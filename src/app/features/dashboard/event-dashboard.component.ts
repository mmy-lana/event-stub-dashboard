import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import type { AttendeeTicket } from '../../core/models/ticket.model';
import { EventDashboardStore } from './stores/event-dashboard.store';
import { RsvpCheckoutDialogComponent, type CheckoutOutcome } from '../ticketing/rsvp-checkout-dialog.component';
import { TicketStubCardComponent } from '../../shared/molecules/ticket-stub-card/ticket-stub-card.component';
import { StatCardComponent } from '../../shared/molecules/stat-card/stat-card.component';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { ButtonComponent } from '../../shared/ui/button/button.component';
import { CurrencyFormatUtility } from '../../shared/utils/currency-format.util';
import { DateFormatUtility } from '../../shared/utils/date-format.util';

/**
 * Event overview screen.
 *
 * KPI rail, capacity health, tier quota list, live arrival feed and the quick
 * actions an organiser needs on site (new RSVP, open the kiosk, print a pass). When
 * the project has no data yet, the screen offers the emulator demo dataset instead
 * of an empty dashboard.
 */
@Component({
  selector: 'app-event-dashboard',
  standalone: true,
  imports: [
    BadgeComponent,
    ButtonComponent,
    RouterLink,
    RsvpCheckoutDialogComponent,
    StatCardComponent,
    TicketStubCardComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      @if (store.isEmpty() && !store.isLive()) {
        <section class="empty-state" aria-labelledby="empty-heading">
          <p class="empty-icon" aria-hidden="true">🎟</p>
          <h1 id="empty-heading" class="empty-title">No event data yet</h1>
          <p class="empty-body">
            This project has no events in Firestore. Load the demo dataset to explore the dashboard,
            the roster and the check-in terminal, or create an event through your own tooling.
          </p>
          @if (store.canSeedDemoData()) {
            <app-button
              variant="coral"
              size="lg"
              [loading]="store.isSeeding()"
              (pressed)="loadDemoData()">
              Load demo dataset
            </app-button>
          } @else {
            <p class="empty-note">
              Demo data can only be loaded against the Firebase emulator. Point the app at your
              emulator or seed production data first.
            </p>
          }
          @if (store.errorMessage() !== null) {
            <p class="empty-error" role="alert">{{ store.errorMessage() }}</p>
          }
        </section>
      } @else if (event(); as currentEvent) {
        <header class="page-header">
          <div class="header-main">
            <p class="eyebrow">
              <app-badge [status]="currentEvent.status" size="sm" />
              <span class="eyebrow-text">{{ currentEvent.eventType.replace('_', ' ') }}</span>
            </p>
            <h1 class="page-title">{{ currentEvent.title }}</h1>
            <p class="page-subtitle">
              {{ DateFormatUtility.formatEventDateRange(currentEvent.startDateTime, currentEvent.endDateTime, { timeZone: currentEvent.timezone }) }}
            </p>
            <p class="page-venue">
              {{ currentEvent.venue.venueName }} · {{ currentEvent.venue.city }},
              {{ currentEvent.venue.stateProvince }}
            </p>
          </div>

          <div class="header-actions">
            <app-button variant="coral" icon="+" (pressed)="openCheckout()">New RSVP</app-button>
            <a class="action-link" routerLink="/terminal">
              <app-button variant="neutral" icon="📷">Open check-in terminal</app-button>
            </a>
            <app-button variant="outline" icon="🖨" [disabled]="!hasAdmissions()" (pressed)="printLatestPass()">
              Print last pass
            </app-button>
          </div>
        </header>

        @if (checkoutMessage(); as message) {
          <p class="checkout-banner" role="status">
            {{ message }}
            <button type="button" class="banner-close" aria-label="Dismiss" (click)="checkoutMessage.set(null)">×</button>
          </p>
        }

        <!-- KPI rail -->
        <section class="kpi-rail" aria-label="Key metrics">
          <app-stat-card
            label="Tickets sold"
            [value]="CurrencyFormatUtility.formatCount(metrics().totalRegistrations)"
            [subtext]="capacitySubtext()"
            trend="up" />
          <app-stat-card
            label="Check-in rate"
            [value]="CurrencyFormatUtility.formatPercentage(metrics().checkInRatePercentage, 1, undefined, false)"
            [subtext]="checkedInSubtext()"
            [showProgress]="true"
            [percentage]="metrics().checkInRatePercentage" />
          <app-stat-card
            label="Gross revenue"
            [value]="CurrencyFormatUtility.formatCentsCompact(metrics().totalGrossRevenueCents, currentEvent.currency)"
            [subtext]="refundSubtext()"
            trend="flat" />
          <app-stat-card
            label="Remaining capacity"
            [value]="CurrencyFormatUtility.formatCount(metrics().availableCapacity)"
            [subtext]="velocitySubtext()"
            [showProgress]="true"
            [percentage]="store.capacityUsedPercentage()" />
        </section>

        <!-- Capacity bar -->
        <section class="capacity-panel" aria-labelledby="capacity-heading">
          <div class="capacity-head">
            <h2 id="capacity-heading" class="panel-title">Capacity</h2>
            <span class="capacity-figure">
              {{ CurrencyFormatUtility.formatCount(metrics().totalRegistrations) }} /
              {{ CurrencyFormatUtility.formatCount(currentEvent.totalCapacity) }}
              ({{ store.capacityUsedPercentage() }}%)
            </span>
          </div>
          <div
            class="capacity-track"
            role="progressbar"
            aria-label="Capacity used"
            [attr.aria-valuenow]="store.capacityUsedPercentage()"
            aria-valuemin="0"
            aria-valuemax="100">
            <span class="capacity-fill" [style.width.%]="store.capacityUsedPercentage()"></span>
          </div>
        </section>

        <div class="columns">
          <!-- Tier quota health -->
          <section class="panel" aria-labelledby="tiers-heading">
            <h2 id="tiers-heading" class="panel-title">Tier quota health</h2>

            @if (store.tierQuotaHealth().length === 0) {
              <p class="panel-empty">No ticket tiers have been published for this event yet.</p>
            } @else {
              <ul class="quota-list">
                @for (row of store.tierQuotaHealth(); track row.tier.id) {
                  <li class="quota-row">
                    <span class="quota-swatch" [style.background-color]="row.tier.badgeColorHex"></span>
                    <div class="quota-main">
                      <div class="quota-head">
                        <span class="quota-name">{{ row.tier.name }}</span>
                        <span class="quota-count">{{ row.sold }} / {{ row.tier.initialQuota }}</span>
                      </div>
                      <div class="quota-track">
                        <span
                          class="quota-fill"
                          [style.width.%]="row.soldPercentage"
                          [style.background-color]="row.tier.badgeColorHex"></span>
                      </div>
                      <p class="quota-meta">
                        {{ row.remaining }} remaining
                        @if (row.isSoldOut) {
                          <span class="quota-sold-out">· sold out</span>
                        }
                      </p>
                    </div>
                  </li>
                }
              </ul>
            }
          </section>

          <!-- Live arrival feed -->
          <section class="panel" aria-labelledby="arrivals-heading">
            <h2 id="arrivals-heading" class="panel-title">Recent arrivals</h2>

            @if (store.recentAdmissions().length === 0) {
              <p class="panel-empty">No attendees have been admitted yet.</p>
            } @else {
              <ul class="arrival-list">
                @for (attendee of store.recentAdmissions(); track attendee.id) {
                  <li class="arrival-row">
                    <div class="arrival-main">
                      <span class="arrival-name">{{ attendee.firstName }} {{ attendee.lastName }}</span>
                      <span class="arrival-meta font-mono">{{ attendee.ticketStubNumber }}</span>
                    </div>
                    <span class="arrival-time">{{ DateFormatUtility.formatRelative(attendee.checkedInAt) }}</span>
                  </li>
                }
              </ul>
            }
          </section>
        </div>

        <!-- Pass preview -->
        @if (previewTicket(); as preview) {
          <section class="panel preview-panel" aria-labelledby="preview-heading">
            <div class="preview-head">
              <h2 id="preview-heading" class="panel-title">Latest pass</h2>
              <app-button variant="ghost" size="sm" (pressed)="closePreview()">Hide</app-button>
            </div>
            <app-ticket-stub-card
              [ticket]="preview"
              [eventTitle]="currentEvent.title"
              [venueName]="venueLine()"
              [formattedDateTime]="dateTimeLine()"
              [compact]="true"
              (onToggleCheckIn)="toggleAdmission($event)" />
          </section>
        }
      } @else {
        <section class="empty-state" aria-live="polite">
          <span class="loading-spinner" aria-hidden="true"></span>
          <p class="empty-body">Connecting to Firestore…</p>
        </section>
      }

      @if (isCheckoutOpen()) {
        <app-rsvp-checkout-dialog
          (closed)="closeCheckout()"
          (completed)="onCheckoutCompleted($event)" />
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .page {
        display: flex;
        flex-direction: column;
        gap: 18px;
        width: 100%;
        max-width: var(--content-max-width);
        margin: 0 auto;
        padding: 18px 14px 32px 14px;
      }

      @media (min-width: 768px) {
        .page {
          padding: 24px 20px 40px 20px;
          gap: 20px;
        }
      }

      @media (min-width: 1024px) {
        .page {
          padding: 28px 32px 48px 32px;
        }
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        padding: 48px 20px;
        text-align: center;
        background: var(--color-surface);
        border: 1px dashed var(--color-border-strong);
        border-radius: var(--radius-xl);
      }

      .empty-icon {
        font-size: 40px;
      }

      .empty-title {
        font-size: 20px;
        font-weight: 900;
      }

      .empty-body {
        max-width: 520px;
        font-size: 13px;
        line-height: 1.6;
        color: var(--color-slate-500);
      }

      .empty-note {
        max-width: 520px;
        font-size: 12px;
        color: var(--color-muted);
      }

      .empty-error {
        font-size: 12px;
        font-weight: 700;
        color: var(--color-danger);
      }

      .loading-spinner {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        border: 3px solid var(--color-border);
        border-top-color: var(--color-coral);
        animation: dash-spin 800ms linear infinite;
      }

      @keyframes dash-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .page-header {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 16px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-xl);
      }

      .eyebrow {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .eyebrow-text {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 1.2px;
        color: var(--color-muted-soft);
        text-transform: uppercase;
      }

      .page-title {
        font-size: 24px;
        font-weight: 900;
        letter-spacing: -0.5px;
      }

      .page-subtitle,
      .page-venue {
        font-size: 13px;
        color: var(--color-slate-500);
      }

      .header-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .action-link {
        display: contents;
        text-decoration: none;
      }

      .checkout-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid #bbf7d0;
        border-radius: var(--radius-md);
        background: var(--color-emerald-soft);
        font-size: 12px;
        font-weight: 700;
        color: var(--color-emerald-deep);
      }

      .banner-close {
        flex: 0 0 auto;
        width: 44px;
        height: 44px;
        border: none;
        border-radius: 50%;
        background: rgba(5, 150, 105, 0.12);
        color: var(--color-emerald-deep);
        font-size: 16px;
        line-height: 1;
      }

      .kpi-rail {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
      }

      @media (min-width: 768px) {
        .page-header {
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
        }

        .kpi-rail {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (min-width: 1024px) {
        .kpi-rail {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }

      .capacity-panel,
      .panel {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
      }

      .capacity-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }

      .panel-title {
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 1.2px;
        text-transform: uppercase;
        color: var(--color-slate-500);
      }

      .capacity-figure {
        font-size: 13px;
        font-weight: 700;
        color: var(--color-slate-700);
      }

      .capacity-track {
        height: 12px;
        border-radius: var(--radius-pill);
        background: var(--color-canvas);
        border: 1px solid var(--color-border);
        overflow: hidden;
      }

      .capacity-fill {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, var(--color-coral), #ff8b6d);
        transition: width var(--transition-base);
      }

      .columns {
        display: grid;
        grid-template-columns: 1fr;
        gap: 14px;
      }

      @media (min-width: 1024px) {
        .columns {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        }
      }

      .panel-empty {
        font-size: 12px;
        color: var(--color-muted);
      }

      .quota-list,
      .arrival-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .quota-row {
        display: flex;
        gap: 10px;
        align-items: flex-start;
      }

      .quota-swatch {
        flex: 0 0 4px;
        align-self: stretch;
        border-radius: var(--radius-pill);
      }

      .quota-main {
        flex: 1 1 auto;
        min-width: 0;
      }

      .quota-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }

      .quota-name {
        font-size: 13px;
        font-weight: 700;
        color: var(--color-ink);
      }

      .quota-count {
        font-size: 12px;
        font-weight: 800;
        color: var(--color-slate-600);
      }

      .quota-track {
        height: 8px;
        margin: 6px 0 4px 0;
        border-radius: var(--radius-pill);
        background: var(--color-canvas);
        overflow: hidden;
      }

      .quota-fill {
        display: block;
        height: 100%;
      }

      .quota-meta {
        font-size: 11px;
        color: var(--color-slate-500);
      }

      .quota-sold-out {
        font-weight: 800;
        color: var(--color-danger);
      }

      .arrival-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding-bottom: 10px;
        border-bottom: 1px dashed var(--color-border);
      }

      .arrival-row:last-child {
        border-bottom: none;
        padding-bottom: 0;
      }

      .arrival-main {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .arrival-name {
        font-size: 13px;
        font-weight: 700;
      }

      .arrival-meta {
        font-size: 11px;
        letter-spacing: 1px;
        color: var(--color-muted);
      }

      .font-mono {
        font-family: var(--font-mono);
      }

      .arrival-time {
        font-size: 11px;
        font-weight: 700;
        color: var(--color-emerald-deep);
        white-space: nowrap;
      }

      .preview-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
    `
  ]
})
export class EventDashboardComponent {
  /** Dashboard metrics and quick actions. */
  protected readonly store = inject(EventDashboardStore);

  /** Shortcut to the live event document. */
  protected readonly event = this.store.event;

  /** Metrics view model. */
  protected readonly metrics = this.store.metrics;

  /** Pass currently previewed on the overview. */
  protected readonly previewTicket = signal<AttendeeTicket | null>(null);

  /** Whether the RSVP checkout dialog is open. */
  protected readonly isCheckoutOpen = signal<boolean>(false);

  /** Last checkout outcome, shown as a banner on the overview. */
  protected readonly checkoutMessage = signal<string | null>(null);

  /** Date utilities exposed to the template. */
  protected readonly DateFormatUtility = DateFormatUtility;

  /** Currency utilities exposed to the template. */
  protected readonly CurrencyFormatUtility = CurrencyFormatUtility;

  /** `true` when at least one attendee has been admitted. */
  protected readonly hasAdmissions = computed(() => this.metrics().totalCheckedIn > 0);

  /** Subtext describing sales progress. */
  protected readonly capacitySubtext = computed(() => {
    const metrics = this.metrics();
    const event = this.event();
    if (event === null) {
      return null;
    }
    const remaining = Math.max(0, event.totalCapacity - metrics.totalRegistrations);
    return `${remaining} seats remaining`;
  });

  /** Subtext describing admissions. */
  protected readonly checkedInSubtext = computed(() => {
    const metrics = this.metrics();
    return `${metrics.totalCheckedIn} of ${metrics.totalRegistrations} admitted`;
  });

  /** Subtext describing refunds. */
  protected readonly refundSubtext = computed(() => {
    const refunded = this.store.orders().filter((order) => order.paymentStatus === 'refunded');
    if (refunded.length === 0) {
      return 'no refunds issued';
    }
    const total = refunded.reduce((sum, order) => sum + order.totalCents, 0);
    return `${refunded.length} refunds · ${CurrencyFormatUtility.formatCentsCompact(total, this.event()?.currency ?? 'USD')}`;
  });

  /** Subtext describing the arrival velocity. */
  protected readonly velocitySubtext = computed(
    () => `${this.metrics().recentArrivalVelocity} admitted in the last 15 min`
  );

  /** Venue line used by the pass preview. */
  protected readonly venueLine = computed(() => {
    const event = this.event();
    if (event === null) {
      return '';
    }
    return `${event.venue.venueName} · ${event.venue.city}, ${event.venue.stateProvince}`;
  });

  /** Date and time line used by the pass preview. */
  protected readonly dateTimeLine = computed(() => {
    const event = this.event();
    if (event === null) {
      return '';
    }
    return DateFormatUtility.formatEventDateRange(event.startDateTime, event.endDateTime, {
      timeZone: event.timezone
    });
  });

  public constructor() {
    // Load (or reconnect to) the active event when the screen is created.
    void this.store.connect();
  }

  /** Writes the demo dataset and reloads. */
  protected async loadDemoData(): Promise<void> {
    await this.store.loadDemoDataset(false);
  }

  /** Opens the RSVP checkout dialog. */
  protected openCheckout(): void {
    this.checkoutMessage.set(null);
    this.isCheckoutOpen.set(true);
  }

  /** Closes the checkout dialog. */
  protected closeCheckout(): void {
    this.isCheckoutOpen.set(false);
  }

  /**
   * Reports the checkout outcome and, on success, previews the newest ticket that
   * was just issued so the operator can print it immediately.
   */
  protected onCheckoutCompleted(outcome: CheckoutOutcome): void {
    this.checkoutMessage.set(outcome.message);

    if (outcome.status !== 'reserved') {
      return;
    }

    const newest = this.store
      .attendees()
      .filter((attendee) => attendee.orderId === outcome.orderId)
      .at(0);
    if (newest !== undefined) {
      this.previewTicket.set(newest);
    }
    this.isCheckoutOpen.set(false);
  }

  /** Shows the newest admitted pass, or the newest ticket when nobody has arrived. */
  protected printLatestPass(): void {
    const latest = this.store.recentAdmissions()[0] ?? this.store.attendees()[0];
    this.previewTicket.set(latest ?? null);
  }

  /** Hides the pass preview. */
  protected closePreview(): void {
    this.previewTicket.set(null);
  }

  /** Admits or reverses the previewed pass. */
  protected async toggleAdmission(ticket: AttendeeTicket): Promise<void> {
    const applied =
      ticket.checkInStatus === 'checked_in'
        ? await this.store.undoCheckIn(ticket)
        : await this.store.checkInAttendee(ticket);

    if (applied) {
      const refreshed = this.store.attendees().find((attendee) => attendee.id === ticket.id);
      this.previewTicket.set(refreshed ?? null);
    }
  }
}
