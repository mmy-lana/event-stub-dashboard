import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { doc, runTransaction, type DocumentReference } from 'firebase/firestore';

import { FIRESTORE_DB } from '../../core/firebase/firebase.config';
import { FirestorePaths } from '../../core/firebase/firestore-paths';
import {
  VALIDATION_RULES,
  type AttendeeTicket,
  type EventModel,
  type OrderLineItem,
  type TicketOrder,
  type TicketTier
} from '../../core/models/ticket.model';
import { EventDataStore } from '../../core/state/event-data.store';
import { ButtonComponent } from '../../shared/ui/button/button.component';
import { TierSelectorRowComponent } from '../../shared/molecules/tier-selector-row/tier-selector-row.component';
import { CurrencyFormatUtility } from '../../shared/utils/currency-format.util';
import { TicketSecurityUtility } from '../../shared/utils/ticket-cryptography';
import { createShortIdentifier } from '../../shared/utils/identifier.util';

/** Outcome banner shown after a checkout attempt. */
export interface CheckoutOutcome {
  readonly status: 'reserved' | 'sold_out' | 'invalid' | 'error';
  readonly message: string;
  readonly orderId: string | null;
  readonly attendeeCount: number;
}

/**
 * RSVP and ticket checkout dialog.
 *
 * Multi-tier selection with a contact capture form, followed by an atomic capacity
 * reservation: the transaction re-reads the tier, refuses the order when the quota
 * has been exhausted by another station, decrements the quota, increments the
 * denormalised event counters and writes the order plus one attendee ticket per
 * seat. A quota race therefore surfaces as an explicit "sold out" banner instead of
 * an oversold event.
 */
@Component({
  selector: 'app-rsvp-checkout-dialog',
  standalone: true,
  imports: [ButtonComponent, TierSelectorRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="close()"></div>

    <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="checkout-heading">
      <header class="dialog-head">
        <div>
          <h2 id="checkout-heading" class="dialog-title">New RSVP</h2>
          <p class="dialog-subtitle">{{ event()?.title ?? 'Event' }}</p>
        </div>
        <button type="button" class="close-btn" aria-label="Close checkout" (click)="close()">×</button>
      </header>

      @if (outcome(); as result) {
        <p class="outcome" [class]="'outcome-' + result.status" role="alert">
          {{ result.message }}
        </p>
      }

      <div class="dialog-body">
        <!-- Tier selection -->
        <div class="tier-column">
          <h3 class="section-title">Select tickets</h3>

          @if (tiers().length === 0) {
            <p class="empty-note">No ticket tiers are on sale for this event.</p>
          } @else {
            @for (tier of tiers(); track tier.id) {
              <app-tier-selector-row
                [tier]="tier"
                [quantity]="quantityFor(tier.id)"
                [totalSelected]="totalQuantity()"
                [maxTicketsPerOrder]="VALIDATION_RULES.MAX_TICKETS_PER_ORDER"
                [currency]="currency()"
                (quantityChange)="setQuantity(tier.id, $event)" />
            }
          }
        </div>

        <!-- Contact capture -->
        <div class="form-column">
          <h3 class="section-title">Attendee details</h3>

          <form class="checkout-form" (submit)="submit($event)">
            <label class="field">
              <span class="field-label">First name</span>
              <input
                class="field-input"
                type="text"
                autocomplete="given-name"
                [value]="firstName()"
                [attr.aria-invalid]="errors().firstName ? 'true' : null"
                (input)="firstName.set(readValue($event))" />
              @if (errors().firstName) {
                <span class="field-error">{{ errors().firstName }}</span>
              }
            </label>

            <label class="field">
              <span class="field-label">Last name</span>
              <input
                class="field-input"
                type="text"
                autocomplete="family-name"
                [value]="lastName()"
                [attr.aria-invalid]="errors().lastName ? 'true' : null"
                (input)="lastName.set(readValue($event))" />
              @if (errors().lastName) {
                <span class="field-error">{{ errors().lastName }}</span>
              }
            </label>

            <label class="field">
              <span class="field-label">Email</span>
              <input
                class="field-input"
                type="email"
                autocomplete="email"
                [value]="email()"
                [attr.aria-invalid]="errors().email ? 'true' : null"
                (input)="email.set(readValue($event))" />
              @if (errors().email) {
                <span class="field-error">{{ errors().email }}</span>
              }
            </label>

            <label class="field">
              <span class="field-label">Phone (optional)</span>
              <input
                class="field-input"
                type="tel"
                autocomplete="tel"
                [value]="phoneNumber()"
                [attr.aria-invalid]="errors().phoneNumber ? 'true' : null"
                (input)="phoneNumber.set(readValue($event))" />
              @if (errors().phoneNumber) {
                <span class="field-error">{{ errors().phoneNumber }}</span>
              }
            </label>

            <label class="field">
              <span class="field-label">Company or affiliation (optional)</span>
              <input
                class="field-input"
                type="text"
                autocomplete="organization"
                [value]="company()"
                (input)="company.set(readValue($event))" />
            </label>

            <label class="field">
              <span class="field-label">Seat / zone (optional)</span>
              <input
                class="field-input"
                type="text"
                [value]="seatAssignment()"
                (input)="seatAssignment.set(readValue($event))" />
            </label>
          </form>
        </div>
      </div>

      <footer class="dialog-foot">
        <div class="totals">
          <span class="totals-label">{{ totalQuantity() }} tickets</span>
          <span class="totals-value">{{ totalLabel() }}</span>
        </div>

        <div class="foot-actions">
          <app-button variant="outline" (pressed)="close()">Cancel</app-button>
          <app-button
            variant="coral"
            size="lg"
            [loading]="isSubmitting()"
            [disabled]="totalQuantity() === 0"
            (pressed)="submit($event)">
            Reserve {{ totalQuantity() }} {{ totalQuantity() === 1 ? 'ticket' : 'tickets' }}
          </app-button>
        </div>
      </footer>
    </section>
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 90;
        background: rgba(15, 23, 42, 0.5);
      }

      .dialog {
        position: fixed;
        z-index: 100;
        inset: 0;
        display: flex;
        flex-direction: column;
        background: var(--color-surface);
        max-height: 100vh;
        overflow: hidden;
      }

      @media (min-width: 768px) {
        .dialog {
          inset: 50% auto auto 50%;
          transform: translate(-50%, -50%);
          width: min(980px, 94vw);
          max-height: 90vh;
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-overlay);
          overflow: hidden;
        }
      }

      .dialog-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        padding: 16px;
        border-bottom: 1px solid var(--color-border);
      }

      .dialog-title {
        font-size: 19px;
        font-weight: 900;
      }

      .dialog-subtitle {
        font-size: 12px;
        color: var(--color-slate-500);
      }

      .close-btn {
        width: var(--touch-target-min);
        height: var(--touch-target-min);
        border: 1px solid var(--color-border);
        border-radius: 50%;
        background: var(--color-canvas);
        font-size: 20px;
        line-height: 1;
        color: var(--color-slate-600);
      }

      .outcome {
        margin: 12px 16px 0 16px;
        padding: 10px 12px;
        border-radius: var(--radius-md);
        font-size: 12px;
        font-weight: 700;
      }

      .outcome-reserved {
        border: 1px solid #bbf7d0;
        background: var(--color-emerald-soft);
        color: var(--color-emerald-deep);
      }

      .outcome-sold_out {
        border: 1px solid #fecaca;
        background: var(--color-danger-soft);
        color: var(--color-danger);
      }

      .outcome-invalid {
        border: 1px solid #fde68a;
        background: var(--color-amber-soft);
        color: #b45309;
      }

      .outcome-error {
        border: 1px solid var(--color-border-strong);
        background: var(--color-canvas);
        color: var(--color-slate-700);
      }

      .dialog-body {
        flex: 1 1 auto;
        min-height: 0;
        display: grid;
        grid-template-columns: 1fr;
        gap: 16px;
        padding: 16px;
        overflow-y: auto;
      }

      @media (min-width: 768px) {
        .dialog-body {
          grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
        }
      }

      .tier-column,
      .form-column {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
      }

      .section-title {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 1.2px;
        color: var(--color-slate-500);
        text-transform: uppercase;
      }

      .empty-note {
        font-size: 12px;
        color: var(--color-muted);
      }

      .checkout-form {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
      }

      @media (min-width: 430px) {
        .checkout-form {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }

      .field-label {
        font-size: 11px;
        font-weight: 700;
        color: var(--color-slate-600);
      }

      .field-input {
        min-height: var(--touch-target-min);
        padding: 10px 12px;
        border: 1px solid var(--color-border-strong);
        border-radius: var(--radius-md);
        font-size: 14px;
      }

      .field-input[aria-invalid='true'] {
        border-color: var(--color-danger);
        background: var(--color-danger-soft);
      }

      .field-error {
        font-size: 11px;
        font-weight: 700;
        color: var(--color-danger);
      }

      .dialog-foot {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px 16px;
        border-top: 1px solid var(--color-border);
        background: var(--color-canvas);
      }

      .totals {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
      }

      .totals-label {
        font-size: 12px;
        font-weight: 700;
        color: var(--color-slate-500);
      }

      .totals-value {
        font-size: 20px;
        font-weight: 900;
        color: var(--color-ink);
      }

      .foot-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
      }

      @media (min-width: 768px) {
        .dialog-foot {
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
        }
      }
    `
  ]
})
export class RsvpCheckoutDialogComponent {
  private readonly firestore = inject(FIRESTORE_DB);
  private readonly data = inject(EventDataStore);

  /** Event the order belongs to; defaults to the active event. */
  public readonly eventId = input<string | null>(null);

  /** Emitted when the dialog should close. */
  public readonly closed = output<void>();

  /** Emitted with the reservation outcome after a successful or failed attempt. */
  public readonly completed = output<CheckoutOutcome>();

  /** Validation rules exposed to the template. */
  protected readonly VALIDATION_RULES = VALIDATION_RULES;

  /** Event being sold for. */
  protected readonly event = computed<EventModel | null>(() => this.data.event());

  /** Tiers on sale. */
  protected readonly tiers = computed<readonly TicketTier[]>(() =>
    this.data.ticketTiers().filter((tier) => tier.isActive)
  );

  /** Currency used for pricing. */
  protected readonly currency = computed(() => this.data.event()?.currency ?? 'USD');

  /** Quantity per tier id. */
  private readonly quantities = signal<Readonly<Record<string, number>>>({});

  /** Contact capture fields. */
  protected readonly firstName = signal<string>('');
  protected readonly lastName = signal<string>('');
  protected readonly email = signal<string>('');
  protected readonly phoneNumber = signal<string>('');
  protected readonly company = signal<string>('');
  protected readonly seatAssignment = signal<string>('');

  /** Submission state and outcome. */
  protected readonly isSubmitting = signal<boolean>(false);
  protected readonly outcome = signal<CheckoutOutcome | null>(null);

  /** Total tickets selected. */
  protected readonly totalQuantity = computed(() =>
    Object.values(this.quantities()).reduce((total, quantity) => total + quantity, 0)
  );

  /** Subtotal in minor units. */
  protected readonly subtotalCents = computed(() => {
    const selection = this.quantities();
    return this.tiers().reduce((total, tier) => {
      const quantity = selection[tier.id] ?? 0;
      return total + tier.priceCents * quantity;
    }, 0);
  });

  /** Formatted total. */
  protected readonly totalLabel = computed(() =>
    CurrencyFormatUtility.formatCents(this.subtotalCents(), this.currency())
  );

  /** Per-field validation messages. */
  protected readonly errors = computed<Record<string, string | null>>(() => ({
    firstName: this.firstName().trim().length === 0 ? 'First name is required.' : null,
    lastName: this.lastName().trim().length === 0 ? 'Last name is required.' : null,
    email: VALIDATION_RULES.EMAIL_REGEX.test(this.email().trim())
      ? null
      : 'Enter a valid email address.',
    phoneNumber:
      this.phoneNumber().trim().length === 0 ||
      VALIDATION_RULES.PHONE_REGEX.test(this.phoneNumber().trim())
        ? null
        : 'Enter a valid phone number in international format.'
  }));

  /** Reads a text input value from an event. */
  protected readValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  /** Current quantity for a tier. */
  protected quantityFor(tierId: string): number {
    return this.quantities()[tierId] ?? 0;
  }

  /** Applies a new quantity for a tier. */
  protected setQuantity(tierId: string, quantity: number): void {
    this.quantities.update((current) => ({ ...current, [tierId]: Math.max(0, quantity) }));
  }

  /** Closes the dialog. */
  protected close(): void {
    this.closed.emit();
  }

  /**
   * Reserves the selected tickets atomically.
   *
   * @param event Optional submit event; the browser default is suppressed.
   */
  protected async submit(event?: Event): Promise<void> {
    event?.preventDefault();

    if (this.isSubmitting()) {
      return;
    }

    const validationErrors = this.errors();
    const firstError = Object.values(validationErrors).find((message) => message !== null) ?? null;
    if (firstError !== null) {
      this.publishOutcome({
        status: 'invalid',
        message: firstError,
        orderId: null,
        attendeeCount: 0
      });
      return;
    }

    const selection = this.quantities();
    const requested = Object.entries(selection).filter(([, quantity]) => quantity > 0);
    if (requested.length === 0) {
      this.publishOutcome({
        status: 'invalid',
        message: 'Select at least one ticket before reserving.',
        orderId: null,
        attendeeCount: 0
      });
      return;
    }

    const totalRequested = requested.reduce((total, [, quantity]) => total + quantity, 0);
    if (totalRequested > VALIDATION_RULES.MAX_TICKETS_PER_ORDER) {
      this.publishOutcome({
        status: 'invalid',
        message: `Orders are limited to ${VALIDATION_RULES.MAX_TICKETS_PER_ORDER} tickets.`,
        orderId: null,
        attendeeCount: 0
      });
      return;
    }

    const eventId = this.eventId() ?? this.data.activeEventId();
    if (eventId === null) {
      this.publishOutcome({
        status: 'error',
        message: 'No active event is connected.',
        orderId: null,
        attendeeCount: 0
      });
      return;
    }

    this.isSubmitting.set(true);
    try {
      const result = await this.reserveAtomically(eventId, requested);
      this.publishOutcome(result);
      if (result.status === 'reserved') {
        this.quantities.set({});
        this.firstName.set('');
        this.lastName.set('');
        this.email.set('');
        this.phoneNumber.set('');
        this.company.set('');
        this.seatAssignment.set('');
      }
    } finally {
      this.isSubmitting.set(false);
    }
  }

  /** Runs the capacity reservation transaction and writes the order documents. */
  private async reserveAtomically(
    eventId: string,
    requested: readonly (readonly [string, number])[]
  ): Promise<CheckoutOutcome> {
    const orderId = `ord_${createShortIdentifier(12)}`;
    const now = new Date().toISOString();
    const eventRef = doc(this.firestore, FirestorePaths.event(eventId));

    try {
      const reservation = await runTransaction(this.firestore, async (transaction) => {
        const eventSnapshot = await transaction.get(eventRef);
        if (!eventSnapshot.exists()) {
          throw new Error('EVENT_NOT_FOUND');
        }

        const tiers: TicketTier[] = [];
        let issuedTotal = 0;

        // Phase 1 — reads only. Firestore rejects a transaction that reads after it
        // has issued its first write ("all reads must be executed before all
        // writes"), so every tier is read and validated before any quota update is
        // queued. Interleaving the two fails every multi-tier order.
        const reservations: { tierRef: DocumentReference; tier: TicketTier; quantity: number }[] =
          [];

        for (const [tierId, quantity] of requested) {
          const tierRef = doc(this.firestore, FirestorePaths.ticketTier(eventId, tierId));
          const tierSnapshot = await transaction.get(tierRef);
          if (!tierSnapshot.exists()) {
            throw new Error(`TIER_NOT_FOUND:${tierId}`);
          }

          const tier = { id: tierSnapshot.id, ...tierSnapshot.data() } as TicketTier;
          if (!tier.isActive) {
            throw new Error(`TIER_INACTIVE:${tier.name}`);
          }
          if (quantity > tier.maxPerOrder) {
            throw new Error(`TIER_LIMIT:${tier.name}:${tier.maxPerOrder}`);
          }
          if (tier.availableQuota < quantity) {
            throw new Error(`SOLD_OUT:${tier.name}`);
          }

          reservations.push({ tierRef, tier, quantity });
          issuedTotal += quantity;
        }

        const currentIssued = Number(eventSnapshot.data()['totalTicketsIssued'] ?? 0);

        // Phase 2 — writes only.
        for (const { tierRef, tier, quantity } of reservations) {
          const remainingQuota = tier.availableQuota - quantity;
          transaction.update(tierRef, { availableQuota: remainingQuota });
          tiers.push({ ...tier, availableQuota: remainingQuota });
        }

        transaction.update(eventRef, {
          totalTicketsIssued: currentIssued + issuedTotal,
          updatedAt: now
        });

        const lineItems: OrderLineItem[] = tiers.map((tier) => {
          const quantity = requested.find(([tierId]) => tierId === tier.id)?.[1] ?? 0;
          return {
            ticketTierId: tier.id,
            tierName: tier.name,
            quantity,
            unitPriceCents: tier.priceCents,
            subtotalCents: tier.priceCents * quantity
          };
        });

        const subtotalCents = lineItems.reduce((total, item) => total + item.subtotalCents, 0);

        const isFreeOrder = subtotalCents === 0;
        const order: TicketOrder = {
          id: orderId,
          eventId,
          orderReference: `SD-${new Date().getFullYear()}-${orderId.slice(-6).toUpperCase()}`,
          customerFirstName: this.firstName().trim(),
          customerLastName: this.lastName().trim(),
          customerEmail: this.email().trim().toLowerCase(),
          subtotalCents,
          discountCents: 0,
          totalCents: subtotalCents,
          currency: this.currency(),
          paymentStatus: isFreeOrder ? 'free_rsvp' : 'pending',
          paymentMethod: isFreeOrder ? 'free' : 'stripe_card',
          lineItems,
          createdAt: now
        };

        const generatedAttendees = this.buildAttendeeTickets(
          eventId,
          orderId,
          tiers,
          requested,
          now,
          order.paymentStatus
        );

        transaction.set(doc(this.firestore, FirestorePaths.order(eventId, orderId)), order);
        for (const attendee of generatedAttendees) {
          transaction.set(doc(this.firestore, FirestorePaths.attendee(eventId, attendee.id)), attendee);
        }

        return { order, attendees: generatedAttendees };
      });

      const { order, attendees } = reservation;

      return {
        status: 'reserved',
        message: `${attendees.length} ${attendees.length === 1 ? 'ticket' : 'tickets'} reserved for ${order.customerFirstName} ${order.customerLastName}.`,
        orderId,
        attendeeCount: attendees.length
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Reservation failed.';

      if (message.startsWith('SOLD_OUT:')) {
        return {
          status: 'sold_out',
          message: `${message.slice('SOLD_OUT:'.length)} sold out while you were checking out. No tickets were issued.`,
          orderId: null,
          attendeeCount: 0
        };
      }
      if (message.startsWith('TIER_LIMIT:')) {
        const [, tierName, limit] = message.split(':');
        return {
          status: 'invalid',
          message: `${tierName} allows at most ${limit} tickets per order.`,
          orderId: null,
          attendeeCount: 0
        };
      }
      if (message.startsWith('TIER_INACTIVE:')) {
        return {
          status: 'sold_out',
          message: `${message.slice('TIER_INACTIVE:'.length)} is no longer on sale.`,
          orderId: null,
          attendeeCount: 0
        };
      }

      return { status: 'error', message, orderId: null, attendeeCount: 0 };
    }
  }

  /**
   * Builds one attendee ticket per reserved seat.
   *
   * Admission is gated on settlement: a seat whose order is not yet paid is issued
   * as `cancelled` so the door kiosk refuses it, with a note explaining why. Only
   * settled orders (`completed`/`free_rsvp`) produce admittable passes.
   *
   * @param paymentStatus Settlement state of the owning order.
   */
  private buildAttendeeTickets(
    eventId: string,
    orderId: string,
    tiers: readonly TicketTier[],
    requested: readonly (readonly [string, number])[],
    timestamp: string,
    paymentStatus: TicketOrder['paymentStatus'] = 'completed'
  ): readonly AttendeeTicket[] {
    const eventPrefix = (this.event()?.slug ?? 'evt').slice(0, 3).toUpperCase() || 'EVT';
    const tickets: AttendeeTicket[] = [];
    const isPaymentSettled = paymentStatus === 'completed' || paymentStatus === 'free_rsvp';

    for (const tier of tiers) {
      const quantity = requested.find(([tierId]) => tierId === tier.id)?.[1] ?? 0;
      for (let index = 0; index < quantity; index += 1) {
        const ticketId = `tkt_${createShortIdentifier(16)}`;
        const stubNumber = TicketSecurityUtility.generateStubNumber(eventPrefix);

        tickets.push({
          id: ticketId,
          eventId,
          orderId,
          ticketTierId: tier.id,
          ticketTierName: tier.name,
          ticketStubNumber: stubNumber,
          firstName: this.firstName().trim(),
          lastName: this.lastName().trim(),
          email: this.email().trim().toLowerCase(),
          phoneNumber: this.phoneNumber().trim(),
          companyOrAffiliation: this.company().trim(),
          checkInStatus: isPaymentSettled ? 'confirmed' : 'cancelled',
          checkedInAt: null,
          checkedInByUserId: null,
          qrVerificationSecret: TicketSecurityUtility.generateVerifiableToken(
            ticketId,
            stubNumber,
            eventId
          ),
          barcodeValue: TicketSecurityUtility.generateBarcodeValue(
            stubNumber,
            tier.tierType === 'free' ? 'GA' : 'STD',
            'MAIN'
          ),
          ...(this.seatAssignment().trim().length === 0
            ? {}
            : { seatAssignment: this.seatAssignment().trim() }),
          ...(isPaymentSettled ? {} : { notes: 'Awaiting payment confirmation' }),
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }
    }

    return tickets;
  }

  /** Publishes an outcome to the parent and the banner. */
  private publishOutcome(outcome: CheckoutOutcome): void {
    this.outcome.set(outcome);
    this.completed.emit(outcome);
  }
}
