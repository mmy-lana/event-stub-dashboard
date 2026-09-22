import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import type { AttendeeTicket, TicketOrder } from '../../core/models/ticket.model';
import { EventDataStore } from '../../core/state/event-data.store';
import { TicketStubCardComponent } from '../../shared/molecules/ticket-stub-card/ticket-stub-card.component';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { ButtonComponent } from '../../shared/ui/button/button.component';
import { CurrencyFormatUtility } from '../../shared/utils/currency-format.util';
import { DateFormatUtility } from '../../shared/utils/date-format.util';

/**
 * Full ticket detail sheet.
 *
 * Deep-linkable page (`/tickets/:ticketId`) rendering the printable tear-off pass,
 * the order it belongs to and the door audit trail, with the operator actions for
 * admission and the refund cascade.
 */
@Component({
  selector: 'app-ticket-detail-sheet',
  standalone: true,
  imports: [BadgeComponent, ButtonComponent, RouterLink, TicketStubCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a routerLink="/attendees" class="breadcrumb-link">← Back to roster</a>
      </nav>

      @if (ticket(); as current) {
        <header class="page-header">
          <div>
            <h1 class="page-title">{{ current.firstName }} {{ current.lastName }}</h1>
            <p class="page-subtitle">
              {{ current.ticketTierName }} · <span class="font-mono">{{ current.ticketStubNumber }}</span>
            </p>
          </div>
          <app-badge [status]="current.checkInStatus" />
        </header>

        @if (actionMessage() !== null) {
          <p class="action-message" role="status">{{ actionMessage() }}</p>
        }

        <app-ticket-stub-card
          [ticket]="current"
          [eventTitle]="eventTitle()"
          [venueName]="venueLine()"
          [formattedDateTime]="dateTimeLine()"
          [pending]="isBusy()"
          (onToggleCheckIn)="toggleAdmission($event)" />

        <div class="detail-columns">
          <section class="panel" aria-labelledby="order-heading">
            <h2 id="order-heading" class="panel-title">Order</h2>

            @if (order(); as currentOrder) {
              <dl class="detail-list">
                <div>
                  <dt>Reference</dt>
                  <dd class="font-mono">{{ currentOrder.orderReference }}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd><app-badge [status]="currentOrder.paymentStatus" size="sm" /></dd>
                </div>
                <div>
                  <dt>Method</dt>
                  <dd>{{ currentOrder.paymentMethod.replace('_', ' ') }}</dd>
                </div>
                <div>
                  <dt>Total</dt>
                  <dd>{{ CurrencyFormatUtility.formatCents(currentOrder.totalCents, currentOrder.currency) }}</dd>
                </div>
                <div>
                  <dt>Placed</dt>
                  <dd>{{ DateFormatUtility.formatDateTime(currentOrder.createdAt) }}</dd>
                </div>
                <div>
                  <dt>Contact</dt>
                  <dd>{{ currentOrder.customerEmail }}</dd>
                </div>
              </dl>

              <ul class="line-items">
                @for (item of currentOrder.lineItems; track item.ticketTierId) {
                  <li class="line-item">
                    <span>{{ item.quantity }} × {{ item.tierName }}</span>
                    <span>{{ CurrencyFormatUtility.formatCents(item.subtotalCents, currentOrder.currency) }}</span>
                  </li>
                }
              </ul>
            } @else {
              <p class="panel-empty">
                No order document is available for this ticket (it may have been issued offline).
              </p>
            }
          </section>

          <section class="panel" aria-labelledby="door-heading">
            <h2 id="door-heading" class="panel-title">Door record</h2>

            <dl class="detail-list">
              <div>
                <dt>Admission</dt>
                <dd>{{ current.checkInStatus.replace('_', ' ') }}</dd>
              </div>
              <div>
                <dt>Admitted at</dt>
                <dd>
                  {{ current.checkedInAt === null ? 'not admitted' : DateFormatUtility.formatDateTime(current.checkedInAt) }}
                </dd>
              </div>
              <div>
                <dt>Operator</dt>
                <dd class="font-mono">{{ current.checkedInByUserId ?? '—' }}</dd>
              </div>
              <div>
                <dt>Seat / zone</dt>
                <dd>{{ current.seatAssignment ?? 'general admission' }}</dd>
              </div>
              <div>
                <dt>Issued</dt>
                <dd>{{ DateFormatUtility.formatDateTime(current.createdAt) }}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{{ DateFormatUtility.formatDateTime(current.updatedAt) }}</dd>
              </div>
            </dl>

            <div class="panel-actions">
              <app-button
                variant="neutral"
                icon="🖨"
                (pressed)="print()">
                Print pass
              </app-button>
              <app-button
                variant="outline"
                [disabled]="current.checkInStatus === 'cancelled' || isBusy()"
                [loading]="isBusy()"
                (pressed)="refund($event)">
                Refund &amp; cancel
              </app-button>
            </div>
          </section>
        </div>
      } @else {
        <section class="not-found" aria-live="polite">
          <p class="not-found-icon" aria-hidden="true">🎫</p>
          <h1 class="not-found-title">Ticket not found</h1>
          <p class="not-found-body">
            No attendee ticket with this reference exists for the active event. It may have been
            issued for a different event, or the roster is still loading.
          </p>
          <app-button variant="outline" (pressed)="reload()">Reload roster</app-button>
        </section>
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
        gap: 14px;
        width: 100%;
        max-width: var(--content-max-width);
        margin: 0 auto;
        padding: 18px 14px 32px 14px;
      }

      @media (min-width: 1024px) {
        .page {
          padding: 24px 32px 40px 32px;
        }
      }

      .breadcrumb-link {
        font-size: 12px;
        font-weight: 700;
        color: var(--color-slate-500);
        text-decoration: none;
      }

      .page-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .page-title {
        font-size: 21px;
        font-weight: 900;
        letter-spacing: -0.4px;
      }

      .page-subtitle {
        font-size: 13px;
        color: var(--color-slate-500);
      }

      .font-mono {
        font-family: var(--font-mono);
      }

      .action-message {
        padding: 10px 12px;
        border: 1px solid var(--color-border-strong);
        border-radius: var(--radius-md);
        background: var(--color-canvas);
        font-size: 12px;
        font-weight: 700;
        color: var(--color-slate-700);
      }

      .detail-columns {
        display: grid;
        grid-template-columns: 1fr;
        gap: 14px;
      }

      @media (min-width: 768px) {
        .detail-columns {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      .panel {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
      }

      .panel-title {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 1.2px;
        color: var(--color-slate-500);
        text-transform: uppercase;
      }

      .panel-empty {
        font-size: 12px;
        color: var(--color-muted);
      }

      .detail-list {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin: 0;
      }

      .detail-list dt {
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.8px;
        color: var(--color-muted-soft);
        text-transform: uppercase;
      }

      .detail-list dd {
        margin: 2px 0 0 0;
        font-size: 13px;
        font-weight: 700;
        color: var(--color-slate-800);
        word-break: break-word;
      }

      .line-items {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin: 0;
        padding: 10px 12px;
        background: var(--color-canvas);
        border-radius: var(--radius-md);
        list-style: none;
      }

      .line-item {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        font-size: 12px;
        font-weight: 600;
        color: var(--color-slate-700);
      }

      .panel-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .not-found {
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

      .not-found-icon {
        font-size: 38px;
      }

      .not-found-title {
        font-size: 19px;
        font-weight: 900;
      }

      .not-found-body {
        max-width: 460px;
        font-size: 13px;
        line-height: 1.6;
        color: var(--color-slate-500);
      }
    `
  ]
})
export class TicketDetailSheetComponent {
  private readonly data = inject(EventDataStore);

  /** Ticket id from the route. */
  public readonly ticketId = input<string>('');

  /** Attendee ticket resolved from the live roster. */
  protected readonly ticket = computed<AttendeeTicket | null>(() => {
    const id = this.ticketId();
    if (id.length === 0) {
      return null;
    }
    return this.data.attendees().find((attendee) => attendee.id === id) ?? null;
  });

  /** Order the ticket belongs to. */
  protected readonly order = computed<TicketOrder | null>(() => {
    const current = this.ticket();
    if (current === null) {
      return null;
    }
    return this.data.orders().find((entry) => entry.id === current.orderId) ?? null;
  });

  /** Local busy flag for the operator actions. */
  protected readonly isBusy = signal<boolean>(false);

  /** Feedback line for the last action. */
  protected readonly actionMessage = signal<string | null>(null);

  /** Currency utilities exposed to the template. */
  protected readonly CurrencyFormatUtility = CurrencyFormatUtility;

  /** Date utilities exposed to the template. */
  protected readonly DateFormatUtility = DateFormatUtility;

  /** Event title used by the pass. */
  protected readonly eventTitle = computed(() => this.data.event()?.title ?? 'Event pass');

  /** Venue line used by the pass. */
  protected readonly venueLine = computed(() => {
    const event = this.data.event();
    if (event === null) {
      return '';
    }
    return `${event.venue.venueName} · ${event.venue.city}, ${event.venue.stateProvince}`;
  });

  /** Date and time line used by the pass. */
  protected readonly dateTimeLine = computed(() => {
    const event = this.data.event();
    if (event === null) {
      return '';
    }
    return DateFormatUtility.formatEventDateRange(event.startDateTime, event.endDateTime, {
      timeZone: event.timezone
    });
  });

  public constructor() {
    void this.data.connect();
  }

  /** Reloads the active event when the ticket cannot be resolved yet. */
  protected async reload(): Promise<void> {
    await this.data.connect();
  }

  /** Admits or reverses the admission for this ticket. */
  protected async toggleAdmission(ticket: AttendeeTicket): Promise<void> {
    this.isBusy.set(true);
    try {
      const applied =
        ticket.checkInStatus === 'checked_in'
          ? await this.data.reverseAdmission(ticket)
          : await this.data.admitAttendee(ticket, 'pass_detail_operator', 'manual_button');

      this.actionMessage.set(
        applied
          ? ticket.checkInStatus === 'checked_in'
            ? 'Admission reversed.'
            : 'Attendee admitted.'
          : 'The admission could not be applied.'
      );
    } finally {
      this.isBusy.set(false);
    }
  }

  /** Refunds the order and cancels the ticket through the cascade. */
  protected async refund(event: Event): Promise<void> {
    event.preventDefault();
    const current = this.ticket();
    if (current === null || this.isBusy()) {
      return;
    }

    this.isBusy.set(true);
    try {
      const applied = await this.data.refundTicket(current);
      this.actionMessage.set(
        applied
          ? 'Order refunded, ticket cancelled and the tier quota released.'
          : 'The refund could not be applied.'
      );
    } finally {
      this.isBusy.set(false);
    }
  }

  /** Prints the pass. */
  protected print(): void {
    if (typeof window !== 'undefined') {
      window.print();
    }
  }
}
