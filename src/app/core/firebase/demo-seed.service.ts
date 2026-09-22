/**
 * Demo dataset loader.
 *
 * Writes a complete, realistic event (tiers, attendees, orders and audit logs)
 * into the Firestore emulator so the dashboard, roster and kiosk can be exercised
 * end to end. It refuses to run against a cloud project and is idempotent: an
 * existing event is left untouched unless `force` is requested.
 */

import { Injectable, inject } from '@angular/core';
import { collection, doc, getDoc, getDocs, limit, query, writeBatch } from 'firebase/firestore';

import { FIREBASE_CONFIG, FIRESTORE_DB } from '../firebase/firebase.config';
import { FirestorePaths } from '../firebase/firestore-paths';
import { TicketSecurityUtility } from '../../shared/utils/ticket-cryptography';
import type {
  AttendeeTicket,
  CheckInAuditLog,
  EventModel,
  OrderLineItem,
  TicketOrder,
  TicketTier
} from '../models/ticket.model';

/** Outcome of a seed run. */
export interface SeedResult {
  readonly seeded: boolean;
  readonly eventId: string;
  readonly reason: string;
  readonly tiersWritten: number;
  readonly attendeesWritten: number;
  readonly ordersWritten: number;
}

/** Identifier of the demo event written by the seeder. */
export const DEMO_EVENT_ID = 'evt_devcon_2026';

/** Thrown when seeding is attempted against a non-emulator project. */
export class DemoSeedForbiddenError extends Error {
  public constructor() {
    super('Demo data can only be seeded while the Firebase emulator is in use.');
    this.name = 'DemoSeedForbiddenError';
  }
}

/** Attendee template used to build the deterministic demo roster. */
interface AttendeeTemplate {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly company: string;
  readonly tierIndex: number;
  readonly seat: string | null;
  /** Minutes relative to `now`: negative is already admitted, positive is pending. */
  readonly checkInOffsetMinutes: number | null;
  readonly cancelled: boolean;
}

const ATTENDEE_TEMPLATES: readonly AttendeeTemplate[] = [
  { firstName: 'Alexandra', lastName: 'Chen', email: 'alexandra.chen@northwind.dev', company: 'Northwind Labs', tierIndex: 0, seat: 'A-14', checkInOffsetMinutes: -4, cancelled: false },
  { firstName: 'Marcus', lastName: 'Delgado', email: 'm.delgado@lumenworks.io', company: 'Lumen Works', tierIndex: 1, seat: null, checkInOffsetMinutes: -9, cancelled: false },
  { firstName: 'Priya', lastName: 'Raman', email: 'priya.raman@arcadia.health', company: 'Arcadia Health', tierIndex: 1, seat: null, checkInOffsetMinutes: null, cancelled: true },
  { firstName: 'Tomás', lastName: 'Okafor', email: 't.okafor@brightpath.org', company: 'Brightpath', tierIndex: 0, seat: 'A-15', checkInOffsetMinutes: -2, cancelled: false },
  { firstName: 'Hana', lastName: 'Yamada', email: 'hana.yamada@sakuragumi.jp', company: 'Sakura Gumi', tierIndex: 2, seat: null, checkInOffsetMinutes: -12, cancelled: false },
  { firstName: 'Diego', lastName: 'Marín', email: 'diego.marin@ventanas.es', company: 'Ventanas', tierIndex: 1, seat: null, checkInOffsetMinutes: null, cancelled: false },
  { firstName: 'Ingrid', lastName: 'Halvorsen', email: 'ingrid.h@fjordtek.no', company: 'Fjordtek', tierIndex: 0, seat: 'B-02', checkInOffsetMinutes: -21, cancelled: false },
  { firstName: 'Samuel', lastName: 'Adeyemi', email: 'samuel.adeyemi@lagostech.ng', company: 'Lagos Tech', tierIndex: 1, seat: null, checkInOffsetMinutes: null, cancelled: false },
  { firstName: 'Mei', lastName: 'Lin', email: 'mei.lin@orbitpay.sg', company: 'OrbitPay', tierIndex: 1, seat: null, checkInOffsetMinutes: -6, cancelled: false },
  { firstName: 'Jonas', lastName: 'Weber', email: 'jonas.weber@kranzwerk.de', company: 'Kranzwerk', tierIndex: 2, seat: null, checkInOffsetMinutes: null, cancelled: false },
  { firstName: 'Fatima', lastName: 'Al-Sayed', email: 'fatima.alsayed@dunelabs.ae', company: 'Dune Labs', tierIndex: 0, seat: 'A-21', checkInOffsetMinutes: -3, cancelled: false },
  { firstName: 'Lucas', lastName: 'Ferreira', email: 'lucas.ferreira@ondamais.br', company: 'Onda Mais', tierIndex: 1, seat: null, checkInOffsetMinutes: null, cancelled: false },
  { firstName: 'Chloé', lastName: 'Dubois', email: 'chloe.dubois@atelier13.fr', company: 'Atelier 13', tierIndex: 1, seat: null, checkInOffsetMinutes: -17, cancelled: false },
  { firstName: 'Ravi', lastName: 'Nair', email: 'ravi.nair@tessellate.in', company: 'Tessellate', tierIndex: 2, seat: null, checkInOffsetMinutes: null, cancelled: false },
  { firstName: 'Elena', lastName: 'Petrova', email: 'elena.petrova@severstal.digital', company: 'Severstal Digital', tierIndex: 0, seat: 'B-08', checkInOffsetMinutes: -8, cancelled: false },
  { firstName: 'Noah', lastName: 'Bergström', email: 'noah.bergstrom@nordlys.se', company: 'Nordlys', tierIndex: 1, seat: null, checkInOffsetMinutes: null, cancelled: false },
  { firstName: 'Aisha', lastName: 'Karim', email: 'aisha.karim@crescentworks.pk', company: 'Crescent Works', tierIndex: 1, seat: null, checkInOffsetMinutes: -14, cancelled: false },
  { firstName: 'Ben', lastName: 'Osei', email: 'ben.osei@accralabs.gh', company: 'Accra Labs', tierIndex: 2, seat: null, checkInOffsetMinutes: null, cancelled: false },
  { firstName: 'Sofia', lastName: 'Rossi', email: 'sofia.rossi@fabbrica.it', company: 'Fabbrica', tierIndex: 0, seat: 'A-33', checkInOffsetMinutes: -1, cancelled: false },
  { firstName: 'Daniel', lastName: 'Kim', email: 'daniel.kim@hanriver.kr', company: 'Han River', tierIndex: 1, seat: null, checkInOffsetMinutes: null, cancelled: false },
  { firstName: 'Zara', lastName: 'Hussain', email: 'zara.hussain@meridian.co.uk', company: 'Meridian', tierIndex: 1, seat: null, checkInOffsetMinutes: -11, cancelled: false },
  { firstName: 'Pedro', lastName: 'Alvarez', email: 'pedro.alvarez@altiplano.cl', company: 'Altiplano', tierIndex: 2, seat: null, checkInOffsetMinutes: null, cancelled: false },
  { firstName: 'Nadia', lastName: 'Benali', email: 'nadia.benali@kasbah.ma', company: 'Kasbah', tierIndex: 0, seat: 'A-40', checkInOffsetMinutes: -5, cancelled: false },
  { firstName: 'Erik', lastName: 'Lindqvist', email: 'erik.lindqvist@vasa.fi', company: 'Vasa', tierIndex: 1, seat: null, checkInOffsetMinutes: null, cancelled: false }
];

/** Writes the demo dataset into the emulator. */
@Injectable({ providedIn: 'root' })
export class DemoSeedService {
  private readonly firestore = inject(FIRESTORE_DB);
  private readonly config = inject(FIREBASE_CONFIG);

  /** `true` when seeding is permitted in this environment. */
  public get isAvailable(): boolean {
    return this.config.useEmulator;
  }

  /**
   * Seeds the demo event.
   *
   * @param force Rewrites the dataset even when the event already exists.
   * @returns A summary of what was written.
   * @throws {DemoSeedForbiddenError} When the project is not the emulator.
   */
  public async seedDemoEvent(force = false): Promise<SeedResult> {
    if (!this.isAvailable) {
      throw new DemoSeedForbiddenError();
    }

    const eventRef = doc(this.firestore, FirestorePaths.event(DEMO_EVENT_ID));
    const existing = await getDoc(eventRef);
    if (existing.exists() && !force) {
      return {
        seeded: false,
        eventId: DEMO_EVENT_ID,
        reason: 'Demo event already present.',
        tiersWritten: 0,
        attendeesWritten: 0,
        ordersWritten: 0
      };
    }

    const now = new Date();
    const tiers = buildTiers(now);
    const attendees = buildAttendees(now, tiers);
    const orders = buildOrders(now, attendees);
    const auditLogs = buildAuditLogs(attendees);

    const batch = writeBatch(this.firestore);

    // A forced re-seed replaces the dataset rather than merging into it, so stale
    // documents from an earlier run cannot survive and inflate the roster.
    if (existing.exists()) {
      await this.deleteExistingDataset(batch);
    }

    batch.set(eventRef, buildEvent(now, tiers, attendees));

    for (const tier of tiers) {
      batch.set(doc(this.firestore, FirestorePaths.ticketTier(DEMO_EVENT_ID, tier.id)), tier);
    }
    for (const attendee of attendees) {
      batch.set(doc(this.firestore, FirestorePaths.attendee(DEMO_EVENT_ID, attendee.id)), attendee);
    }
    for (const order of orders) {
      batch.set(doc(this.firestore, FirestorePaths.order(DEMO_EVENT_ID, order.id)), order);
    }
    for (const log of auditLogs) {
      batch.set(doc(this.firestore, FirestorePaths.auditLog(DEMO_EVENT_ID, log.id)), log);
    }

    await batch.commit();

    return {
      seeded: true,
      eventId: DEMO_EVENT_ID,
      reason: force ? 'Demo dataset rewritten.' : 'Demo dataset created.',
      tiersWritten: tiers.length,
      attendeesWritten: attendees.length,
      ordersWritten: orders.length
    };
  }

  /**
   * Resolves the id of the most recently created event.
   *
   * @returns The event id, or `null` when the project has no events yet.
   */
  public async resolveActiveEventId(): Promise<string | null> {
    const eventsRef = collection(this.firestore, FirestorePaths.events());
    const snapshot = await getDocs(query(eventsRef, limit(1)));

    if (snapshot.empty) {
      return null;
    }
    return snapshot.docs[0].id;
  }

  /** Stages deletions for every document of a previous demo run. */
  private async deleteExistingDataset(batch: ReturnType<typeof writeBatch>): Promise<void> {
    const collections = [
      FirestorePaths.ticketTiers(DEMO_EVENT_ID),
      FirestorePaths.attendees(DEMO_EVENT_ID),
      FirestorePaths.orders(DEMO_EVENT_ID),
      FirestorePaths.auditLogs(DEMO_EVENT_ID)
    ];

    for (const path of collections) {
      const snapshot = await getDocs(collection(this.firestore, path));
      for (const entry of snapshot.docs) {
        batch.delete(entry.ref);
      }
    }
  }
}

/** Builds the demo event document. */
function buildEvent(now: Date, tiers: readonly TicketTier[], attendees: readonly AttendeeTicket[]): EventModel {
  const start = new Date(now);
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);

  const end = new Date(start);
  end.setHours(17, 0, 0, 0);

  const issued = attendees.filter((attendee) => attendee.checkInStatus !== 'cancelled').length;
  const checkedIn = attendees.filter((attendee) => attendee.checkInStatus === 'checked_in').length;

  return {
    id: DEMO_EVENT_ID,
    organizerId: 'org_stubdeck_demo',
    title: 'Summit Tech Conf 2026',
    slug: 'summit-tech-conf-2026',
    summary: 'Two halls, 40 speakers and a full day of platform engineering.',
    description:
      'The annual platform engineering summit: distributed systems, developer experience and ' +
      'on-call culture across two halls, with a workshop track and an evening reception.',
    bannerImageUrl: 'https://images.stubdeck.dev/banners/summit-tech-conf-2026.jpg',
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
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    timezone: 'America/Los_Angeles',
    status: 'published',
    totalCapacity: tiers.reduce((total, tier) => total + tier.initialQuota, 0),
    totalTicketsIssued: issued,
    totalTicketsCheckedIn: checkedIn,
    currency: 'USD',
    tags: ['conference', 'platform-engineering', 'in-person'],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

/** Builds the three demo ticket tiers. */
function buildTiers(now: Date): readonly TicketTier[] {
  const salesStart = new Date(now);
  salesStart.setMonth(salesStart.getMonth() - 3);
  const salesEnd = new Date(now);
  salesEnd.setDate(salesEnd.getDate() + 1);

  return [
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
      salesStartDate: salesStart.toISOString(),
      salesEndDate: salesEnd.toISOString(),
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
      salesStartDate: salesStart.toISOString(),
      salesEndDate: salesEnd.toISOString(),
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
      availableQuota: 0,
      maxPerOrder: 2,
      salesStartDate: salesStart.toISOString(),
      salesEndDate: salesEnd.toISOString(),
      perks: ['Valid student ID required'],
      badgeColorHex: '#10b981',
      isActive: true,
      displayOrder: 3
    }
  ];
}

/** Builds the demo attendee roster with realistic arrival times. */
function buildAttendees(now: Date, tiers: readonly TicketTier[]): readonly AttendeeTicket[] {
  return ATTENDEE_TEMPLATES.map((template, index) => {
    const tier = tiers[template.tierIndex];
    const stubNumber = TicketSecurityUtility.generateStubNumber('EVT');
    // Deterministic ids keep a forced re-seed idempotent: the same template index
    // always maps onto the same document, so nothing is duplicated.
    const ticketId = `tkt_${(index + 1).toString().padStart(3, '0')}`;
    const checkedInAt =
      template.checkInOffsetMinutes === null
        ? null
        : new Date(now.getTime() + template.checkInOffsetMinutes * 60_000).toISOString();

    const status: AttendeeTicket['checkInStatus'] = template.cancelled
      ? 'cancelled'
      : checkedInAt === null
        ? 'confirmed'
        : 'checked_in';

    const section = tier.id === 'tier_vip' ? 'VIP' : 'GA';
    const gate = index % 2 === 0 ? 'DOORA' : 'DOORB';

    return {
      id: ticketId,
      eventId: DEMO_EVENT_ID,
      orderId: `ord_${(index + 1).toString(36).padStart(4, '0')}`,
      ticketTierId: tier.id,
      ticketTierName: tier.name,
      ticketStubNumber: stubNumber,
      firstName: template.firstName,
      lastName: template.lastName,
      email: template.email,
      phoneNumber: `+1415555${(1000 + index).toString().slice(-4)}`,
      companyOrAffiliation: template.company,
      checkInStatus: status,
      checkedInAt,
      checkedInByUserId: checkedInAt === null ? null : 'kiosk_door_b',
      qrVerificationSecret: TicketSecurityUtility.generateVerifiableToken(
        ticketId,
        stubNumber,
        DEMO_EVENT_ID
      ),
      barcodeValue: TicketSecurityUtility.generateBarcodeValue(stubNumber, section, gate),
      ...(template.seat === null ? {} : { seatAssignment: template.seat }),
      createdAt: new Date(now.getTime() - (index + 1) * 3_600_000).toISOString(),
      updatedAt: checkedInAt ?? new Date(now.getTime() - (index + 1) * 3_600_000).toISOString()
    };
  });
}

/** Builds one order per attendee, priced from their tier. */
function buildOrders(now: Date, attendees: readonly AttendeeTicket[]): readonly TicketOrder[] {
  const priceByTier: Record<string, number> = { tier_vip: 24900, tier_ga: 12500, tier_student: 0 };

  return attendees.map((attendee, index) => {
    const unitPriceCents = priceByTier[attendee.ticketTierId] ?? 0;
    const lineItem: OrderLineItem = {
      ticketTierId: attendee.ticketTierId,
      tierName: attendee.ticketTierName,
      quantity: 1,
      unitPriceCents,
      subtotalCents: unitPriceCents
    };

    return {
      id: attendee.orderId,
      eventId: DEMO_EVENT_ID,
      orderReference: `SD-${(20260 + index).toString()}-${attendee.ticketStubNumber.slice(-3)}`,
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
      lineItems: [lineItem],
      createdAt: new Date(now.getTime() - (index + 1) * 3_600_000).toISOString()
    };
  });
}

/** Builds an audit log entry for every admitted attendee. */
function buildAuditLogs(attendees: readonly AttendeeTicket[]): readonly CheckInAuditLog[] {
  return attendees
    .filter(
      (attendee): attendee is AttendeeTicket & { checkedInAt: string } =>
        attendee.checkInStatus === 'checked_in' && attendee.checkedInAt !== null
    )
    .map((attendee) => ({
      id: `log_${attendee.id}`,
      attendeeId: attendee.id,
      eventId: DEMO_EVENT_ID,
      action: 'admit',
      timestamp: attendee.checkedInAt,
      operatorId: attendee.checkedInByUserId ?? 'kiosk_door_b',
      scanMethod: 'camera_qr',
      wasOfflineCached: false
    }));
}
