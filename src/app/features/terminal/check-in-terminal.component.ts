import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { CheckInTerminalStore, type VerificationState } from './stores/check-in-terminal.store';
import { CameraScannerModalComponent } from './camera-scanner-modal.component';
import { ManualCheckInPadComponent } from './manual-check-in-pad.component';
import { BadgeComponent } from '../../shared/ui/badge/badge.component';
import { ButtonComponent } from '../../shared/ui/button/button.component';
import { DateFormatUtility } from '../../shared/utils/date-format.util';

/**
 * High-throughput check-in terminal.
 *
 * Split kiosk view: the camera scanner and manual pad on one side, the live
 * decision panel and activity feed on the other. The decision panel is deliberately
 * large and high contrast so an operator can confirm an admission from arm's length
 * without reading small print.
 */
@Component({
  selector: 'app-check-in-terminal',
  standalone: true,
  imports: [
    BadgeComponent,
    ButtonComponent,
    CameraScannerModalComponent,
    ManualCheckInPadComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="terminal">
      <header class="terminal-header">
        <div>
          <h1 class="terminal-title">Live entry scanner</h1>
          <p class="terminal-subtitle">
            {{ store.onSiteCount() }} on site ·
            {{ store.isOperatingOffline() ? 'operating offline (queued)' : 'connected' }}
          </p>
        </div>

        <div class="terminal-header-actions">
          <app-badge [status]="store.isOperatingOffline() ? 'offline' : 'online'" />
          <app-button variant="outline" (pressed)="toggleMute()">
            {{ store.isMuted() ? 'Unmute cues' : 'Mute cues' }}
          </app-button>
          <app-button variant="ghost" (pressed)="store.resetSession()">Reset session</app-button>
        </div>
      </header>

      <div class="terminal-grid">
        <!-- Scanner column -->
        <section class="scanner-column" aria-labelledby="scanner-heading">
          <h2 id="scanner-heading" class="sr-only">Scanner</h2>

          <app-camera-scanner-modal (detected)="onDetected($event)" />

          <app-manual-check-in-pad
            [busy]="store.isProcessing()"
            [recentCodes]="recentCodes()"
            (submitted)="onManualSubmit($event)" />
        </section>

        <!-- Decision column -->
        <section class="decision-column" aria-labelledby="decision-heading">
          <h2 id="decision-heading" class="sr-only">Last scan result</h2>

          <div class="decision-card" [class]="'state-' + store.verificationState()" aria-live="assertive">
            @switch (store.verificationState()) {
              @case ('idle') {
                <svg class="decision-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <p class="decision-headline">Awaiting pass</p>
                <p class="decision-detail">
                  Scan a QR code or type the stub reference printed under the barcode.
                </p>
              }

              @case ('validating') {
                <span class="decision-spinner" aria-hidden="true"></span>
                <p class="decision-headline">Validating…</p>
                <p class="decision-detail">Checking the pass against the local roster cache.</p>
              }

              @case ('success') {
                <svg class="decision-svg icon-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <p class="decision-headline">Admitted</p>
                @if (store.lastScannedTicket(); as ticket) {
                  <p class="decision-name">{{ ticket.firstName }} {{ ticket.lastName }}</p>
                  <dl class="decision-meta">
                    <div>
                      <dt>Tier</dt>
                      <dd>{{ ticket.ticketTierName }}</dd>
                    </div>
                    <div>
                      <dt>Stub</dt>
                      <dd class="font-mono">{{ ticket.ticketStubNumber }}</dd>
                    </div>
                    <div>
                      <dt>Affiliation</dt>
                      <dd>{{ ticket.companyOrAffiliation || 'N/A' }}</dd>
                    </div>
                    <div>
                      <dt>Admitted</dt>
                      <dd>{{ admittedAtLabel() }}</dd>
                    </div>
                  </dl>
                }
              }

              @case ('already_checked_in') {
                <svg class="decision-svg icon-warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <p class="decision-headline">Already admitted</p>
                @if (store.lastScannedTicket(); as ticket) {
                  <p class="decision-name">{{ ticket.firstName }} {{ ticket.lastName }}</p>
                  <p class="decision-detail">
                    Admitted {{ DateFormatUtility.formatRelative(ticket.checkedInAt) }} by
                    {{ ticket.checkedInByUserId ?? 'unknown operator' }}.
                  </p>
                }
              }

              @case ('cancelled') {
                <svg class="decision-svg icon-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                </svg>
                <p class="decision-headline">Ticket cancelled</p>
                <p class="decision-detail">
                  This pass was cancelled or refunded. Direct the attendee to the help desk.
                </p>
              }

              @case ('tampered') {
                <svg class="decision-svg icon-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                <p class="decision-headline">Verification failed</p>
                <p class="decision-detail">
                  The pass digest does not match this event. Do not admit.
                </p>
              }

              @default {
                <svg class="decision-svg icon-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <p class="decision-headline">Pass not found</p>
                <p class="decision-detail">{{ store.lastMessage() }}</p>
              }
            }
          </div>

          <div class="counter-row">
            <div class="counter">
              <span class="counter-value">{{ store.counters().admitted }}</span>
              <span class="counter-label">ADMITTED</span>
            </div>
            <div class="counter">
              <span class="counter-value">{{ store.counters().duplicates }}</span>
              <span class="counter-label">DUPLICATES</span>
            </div>
            <div class="counter">
              <span class="counter-value">{{ store.counters().rejected }}</span>
              <span class="counter-label">REJECTED</span>
            </div>
            <div class="counter">
              <span class="counter-value">{{ store.counters().scans }}</span>
              <span class="counter-label">SCANS</span>
            </div>
          </div>

          <div class="activity-panel">
            <h3 class="activity-title">Recent activity</h3>

            @if (store.activity().length === 0) {
              <p class="activity-empty">No passes scanned in this session yet.</p>
            } @else {
              <ul class="activity-list">
                @for (entry of store.activity(); track entry.id) {
                  <li class="activity-row">
                    <span class="activity-outcome" [class]="'outcome-' + entry.outcome">
                      {{ outcomeLabel(entry.outcome) }}
                    </span>
                    <span class="activity-name">{{ entry.attendeeName ?? 'Unknown pass' }}</span>
                    <span class="activity-stub font-mono">{{ entry.stubNumber }}</span>
                    <span class="activity-time">{{ DateFormatUtility.formatTime(entry.scannedAt) }}</span>
                    @if (entry.queuedOffline) {
                      <span class="activity-queued">QUEUED</span>
                    }
                  </li>
                }
              </ul>
            }
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .terminal {
        display: flex;
        flex-direction: column;
        gap: 16px;
        width: 100%;
        max-width: var(--content-max-width);
        margin: 0 auto;
        padding: 18px 14px 32px 14px;
      }

      @media (min-width: 1024px) {
        .terminal {
          padding: 24px 32px 40px 32px;
        }
      }

      .terminal-header {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .terminal-title {
        font-size: 22px;
        font-weight: 900;
        letter-spacing: -0.4px;
      }

      .terminal-subtitle {
        font-size: 13px;
        color: var(--color-slate-500);
      }

      .terminal-header-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }

      .terminal-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 16px;
      }

      @media (min-width: 768px) {
        .terminal-header {
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
        }

        .terminal-grid {
          grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
          align-items: start;
        }
      }

      .scanner-column,
      .decision-column {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-width: 0;
      }

      /* Decision card: large, high contrast, readable from arm's length. */
      .decision-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 22px 18px;
        text-align: center;
        border: 2px solid var(--color-border);
        border-radius: var(--radius-xl);
        background: var(--color-surface);
      }

      .state-success {
        border-color: #a7f3d0;
        background: var(--color-emerald-soft);
      }

      .state-already_checked_in {
        border-color: #fde68a;
        background: var(--color-amber-soft);
      }

      .state-cancelled,
      .state-tampered,
      .state-not_found {
        border-color: #fecaca;
        background: var(--color-danger-soft);
      }

      .decision-svg {
        width: 40px;
        height: 40px;
      }

      .decision-svg.icon-success {
        color: var(--color-emerald-deep);
      }

      .decision-svg.icon-warning {
        color: #b45309;
      }

      .decision-svg.icon-danger {
        color: var(--color-danger);
      }

      .decision-headline {
        font-size: 26px;
        font-weight: 900;
        letter-spacing: -0.6px;
        text-transform: uppercase;
      }

      .state-success .decision-headline {
        color: var(--color-emerald-deep);
      }

      .state-already_checked_in .decision-headline {
        color: #b45309;
      }

      .state-cancelled .decision-headline,
      .state-tampered .decision-headline,
      .state-not_found .decision-headline {
        color: var(--color-danger);
      }

      .decision-name {
        font-size: 17px;
        font-weight: 800;
      }

      .decision-detail {
        max-width: 420px;
        font-size: 13px;
        line-height: 1.5;
        color: var(--color-slate-600);
      }

      .decision-spinner {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: 3px solid var(--color-border);
        border-top-color: var(--color-coral);
        animation: terminal-spin 700ms linear infinite;
      }

      @keyframes terminal-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .decision-meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        width: 100%;
        margin: 10px 0 0 0;
        padding: 12px;
        background: rgba(255, 255, 255, 0.7);
        border-radius: var(--radius-md);
        text-align: left;
      }

      .decision-meta dt {
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.8px;
        color: var(--color-muted-soft);
        text-transform: uppercase;
      }

      .decision-meta dd {
        margin: 2px 0 0 0;
        font-size: 13px;
        font-weight: 700;
        color: var(--color-slate-800);
        word-break: break-word;
      }

      .font-mono {
        font-family: var(--font-mono);
      }

      .counter-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      @media (min-width: 640px) {
        .counter-row {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }

      .counter {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: 10px 6px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
      }

      .counter-value {
        font-size: 20px;
        font-weight: 900;
        color: var(--color-ink);
      }

      .counter-label {
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.6px;
        color: var(--color-muted-soft);
      }

      .activity-panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
      }

      .activity-title {
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 1.2px;
        color: var(--color-slate-500);
        text-transform: uppercase;
      }

      .activity-empty {
        font-size: 12px;
        color: var(--color-muted);
      }

      .activity-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
        max-height: 340px;
        overflow-y: auto;
      }

      .activity-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
      }

      .activity-outcome {
        flex: 0 0 78px;
        padding: 3px 6px;
        border-radius: var(--radius-sm);
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.5px;
        text-align: center;
      }

      .outcome-success {
        background: var(--color-emerald-soft);
        color: var(--color-emerald-deep);
      }

      .outcome-already_checked_in {
        background: var(--color-amber-soft);
        color: #b45309;
      }

      .outcome-not_found,
      .outcome-cancelled,
      .outcome-tampered {
        background: var(--color-danger-soft);
        color: var(--color-danger);
      }

      .outcome-validating,
      .outcome-idle {
        background: var(--color-canvas);
        color: var(--color-slate-500);
      }

      .activity-name {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
      }

      .activity-stub {
        font-size: 11px;
        color: var(--color-slate-600);
      }

      .activity-time {
        font-size: 11px;
        color: var(--color-muted);
        white-space: nowrap;
      }

      .activity-queued {
        padding: 2px 6px;
        border-radius: var(--radius-pill);
        background: var(--color-info-soft);
        color: var(--color-info);
        font-size: 9px;
        font-weight: 800;
      }
    `
  ]
})
export class CheckInTerminalComponent {
  /** Kiosk scan state machine. */
  protected readonly store = inject(CheckInTerminalStore);

  /** Date utilities exposed to the template. */
  protected readonly DateFormatUtility = DateFormatUtility;

  /** The five most recent stub references, offered as pad shortcuts. */
  protected readonly recentCodes = computed<readonly string[]>(() => {
    const codes = this.store
      .activity()
      .filter((entry) => entry.stubNumber !== '—')
      .map((entry) => entry.stubNumber);
    return [...new Set(codes)].slice(0, 5);
  });

  /** Local time of the last admission. */
  protected readonly admittedAtLabel = computed(() => {
    const ticket = this.store.lastScannedTicket();
    if (ticket === null || ticket.checkedInAt === null) {
      return 'just now';
    }
    return DateFormatUtility.formatDateTime(ticket.checkedInAt);
  });

  public constructor() {
    // Make sure the roster cache is streaming before the first scan arrives.
    void this.store.ensureConnected();

    // Browsers only allow audio after a user gesture, so the synthesizer is unlocked
    // by the operator's first tap or key press rather than at load time.
    if (typeof window !== 'undefined') {
      const unlock = (): void => {
        this.store.unlockAudio();
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    }
  }

  /** Handles a decoded scanner payload. */
  protected onDetected(payload: string): void {
    void this.store.submitScan(payload, 'camera_qr');
  }

  /** Handles a manually typed stub number. */
  protected onManualSubmit(code: string): void {
    void this.store.submitScan(code, 'manual_button');
  }

  /** Toggles terminal audio feedback. */
  protected toggleMute(): void {
    this.store.toggleMute();
  }

  /** Short label for an activity outcome. */
  protected outcomeLabel(state: VerificationState): string {
    switch (state) {
      case 'success':
        return 'ADMITTED';
      case 'already_checked_in':
        return 'DUPLICATE';
      case 'not_found':
        return 'NOT FOUND';
      case 'cancelled':
        return 'CANCELLED';
      case 'tampered':
        return 'TAMPERED';
      case 'validating':
        return 'CHECKING';
      default:
        return 'IDLE';
    }
  }
}
