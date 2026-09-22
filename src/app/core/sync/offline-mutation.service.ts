import { Injectable, signal, computed, inject } from '@angular/core';
import { FIRESTORE_DB } from '../firebase/firebase.config';
import { doc, runTransaction } from 'firebase/firestore';
import { OfflineOutboxItem } from '../models/ticket.model';

@Injectable({ providedIn: 'root' })
export class OfflineMutationService {
  private readonly firestore = inject(FIRESTORE_DB);
  private readonly dbName = 'ticketforge_offline_db';
  private readonly storeName = 'mutation_outbox';
  private idbInstance: IDBDatabase | null = null;

  private readonly isOnlineSignal = signal<boolean>(navigator.onLine);
  private readonly outboxQueueSignal = signal<readonly OfflineOutboxItem[]>([]);
  private readonly isSyncingSignal = signal<boolean>(false);

  public readonly isOnline = this.isOnlineSignal.asReadonly();
  public readonly isSyncing = this.isSyncingSignal.asReadonly();
  public readonly pendingCount = computed(() =>
    this.outboxQueueSignal().filter(item => item.syncStatus !== 'failed_permanent').length
  );
  public readonly permanentFailures = computed(() =>
    this.outboxQueueSignal().filter(item => item.syncStatus === 'failed_permanent')
  );

  constructor() {
    this.initNetworkListeners();
    void this.initIndexedDb().then(() => this.hydrateFromIndexedDb());
  }

  private initNetworkListeners(): void {
    window.addEventListener('online', () => {
      this.isOnlineSignal.set(true);
      void this.flushOutbox();
    });
    window.addEventListener('offline', () => {
      this.isOnlineSignal.set(false);
    });
  }

  private async initIndexedDb(): Promise<IDBDatabase> {
    if (this.idbInstance) return this.idbInstance;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        this.idbInstance = request.result;
        resolve(this.idbInstance);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async hydrateFromIndexedDb(): Promise<void> {
    const db = await this.initIndexedDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.getAll();
      request.onsuccess = () => {
        this.outboxQueueSignal.set(request.result as OfflineOutboxItem[]);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async persistOutboxItem(item: OfflineOutboxItem): Promise<void> {
    const db = await this.initIndexedDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private async removeOutboxItem(id: string): Promise<void> {
    const db = await this.initIndexedDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async queueCheckInMutation(
    eventId: string,
    ticketId: string,
    operatorId: string,
    timestamp: string
  ): Promise<void> {
    const mutation: OfflineOutboxItem = {
      id: crypto.randomUUID(),
      actionType: 'CHECK_IN_ATTENDEE',
      entityId: ticketId,
      payload: {
        eventId,
        checkInStatus: 'checked_in',
        checkedInAt: timestamp,
        checkedInByUserId: operatorId,
        scanMethod: 'camera_qr'
      },
      createdAt: new Date().toISOString(),
      retryCount: 0,
      syncStatus: 'pending',
      lastErrorMessage: null
    };

    await this.persistOutboxItem(mutation);
    this.outboxQueueSignal.set([...this.outboxQueueSignal(), mutation]);

    if (this.isOnlineSignal()) {
      await this.flushOutbox();
    }
  }

  public async flushOutbox(): Promise<void> {
    if (this.isSyncingSignal() || this.outboxQueueSignal().length === 0) {
      return;
    }

    this.isSyncingSignal.set(true);
    const pendingItems = this.outboxQueueSignal().filter(i => i.syncStatus !== 'failed_permanent');

    for (const item of pendingItems) {
      try {
        if (item.actionType === 'CHECK_IN_ATTENDEE') {
          const eventId = String(item.payload['eventId']);
          const attendeeRef = doc(this.firestore, `events/${eventId}/attendees/${item.entityId}`);
          const auditRef = doc(this.firestore, `events/${eventId}/audit_logs/${crypto.randomUUID()}`);

          await runTransaction(this.firestore, async (transaction) => {
            const snap = await transaction.get(attendeeRef);
            if (!snap.exists()) {
              throw new Error('ATTENDEE_NOT_FOUND');
            }
            const currentData = snap.data();
            if (currentData['checkInStatus'] === 'checked_in') {
              throw new Error('ALREADY_CHECKED_IN_SERVER_CONFLICT');
            }

            transaction.update(attendeeRef, {
              checkInStatus: 'checked_in',
              checkedInAt: item.payload['checkedInAt'],
              checkedInByUserId: item.payload['checkedInByUserId'],
              updatedAt: new Date().toISOString()
            });

            transaction.set(auditRef, {
              attendeeId: item.entityId,
              eventId,
              timestamp: item.payload['checkedInAt'],
              operatorId: item.payload['checkedInByUserId'],
              scanMethod: item.payload['scanMethod'] || 'camera_qr',
              wasOfflineCached: true
            });
          });

          await this.removeOutboxItem(item.id);
          this.outboxQueueSignal.set(this.outboxQueueSignal().filter(q => q.id !== item.id));
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown sync failure';
        const nextCount = item.retryCount + 1;
        const permanentFailure = nextCount >= 5 || errorMsg === 'ALREADY_CHECKED_IN_SERVER_CONFLICT';

        const updatedItem: OfflineOutboxItem = {
          ...item,
          retryCount: nextCount,
          syncStatus: permanentFailure ? 'failed_permanent' : 'failed',
          lastErrorMessage: errorMsg
        };

        await this.persistOutboxItem(updatedItem);
        this.outboxQueueSignal.set(
          this.outboxQueueSignal().map(q => (q.id === item.id ? updatedItem : q))
        );
      }
    }

    this.isSyncingSignal.set(false);
  }
}
