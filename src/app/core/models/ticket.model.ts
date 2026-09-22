export interface EventModel {
  readonly id: string;
  readonly organizerId: string;
  readonly title: string;
  readonly slug: string;
  readonly summary: string;
  readonly description: string;
  readonly bannerImageUrl: string;
  readonly eventType: 'in_person' | 'online' | 'hybrid';
  readonly venue: VenueLocation;
  readonly virtualMeetingUrl: string | null;
  readonly startDateTime: string;
  readonly endDateTime: string;
  readonly timezone: string;
  readonly status: 'draft' | 'published' | 'sold_out' | 'cancelled' | 'archived';
  readonly totalCapacity: number;
  readonly totalTicketsIssued: number;
  readonly totalTicketsCheckedIn: number;
  readonly currency: 'USD' | 'EUR' | 'GBP';
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

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

export interface TicketTier {
  readonly id: string;
  readonly eventId: string;
  readonly name: string;
  readonly tierType: 'free' | 'paid' | 'donation';
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

export interface AttendeeTicket {
  readonly id: string;
  readonly eventId: string;
  readonly orderId: string;
  readonly ticketTierId: string;
  readonly ticketTierName: string;
  readonly ticketStubNumber: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phoneNumber: string;
  readonly companyOrAffiliation: string;
  readonly checkInStatus: 'confirmed' | 'checked_in' | 'cancelled';
  readonly checkedInAt: string | null;
  readonly checkedInByUserId: string | null;
  readonly qrVerificationSecret: string;
  readonly barcodeValue: string;
  readonly seatAssignment?: string;
  readonly notes?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

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
  readonly paymentStatus: 'completed' | 'free_rsvp' | 'refunded' | 'pending';
  readonly paymentMethod: 'free' | 'stripe_card' | 'offline_cash';
  readonly lineItems: readonly OrderLineItem[];
  readonly createdAt: string;
}

export interface OrderLineItem {
  readonly ticketTierId: string;
  readonly tierName: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly subtotalCents: number;
}

export interface OfflineOutboxItem {
  readonly id: string;
  readonly actionType: 'CHECK_IN_ATTENDEE' | 'CREATE_RSVP_ORDER' | 'CANCEL_TICKET';
  readonly entityId: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
  readonly retryCount: number;
  readonly syncStatus: 'pending' | 'syncing' | 'failed' | 'failed_permanent';
  readonly lastErrorMessage: string | null;
}

export interface CheckInAuditLog {
  readonly id: string;
  readonly attendeeId: string;
  readonly eventId: string;
  readonly timestamp: string;
  readonly operatorId: string;
  readonly scanMethod: 'camera_qr' | 'manual_button' | 'barcode_hardware';
  readonly wasOfflineCached: boolean;
}

export interface DashboardMetrics {
  readonly totalRegistrations: number;
  readonly totalCheckedIn: number;
  readonly checkInRatePercentage: number;
  readonly totalGrossRevenueCents: number;
  readonly availableCapacity: number;
  readonly tierBreakdown: readonly TierMetricStat[];
  readonly recentArrivalVelocity: number;
}

export interface TierMetricStat {
  readonly tierId: string;
  readonly tierName: string;
  readonly soldCount: number;
  readonly totalQuota: number;
  readonly checkedInCount: number;
}
