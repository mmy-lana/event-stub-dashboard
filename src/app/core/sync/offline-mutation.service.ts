/**
 * Offline mutation outbox.
 *
 * Check-ins captured at the door are written to a local IndexedDB queue first and
 * replicated to Firestore afterwards, so an admission is never lost when the venue
 * network drops. Each entry is applied inside a Firestore transaction that
 * re-checks the server state, which keeps a duplicated scan from double-admitting
 * an attendee.
 *
 * Durability contract:
 * - The queue is persisted before any network attempt.
 * - Flushing is skipped entirely while the browser is offline, so retry counters
 *   are never burned by a transport outage.
 * - A mutation becomes `failed_permanent` only for a real server conflict or once
 *   it exhausts {@link VALIDATION_RULES.MAX_OFFLINE_RETRIES} attempts.
 * - When IndexedDB is unavailable (private browsing, hardened contexts) the queue
 *   degrades to in-memory only and reports that through `persistenceMode`.
 */

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { doc, runTransaction } from 'firebase/firestore';

import { FIRESTORE_DB } from '../firebase/firebase.config';
import { FirestorePaths } from '../firebase/firestore-paths';
import {
  VALIDATION_RULES,
  type CheckInAuditLog,
  type OfflineOutboxItem,
  type OutboxActionType,
  type ScanMethod
} from '../models/ticket.model';

/** Where the outbox is currently stored. */
export type OutboxPersistenceMode = 'indexeddb' | 'memory';

/** Error codes raised by the outbox flush routine. */
const SYNC_ERRORS = {
  attendeeNotFound: 'ATTENDEE_NOT_FOUND',
  alreadyCheckedIn: 'ALREADY_CHECKED_IN_SERVER_CONFLICT',
  unsupportedAction: 'UNSUPPORTED_ACTION_TYPE',
  ticketCancelled: 'TICKET_CANCELLED'
} as const;

/** Summary returned by {@link OfflineMutationService.flushOutbox}. */
export interface FlushResult {
  readonly synced: number;
  readonly failed: number;
  readonly skipped: boolean;
}

/**
 * Signal-backed outbox with automatic reconnect flushing.
 */
@Injectable({ providedIn: 'root' })
export class OfflineMutationService {
  private readonly firestore = inject(FIRESTORE_DB);
  private readonly destroyRef = inject(DestroyRef);

  /** IndexedDB database and object store holding the queue. */
  private readonly databaseName = 'stubdeck_offline_db';
  private readonly storeName = 'mutation_outbox';

  private database: IDBDatabase | null = null;
  private persistenceFailed = false;

  private readonly isOnlineSignal = signal<boolean>(readBrowserOnlineState());
  private readonly outboxQueueSignal = signal<readonly OfflineOutboxItem[]>([]);
  private readonly isSyncingSignal = signal<boolean>(false);
  private readonly lastFlushAtSignal = signal<string | null>(null);
  private readonly lastFlushResultSignal = signal<FlushResult | null>(null);
  private readonly persistenceModeSignal = signal<OutboxPersistenceMode>('indexeddb');

  /** `true` while the browser reports a usable network interface. */
  public readonly isOnline = this.isOnlineSignal.asReadonly();

  /** `true` while a flush is in progress. */
  public readonly isSyncing = this.isSyncingSignal.asReadonly();

  /** ISO 8601 timestamp of the last completed flush attempt. */
  public readonly lastFlushAt = this.lastFlushAtSignal.asReadonly();

  /** Outcome of the last completed flush attempt. */
  public readonly lastFlushResult = this.lastFlushResultSignal.asReadonly();

  /** Whether the queue survives a reload (`indexeddb`) or not (`memory`). */
  public readonly persistenceMode = this.persistenceModeSignal.asReadonly();

  /** Every queued mutation, including permanent failures. */
  public readonly queue = this.outboxQueueSignal.asReadonly();

  /** Mutations still waiting to reach the backend. */
  public readonly pendingCount = computed(
    () => this.outboxQueueSignal().filter((item) => item.syncStatus !== 'failed_permanent').length
  );

  /** Mutations that exhausted their retries or hit a server conflict. */
  public readonly permanentFailures = computed(() =>
    this.outboxQueueSignal().filter((item) => item.syncStatus === 'failed_permanent')
  );

  /** `true` when at least one mutation still needs to reach the backend. */
  public readonly hasPendingMutations = computed(() => this.pendingCount() > 0);

  public constructor() {
    this.registerNetworkListeners();
    void this.hydrate();
  }

  /* ---------------------------------------------------------------------- */
  /* Queueing                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Queues a check-in captured at the door and flushes immediately when online.
   *
   * A second scan of the same ticket while it is still queued is ignored, which
   * prevents an offline double-scan from becoming a server-side conflict.
   *
   * @param eventId Owning event id.
   * @param ticketId Attendee ticket document id.
   * @param operatorId Kiosk operator (or terminal id when unauthenticated).
   * @param timestamp ISO 8601 capture time.
   * @param scanMethod How the pass was captured.
   * @returns The queued item, or the existing item when the scan was a duplicate.
   */
  public async queueCheckInMutation(
    eventId: string,
    ticketId: string,
    operatorId: string,
    timestamp: string,
    scanMethod: ScanMethod = 'camera_qr'
  ): Promise<OfflineOutboxItem> {
    const duplicate = this.outboxQueueSignal().find(
      (item) =>
        item.actionType === 'CHECK_IN_ATTENDEE' &&
        item.entityId === ticketId &&
        item.syncStatus !== 'failed_permanent'
    );

    if (duplicate !== undefined) {
      return duplicate;
    }

    const mutation: OfflineOutboxItem = {
      id: createIdentifier(),
      actionType: 'CHECK_IN_ATTENDEE',
      entityId: ticketId,
      payload: {
        eventId,
        checkInStatus: 'checked_in',
        checkedInAt: timestamp,
        checkedInByUserId: operatorId,
        scanMethod
      },
      createdAt: new Date().toISOString(),
      retryCount: 0,
      syncStatus: 'pending',
      lastErrorMessage: null
    };

    await this.persistItem(mutation);
    this.outboxQueueSignal.update((queue) => [...queue, mutation]);

    if (this.isOnlineSignal()) {
      await this.flushOutbox();
    }

    return mutation;
  }

  /* ---------------------------------------------------------------------- */
  /* Replication                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Replicates every pending mutation, oldest first.
   *
   * @returns Counts of synced and failed mutations; `skipped` is `true` when the
   *   flush was deliberately not attempted (offline, or nothing to do).
   */
  public async flushOutbox(): Promise<FlushResult> {
    if (this.isSyncingSignal()) {
      return { synced: 0, failed: 0, skipped: true };
    }

    if (!this.isOnlineSignal()) {
      // Retry counters are only spent on real server rejections.
      return { synced: 0, failed: 0, skipped: true };
    }

    const pending = this.outboxQueueSignal().filter(
      (item) => item.syncStatus !== 'failed_permanent'
    );

    if (pending.length === 0) {
      return { synced: 0, failed: 0, skipped: true };
    }

    this.isSyncingSignal.set(true);
    let synced = 0;
    let failed = 0;

    try {
      for (const item of pending) {
        const outcome = await this.replicate(item);
        if (outcome) {
          synced += 1;
        } else {
          failed += 1;
        }
      }
    } finally {
      this.isSyncingSignal.set(false);
      this.lastFlushAtSignal.set(new Date().toISOString());
      this.lastFlushResultSignal.set({ synced, failed, skipped: false });
    }

    return { synced, failed, skipped: false };
  }

  /**
   * Applies one mutation inside a transaction that re-validates server state.
   *
   * @returns `true` when the mutation was applied and dequeued.
   */
  private async replicate(item: OfflineOutboxItem): Promise<boolean> {
    try {
      if (item.actionType !== 'CHECK_IN_ATTENDEE') {
        throw new Error(SYNC_ERRORS.unsupportedAction);
      }

      const eventId = readString(item.payload['eventId']);
      if (eventId === null) {
        throw new Error(SYNC_ERRORS.unsupportedAction);
      }
      const checkedInAt = readString(item.payload['checkedInAt']) ?? new Date().toISOString();
      const operatorId = readString(item.payload['checkedInByUserId']) ?? 'KIOSK_UNKNOWN';
      const scanMethod = readScanMethod(item.payload['scanMethod']);

      const attendeeRef = doc(this.firestore, FirestorePaths.attendee(eventId, item.entityId));
      const auditRef = doc(this.firestore, FirestorePaths.auditLog(eventId, createIdentifier()));

      await runTransaction(this.firestore, async (transaction) => {
        const snapshot = await transaction.get(attendeeRef);
        if (!snapshot.exists()) {
          throw new Error(SYNC_ERRORS.attendeeNotFound);
        }

        const data = snapshot.data();
        const status = data['checkInStatus'];

        if (status === 'checked_in') {
          throw new Error(SYNC_ERRORS.alreadyCheckedIn);
        }
        if (status === 'cancelled') {
          throw new Error(SYNC_ERRORS.ticketCancelled);
        }

        transaction.update(attendeeRef, {
          checkInStatus: 'checked_in',
          checkedInAt,
          checkedInByUserId: operatorId,
          updatedAt: new Date().toISOString()
        });

        const auditLog: Omit<CheckInAuditLog, 'id'> = {
          attendeeId: item.entityId,
          eventId,
          timestamp: checkedInAt,
          operatorId,
          scanMethod,
          wasOfflineCached: true
        };
        transaction.set(auditRef, auditLog);
      });

      await this.removeItem(item.id);
      this.outboxQueueSignal.update((queue) => queue.filter((entry) => entry.id !== item.id));
      return true;
    } catch (error: unknown) {
      await this.markFailed(item, describeError(error));
      return false;
    }
  }

  /** Records a failed attempt, escalating to `failed_permanent` when exhausted. */
  private async markFailed(item: OfflineOutboxItem, message: string): Promise<void> {
    const retryCount = item.retryCount + 1;
    const permanent =
      retryCount >= VALIDATION_RULES.MAX_OFFLINE_RETRIES ||
      message === SYNC_ERRORS.alreadyCheckedIn ||
      message === SYNC_ERRORS.attendeeNotFound ||
      message === SYNC_ERRORS.ticketCancelled ||
      message === SYNC_ERRORS.unsupportedAction;

    const updated: OfflineOutboxItem = {
      ...item,
      retryCount,
      syncStatus: permanent ? 'failed_permanent' : 'failed',
      lastErrorMessage: message
    };

    await this.persistItem(updated);
    this.outboxQueueSignal.update((queue) =>
      queue.map((entry) => (entry.id === item.id ? updated : entry))
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Operator controls                                                      */
  /* ---------------------------------------------------------------------- */

  /**
   * Returns permanently failed mutations to the queue for another attempt.
   *
   * Used after an operator resolves a conflict (for example a ticket that was
   * re-issued) instead of forcing them to clear the queue.
   *
   * @returns How many entries were re-armed.
   */
  public async retryPermanentFailures(): Promise<number> {
    const failedItems = this.permanentFailures();
    if (failedItems.length === 0) {
      return 0;
    }

    const rearmed = failedItems.map<OfflineOutboxItem>((item) => ({
      ...item,
      retryCount: 0,
      syncStatus: 'pending',
      lastErrorMessage: null
    }));

    for (const item of rearmed) {
      await this.persistItem(item);
    }

    this.outboxQueueSignal.update((queue) =>
      queue.map((entry) => rearmed.find((candidate) => candidate.id === entry.id) ?? entry)
    );

    await this.flushOutbox();
    return rearmed.length;
  }

  /**
   * Drops permanently failed mutations.
   *
   * @returns How many entries were discarded.
   */
  public async discardPermanentFailures(): Promise<number> {
    const failedItems = this.permanentFailures();
    for (const item of failedItems) {
      await this.removeItem(item.id);
    }

    if (failedItems.length > 0) {
      const discarded = new Set(failedItems.map((item) => item.id));
      this.outboxQueueSignal.update((queue) => queue.filter((entry) => !discarded.has(entry.id)));
    }

    return failedItems.length;
  }

  /* ---------------------------------------------------------------------- */
  /* Persistence                                                            */
  /* ---------------------------------------------------------------------- */

  /** Loads the persisted queue, falling back to memory-only when unavailable. */
  private async hydrate(): Promise<void> {
    try {
      const database = await this.openDatabase();
      const items = await new Promise<OfflineOutboxItem[]>((resolve, reject) => {
        const transaction = database.transaction(this.storeName, 'readonly');
        const request = transaction.objectStore(this.storeName).getAll();
        request.onsuccess = () => resolve(request.result as OfflineOutboxItem[]);
        request.onerror = () => reject(request.error);
      });

      // Oldest first so the door queue replays in arrival order.
      this.outboxQueueSignal.set(
        [...items].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      );
      this.persistenceModeSignal.set('indexeddb');

      if (this.isOnlineSignal()) {
        await this.flushOutbox();
      }
    } catch {
      this.persistenceFailed = true;
      this.persistenceModeSignal.set('memory');
    }
  }

  /** Opens (and upgrades) the outbox database. */
  private async openDatabase(): Promise<IDBDatabase> {
    if (this.database !== null) {
      return this.database;
    }
    if (this.persistenceFailed) {
      throw new Error('IndexedDB unavailable');
    }
    if (typeof indexedDB === 'undefined') {
      this.persistenceFailed = true;
      throw new Error('IndexedDB unavailable');
    }

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        const upgraded = request.result;
        if (!upgraded.objectStoreNames.contains(this.storeName)) {
          upgraded.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    this.database = database;
    return database;
  }

  /** Writes (or overwrites) one mutation, degrading silently to memory. */
  private async persistItem(item: OfflineOutboxItem): Promise<void> {
    try {
      const database = await this.openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(this.storeName, 'readwrite');
        const request = transaction.objectStore(this.storeName).put(item);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      this.persistenceModeSignal.set('indexeddb');
    } catch {
      this.persistenceFailed = true;
      this.persistenceModeSignal.set('memory');
    }
  }

  /** Deletes one mutation, degrading silently to memory. */
  private async removeItem(id: string): Promise<void> {
    try {
      const database = await this.openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(this.storeName, 'readwrite');
        const request = transaction.objectStore(this.storeName).delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch {
      this.persistenceFailed = true;
      this.persistenceModeSignal.set('memory');
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Network                                                                */
  /* ---------------------------------------------------------------------- */

  /** Flushes the queue as soon as the browser regains connectivity. */
  private registerNetworkListeners(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const onOnline = (): void => {
      this.isOnlineSignal.set(true);
      void this.flushOutbox();
    };
    const onOffline = (): void => {
      this.isOnlineSignal.set(false);
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      this.database?.close();
      this.database = null;
    });
  }
}

/** Reads `navigator.onLine` defensively for SSR and test environments. */
function readBrowserOnlineState(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') {
    return true;
  }
  return navigator.onLine;
}

/** Creates a unique id, falling back when `crypto.randomUUID` is unavailable. */
function createIdentifier(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Reads an unknown payload value as a string. */
function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Narrows a payload value to a supported scan method. */
function readScanMethod(value: unknown): ScanMethod {
  return value === 'manual_button' || value === 'barcode_hardware' ? value : 'camera_qr';
}

/** Extracts a stable message from an unknown thrown value. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'Unknown sync failure';
}

/** Action types the outbox understands; exported for UI copy. */
export const SUPPORTED_OUTBOX_ACTIONS: readonly OutboxActionType[] = ['CHECK_IN_ATTENDEE'];
