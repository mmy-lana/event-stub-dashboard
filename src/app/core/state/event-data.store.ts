/**
 * Live event data layer.
 *
 * Single owner of the Firestore subscriptions for the active event: the event
 * document, its ticket tiers, attendees and orders. Feature stores (dashboard
 * metrics, roster view state, kiosk scan state) derive from these signals instead
 * of opening their own listeners, which keeps one snapshot stream per collection
 * no matter how many screens are mounted.
 */

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  type Unsubscribe
} from 'firebase/firestore';

import { FIRESTORE_DB } from '../firebase/firebase.config';
import { FirestorePaths } from '../firebase/firestore-paths';
import { DemoSeedService, type SeedResult } from '../firebase/demo-seed.service';
import { OfflineMutationService } from '../sync/offline-mutation.service';
import type {
  AttendeeTicket,
  EventModel,
  ScanMethod,
  TicketOrder,
  TicketTier
} from '../models/ticket.model';

/** Lifecycle of the Firestore subscription set. */
export type EventConnectionState = 'idle' | 'connecting' | 'live' | 'empty' | 'error';

/** Injectable live-data store for one active event. */
@Injectable({ providedIn: 'root' })
export class EventDataStore {
  private readonly firestore = inject(FIRESTORE_DB);
  private readonly seedService = inject(DemoSeedService);
  private readonly outbox = inject(OfflineMutationService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly eventSignal = signal<EventModel | null>(null);
  private readonly tiersSignal = signal<readonly TicketTier[]>([]);
  private readonly attendeesSignal = signal<readonly AttendeeTicket[]>([]);
  private readonly ordersSignal = signal<readonly TicketOrder[]>([]);
  private readonly connectionStateSignal = signal<EventConnectionState>('idle');
  private readonly errorMessageSignal = signal<string | null>(null);
  private readonly isSeedingSignal = signal<boolean>(false);

  /** Unsubscribe handles for the active subscription set. */
  private subscriptions: Unsubscribe[] = [];

  /** Event document currently subscribed to. */
  private activeEventIdValue: string | null = null;

  /** Current event, or `null` before a dataset exists. */
  public readonly event = this.eventSignal.asReadonly();

  /** Ticket tiers ordered by display order. */
  public readonly ticketTiers = this.tiersSignal.asReadonly();

  /** Attendee tickets ordered by last name. */
  public readonly attendees = this.attendeesSignal.asReadonly();

  /** Orders for revenue calculations. */
  public readonly orders = this.ordersSignal.asReadonly();

  /** Subscription lifecycle state. */
  public readonly connectionState = this.connectionStateSignal.asReadonly();

  /** Last subscription error, cleared on a successful connect. */
  public readonly errorMessage = this.errorMessageSignal.asReadonly();

  /** `true` while the demo dataset is being written. */
  public readonly isSeeding = this.isSeedingSignal.asReadonly();

  /** Id of the event currently subscribed to. */
  public readonly activeEventId = computed(() => this.activeEventIdValue);

  /** `true` once live collections are available. */
  public readonly isLive = computed(() => this.connectionStateSignal() === 'live');

  /** `true` when the project has no events yet. */
  public readonly isEmpty = computed(() => this.connectionStateSignal() === 'empty');

  /** Whether demo data can be loaded in this environment. */
  public readonly canSeedDemoData = computed(() => this.seedService.isAvailable);

  /** Tiers keyed by id, for O(1) lookups from roster rows. */
  public readonly tiersById = computed(() => {
    const map = new Map<string, TicketTier>();
    for (const tier of this.tiersSignal()) {
      map.set(tier.id, tier);
    }
    return map;
  });

  /**
   * Subscribes to an event, resolving the active event when no id is supplied.
   *
   * @param eventId Explicit event id; when omitted the most recent event is used.
   * @returns The resolved event id, or `null` when the project is empty.
   */
  public async connect(eventId?: string): Promise<string | null> {
    // Re-connecting to the event that is already live is a no-op, so every screen
    // can safely ask for a connection in its constructor without tearing down the
    // listeners another screen is using.
    if (
      eventId !== undefined &&
      eventId === this.activeEventIdValue &&
      (this.connectionStateSignal() === 'live' || this.connectionStateSignal() === 'connecting')
    ) {
      return this.activeEventIdValue;
    }

    this.disconnect();
    this.connectionStateSignal.set('connecting');
    this.errorMessageSignal.set(null);

    let resolvedId = eventId ?? null;

    try {
      if (resolvedId === null) {
        resolvedId = await this.seedService.resolveActiveEventId();
      }
    } catch (error: unknown) {
      this.connectionStateSignal.set('error');
      this.errorMessageSignal.set(describeError(error));
      return null;
    }

    if (resolvedId === null) {
      this.connectionStateSignal.set('empty');
      return null;
    }

    this.activeEventIdValue = resolvedId;
    this.subscribeToEvent(resolvedId);
    return resolvedId;
  }

  /**
   * Connects only when no live event is available yet.
   *
   * Feature screens that can be the first to mount (the kiosk terminal, a
   * deep-linked pass) call this before reading the roster so a scan is never
   * resolved against an empty cache.
   *
   * @param eventId Optional explicit event id.
   * @returns The resolved event id, or `null` when the project is empty.
   */
  public async ensureConnected(eventId?: string): Promise<string | null> {
    const current = this.activeEventIdValue;
    if (
      current !== null &&
      (this.connectionStateSignal() === 'live' || this.connectionStateSignal() === 'connecting')
    ) {
      return current;
    }
    return this.connect(eventId);
  }

  /** Tears down every active subscription. */
  public disconnect(): void {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    this.subscriptions = [];
    this.activeEventIdValue = null;
    this.eventSignal.set(null);
    this.tiersSignal.set([]);
    this.attendeesSignal.set([]);
    this.ordersSignal.set([]);
    this.connectionStateSignal.set('idle');
  }

  /**
   * Reloads the active event once, without opening new listeners.
   *
   * @returns `true` when the event document was read successfully.
   */
  public async refreshEventDocument(): Promise<boolean> {
    const eventId = this.activeEventIdValue;
    if (eventId === null) {
      return false;
    }

    try {
      const snapshot = await getDoc(doc(this.firestore, FirestorePaths.event(eventId)));
      if (!snapshot.exists()) {
        this.connectionStateSignal.set('empty');
        return false;
      }
      this.eventSignal.set({ id: snapshot.id, ...snapshot.data() } as EventModel);
      return true;
    } catch (error: unknown) {
      this.errorMessageSignal.set(describeError(error));
      return false;
    }
  }

  /**
   * Writes the demo dataset and connects to it.
   *
   * @param force Rewrites an existing demo dataset.
   */
  public async loadDemoDataset(force = false): Promise<SeedResult> {
    this.isSeedingSignal.set(true);
    try {
      const result = await this.seedService.seedDemoEvent(force);
      await this.connect(result.eventId);
      return result;
    } finally {
      this.isSeedingSignal.set(false);
    }
  }

  /**
   * Admits an attendee: optimistically updates local state, then queues the write
   * through the offline outbox so it survives a dropped connection.
   *
   * The outbox is the *only* writer of the admission. Writing the attendee document
   * here as well would race the queued mutation: the flush transaction re-reads the
   * document, would observe `checked_in` and reject the mutation as a duplicate,
   * leaving the denormalised event counters permanently behind.
   *
   * @param ticket Attendee to admit.
   * @param operatorId Operator recorded on the audit trail.
   * @param scanMethod How the pass was captured.
   * @returns `true` when the admission was applied locally.
   */
  public async admitAttendee(
    ticket: AttendeeTicket,
    operatorId: string,
    scanMethod: ScanMethod = 'camera_qr'
  ): Promise<boolean> {
    const eventId = this.activeEventIdValue;
    if (eventId === null || ticket.checkInStatus === 'cancelled') {
      return false;
    }
    if (ticket.checkInStatus === 'checked_in') {
      return false;
    }

    const timestamp = new Date().toISOString();
    this.patchAttendeeLocally(ticket.id, {
      checkInStatus: 'checked_in',
      checkedInAt: timestamp,
      checkedInByUserId: operatorId,
      updatedAt: timestamp
    });

    await this.outbox.queueCheckInMutation(eventId, ticket.id, operatorId, timestamp, scanMethod);
    return true;
  }

  /**
   * Reverses an admission (door operator correction).
   *
   * Like {@link admitAttendee}, the outbox is the only writer: the reversal is
   * queued durably and replicated inside a transaction that decrements the
   * denormalised checked-in counter and appends an audit entry, so a correction
   * made on a disconnected kiosk still lands once the venue network returns.
   *
   * @param ticket Attendee whose admission is reversed.
   * @param operatorId Operator recorded on the audit trail.
   * @returns `true` when the reversal was applied locally.
   */
  public async reverseAdmission(
    ticket: AttendeeTicket,
    operatorId = 'admission_reversal_operator'
  ): Promise<boolean> {
    const eventId = this.activeEventIdValue;
    if (eventId === null || ticket.checkInStatus !== 'checked_in') {
      return false;
    }

    const timestamp = new Date().toISOString();
    this.patchAttendeeLocally(ticket.id, {
      checkInStatus: 'confirmed',
      checkedInAt: null,
      checkedInByUserId: null,
      updatedAt: timestamp
    });

    await this.outbox.queueReverseAdmissionMutation(
      eventId,
      ticket.id,
      operatorId,
      timestamp
    );
    return true;
  }

  /**
   * Refunds an attendee's order and cancels the ticket.
   *
   * The cascade runs in a single transaction: the order is marked refunded, the
   * attendee ticket is cancelled, the tier quota is released and the event counters
   * are adjusted. In production this cascade is owned by an `onOrderUpdated` Cloud
   * Function so a refund issued from the payment provider triggers it too; running
   * it client-side here keeps the emulator workflow complete.
   *
   * @param ticket Attendee ticket whose order is refunded.
   * @returns `true` when the refund was applied.
   */
  public async refundTicket(ticket: AttendeeTicket): Promise<boolean> {
    const eventId = this.activeEventIdValue;
    if (eventId === null) {
      return false;
    }

    try {
      await runTransaction(this.firestore, async (transaction) => {
        const attendeeRef = doc(this.firestore, FirestorePaths.attendee(eventId, ticket.id));
        const orderRef = doc(this.firestore, FirestorePaths.order(eventId, ticket.orderId));
        const tierRef = doc(this.firestore, FirestorePaths.ticketTier(eventId, ticket.ticketTierId));
        const eventRef = doc(this.firestore, FirestorePaths.event(eventId));

        const [attendeeSnapshot, orderSnapshot, tierSnapshot, eventSnapshot] = await Promise.all([
          transaction.get(attendeeRef),
          transaction.get(orderRef),
          transaction.get(tierRef),
          transaction.get(eventRef)
        ]);

        if (!attendeeSnapshot.exists()) {
          throw new Error('ATTENDEE_NOT_FOUND');
        }
        if (attendeeSnapshot.data()['checkInStatus'] === 'cancelled') {
          throw new Error('ALREADY_CANCELLED');
        }

        const timestamp = new Date().toISOString();
        transaction.update(attendeeRef, {
          checkInStatus: 'cancelled',
          checkedInAt: null,
          checkedInByUserId: null,
          updatedAt: timestamp
        });

        if (orderSnapshot.exists()) {
          transaction.update(orderRef, { paymentStatus: 'refunded' });
        }

        if (tierSnapshot.exists()) {
          const available = Number(tierSnapshot.data()['availableQuota'] ?? 0);
          transaction.update(tierRef, { availableQuota: available + 1 });
        }

        if (eventSnapshot.exists()) {
          const issued = Number(eventSnapshot.data()['totalTicketsIssued'] ?? 0);
          const checkedIn = Number(eventSnapshot.data()['totalTicketsCheckedIn'] ?? 0);
          transaction.update(eventRef, {
            totalTicketsIssued: Math.max(0, issued - 1),
            totalTicketsCheckedIn:
              attendeeSnapshot.data()['checkInStatus'] === 'checked_in'
                ? Math.max(0, checkedIn - 1)
                : checkedIn,
            updatedAt: timestamp
          });
        }
      });

      this.patchAttendeeLocally(ticket.id, {
        checkInStatus: 'cancelled',
        checkedInAt: null,
        checkedInByUserId: null
      });
      return true;
    } catch (error: unknown) {
      this.errorMessageSignal.set(describeError(error));
      return false;
    }
  }

  /** Applies a partial update to one attendee in the local signal. */
  private patchAttendeeLocally(ticketId: string, patch: Partial<AttendeeTicket>): void {
    this.attendeesSignal.update((attendees) =>
      attendees.map((attendee) =>
        attendee.id === ticketId ? { ...attendee, ...patch } : attendee
      )
    );
  }

  /** Opens the four snapshot listeners for an event. */
  private subscribeToEvent(eventId: string): void {
    const eventRef = doc(this.firestore, FirestorePaths.event(eventId));
    let firstEventSnapshot = true;

    this.subscriptions.push(
      onSnapshot(
        eventRef,
        (snapshot) => {
          if (!snapshot.exists()) {
            this.connectionStateSignal.set('empty');
            return;
          }
          this.eventSignal.set({ id: snapshot.id, ...snapshot.data() } as EventModel);
          if (firstEventSnapshot) {
            firstEventSnapshot = false;
            this.connectionStateSignal.set('live');
          }
        },
        (error) => {
          this.connectionStateSignal.set('error');
          this.errorMessageSignal.set(describeError(error));
        }
      )
    );

    this.subscriptions.push(
      onSnapshot(
        query(
          collection(this.firestore, FirestorePaths.ticketTiers(eventId)),
          orderBy('displayOrder', 'asc')
        ),
        (snapshot) => {
          this.tiersSignal.set(
            snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as TicketTier)
          );
        },
        (error) => this.errorMessageSignal.set(describeError(error))
      )
    );

    this.subscriptions.push(
      onSnapshot(
        query(
          collection(this.firestore, FirestorePaths.attendees(eventId)),
          orderBy('lastName', 'asc')
        ),
        (snapshot) => {
          this.attendeesSignal.set(
            snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as AttendeeTicket)
          );
        },
        (error) => this.errorMessageSignal.set(describeError(error))
      )
    );

    this.subscriptions.push(
      onSnapshot(
        collection(this.firestore, FirestorePaths.orders(eventId)),
        (snapshot) => {
          this.ordersSignal.set(
            snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as TicketOrder)
          );
        },
        (error) => this.errorMessageSignal.set(describeError(error))
      )
    );

    this.destroyRef.onDestroy(() => this.disconnect());
  }
}

/** Extracts a stable message from an unknown thrown value. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : 'Unknown Firestore error';
}
