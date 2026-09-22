/**
 * Canonical Firestore document paths.
 *
 * Keeping every path in one place removes stringly-typed drift between the
 * feature stores, the offline outbox flush routine and the security rules.
 */

/** Collection identifiers nested under `events/{eventId}`. */
export const FIRESTORE_COLLECTIONS = {
  events: 'events',
  ticketTiers: 'ticketTiers',
  attendees: 'attendees',
  orders: 'orders',
  auditLogs: 'audit_logs'
} as const;

/** Thrown when a path segment is empty or contains a slash. */
export class InvalidFirestorePathError extends Error {
  public constructor(segment: string, value: string) {
    super(`Invalid Firestore path segment for "${segment}": "${value}".`);
    this.name = 'InvalidFirestorePathError';
  }
}

/**
 * Validates a document/collection id before it is interpolated into a path.
 *
 * @throws {InvalidFirestorePathError} When the id is empty or contains `/`.
 */
function segment(name: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.includes('/')) {
    throw new InvalidFirestorePathError(name, value);
  }
  return trimmed;
}

/** Typed path builders for the ticketing data model. */
export const FirestorePaths = {
  events(): string {
    return FIRESTORE_COLLECTIONS.events;
  },
  event(eventId: string): string {
    return `${FIRESTORE_COLLECTIONS.events}/${segment('eventId', eventId)}`;
  },
  ticketTiers(eventId: string): string {
    return `${FirestorePaths.event(eventId)}/${FIRESTORE_COLLECTIONS.ticketTiers}`;
  },
  ticketTier(eventId: string, tierId: string): string {
    return `${FirestorePaths.ticketTiers(eventId)}/${segment('tierId', tierId)}`;
  },
  attendees(eventId: string): string {
    return `${FirestorePaths.event(eventId)}/${FIRESTORE_COLLECTIONS.attendees}`;
  },
  attendee(eventId: string, attendeeId: string): string {
    return `${FirestorePaths.attendees(eventId)}/${segment('attendeeId', attendeeId)}`;
  },
  orders(eventId: string): string {
    return `${FirestorePaths.event(eventId)}/${FIRESTORE_COLLECTIONS.orders}`;
  },
  order(eventId: string, orderId: string): string {
    return `${FirestorePaths.orders(eventId)}/${segment('orderId', orderId)}`;
  },
  auditLogs(eventId: string): string {
    return `${FirestorePaths.event(eventId)}/${FIRESTORE_COLLECTIONS.auditLogs}`;
  },
  auditLog(eventId: string, auditLogId: string): string {
    return `${FirestorePaths.auditLogs(eventId)}/${segment('auditLogId', auditLogId)}`;
  }
} as const;
