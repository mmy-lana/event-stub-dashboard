/**
 * Dashboard analytics store.
 *
 * Derives every KPI the overview screen renders from the live event data layer:
 * registrations, admissions, check-in rate, gross revenue, remaining capacity,
 * per-tier breakdown and the recent arrival velocity used by the live feed.
 */

import { Injectable, computed, inject } from '@angular/core';

import { EventDataStore } from '../../../core/state/event-data.store';
import type {
  AttendeeTicket,
  DashboardMetrics,
  TierMetricStat,
  TicketTier
} from '../../../core/models/ticket.model';

/** Window used for the arrival-velocity metric, in minutes. */
export const ARRIVAL_VELOCITY_WINDOW_MINUTES = 15;

/** Arrival bucket shown in the velocity sparkline. */
export interface ArrivalBucket {
  readonly label: string;
  readonly count: number;
  /** Minutes before "now" represented by this bucket. */
  readonly minutesAgo: number;
}

/** Live overview metrics and quick actions. */
@Injectable({ providedIn: 'root' })
export class EventDashboardStore {
  private readonly data = inject(EventDataStore);

  /** Event currently in context, or `null` when no dataset exists yet. */
  public readonly event = this.data.event;

  /** Ticket tiers for the active event. */
  public readonly ticketTiers = this.data.ticketTiers;

  /** Attendee tickets for the active event. */
  public readonly attendees = this.data.attendees;

  /** Orders for the active event. */
  public readonly orders = this.data.orders;

  /** Subscription lifecycle state. */
  public readonly connectionState = this.data.connectionState;

  /** Last error surfaced by the data layer. */
  public readonly errorMessage = this.data.errorMessage;

  /** `true` while the demo dataset is being written. */
  public readonly isSeeding = this.data.isSeeding;

  /** Whether demo data can be loaded in this environment. */
  public readonly canSeedDemoData = this.data.canSeedDemoData;

  /** `true` when the dataset comes from the in-memory mock engine, not Firestore. */
  public readonly isMockMode = this.data.isMockMode;

  /** `true` when the project has no events yet. */
  public readonly isEmpty = this.data.isEmpty;

  /** `true` once live data is flowing. */
  public readonly isLive = this.data.isLive;

  /** Full metrics view model consumed by the KPI rail. */
  public readonly metrics = computed<DashboardMetrics>(() => {
    const event = this.data.event();
    const tiers = this.data.ticketTiers();
    const attendees = this.data.attendees();
    const orders = this.data.orders();

    const activeAttendees = attendees.filter((attendee) => attendee.checkInStatus !== 'cancelled');
    const checkedIn = activeAttendees.filter(
      (attendee) => attendee.checkInStatus === 'checked_in'
    ).length;
    const totalRegistrations = activeAttendees.length;

    const totalCapacity = event?.totalCapacity ?? totalRegistrations;
    const availableCapacity = Math.max(0, totalCapacity - totalRegistrations);

    const grossRevenue = orders
      .filter((order) => order.paymentStatus === 'completed' || order.paymentStatus === 'free_rsvp')
      .reduce((total, order) => total + order.totalCents, 0);

    return {
      totalRegistrations,
      totalCheckedIn: checkedIn,
      checkInRatePercentage:
        totalRegistrations === 0 ? 0 : roundTo((checkedIn / totalRegistrations) * 100, 1),
      totalGrossRevenueCents: grossRevenue,
      availableCapacity,
      tierBreakdown: buildTierBreakdown(tiers, activeAttendees),
      recentArrivalVelocity: this.countRecentArrivals(ARRIVAL_VELOCITY_WINDOW_MINUTES)
    };
  });

  /** Capacity used as a 0-100 percentage for the progress bar. */
  public readonly capacityUsedPercentage = computed(() => {
    const metrics = this.metrics();
    const event = this.data.event();
    const capacity = event?.totalCapacity ?? 0;
    if (capacity === 0) {
      return 0;
    }
    return roundTo(Math.min(100, (metrics.totalRegistrations / capacity) * 100), 1);
  });

  /** Arrival counts per five-minute bucket over the last hour. */
  public readonly arrivalBuckets = computed<readonly ArrivalBucket[]>(() => {
    const attendees = this.data.attendees();
    const now = Date.now();
    const bucketCount = 12;
    const buckets: ArrivalBucket[] = [];

    for (let index = bucketCount - 1; index >= 0; index -= 1) {
      const minutesAgo = (index + 1) * 5;
      const windowStart = now - minutesAgo * 60_000;
      const windowEnd = now - index * 5 * 60_000;

      const count = attendees.filter((attendee) => {
        if (attendee.checkedInAt === null) {
          return false;
        }
        const at = new Date(attendee.checkedInAt).getTime();
        return at > windowStart && at <= windowEnd;
      }).length;

      buckets.push({ label: `${minutesAgo}m`, count, minutesAgo });
    }

    return buckets;
  });

  /** Most recent admissions, newest first, capped for the live feed. */
  public readonly recentAdmissions = computed<readonly AttendeeTicket[]>(() =>
    this.data
      .attendees()
      .filter(
        (attendee): attendee is AttendeeTicket & { checkedInAt: string } =>
          attendee.checkInStatus === 'checked_in' && attendee.checkedInAt !== null
      )
      .sort((left, right) => right.checkedInAt.localeCompare(left.checkedInAt))
      .slice(0, 8)
  );

  /** Tiers with their remaining inventory, for the quota health list. */
  public readonly tierQuotaHealth = computed(() =>
    this.data.ticketTiers().map((tier) => {
      const sold = Math.max(0, tier.initialQuota - tier.availableQuota);
      return {
        tier,
        sold,
        remaining: tier.availableQuota,
        soldPercentage: tier.initialQuota === 0 ? 0 : roundTo((sold / tier.initialQuota) * 100, 1),
        isSoldOut: tier.availableQuota <= 0
      };
    })
  );

  /** Connects to the active event, resolving the most recent one when omitted. */
  public async connect(eventId?: string): Promise<string | null> {
    return this.data.connect(eventId);
  }

  /** Reloads the event document without reopening listeners. */
  public async refresh(): Promise<boolean> {
    return this.data.refreshEventDocument();
  }

  /** Writes the demo dataset and connects to it. */
  public async loadDemoDataset(force = false): Promise<void> {
    await this.data.loadDemoDataset(force);
  }

  /** Admits an attendee from the dashboard quick actions. */
  public async checkInAttendee(ticket: AttendeeTicket): Promise<boolean> {
    return this.data.admitAttendee(ticket, 'dashboard_operator', 'manual_button');
  }

  /** Reverses an admission from the dashboard quick actions. */
  public async undoCheckIn(ticket: AttendeeTicket): Promise<boolean> {
    return this.data.reverseAdmission(ticket);
  }

  /** Counts admissions inside the trailing window. */
  private countRecentArrivals(windowMinutes: number): number {
    const threshold = Date.now() - windowMinutes * 60_000;
    return this.data.attendees().filter((attendee) => {
      if (attendee.checkedInAt === null) {
        return false;
      }
      return new Date(attendee.checkedInAt).getTime() >= threshold;
    }).length;
  }
}

/** Builds the per-tier metric rows used by the breakdown list. */
function buildTierBreakdown(
  tiers: readonly TicketTier[],
  attendees: readonly AttendeeTicket[]
): readonly TierMetricStat[] {
  return tiers.map((tier) => {
    const tierAttendees = attendees.filter((attendee) => attendee.ticketTierId === tier.id);
    return {
      tierId: tier.id,
      tierName: tier.name,
      soldCount: tierAttendees.length,
      totalQuota: tier.initialQuota,
      checkedInCount: tierAttendees.filter(
        (attendee) => attendee.checkInStatus === 'checked_in'
      ).length
    };
  });
}

/** Rounds to a fixed number of decimals without floating-point noise. */
function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
