import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import type { AttendeeTicket } from '../../../core/models/ticket.model';
import { BadgeComponent } from '../../ui/badge/badge.component';
import { DateFormatUtility } from '../../utils/date-format.util';

/**
 * Single roster row: avatar initials, attendee identity, stub reference, tier,
 * admission badge and an instant check-in toggle.
 *
 * The whole row is a button-like surface for tap ergonomics on mobile, while the
 * explicit toggle keeps a 48px hit box and carries an accurate accessible name.
 */
@Component({
  selector: 'app-attendee-row-item',
  standalone: true,
  imports: [BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="attendee-row"
      [class.is-checked-in]="isCheckedIn()"
      [class.is-cancelled]="isCancelled()"
      [class.is-selected]="selected()">
      @if (selectable()) {
        <label class="row-select">
          <input
            type="checkbox"
            [checked]="selected()"
            [attr.aria-label]="'Select ' + fullName()"
            (change)="onSelectToggle($event)" />
        </label>
      }

      <span class="avatar" [style.background-color]="avatarColor()" aria-hidden="true">
        {{ initials() }}
      </span>

      <div class="row-main">
        <div class="row-heading">
          <h3 class="attendee-name">{{ fullName() }}</h3>
          <app-badge [status]="badgeStatus()" size="sm" />
        </div>

        <p class="attendee-meta">
          <span class="meta-email">{{ ticket().email }}</span>
          @if (ticket().companyOrAffiliation.length > 0) {
            <span class="meta-sep">·</span>
            <span class="meta-company">{{ ticket().companyOrAffiliation }}</span>
          }
        </p>

        <div class="row-tags">
          <span class="tag tag-stub font-mono">{{ ticket().ticketStubNumber }}</span>
          <span class="tag tag-tier">{{ ticket().ticketTierName }}</span>
          @if (ticket().seatAssignment !== undefined && ticket().seatAssignment !== '') {
            <span class="tag">SEAT {{ ticket().seatAssignment }}</span>
          }
          @if (isCheckedIn() && checkInLabel() !== null) {
            <span class="tag tag-time">{{ checkInLabel() }}</span>
          }
        </div>
      </div>

      <div class="row-actions">
        <button
          type="button"
          class="toggle-btn"
          [class.undo]="isCheckedIn()"
          [disabled]="isCancelled() || pending()"
          [attr.aria-pressed]="isCheckedIn()"
          [attr.aria-label]="toggleLabel()"
          (click)="toggleCheckIn()">
          @if (pending()) {
            <span class="mini-spinner" aria-hidden="true"></span>
          } @else if (isCheckedIn()) {
            UNDO
          } @else {
            CHECK IN
          }
        </button>

        @if (showDetails()) {
          <button
            type="button"
            class="details-btn"
            [attr.aria-label]="'Open ticket pass for ' + fullName()"
            (click)="openDetails.emit(ticket())">
            PASS
          </button>
        }
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .attendee-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 14px;
        background: var(--color-surface);
        border-bottom: 1px solid var(--color-border);
      }

      .attendee-row:last-child {
        border-bottom: none;
      }

      .attendee-row.is-checked-in {
        background: linear-gradient(90deg, var(--color-emerald-soft), var(--color-surface) 45%);
      }

      .attendee-row.is-cancelled {
        opacity: 0.62;
      }

      .attendee-row.is-selected {
        box-shadow: inset 3px 0 0 var(--color-coral);
      }

      .row-select {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--touch-target-min);
        height: var(--touch-target-min);
        margin-left: -8px;
      }

      .row-select input {
        width: 18px;
        height: 18px;
        accent-color: var(--color-coral);
      }

      .avatar {
        flex: 0 0 40px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        color: #ffffff;
        font-size: 14px;
        font-weight: 800;
        letter-spacing: 0.5px;
      }

      .row-main {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
      }

      .row-heading {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .attendee-name {
        font-size: 14px;
        font-weight: 800;
        color: var(--color-ink);
      }

      .attendee-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        font-size: 12px;
        color: var(--color-slate-500);
        word-break: break-word;
      }

      .meta-sep {
        color: var(--color-muted-soft);
      }

      .row-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 2px;
      }

      .tag {
        padding: 2px 7px;
        border-radius: var(--radius-sm);
        background: var(--color-canvas);
        border: 1px solid var(--color-border);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.4px;
        color: var(--color-slate-600);
      }

      .tag-stub {
        letter-spacing: 1px;
        color: var(--color-slate-800);
      }

      .tag-tier {
        border-color: #ffd9d0;
        background: var(--color-coral-soft);
        color: var(--color-coral-strong);
      }

      .tag-time {
        border-color: #bbf7d0;
        background: var(--color-emerald-soft);
        color: var(--color-emerald-deep);
      }

      .row-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      .toggle-btn,
      .details-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 92px;
        min-height: var(--touch-target-min);
        padding: 8px 12px;
        border-radius: var(--radius-md);
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.6px;
        border: 1px solid transparent;
      }

      .toggle-btn {
        background: var(--color-coral);
        color: #ffffff;
      }

      .toggle-btn.undo {
        background: var(--color-emerald-soft);
        border-color: #a7f3d0;
        color: var(--color-emerald-deep);
      }

      .toggle-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .details-btn {
        min-width: var(--touch-target-min);
        background: var(--color-surface);
        border-color: var(--color-border-strong);
        color: var(--color-slate-600);
      }

      .mini-spinner {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 2px solid currentColor;
        border-top-color: transparent;
        animation: row-spin 700ms linear infinite;
      }

      @keyframes row-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (max-width: 430px) {
        .attendee-row {
          flex-wrap: wrap;
        }

        .row-actions {
          width: 100%;
          justify-content: space-between;
          margin-top: 4px;
        }

        .toggle-btn {
          flex: 1 1 auto;
        }
      }
    `
  ]
})
export class AttendeeRowItemComponent {
  /** Attendee record to render. */
  public readonly ticket = input.required<AttendeeTicket>();

  /** Renders a leading selection checkbox for batch actions. */
  public readonly selectable = input<boolean>(false);

  /** Whether this row is currently selected. */
  public readonly selected = input<boolean>(false);

  /** Renders the pass-detail action. */
  public readonly showDetails = input<boolean>(true);

  /** Shows an inline spinner and blocks the toggle while a write is in flight. */
  public readonly pending = input<boolean>(false);

  /** Emitted when the operator toggles admission for this attendee. */
  public readonly toggleCheckIn = output<AttendeeTicket>();

  /** Emitted when the operator opens the printable pass. */
  public readonly openDetails = output<AttendeeTicket>();

  /** Emitted when the row selection changes. */
  public readonly selectionChange = output<{ ticket: AttendeeTicket; selected: boolean }>();

  /** `true` when the attendee has been admitted. */
  public readonly isCheckedIn = computed(() => this.ticket().checkInStatus === 'checked_in');

  /** `true` when the ticket was cancelled (refund or void). */
  public readonly isCancelled = computed(() => this.ticket().checkInStatus === 'cancelled');

  /** Full display name. */
  public readonly fullName = computed(() => {
    const ticket = this.ticket();
    return `${ticket.firstName} ${ticket.lastName}`.trim();
  });

  /** Avatar initials, at most two characters. */
  public readonly initials = computed(() => {
    const ticket = this.ticket();
    const first = ticket.firstName.trim().charAt(0);
    const last = ticket.lastName.trim().charAt(0);
    return `${first}${last}`.toUpperCase() || '?';
  });

  /** Deterministic avatar colour derived from the attendee id. */
  public readonly avatarColor = computed(() => {
    const palette = ['#ff5a36', '#0ea5e9', '#7c3aed', '#059669', '#d97706', '#db2777'];
    const id = this.ticket().id;
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) {
      hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
    }
    return palette[hash % palette.length];
  });

  /** Badge status for the admission state. */
  public readonly badgeStatus = computed(() => {
    const status = this.ticket().checkInStatus;
    if (status === 'checked_in') {
      return 'checked_in' as const;
    }
    if (status === 'cancelled') {
      return 'cancelled' as const;
    }
    return 'confirmed' as const;
  });

  /** Local time of admission, or `null` when not admitted. */
  public readonly checkInLabel = computed(() => {
    const checkedInAt = this.ticket().checkedInAt;
    if (checkedInAt === null || checkedInAt === '') {
      return null;
    }
    return `IN ${DateFormatUtility.formatTime(checkedInAt)}`;
  });

  /** Accessible name for the admission toggle. */
  public readonly toggleLabel = computed(() =>
    this.isCheckedIn()
      ? `Reverse check-in for ${this.fullName()}`
      : `Check in ${this.fullName()}`
  );

  /** Emits the toggle request, guarding cancelled tickets and in-flight writes. */
  public toggle(): void {
    if (this.isCancelled() || this.pending()) {
      return;
    }
    this.toggleCheckIn.emit(this.ticket());
  }

  /** Handles the selection checkbox. */
  public onSelectToggle(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.selectionChange.emit({ ticket: this.ticket(), selected: target.checked });
  }
}
