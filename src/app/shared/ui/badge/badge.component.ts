import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Status themes covering admission state, sales state, payment state, ticket
 * tier classes and sync health.
 */
export type BadgeStatus =
  | 'confirmed'
  | 'checked_in'
  | 'cancelled'
  | 'sold_out'
  | 'available'
  | 'vip'
  | 'free'
  | 'paid'
  | 'refunded'
  | 'pending'
  | 'draft'
  | 'published'
  | 'archived'
  | 'online'
  | 'offline'
  | 'syncing'
  | 'error';

/** Badge size; `sm` is used inside dense table rows. */
export type BadgeSize = 'sm' | 'md';

/** Maps a status to its default human readable label. */
const STATUS_LABELS: Record<BadgeStatus, string> = {
  confirmed: 'CONFIRMED',
  checked_in: 'CHECKED IN',
  cancelled: 'CANCELLED',
  sold_out: 'SOLD OUT',
  available: 'AVAILABLE',
  vip: 'VIP',
  free: 'FREE',
  paid: 'PAID',
  refunded: 'REFUNDED',
  pending: 'PENDING',
  draft: 'DRAFT',
  published: 'PUBLISHED',
  archived: 'ARCHIVED',
  online: 'ONLINE',
  offline: 'OFFLINE',
  syncing: 'SYNCING',
  error: 'FAILED'
};

/** Statuses rendered with a pulsing dot to signal a live/transient state. */
const PULSING_STATUSES: ReadonlySet<BadgeStatus> = new Set<BadgeStatus>([
  'online',
  'syncing',
  'pending'
]);

/**
 * High-contrast status chip.
 *
 * Colours come from the design tokens so the same chip reads identically on the
 * dashboard, the roster and the kiosk terminal.
 */
@Component({
  selector: 'app-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="badge"
      [class]="statusClass()"
      [class.size-sm]="size() === 'sm'"
      [class.size-md]="size() === 'md'"
      [class.with-dot]="showDotResolved()"
      role="status">
      @if (showDotResolved()) {
        <span class="dot" [class.pulsing]="pulses()" aria-hidden="true"></span>
      }
      <span class="badge-label">{{ labelText() }}</span>
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: var(--radius-pill);
        font-weight: 800;
        letter-spacing: 0.5px;
        white-space: nowrap;
        text-transform: uppercase;
      }

      .size-sm {
        padding: 3px 8px;
        font-size: 10px;
      }

      .size-md {
        padding: 5px 10px;
        font-size: 11px;
      }

      .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background-color: currentColor;
      }

      .dot.pulsing {
        animation: badge-pulse 1.4s ease-in-out infinite;
      }

      @keyframes badge-pulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.45;
          transform: scale(0.82);
        }
      }

      /* Admission ---------------------------------------------------------- */
      .status-confirmed {
        background-color: var(--color-coral-soft);
        color: var(--color-coral-strong);
      }

      .status-checked_in {
        background-color: var(--color-emerald-soft);
        color: var(--color-emerald-deep);
      }

      .status-cancelled {
        background-color: var(--color-danger-soft);
        color: var(--color-danger);
      }

      /* Sales -------------------------------------------------------------- */
      .status-sold_out {
        background-color: var(--color-charcoal);
        color: #ffffff;
      }

      .status-available {
        background-color: var(--color-info-soft);
        color: var(--color-info);
      }

      .status-vip {
        background-color: var(--color-violet-soft);
        color: var(--color-violet);
      }

      .status-free {
        background-color: #f0fdf4;
        color: #15803d;
      }

      /* Payment ------------------------------------------------------------ */
      .status-paid {
        background-color: var(--color-emerald-soft);
        color: var(--color-emerald-deep);
      }

      .status-refunded {
        background-color: var(--color-amber-soft);
        color: #b45309;
      }

      .status-pending {
        background-color: var(--color-amber-soft);
        color: #b45309;
      }

      /* Lifecycle ---------------------------------------------------------- */
      .status-draft {
        background-color: #f1f5f9;
        color: var(--color-slate-600);
      }

      .status-published {
        background-color: var(--color-emerald-soft);
        color: var(--color-emerald-deep);
      }

      .status-archived {
        background-color: #f1f5f9;
        color: var(--color-muted);
      }

      /* Sync --------------------------------------------------------------- */
      .status-online {
        background-color: var(--color-emerald-soft);
        color: var(--color-emerald-deep);
      }

      .status-offline {
        background-color: var(--color-danger-soft);
        color: var(--color-danger);
      }

      .status-syncing {
        background-color: var(--color-info-soft);
        color: var(--color-info);
      }

      .status-error {
        background-color: var(--color-danger-soft);
        color: var(--color-danger);
      }
    `
  ]
})
export class BadgeComponent {
  /** Status to display. */
  public readonly status = input.required<BadgeStatus>();

  /** Size variant. */
  public readonly size = input<BadgeSize>('md');

  /** Overrides the default label text. */
  public readonly label = input<string | null>(null);

  /** Renders a leading status dot; defaults to on for sync-style statuses. */
  public readonly showDot = input<boolean | null>(null);

  /** Label actually rendered. */
  public readonly labelText = computed(() => this.label() ?? STATUS_LABELS[this.status()]);

  /** CSS class for the active status theme. */
  public readonly statusClass = computed(() => `status-${this.status()}`);

  /** Whether a leading dot is rendered. */
  public readonly showDotResolved = computed(
    () => this.showDot() ?? PULSING_STATUSES.has(this.status())
  );

  /** Whether the leading dot pulses. */
  public readonly pulses = computed(() => PULSING_STATUSES.has(this.status()));
}
