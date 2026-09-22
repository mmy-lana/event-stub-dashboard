import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

import { BadgeComponent, type BadgeStatus } from '../../shared/ui/badge/badge.component';
import { ButtonComponent } from '../../shared/ui/button/button.component';
import { BarcodeStripComponent } from '../../shared/ui/barcode-strip/barcode-strip.component';
import { PerforationDividerComponent } from '../../shared/ui/perforation-divider/perforation-divider.component';
import { QrCanvasComponent } from '../../shared/ui/qr-canvas/qr-canvas.component';
import { SyncIndicatorComponent } from '../../shared/ui/sync-indicator/sync-indicator.component';
import { TicketNotchComponent } from '../../shared/ui/ticket-notch/ticket-notch.component';
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
    BadgeComponent,
    BarcodeStripComponent,
    ButtonComponent,
    PerforationDividerComponent,
    QrCanvasComponent,
    SyncIndicatorComponent,
    TicketNotchComponent
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

  /** Records a button activation for the gallery's status line. */
  protected recordInteraction(variant: string): void {
    this.lastInteraction.set(variant);
  }
}
