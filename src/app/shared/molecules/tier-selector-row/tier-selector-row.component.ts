import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import type { TicketTier } from '../../../core/models/ticket.model';
import { CurrencyFormatUtility } from '../../utils/currency-format.util';
import { DateFormatUtility } from '../../utils/date-format.util';

/**
 * Ticket tier row with a quantity stepper for the RSVP checkout flow.
 *
 * Enforces the tier's own inventory (`availableQuota`), the per-order cap
 * (`maxPerOrder`), the sales window and the global per-order limit, and explains
 * every disabled state inline so an operator never has to guess why a tier cannot
 * be selected.
 */
@Component({
  selector: 'app-tier-selector-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="tier-row" [class.sold-out]="isSoldOut()" [class.inactive]="!tier().isActive">
      <span class="tier-accent" [style.background-color]="tier().badgeColorHex"></span>

      <div class="tier-main">
        <div class="tier-heading">
          <h3 class="tier-name">{{ tier().name }}</h3>
          <span class="tier-price">{{ priceLabel() }}</span>
        </div>

        <p class="tier-meta">
          {{ availabilityLabel() }}
          @if (salesWindowLabel() !== null) {
            <span class="tier-window">· {{ salesWindowLabel() }}</span>
          }
        </p>

        @if (tier().perks.length > 0) {
          <ul class="perk-list">
            @for (perk of tier().perks; track perk) {
              <li class="perk-item">{{ perk }}</li>
            }
          </ul>
        }

        @if (disabledReason() !== null) {
          <p class="tier-notice" role="status">{{ disabledReason() }}</p>
        }
      </div>

      <div class="stepper">
        <button
          type="button"
          class="step-btn"
          [disabled]="quantity() === 0"
          [attr.aria-label]="'Remove one ' + tier().name + ' ticket'"
          (click)="decrement()">
          &minus;
        </button>

        <input
          class="step-value"
          type="text"
          inputmode="numeric"
          readonly
          [value]="quantity()"
          [attr.aria-label]="tier().name + ' quantity'"
          [attr.aria-live]="'polite'" />

        <button
          type="button"
          class="step-btn"
          [disabled]="!canIncrement()"
          [attr.aria-label]="'Add one ' + tier().name + ' ticket'"
          (click)="increment()">
          +
        </button>
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .tier-row {
        display: flex;
        align-items: stretch;
        gap: 12px;
        padding: 14px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
      }

      .tier-row.sold-out,
      .tier-row.inactive {
        background: var(--color-ticket-canvas);
      }

      .tier-accent {
        flex: 0 0 4px;
        border-radius: var(--radius-pill);
      }

      .tier-main {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }

      .tier-heading {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }

      .tier-name {
        font-size: 15px;
        font-weight: 800;
        color: var(--color-ink);
      }

      .tier-price {
        font-size: 15px;
        font-weight: 900;
        color: var(--color-coral);
      }

      .tier-meta {
        font-size: 12px;
        color: var(--color-slate-500);
      }

      .tier-window {
        color: var(--color-muted-soft);
      }

      .perk-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 6px 0 0 0;
        padding: 0;
        list-style: none;
      }

      .perk-item {
        padding: 2px 8px;
        border-radius: var(--radius-pill);
        background: var(--color-canvas);
        font-size: 11px;
        font-weight: 600;
        color: var(--color-slate-600);
      }

      .tier-notice {
        margin-top: 6px;
        font-size: 11px;
        font-weight: 700;
        color: #b45309;
      }

      .sold-out .tier-notice,
      .inactive .tier-notice {
        color: var(--color-danger);
      }

      /* Stepper: both buttons honour the 48px touch target. */
      .stepper {
        display: flex;
        align-items: center;
        gap: 4px;
        align-self: center;
      }

      .step-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--touch-target-min);
        height: var(--touch-target-min);
        border: 1px solid var(--color-border-strong);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        font-size: 20px;
        font-weight: 700;
        color: var(--color-slate-700);
        transition: background-color var(--transition-fast);
      }

      .step-btn:not(:disabled):hover {
        border-color: var(--color-coral);
        color: var(--color-coral);
      }

      .step-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .step-value {
        width: 44px;
        height: var(--touch-target-min);
        border: none;
        background: transparent;
        text-align: center;
        font-size: 17px;
        font-weight: 900;
        color: var(--color-ink);
      }

      @media (max-width: 430px) {
        .tier-row {
          flex-wrap: wrap;
        }

        .stepper {
          width: 100%;
          justify-content: space-between;
          margin-top: 8px;
        }
      }
    `
  ]
})
export class TierSelectorRowComponent {
  /** Tier being offered. */
  public readonly tier = input.required<TicketTier>();

  /** Quantity currently selected for this tier. */
  public readonly quantity = input<number>(0);

  /** Total tickets already selected across all tiers (enforces the per-order cap). */
  public readonly totalSelected = input<number>(0);

  /** Global maximum tickets per order. */
  public readonly maxTicketsPerOrder = input<number>(10);

  /** Currency used for the price label. */
  public readonly currency = input<string>('USD');

  /** Locale used for price and date formatting. */
  public readonly locale = input<string | undefined>(undefined);

  /** Emitted with the new quantity when the stepper changes. */
  public readonly quantityChange = output<number>();

  /** True when the tier has no inventory left. */
  public readonly isSoldOut = computed(() => this.tier().availableQuota <= 0);

  /** Effective per-tier ceiling for this order. */
  public readonly tierLimit = computed(() =>
    Math.min(this.tier().availableQuota, this.tier().maxPerOrder)
  );

  /** Formatted price, or the tier type for free/donation tiers. */
  public readonly priceLabel = computed(() => {
    const tier = this.tier();
    if (tier.tierType === 'free' || tier.priceCents === 0) {
      return 'FREE';
    }
    return CurrencyFormatUtility.formatCents(tier.priceCents, this.currency(), {
      locale: this.locale(),
      showCents: tier.priceCents % 100 !== 0
    });
  });

  /** Remaining inventory line. */
  public readonly availabilityLabel = computed(() => {
    const tier = this.tier();
    if (!tier.isActive) {
      return 'Not on sale';
    }
    if (tier.availableQuota <= 0) {
      return 'Sold out';
    }
    if (tier.availableQuota <= 10) {
      return `Only ${tier.availableQuota} left of ${tier.initialQuota}`;
    }
    return `${tier.availableQuota} of ${tier.initialQuota} available`;
  });

  /** Sales window, rendered only when it is not fully open. */
  public readonly salesWindowLabel = computed(() => {
    const tier = this.tier();
    const now = new Date();
    const starts = new Date(tier.salesStartDate);
    const ends = new Date(tier.salesEndDate);

    if (!Number.isNaN(starts.getTime()) && starts.getTime() > now.getTime()) {
      return `Opens ${DateFormatUtility.formatDate(tier.salesStartDate, { locale: this.locale() })}`;
    }
    if (!Number.isNaN(ends.getTime()) && ends.getTime() < now.getTime()) {
      return `Closed ${DateFormatUtility.formatDate(tier.salesEndDate, { locale: this.locale() })}`;
    }
    return null;
  });

  /** Explains why the tier cannot be increased, or `null` when it can. */
  public readonly disabledReason = computed<string | null>(() => {
    const tier = this.tier();
    if (!tier.isActive) {
      return 'This tier is not on sale.';
    }
    if (this.isSoldOut()) {
      return 'Tier sold out.';
    }
    if (this.quantity() >= this.tierLimit()) {
      return `Limit of ${this.tierLimit()} per order reached for this tier.`;
    }
    if (this.totalSelected() >= this.maxTicketsPerOrder()) {
      return `Maximum of ${this.maxTicketsPerOrder()} tickets per order reached.`;
    }
    if (this.salesWindowLabel() !== null) {
      return this.salesWindowLabel() ?? null;
    }
    return null;
  });

  /** Whether the increment control is available. */
  public readonly canIncrement = computed(
    () =>
      this.tier().isActive &&
      !this.isSoldOut() &&
      this.quantity() < this.tierLimit() &&
      this.totalSelected() < this.maxTicketsPerOrder()
  );

  /** Adds one ticket when the tier allows it. */
  public increment(): void {
    if (!this.canIncrement()) {
      return;
    }
    this.quantityChange.emit(this.quantity() + 1);
  }

  /** Removes one ticket, never below zero. */
  public decrement(): void {
    if (this.quantity() <= 0) {
      return;
    }
    this.quantityChange.emit(this.quantity() - 1);
  }
}
