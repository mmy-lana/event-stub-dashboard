import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';

import { AttendeeRowItemComponent } from '../../shared/molecules/attendee-row-item/attendee-row-item.component';
import { SearchFilterToolbarComponent, type StatusFilter } from '../../shared/molecules/search-filter-toolbar/search-filter-toolbar.component';
import { StatCardComponent } from '../../shared/molecules/stat-card/stat-card.component';
import { TicketStubCardComponent } from '../../shared/molecules/ticket-stub-card/ticket-stub-card.component';
import { TierSelectorRowComponent } from '../../shared/molecules/tier-selector-row/tier-selector-row.component';
import { BadgeComponent, type BadgeStatus } from '../../shared/ui/badge/badge.component';
import { ButtonComponent } from '../../shared/ui/button/button.component';
import { BarcodeStripComponent } from '../../shared/ui/barcode-strip/barcode-strip.component';
import { PerforationDividerComponent } from '../../shared/ui/perforation-divider/perforation-divider.component';
import { QrCanvasComponent } from '../../shared/ui/qr-canvas/qr-canvas.component';
import { SyncIndicatorComponent } from '../../shared/ui/sync-indicator/sync-indicator.component';
import { TicketNotchComponent } from '../../shared/ui/ticket-notch/ticket-notch.component';
import type { AttendeeTicket, TicketTier } from '../../core/models/ticket.model';
import { TicketSecurityUtility } from '../../shared/utils/ticket-cryptography';

/**
 * Design-system reference surface.
 *
 * Renders every atomic primitive and molecule in each of its states so the
 * palette, touch ergonomics and responsive behaviour can be reviewed in one
 * place (and asserted by the automated DOM checks). Reachable at `/gallery`.
 */
@Component({
  selector: 'app-component-gallery',
  standalone: true,
  imports: [
    AttendeeRowItemComponent,
    BadgeComponent,
    BarcodeStripComponent,
    ButtonComponent,
    PerforationDividerComponent,
    QrCanvasComponent,
    SearchFilterToolbarComponent,
    StatCardComponent,
    SyncIndicatorComponent,
    TicketNotchComponent,
    TicketStubCardComponent,
    TierSelectorRowComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gallery">
      <header class="gallery-header">
        <p class="eyebrow">STUBDECK DESIGN SYSTEM</p>
        <h1 class="title">Component gallery</h1>
        <p class="subtitle">
          Every primitive and molecule in each supported state. Used for visual review, keyboard
          checks and the 360 / 390 / 430 / 768 / 1024 viewport audit.
        </p>
      </header>

      <!-- Buttons -->
      <section class="panel" aria-labelledby="buttons-heading">
        <h2 id="buttons-heading" class="panel-title">Buttons</h2>

        <div class="row">
          <app-button variant="coral" (pressed)="recordInteraction('coral')">Primary action</app-button>
          <app-button variant="emerald" (pressed)="recordInteraction('emerald')">Confirm admission</app-button>
          <app-button variant="neutral" (pressed)="recordInteraction('neutral')">Neutral</app-button>
          <app-button variant="outline" (pressed)="recordInteraction('outline')">Outline</app-button>
          <app-button variant="ghost" (pressed)="recordInteraction('ghost')">Ghost</app-button>
          <app-button variant="perforated" icon="✂" (pressed)="recordInteraction('perforated')">
            Tear off pass
          </app-button>
        </div>

        <div class="row">
          <app-button size="sm" variant="coral">Small</app-button>
          <app-button size="md" variant="coral">Medium</app-button>
          <app-button size="lg" variant="coral">Large</app-button>
          <app-button variant="coral" [loading]="true">Saving order…</app-button>
          <app-button variant="outline" [disabled]="true">Disabled</app-button>
          <app-button variant="coral" [badge]="7">Sync queue</app-button>
        </div>

        @if (lastInteraction() !== null) {
          <p class="note" role="status">Last button activated: {{ lastInteraction() }}</p>
        }
      </section>

      <!-- Badges -->
      <section class="panel" aria-labelledby="badges-heading">
        <h2 id="badges-heading" class="panel-title">Status badges</h2>
        <div class="row">
          @for (status of badgeStatuses; track status) {
            <app-badge [status]="status" />
          }
        </div>
        <div class="row">
          @for (status of badgeStatuses; track status) {
            <app-badge [status]="status" size="sm" [label]="status.replace('_', ' ')" />
          }
        </div>
      </section>

      <!-- Ticket silhouette primitives -->
      <section class="panel" aria-labelledby="notch-heading">
        <h2 id="notch-heading" class="panel-title">Perforation and notches</h2>

        <div class="notch-demo">
          <app-ticket-notch edge="left" [size]="22" />
          <div class="notch-demo-body">
            <span class="mono">EDGE LEFT</span>
          </div>
          <app-ticket-notch edge="right" [size]="22" />
        </div>

        <div class="stub-demo">
          <div class="stub-body">
            <p class="stub-title">SUMMIT TECH CONF 2026</p>
            <p class="stub-meta">Moscone Center, Hall D · San Francisco, CA</p>
          </div>
          <app-perforation-divider [orientation]="'vertical'" class="divider-desktop" />
          <app-perforation-divider [orientation]="'horizontal'" class="divider-mobile" />
          <div class="stub-coupon">
            <span class="mono">TEAR-OFF</span>
          </div>
        </div>
      </section>

      <!-- Encoders -->
      <section class="panel" aria-labelledby="encoders-heading">
        <h2 id="encoders-heading" class="panel-title">Verification tags</h2>

        <div class="row row-stretch">
          <div class="tag-card">
            <app-qr-canvas
              [value]="verificationToken()"
              [size]="132"
              caption="Tear-off pass" />
            <p class="mono token-line">{{ verificationToken() }}</p>
          </div>

          <div class="tag-card">
            <app-qr-canvas
              [value]="verificationToken()"
              [size]="88"
              errorCorrectionLevel="H"
              caption="High ECC" />
            <p class="note">Error correction H survives a scuffed print.</p>
          </div>

          <div class="tag-card wide">
            <app-barcode-strip [code]="barcodeValue()" [height]="56" />
            <p class="note">Code 128 Set B with mod-103 check symbol.</p>
          </div>
        </div>
      </section>

      <!-- KPI tiles -->
      <section class="panel" aria-labelledby="stats-heading">
        <h2 id="stats-heading" class="panel-title">Dashboard metrics</h2>
        <div class="stat-grid">
          @for (stat of statCards; track stat.label) {
            <app-stat-card
              [label]="stat.label"
              [value]="stat.value"
              [subtext]="stat.subtext"
              [trend]="stat.trend"
              [showProgress]="stat.showProgress"
              [percentage]="stat.percentage" />
          }
        </div>
      </section>

      <!-- Tier stepper -->
      <section class="panel" aria-labelledby="tiers-heading">
        <h2 id="tiers-heading" class="panel-title">Ticket tiers</h2>
        @for (tier of tiers; track tier.id) {
          <app-tier-selector-row
            [tier]="tier"
            [quantity]="quantityFor(tier.id)"
            [totalSelected]="totalSelected()"
            (quantityChange)="setQuantity(tier.id, $event)" />
        }
        <p class="note" role="status">
          {{ totalSelected() }} selected · limit {{ maxPerOrder }} per order
        </p>
      </section>

      <!-- Roster toolbar + rows -->
      <section class="panel" aria-labelledby="roster-heading">
        <h2 id="roster-heading" class="panel-title">Attendee roster</h2>

        <app-search-filter-toolbar
          [tiers]="tiers"
          [searchTerm]="searchTerm()"
          [statusFilter]="statusFilter()"
          [resultCount]="2"
          [totalCount]="3"
          (searchTermChange)="searchTerm.set($event)"
          (statusFilterChange)="statusFilter.set($event)"
          (filtersReset)="resetFilters()" />

        <div class="roster-list">
          @for (attendee of attendees; track attendee.id) {
            <app-attendee-row-item
              [ticket]="attendee"
              [selectable]="true"
              [selected]="selectedIds().includes(attendee.id)"
              (toggleCheckIn)="recordInteraction('toggle ' + attendee.ticketStubNumber)"
              (selectionChange)="onSelectionChange($event)"
              (openDetails)="recordInteraction('pass ' + attendee.ticketStubNumber)" />
          }
        </div>
      </section>

      <!-- Ticket stub -->
      <section class="panel" aria-labelledby="stub-heading">
        <h2 id="stub-heading" class="panel-title">Tear-off ticket stub</h2>
        <app-ticket-stub-card
          [ticket]="stubTicket"
          [eventTitle]="'Summit Tech Conf 2026'"
          [venueName]="'Moscone Center, Hall D · San Francisco, CA'"
          [formattedDateTime]="'Sat, Oct 24, 2026 · 9:00 AM – 5:00 PM PDT'"
          [pending]="stubPending()"
          (onToggleCheckIn)="toggleStub()" />
      </section>

      <!-- Sync indicator -->
      <section class="panel" aria-labelledby="sync-heading">
        <h2 id="sync-heading" class="panel-title">Sync diagnostics</h2>
        <div class="row">
          <app-sync-indicator />
        </div>
        <app-sync-indicator layout="panel" />
      </section>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: 20px 16px 40px 16px;
        max-width: var(--content-max-width);
        margin: 0 auto;
      }

      @media (min-width: 768px) {
        :host {
          padding: 28px 24px 48px 24px;
        }
      }

      .gallery {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .gallery-header {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .eyebrow {
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 1.6px;
        color: var(--color-coral);
        text-transform: uppercase;
      }

      .title {
        font-size: 26px;
        font-weight: 900;
        letter-spacing: -0.5px;
      }

      .subtitle {
        max-width: 720px;
        font-size: 13px;
        color: var(--color-slate-500);
      }

      .panel {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 16px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
      }

      .panel-title {
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 1.2px;
        text-transform: uppercase;
        color: var(--color-slate-500);
      }

      .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
      }

      .row-stretch {
        align-items: stretch;
      }

      .note {
        font-size: 12px;
        color: var(--color-slate-500);
      }

      .mono {
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 1px;
        color: var(--color-slate-600);
      }

      .token-line {
        word-break: break-all;
        text-align: center;
      }

      .notch-demo {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0;
        padding: 12px 0;
      }

      .notch-demo-body {
        flex: 0 1 260px;
        padding: 14px;
        text-align: center;
        background: var(--color-ticket-canvas);
        border-top: 1px solid var(--color-border);
        border-bottom: 1px solid var(--color-border);
      }

      /* Stub layout: horizontal with a right-hand coupon on tablet and up. */
      .stub-demo {
        display: flex;
        flex-direction: row;
        align-items: stretch;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-xl);
        overflow: hidden;
      }

      .stub-body {
        flex: 1 1 auto;
        padding: 18px;
        min-width: 0;
      }

      .stub-title {
        font-size: 16px;
        font-weight: 800;
      }

      .stub-meta {
        font-size: 12px;
        color: var(--color-slate-500);
      }

      .divider-desktop {
        display: block;
      }

      .divider-mobile {
        display: none;
      }

      .stub-coupon {
        flex: 0 0 132px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-sub-ticket);
        padding: 16px;
      }

      .tag-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 14px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-ticket-canvas);
      }

      .stat-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
      }

      @media (min-width: 768px) {
        .stat-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (min-width: 1024px) {
        .stat-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }

      .roster-list {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        overflow: hidden;
      }

      .tag-card.wide {
        flex: 1 1 260px;
        min-width: 0;
        justify-content: center;
      }

      /* Mobile fold: the coupon drops under the body with a horizontal cut line. */
      @media (max-width: 767px) {
        .stub-demo {
          flex-direction: column;
        }

        .divider-desktop {
          display: none;
        }

        .divider-mobile {
          display: block;
        }

        .stub-coupon {
          flex: 1 1 auto;
          width: 100%;
        }
      }
    `
  ]
})
export class ComponentGalleryComponent {
  /** Statuses rendered in the badge matrix. */
  protected readonly badgeStatuses: readonly BadgeStatus[] = [
    'confirmed',
    'checked_in',
    'cancelled',
    'sold_out',
    'available',
    'vip',
    'free',
    'paid',
    'refunded',
    'pending',
    'draft',
    'published',
    'archived',
    'online',
    'offline',
    'syncing',
    'error'
  ];

  /** Last button the operator activated, echoed back for the DOM checks. */
  protected readonly lastInteraction = signal<string | null>(null);

  /** Real token produced by the ticket security utility. */
  protected readonly verificationToken = signal<string>(
    TicketSecurityUtility.generateVerifiableToken(
      'tkt_9f2c41',
      TicketSecurityUtility.generateStubNumber('EVT'),
      'evt_devcon_2026'
    )
  );

  /** Real Code 128 payload derived from the demo stub number. */
  protected readonly barcodeValue = signal<string>(
    TicketSecurityUtility.generateBarcodeValue('EVT-8924-XQ9', 'SEC4', 'DOORB')
  );

  /** KPI tiles exercising the ring, trend and compact variants. */
  protected readonly statCards = [
    {
      label: 'Tickets sold',
      value: '1,248',
      subtext: '+86 today',
      trend: 'up' as const,
      showProgress: false,
      percentage: 0
    },
    {
      label: 'Check-in rate',
      value: '73.4%',
      subtext: '916 of 1,248',
      trend: 'up' as const,
      showProgress: true,
      percentage: 73.4
    },
    {
      label: 'Gross revenue',
      value: '$48.2K',
      subtext: 'after refunds',
      trend: 'flat' as const,
      showProgress: false,
      percentage: 0
    },
    {
      label: 'Remaining capacity',
      value: '252',
      subtext: '-64 this hour',
      trend: 'down' as const,
      showProgress: true,
      percentage: 16.8
    }
  ];

  /** Ticket tiers rendered by the stepper. */
  protected readonly tiers: readonly TicketTier[] = [
    {
      id: 'tier_vip',
      eventId: 'evt_devcon_2026',
      name: 'VIP Access All-Inclusive',
      tierType: 'paid',
      priceCents: 24900,
      currency: 'USD',
      initialQuota: 120,
      availableQuota: 18,
      maxPerOrder: 4,
      salesStartDate: '2026-01-05T17:00:00.000Z',
      salesEndDate: '2026-10-24T07:00:00.000Z',
      perks: ['Front row seating', 'Speaker lounge', 'Dinner reception'],
      badgeColorHex: '#7c3aed',
      isActive: true,
      displayOrder: 1
    },
    {
      id: 'tier_ga',
      eventId: 'evt_devcon_2026',
      name: 'General Admission',
      tierType: 'paid',
      priceCents: 12500,
      currency: 'USD',
      initialQuota: 900,
      availableQuota: 214,
      maxPerOrder: 8,
      salesStartDate: '2026-01-05T17:00:00.000Z',
      salesEndDate: '2026-10-24T07:00:00.000Z',
      perks: ['All keynotes', 'Expo hall'],
      badgeColorHex: '#ff5a36',
      isActive: true,
      displayOrder: 2
    },
    {
      id: 'tier_student',
      eventId: 'evt_devcon_2026',
      name: 'Student Pass',
      tierType: 'free',
      priceCents: 0,
      currency: 'USD',
      initialQuota: 80,
      availableQuota: 0,
      maxPerOrder: 2,
      salesStartDate: '2026-01-05T17:00:00.000Z',
      salesEndDate: '2026-10-24T07:00:00.000Z',
      perks: ['Valid student ID required'],
      badgeColorHex: '#10b981',
      isActive: true,
      displayOrder: 3
    }
  ];

  /** Attendees rendered in the roster section. */
  protected readonly attendees: readonly AttendeeTicket[] = [
    {
      id: 'tkt_9f2c41',
      eventId: 'evt_devcon_2026',
      orderId: 'ord_7781',
      ticketTierId: 'tier_vip',
      ticketTierName: 'VIP Access All-Inclusive',
      ticketStubNumber: 'EVT-8924-XQ9',
      firstName: 'Alexandra',
      lastName: 'Chen',
      email: 'alexandra.chen@northwind.dev',
      phoneNumber: '+14155552671',
      companyOrAffiliation: 'Northwind Labs',
      checkInStatus: 'confirmed',
      checkedInAt: null,
      checkedInByUserId: null,
      qrVerificationSecret: '',
      barcodeValue: 'EVT-8924-XQ9-SEC4-DOOR',
      seatAssignment: 'A-14',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z'
    },
    {
      id: 'tkt_31ab90',
      eventId: 'evt_devcon_2026',
      orderId: 'ord_7782',
      ticketTierId: 'tier_ga',
      ticketTierName: 'General Admission',
      ticketStubNumber: 'EVT-4417-KM2',
      firstName: 'Marcus',
      lastName: 'Delgado',
      email: 'm.delgado@lumenworks.io',
      phoneNumber: '+14155558899',
      companyOrAffiliation: 'Lumen Works',
      checkInStatus: 'checked_in',
      checkedInAt: '2026-10-24T16:12:00.000Z',
      checkedInByUserId: 'kiosk_door_b',
      qrVerificationSecret: '',
      barcodeValue: 'EVT-4417-KM2-GAXX-MAIN',
      createdAt: '2026-09-02T11:30:00.000Z',
      updatedAt: '2026-10-24T16:12:00.000Z'
    },
    {
      id: 'tkt_77de02',
      eventId: 'evt_devcon_2026',
      orderId: 'ord_7783',
      ticketTierId: 'tier_ga',
      ticketTierName: 'General Admission',
      ticketStubNumber: 'EVT-1180-PQ7',
      firstName: 'Priya',
      lastName: 'Raman',
      email: 'priya.raman@arcadia.health',
      phoneNumber: '+14155550123',
      companyOrAffiliation: 'Arcadia Health',
      checkInStatus: 'cancelled',
      checkedInAt: null,
      checkedInByUserId: null,
      qrVerificationSecret: '',
      barcodeValue: 'EVT-1180-PQ7-GAXX-MAIN',
      createdAt: '2026-09-04T09:15:00.000Z',
      updatedAt: '2026-09-20T14:00:00.000Z'
    }
  ];

  /** Maximum tickets per order used by the tier steppers. */
  protected readonly maxPerOrder = 10;

  /** Live search term bound to the toolbar. */
  protected readonly searchTerm = signal<string>('');

  /** Live status filter bound to the toolbar. */
  protected readonly statusFilter = signal<StatusFilter>('all');

  /** Selected roster rows. */
  protected readonly selectedIds = signal<readonly string[]>([]);

  /** Quantity per tier id. */
  private readonly quantities = signal<Readonly<Record<string, number>>>({ tier_vip: 1 });

  /** Ticket rendered on the stub preview. */
  protected readonly stubTicket: AttendeeTicket = {
    ...this.attendees[0],
    qrVerificationSecret: TicketSecurityUtility.generateVerifiableToken(
      'tkt_9f2c41',
      'EVT-8924-XQ9',
      'evt_devcon_2026'
    )
  };

  /** Pending state for the stub admission action. */
  protected readonly stubPending = signal<boolean>(false);

  /** Total tickets selected across every tier. */
  protected readonly totalSelected = computed(() =>
    Object.values(this.quantities()).reduce((total, quantity) => total + quantity, 0)
  );

  /** Current quantity for a tier. */
  protected quantityFor(tierId: string): number {
    return this.quantities()[tierId] ?? 0;
  }

  /** Applies a new quantity for a tier. */
  protected setQuantity(tierId: string, quantity: number): void {
    this.quantities.update((current) => ({ ...current, [tierId]: quantity }));
  }

  /** Handles a roster selection change. */
  protected onSelectionChange(event: { ticket: AttendeeTicket; selected: boolean }): void {
    this.selectedIds.update((current) =>
      event.selected
        ? [...current.filter((id) => id !== event.ticket.id), event.ticket.id]
        : current.filter((id) => id !== event.ticket.id)
    );
  }

  /** Clears the toolbar filters. */
  protected resetFilters(): void {
    this.searchTerm.set('');
    this.statusFilter.set('all');
  }

  /** Simulates the stub admission action with a visible busy state. */
  protected toggleStub(): void {
    this.stubPending.set(true);
    setTimeout(() => {
      this.stubPending.set(false);
      this.recordInteraction('stub admission');
    }, 350);
  }

  /** Records a button activation for the gallery's status line. */
  protected recordInteraction(variant: string): void {
    this.lastInteraction.set(variant);
  }
}
