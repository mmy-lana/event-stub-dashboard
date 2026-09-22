import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import type { AttendeeTicket } from '../../../core/models/ticket.model';
import { BarcodeStripComponent } from '../../ui/barcode-strip/barcode-strip.component';
import { PerforationDividerComponent } from '../../ui/perforation-divider/perforation-divider.component';
import { QrCanvasComponent } from '../../ui/qr-canvas/qr-canvas.component';
import { TicketNotchComponent } from '../../ui/ticket-notch/ticket-notch.component';

/**
 * Physical tear-off ticket stub.
 *
 * Horizontal on tablet and up (main body plus a right-hand perforated coupon with
 * the QR tag); folds into a vertical stack with a horizontal cut line below 768px,
 * where the action button grows to the full-width 48px target. Colours, notches
 * and the dashed cut line follow the skeuomorphic stub specification.
 */
@Component({
  selector: 'app-ticket-stub-card',
  standalone: true,
  imports: [BarcodeStripComponent, PerforationDividerComponent, QrCanvasComponent, TicketNotchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="ticket-stub-card"
      [class.is-checked-in]="isCheckedIn()"
      [class.is-cancelled]="isCancelled()">
      <!-- Main ticket body -->
      <div class="ticket-body">
        <div class="header-strip">
          <span class="brand-eyebrow">{{ eyebrow() }}</span>
          <span class="status-chip" [class.chip-valid]="!isCheckedIn()" [class.chip-used]="isCheckedIn()">
            {{ isCheckedIn() ? 'CHECKED IN' : isCancelled() ? 'CANCELLED' : 'VALID PASS' }}
          </span>
        </div>

        <div class="event-meta">
          <h3 class="event-title">{{ eventTitle() }}</h3>
          <p class="venue-line">{{ venueName() }}</p>
          <p class="datetime-line">{{ formattedDateTime() }}</p>
        </div>

        <dl class="attendee-details-grid">
          <div class="meta-field">
            <dt class="field-label">ATTENDEE</dt>
            <dd class="field-value">{{ fullName() }}</dd>
          </div>
          <div class="meta-field">
            <dt class="field-label">TIER</dt>
            <dd class="field-value tier-name">{{ ticket().ticketTierName }}</dd>
          </div>
          <div class="meta-field">
            <dt class="field-label">STUB REFERENCE</dt>
            <dd class="field-value font-mono">{{ ticket().ticketStubNumber }}</dd>
          </div>
          @if (seatAssignment() !== null) {
            <div class="meta-field">
              <dt class="field-label">SEAT / ZONE</dt>
              <dd class="field-value">{{ seatAssignment() }}</dd>
            </div>
          }
        </dl>

        <div class="body-barcode-footer">
          <app-barcode-strip [code]="ticket().barcodeValue" [height]="40" />
        </div>
      </div>

      <!-- Perforated tear-off line -->
      <div class="ticket-perforation">
        <app-perforation-divider
          [orientation]="'vertical'"
          [notchColor]="'var(--color-surface)'"
          class="desktop-divider" />
        <app-perforation-divider
          [orientation]="'horizontal'"
          [notchColor]="'var(--color-surface)'"
          class="mobile-divider" />
      </div>

      <!-- Tear-off coupon -->
      <div class="ticket-tear-stub">
        <div class="stub-header">
          <span class="stub-tag">TEAR-OFF PASS</span>
          <span class="stub-number font-mono">{{ ticket().ticketStubNumber }}</span>
        </div>

        <div class="qr-container">
          <app-qr-canvas
            [value]="ticket().qrVerificationSecret"
            [size]="effectiveQrSize()"
            caption="Scan to verify" />
        </div>

        <div class="stub-footer">
          @if (showActions()) {
            <button
              type="button"
              class="verify-action-btn"
              [class.btn-checked-in]="isCheckedIn()"
              [disabled]="isCancelled() || pending()"
              (click)="onToggleCheckIn.emit(ticket())">
              @if (pending()) {
                <span class="mini-spinner" aria-hidden="true"></span>
              } @else if (isCheckedIn()) {
                <span>&#10003; REVERSE CHECK-IN</span>
              } @else {
                <span>CONFIRM ADMISSION</span>
              }
            </button>
          } @else {
            <p class="stub-hint">{{ isCheckedIn() ? 'Admitted' : 'Present this pass at the door' }}</p>
          }
        </div>
      </div>

      <app-ticket-notch class="notch-notch top-notch" edge="top" [size]="18" [color]="'var(--color-canvas)'" />
      <app-ticket-notch class="notch-notch bottom-notch" edge="bottom" [size]="18" [color]="'var(--color-canvas)'" />
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        max-width: 860px;
        margin: 0 auto;
      }

      .ticket-stub-card {
        position: relative;
        display: flex;
        flex-direction: row;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-raised);
        overflow: hidden;
      }

      .ticket-stub-card.is-checked-in {
        border-color: #a7f3d0;
      }

      .ticket-stub-card.is-cancelled {
        opacity: 0.7;
      }

      .ticket-body {
        flex: 1 1 65%;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        min-width: 0;
        padding: 24px;
      }

      .header-strip {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 12px;
      }

      .brand-eyebrow {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 1.5px;
        color: var(--color-coral);
        text-transform: uppercase;
      }

      .status-chip {
        padding: 4px 8px;
        border-radius: var(--radius-pill);
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.6px;
      }

      .chip-valid {
        background: var(--color-coral-soft);
        color: var(--color-coral-strong);
      }

      .chip-used {
        background: var(--color-emerald-soft);
        color: var(--color-emerald-deep);
      }

      .event-title {
        margin: 0 0 6px 0;
        font-size: 20px;
        font-weight: 800;
        line-height: 1.25;
        color: var(--color-ink);
      }

      .venue-line,
      .datetime-line {
        font-size: 13px;
        line-height: 1.4;
        color: var(--color-slate-500);
      }

      .attendee-details-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        margin: 20px 0;
        padding: 14px;
        background: var(--color-canvas);
        border-radius: var(--radius-md);
      }

      .meta-field {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .field-label {
        margin-bottom: 2px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.8px;
        color: var(--color-muted-soft);
        text-transform: uppercase;
      }

      .field-value {
        margin: 0;
        font-size: 14px;
        font-weight: 700;
        color: var(--color-slate-800);
        word-break: break-word;
      }

      .tier-name {
        color: var(--color-coral);
      }

      .font-mono {
        font-family: var(--font-mono);
      }

      .body-barcode-footer {
        margin-top: auto;
        padding-top: 8px;
      }

      .ticket-perforation {
        display: flex;
        align-items: center;
        position: relative;
      }

      .desktop-divider {
        display: block;
        height: 100%;
      }

      .mobile-divider {
        display: none;
        width: 100%;
      }

      .ticket-tear-stub {
        flex: 0 0 214px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: space-between;
        padding: 20px;
        background: var(--color-sub-ticket);
      }

      .stub-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        margin-bottom: 8px;
      }

      .stub-tag {
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 1px;
        color: var(--color-muted-soft);
      }

      .stub-number {
        font-size: 12px;
        font-weight: 700;
        color: var(--color-slate-700);
      }

      .qr-container {
        display: flex;
        justify-content: center;
        margin: 8px 0;
      }

      .stub-footer {
        width: 100%;
      }

      .stub-hint {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.4px;
        text-align: center;
        color: var(--color-muted);
      }

      .verify-action-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        min-height: var(--touch-target-min);
        padding: 10px 14px;
        border: none;
        border-radius: var(--radius-md);
        background-color: var(--color-coral);
        color: #ffffff;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.4px;
        transition: background-color var(--transition-fast);
      }

      .verify-action-btn:active:not(:disabled) {
        transform: scale(0.985);
      }

      .verify-action-btn.btn-checked-in {
        background-color: var(--color-emerald-deep);
      }

      .verify-action-btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }

      .mini-spinner {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 2px solid currentColor;
        border-top-color: transparent;
        animation: stub-spin 700ms linear infinite;
      }

      @keyframes stub-spin {
        to {
          transform: rotate(360deg);
        }
      }

      /* Decorative punched notches on the outer corners of the card. */
      .notch-notch {
        position: absolute;
        z-index: 3;
      }

      .top-notch {
        top: 0;
        right: 78px;
      }

      .bottom-notch {
        bottom: 0;
        right: 78px;
      }

      @media (max-width: 767px) {
        .ticket-stub-card {
          flex-direction: column;
        }

        .ticket-body {
          padding: 20px 16px 12px 16px;
        }

        .desktop-divider {
          display: none;
        }

        .mobile-divider {
          display: block;
        }

        .ticket-tear-stub {
          flex: 1 1 auto;
          width: 100%;
          padding: 16px;
        }

        .attendee-details-grid {
          grid-template-columns: 1fr;
          gap: 12px;
          margin: 14px 0;
        }

        .top-notch {
          right: 16px;
        }

        .bottom-notch {
          right: 16px;
        }
      }
    `
  ]
})
export class TicketStubCardComponent {
  /** Attendee ticket rendered on the pass. */
  public readonly ticket = input.required<AttendeeTicket>();

  /** Event title printed in the header. */
  public readonly eventTitle = input.required<string>();

  /** Venue line printed under the title. */
  public readonly venueName = input.required<string>();

  /** Pre-formatted date and time line. */
  public readonly formattedDateTime = input.required<string>();

  /** Eyebrow above the title. */
  public readonly eyebrow = input<string>('OFFICIAL ENTRY PASS');

  /** Renders the admission action on the coupon. */
  public readonly showActions = input<boolean>(true);

  /** Inline spinner state for the admission action. */
  public readonly pending = input<boolean>(false);

  /** Emitted when the operator toggles admission from the stub. */
  public readonly onToggleCheckIn = output<AttendeeTicket>();

  /** `true` when the pass has been admitted. */
  public readonly isCheckedIn = computed(() => this.ticket().checkInStatus === 'checked_in');

  /** `true` when the pass was cancelled. */
  public readonly isCancelled = computed(() => this.ticket().checkInStatus === 'cancelled');

  /** Full attendee name. */
  public readonly fullName = computed(() => {
    const ticket = this.ticket();
    return `${ticket.firstName} ${ticket.lastName}`.trim().toUpperCase();
  });

  /** Optional seat assignment. */
  public readonly seatAssignment = computed(() => {
    const seat = this.ticket().seatAssignment;
    return seat === undefined || seat === '' ? null : seat;
  });

  /** Explicit QR size override in CSS pixels. */
  public readonly qrSize = input<number | null>(null);

  /** Compact rendering used by the parent on small viewports. */
  public readonly compact = input<boolean>(false);

  /**
   * QR size actually rendered: the explicit override when provided, otherwise
   * 120px in compact mode (phones) and 132px from tablet up, matching the
   * responsive matrix in the specification.
   */
  public readonly effectiveQrSize = computed(() => this.qrSize() ?? (this.compact() ? 120 : 132));
}
