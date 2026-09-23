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

import { FIREBASE_CONFIG, FIRESTORE_DB } from '../firebase/firebase.config';
import { FirestorePaths } from '../firebase/firestore-paths';
import { DemoSeedService, DEMO_EVENT_ID, type SeedResult } from '../firebase/demo-seed.service';
import { OfflineMutationService } from '../sync/offline-mutation.service';
import { TicketSecurityUtility } from '../../shared/utils/ticket-cryptography';
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
  private readonly config = inject(FIREBASE_CONFIG);
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

  /**
   * `true` when the store is serving the in-memory mock dataset because no Firebase
   * backend is configured (see `FirebaseEnvironmentConfig.isMockMode`).
   *
   * Exposed as a signal so templates bind to it as `isMockMode()`, matching every
   * other selector on this store rather than reading a raw boolean field.
   */
  public readonly isMockMode = signal<boolean>(this.config.isMockMode).asReadonly();

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

    // Offline preview: no Firestore listener is opened at all. The dataset is built
    // in memory and the store reports itself as `live` so every screen renders its
    // real content instead of the empty state or an eternal spinner. This is what
    // keeps a credential-less deployment (Vercel preview, static export) from
    // showing a blank page.
    if (this.config.isMockMode) {
      this.activeEventIdValue = DEMO_EVENT_ID;
      this.populateInMemoryMockData();
      this.connectionStateSignal.set('live');
      return DEMO_EVENT_ID;
    }

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

    // The mock dataset has no server document to re-read; the signals already hold
    // the only copy of it.
    if (this.config.isMockMode) {
      return this.eventSignal() !== null;
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
    // Offline preview already serves the dataset from memory, so the "Load demo
    // dataset" affordance must not issue a Firestore writeBatch against a backend
    // that does not exist.
    if (this.config.isMockMode) {
      this.activeEventIdValue = DEMO_EVENT_ID;
      this.populateInMemoryMockData();
      this.connectionStateSignal.set('live');
      return {
        seeded: false,
        eventId: DEMO_EVENT_ID,
        reason: 'The in-memory mock dataset is already active in offline preview mode.',
        tiersWritten: this.tiersSignal().length,
        attendeesWritten: this.attendeesSignal().length,
        ordersWritten: this.ordersSignal().length
      };
    }

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

    // Offline preview: there is no backend to replicate to, so the optimistically
    // committed signal update *is* the admission. Queueing it would leave a mutation
    // that can never drain and would misreport a healthy outbox as backed up.
    if (this.config.isMockMode) {
      return true;
    }

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

    // See `admitAttendee`: offline preview applies the reversal in memory only.
    if (this.config.isMockMode) {
      return true;
    }

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

    // Offline preview: the same cascade, applied to the in-memory signals instead of
    // a Firestore transaction. Without this the `runTransaction` below would reject
    // against an unreachable backend and every refund would silently no-op.
    if (this.config.isMockMode) {
      return this.applyRefundLocally(ticket);
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

        // Seats on an unsettled order are issued already cancelled, so refunding one
        // would otherwise always trip the double-refund guard and the reserved quota
        // could never be released — an abandoned checkout would hold its seats
        // forever. A settled order keeps the guard.
        const isPendingOrder =
          orderSnapshot.exists() && orderSnapshot.data()['paymentStatus'] === 'pending';
        const isCancelledTicket = attendeeSnapshot.data()['checkInStatus'] === 'cancelled';

        if (isCancelledTicket && !isPendingOrder) {
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

  /**
   * Populates the in-memory signals with a complete demo conference dataset.
   *
   * Used when {@link FirebaseEnvironmentConfig.isMockMode} is set, so an offline
   * deployment still renders a populated dashboard, roster and kiosk. The tokens are
   * minted through `TicketSecurityUtility`, so the passes produced here verify under
   * the same cryptographic check the kiosk runs against a real camera scan.
   */
  private populateInMemoryMockData(): void {
    const now = new Date();
    const nowIso = now.toISOString();
    const dayMs = 86_400_000;

    const tiers: readonly TicketTier[] = [
      {
        id: 'tier_vip',
        eventId: DEMO_EVENT_ID,
        name: 'VIP Access All-Inclusive',
        tierType: 'paid',
        priceCents: 24900,
        currency: 'USD',
        initialQuota: 120,
        availableQuota: 96,
        maxPerOrder: 4,
        salesStartDate: new Date(now.getTime() - 90 * dayMs).toISOString(),
        salesEndDate: new Date(now.getTime() + dayMs).toISOString(),
        perks: ['Front row seating', 'Speaker lounge', 'Dinner reception'],
        badgeColorHex: '#7c3aed',
        isActive: true,
        displayOrder: 1
      },
      {
        id: 'tier_ga',
        eventId: DEMO_EVENT_ID,
        name: 'General Admission',
        tierType: 'paid',
        priceCents: 12500,
        currency: 'USD',
        initialQuota: 900,
        availableQuota: 687,
        maxPerOrder: 8,
        salesStartDate: new Date(now.getTime() - 90 * dayMs).toISOString(),
        salesEndDate: new Date(now.getTime() + dayMs).toISOString(),
        perks: ['All keynotes', 'Expo hall', 'Recorded sessions'],
        badgeColorHex: '#ff5a36',
        isActive: true,
        displayOrder: 2
      },
      {
        id: 'tier_student',
        eventId: DEMO_EVENT_ID,
        name: 'Student Pass',
        tierType: 'free',
        priceCents: 0,
        currency: 'USD',
        initialQuota: 80,
        availableQuota: 45,
        maxPerOrder: 2,
        salesStartDate: new Date(now.getTime() - 90 * dayMs).toISOString(),
        salesEndDate: new Date(now.getTime() + dayMs).toISOString(),
        perks: ['Valid student ID required'],
        badgeColorHex: '#10b981',
        isActive: true,
        displayOrder: 3
      }
    ];

    const attendees: readonly AttendeeTicket[] = [
      {
        id: 'tkt_001',
        eventId: DEMO_EVENT_ID,
        orderId: 'ord_001',
        ticketTierId: 'tier_vip',
        ticketTierName: 'VIP Access All-Inclusive',
        ticketStubNumber: 'EVT-8924-XQ9',
        firstName: 'Alexandra',
        lastName: 'Chen',
        email: 'alexandra.chen@northwind.dev',
        phoneNumber: '+14155552671',
        companyOrAffiliation: 'Northwind Labs',
        checkInStatus: 'checked_in',
        checkedInAt: new Date(now.getTime() - 4 * 60_000).toISOString(),
        checkedInByUserId: 'kiosk_door_a',
        qrVerificationSecret: TicketSecurityUtility.generateVerifiableToken(
          'tkt_001',
          'EVT-8924-XQ9',
          DEMO_EVENT_ID
        ),
        barcodeValue: TicketSecurityUtility.generateBarcodeValue('EVT-8924-XQ9', 'VIP', 'DOORA'),
        seatAssignment: 'A-14',
        createdAt: new Date(now.getTime() - 3_600_000).toISOString(),
        updatedAt: new Date(now.getTime() - 4 * 60_000).toISOString()
      },
      {
        id: 'tkt_002',
        eventId: DEMO_EVENT_ID,
        orderId: 'ord_002',
        ticketTierId: 'tier_ga',
        ticketTierName: 'General Admission',
        ticketStubNumber: 'EVT-4417-KM2',
        firstName: 'Marcus',
        lastName: 'Delgado',
        email: 'm.delgado@lumenworks.io',
        phoneNumber: '+14155558899',
        companyOrAffiliation: 'Lumen Works',
        checkInStatus: 'checked_in',
        checkedInAt: new Date(now.getTime() - 9 * 60_000).toISOString(),
        checkedInByUserId: 'kiosk_door_b',
        qrVerificationSecret: TicketSecurityUtility.generateVerifiableToken(
          'tkt_002',
          'EVT-4417-KM2',
          DEMO_EVENT_ID
        ),
        barcodeValue: TicketSecurityUtility.generateBarcodeValue('EVT-4417-KM2', 'GA', 'DOORB'),
        createdAt: new Date(now.getTime() - 7_200_000).toISOString(),
        updatedAt: new Date(now.getTime() - 9 * 60_000).toISOString()
      },
      {
        id: 'tkt_003',
        eventId: DEMO_EVENT_ID,
        orderId: 'ord_003',
        ticketTierId: 'tier_student',
        ticketTierName: 'Student Pass',
        ticketStubNumber: 'EVT-7730-PL4',
        firstName: 'Hana',
        lastName: 'Yamada',
        email: 'hana.yamada@sakuragumi.jp',
        phoneNumber: '+14155554321',
        companyOrAffiliation: 'Sakura Gumi',
        checkInStatus: 'confirmed',
        checkedInAt: null,
        checkedInByUserId: null,
        qrVerificationSecret: TicketSecurityUtility.generateVerifiableToken(
          'tkt_003',
          'EVT-7730-PL4',
          DEMO_EVENT_ID
        ),
        barcodeValue: TicketSecurityUtility.generateBarcodeValue('EVT-7730-PL4', 'GA', 'DOORA'),
        createdAt: new Date(now.getTime() - 10_800_000).toISOString(),
        updatedAt: new Date(now.getTime() - 10_800_000).toISOString()
      },
      {
        id: 'tkt_004',
        eventId: DEMO_EVENT_ID,
        orderId: 'ord_004',
        ticketTierId: 'tier_ga',
        ticketTierName: 'General Admission',
        ticketStubNumber: 'EVT-2298-RT7',
        firstName: 'Ingrid',
        lastName: 'Halvorsen',
        email: 'ingrid.h@fjordtek.no',
        phoneNumber: '+14155557744',
        companyOrAffiliation: 'Fjordtek',
        checkInStatus: 'confirmed',
        checkedInAt: null,
        checkedInByUserId: null,
        qrVerificationSecret: TicketSecurityUtility.generateVerifiableToken(
          'tkt_004',
          'EVT-2298-RT7',
          DEMO_EVENT_ID
        ),
        barcodeValue: TicketSecurityUtility.generateBarcodeValue('EVT-2298-RT7', 'GA', 'DOORB'),
        createdAt: new Date(now.getTime() - 14_400_000).toISOString(),
        updatedAt: new Date(now.getTime() - 14_400_000).toISOString()
      },
      {
        id: 'tkt_005',
        eventId: DEMO_EVENT_ID,
        orderId: 'ord_005',
        ticketTierId: 'tier_vip',
        ticketTierName: 'VIP Access All-Inclusive',
        ticketStubNumber: 'EVT-5106-BN3',
        firstName: 'Fatima',
        lastName: 'Al-Sayed',
        email: 'fatima.alsayed@dunelabs.ae',
        phoneNumber: '+14155553322',
        companyOrAffiliation: 'Dune Labs',
        checkInStatus: 'checked_in',
        checkedInAt: new Date(now.getTime() - 2 * 60_000).toISOString(),
        checkedInByUserId: 'kiosk_door_a',
        qrVerificationSecret: TicketSecurityUtility.generateVerifiableToken(
          'tkt_005',
          'EVT-5106-BN3',
          DEMO_EVENT_ID
        ),
        barcodeValue: TicketSecurityUtility.generateBarcodeValue('EVT-5106-BN3', 'VIP', 'DOORB'),
        seatAssignment: 'A-21',
        createdAt: new Date(now.getTime() - 18_000_000).toISOString(),
        updatedAt: new Date(now.getTime() - 2 * 60_000).toISOString()
      },
      {
        id: 'tkt_006',
        eventId: DEMO_EVENT_ID,
        orderId: 'ord_006',
        ticketTierId: 'tier_ga',
        ticketTierName: 'General Admission',
        ticketStubNumber: 'EVT-3381-HD8',
        firstName: 'Priya',
        lastName: 'Raman',
        email: 'priya.raman@arcadia.health',
        phoneNumber: '+14155551100',
        companyOrAffiliation: 'Arcadia Health',
        checkInStatus: 'cancelled',
        checkedInAt: null,
        checkedInByUserId: null,
        qrVerificationSecret: TicketSecurityUtility.generateVerifiableToken(
          'tkt_006',
          'EVT-3381-HD8',
          DEMO_EVENT_ID
        ),
        barcodeValue: TicketSecurityUtility.generateBarcodeValue('EVT-3381-HD8', 'GA', 'DOORA'),
        createdAt: new Date(now.getTime() - 21_600_000).toISOString(),
        updatedAt: new Date(now.getTime() - 21_600_000).toISOString()
      }
    ];

    const priceByTier: Record<string, number> = {
      tier_vip: 24900,
      tier_ga: 12500,
      tier_student: 0
    };

    const orders: readonly TicketOrder[] = attendees.map((attendee, index) => {
      const unitPriceCents = priceByTier[attendee.ticketTierId] ?? 0;
      return {
        id: attendee.orderId,
        eventId: DEMO_EVENT_ID,
        orderReference: `ESD-2026-${(index + 1).toString().padStart(3, '0')}`,
        customerFirstName: attendee.firstName,
        customerLastName: attendee.lastName,
        customerEmail: attendee.email,
        subtotalCents: unitPriceCents,
        discountCents: 0,
        totalCents: unitPriceCents,
        currency: 'USD',
        paymentStatus:
          attendee.checkInStatus === 'cancelled'
            ? 'refunded'
            : unitPriceCents === 0
              ? 'free_rsvp'
              : 'completed',
        paymentMethod: unitPriceCents === 0 ? 'free' : 'stripe_card',
        lineItems: [
          {
            ticketTierId: attendee.ticketTierId,
            tierName: attendee.ticketTierName,
            quantity: 1,
            unitPriceCents,
            subtotalCents: unitPriceCents
          }
        ],
        createdAt: attendee.createdAt
      };
    });

    this.eventSignal.set({
      id: DEMO_EVENT_ID,
      organizerId: 'org_event_stub_dashboard_demo',
      title: 'Summit Tech Conf 2026',
      slug: 'summit-tech-conf-2026',
      summary: 'Two halls, 40 speakers and a full day of platform engineering.',
      description:
        'The annual platform engineering summit: distributed systems, developer experience ' +
        'and on-call culture across two halls, with a workshop track and an evening reception.',
      bannerImageUrl:
        'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1200&q=80',
      eventType: 'in_person',
      venue: {
        venueName: 'Moscone Center, Hall D',
        streetAddress: '747 Howard St',
        unitSuite: 'Hall D',
        city: 'San Francisco',
        stateProvince: 'CA',
        postalCode: '94103',
        country: 'United States',
        latitude: 37.7842,
        longitude: -122.4014
      },
      virtualMeetingUrl: null,
      startDateTime: new Date(now.getTime() + dayMs).toISOString(),
      endDateTime: new Date(now.getTime() + 2 * dayMs).toISOString(),
      timezone: 'America/Los_Angeles',
      status: 'published',
      totalCapacity: tiers.reduce((total, tier) => total + tier.initialQuota, 0),
      totalTicketsIssued: attendees.filter((entry) => entry.checkInStatus !== 'cancelled').length,
      totalTicketsCheckedIn: attendees.filter((entry) => entry.checkInStatus === 'checked_in').length,
      currency: 'USD',
      tags: ['conference', 'platform-engineering', 'in-person'],
      createdAt: nowIso,
      updatedAt: nowIso
    });

    this.tiersSignal.set(tiers);
    this.attendeesSignal.set(attendees);
    this.ordersSignal.set(orders);
  }

  /**
   * Mirrors the refund cascade onto the in-memory signals.
   *
   * Applies exactly the effects of the Firestore transaction in
   * {@link refundTicket}: the ticket is cancelled, its order is marked refunded, the
   * tier quota is released and the event's issued/checked-in counters are adjusted.
   * The double-refund guard is preserved so a repeated click stays a no-op.
   *
   * @param ticket Attendee ticket whose order is refunded.
   * @returns `true` when the refund was applied.
   */
  private applyRefundLocally(ticket: AttendeeTicket): boolean {
    const current = this.attendeesSignal().find((entry) => entry.id === ticket.id);
    if (current === undefined) {
      this.errorMessageSignal.set('ATTENDEE_NOT_FOUND');
      return false;
    }

    const order = this.ordersSignal().find((entry) => entry.id === current.orderId);
    const isPendingOrder = order?.paymentStatus === 'pending';
    const isCancelledTicket = current.checkInStatus === 'cancelled';

    if (isCancelledTicket && !isPendingOrder) {
      this.errorMessageSignal.set('ALREADY_CANCELLED');
      return false;
    }

    const timestamp = new Date().toISOString();
    const wasAdmitted = current.checkInStatus === 'checked_in';

    this.patchAttendeeLocally(current.id, {
      checkInStatus: 'cancelled',
      checkedInAt: null,
      checkedInByUserId: null,
      updatedAt: timestamp
    });

    this.ordersSignal.update((orders) =>
      orders.map((entry) =>
        entry.id === current.orderId ? { ...entry, paymentStatus: 'refunded' } : entry
      )
    );

    this.tiersSignal.update((tiers) =>
      tiers.map((tier) =>
        tier.id === current.ticketTierId
          ? { ...tier, availableQuota: tier.availableQuota + 1 }
          : tier
      )
    );

    this.eventSignal.update((event) =>
      event === null
        ? null
        : {
            ...event,
            totalTicketsIssued: Math.max(0, event.totalTicketsIssued - 1),
            totalTicketsCheckedIn: wasAdmitted
              ? Math.max(0, event.totalTicketsCheckedIn - 1)
              : event.totalTicketsCheckedIn,
            updatedAt: timestamp
          }
    );

    return true;
  }

  /**
   * Applies a partial update to one attendee in the local signal.
   *
   * Kept as a signal-level patch rather than a document write so every caller
   * (including the offline preview) shares one mutation path.
   */
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
