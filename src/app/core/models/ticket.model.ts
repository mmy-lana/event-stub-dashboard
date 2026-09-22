/**
 * Pure TypeScript domain model for the Event RSVP & Ticketing Dashboard.
 *
 * Every interface in this file is serialization-safe: timestamps are ISO 8601
 * strings (never `Date` instances) so that records can round-trip unchanged
 * through Firestore, IndexedDB (outbox persistence) and Angular signals without
 * lossy conversions.
 *
 * This module has zero runtime dependencies by design.
 */

/* -------------------------------------------------------------------------- */
/* Shared string unions                                                       */
/* -------------------------------------------------------------------------- */

/** Supported hosting modality for an event. */
export type EventType = 'in_person' | 'online' | 'hybrid';

/** Lifecycle state of an event. */
export type EventStatus = 'draft' | 'published' | 'sold_out' | 'cancelled' | 'archived';

/** Currencies the dashboard is able to price and format. */
export type CurrencyCode = 'USD' | 'EUR' | 'GBP';

/** Commercial model of a ticket tier. */
export type TicketTierType = 'free' | 'paid' | 'donation';

/** Admission state of an issued ticket. */
export type CheckInStatus = 'confirmed' | 'checked_in' | 'cancelled';

/** Settlement state of an order aggregate. */
export type PaymentStatus = 'completed' | 'free_rsvp' | 'refunded' | 'pending';

/** Tender used to settle an order. */
export type PaymentMethod = 'free' | 'stripe_card' | 'offline_cash';

/** How an admission was captured at the door. */
export type ScanMethod = 'camera_qr' | 'manual_button' | 'barcode_hardware';

/** Kind of mutation stored in the offline outbox. */
export type OutboxActionType = 'CHECK_IN_ATTENDEE' | 'CREATE_RSVP_ORDER' | 'CANCEL_TICKET';

/** Replication state of an offline mutation. */
export type OutboxSyncStatus = 'pending' | 'syncing' | 'failed' | 'failed_permanent';

/* -------------------------------------------------------------------------- */
/* Domain entities                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Core event representation supporting in-person, online, and hybrid modalities.
 */
export interface EventModel {
  readonly id: string;
  readonly organizerId: string;
  readonly title: string;
  readonly slug: string;
  readonly summary: string;
  readonly description: string;
  readonly bannerImageUrl: string;
  readonly eventType: EventType;
  readonly venue: VenueLocation;
  readonly virtualMeetingUrl: string | null;
  readonly startDateTime: string; // ISO 8601
  readonly endDateTime: string; // ISO 8601
  readonly timezone: string;
  readonly status: EventStatus;
  readonly totalCapacity: number;
  readonly totalTicketsIssued: number;
  readonly totalTicketsCheckedIn: number;
  readonly currency: CurrencyCode;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Physical (or virtual) location metadata for an event. */
export interface VenueLocation {
  readonly venueName: string;
  readonly streetAddress: string;
  readonly unitSuite?: string;
  readonly city: string;
  readonly stateProvince: string;
  readonly postalCode: string;
  readonly country: string;
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Ticket tiers (e.g. VIP, General Admission, Early Bird, Speaker Pass).
 */
export interface TicketTier {
  readonly id: string;
  readonly eventId: string;
  readonly name: string;
  readonly tierType: TicketTierType;
  readonly priceCents: number;
  readonly currency: string;
  readonly initialQuota: number;
  readonly availableQuota: number;
  readonly maxPerOrder: number;
  readonly salesStartDate: string;
  readonly salesEndDate: string;
  readonly perks: readonly string[];
  readonly badgeColorHex: string;
  readonly isActive: boolean;
  readonly displayOrder: number;
}

/**
 * Attendee record representing an issued ticket instance.
 */
export interface AttendeeTicket {
  readonly id: string;
  readonly eventId: string;
  readonly orderId: string;
  readonly ticketTierId: string;
  readonly ticketTierName: string;
  readonly ticketStubNumber: string; // e.g. "EVT-8924-XQ9"
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phoneNumber: string;
  readonly companyOrAffiliation: string;
  readonly checkInStatus: CheckInStatus;
  readonly checkedInAt: string | null;
  readonly checkedInByUserId: string | null;
  readonly qrVerificationSecret: string; // Hashed payload for dynamic scanner verification
  readonly barcodeValue: string;
  readonly seatAssignment?: string;
  readonly notes?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Order aggregate representing a completed registration or transaction.
 */
export interface TicketOrder {
  readonly id: string;
  readonly eventId: string;
  readonly orderReference: string;
  readonly customerFirstName: string;
  readonly customerLastName: string;
  readonly customerEmail: string;
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly totalCents: number;
  readonly currency: string;
  readonly paymentStatus: PaymentStatus;
  readonly paymentMethod: PaymentMethod;
  readonly lineItems: readonly OrderLineItem[];
  readonly createdAt: string;
}

/** Single priced line within a {@link TicketOrder}. */
export interface OrderLineItem {
  readonly ticketTierId: string;
  readonly tierName: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly subtotalCents: number;
}

/**
 * Offline Sync and Mutation Outbox Models.
 */
export interface OfflineOutboxItem {
  readonly id: string;
  readonly actionType: OutboxActionType;
  readonly entityId: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
  readonly retryCount: number;
  readonly syncStatus: OutboxSyncStatus;
  readonly lastErrorMessage: string | null;
}

/** Immutable audit trail entry written on every successful admission. */
export interface CheckInAuditLog {
  readonly id: string;
  readonly attendeeId: string;
  readonly eventId: string;
  readonly timestamp: string;
  readonly operatorId: string;
  readonly scanMethod: ScanMethod;
  readonly wasOfflineCached: boolean;
}

/**
 * Real-time Analytics View Model.
 */
export interface DashboardMetrics {
  readonly totalRegistrations: number;
  readonly totalCheckedIn: number;
  readonly checkInRatePercentage: number;
  readonly totalGrossRevenueCents: number;
  readonly availableCapacity: number;
  readonly tierBreakdown: readonly TierMetricStat[];
  readonly recentArrivalVelocity: number; // check-ins during the last 15 minutes
}

/** Per-tier rollup used by the dashboard breakdown charts. */
export interface TierMetricStat {
  readonly tierId: string;
  readonly tierName: string;
  readonly soldCount: number;
  readonly totalQuota: number;
  readonly checkedInCount: number;
}

/* -------------------------------------------------------------------------- */
/* Validation schema constraints                                              */
/* -------------------------------------------------------------------------- */

/**
 * Validation schema constraints shared by forms, importers and the kiosk
 * terminal. Declared `as const` so the regular expressions keep their exact
 * literal types while remaining fully tree-shakeable.
 */
export const VALIDATION_RULES = {
  EMAIL_REGEX: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  PHONE_REGEX: /^\+?[1-9]\d{1,14}$/,
  TICKET_STUB_REGEX: /^[A-Z]{3,4}-[0-9]{4}-[A-Z0-9]{3}$/,
  MAX_TICKETS_PER_ORDER: 10,
  MIN_SEARCH_CHARACTERS: 2,
  QR_HASH_SEPARATOR: '::',
  MAX_OFFLINE_RETRIES: 5
} as const;
