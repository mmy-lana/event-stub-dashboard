import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';

import { FirestoreOfflineService } from '../../../core/firebase/firestore-offline.service';
import { OfflineMutationService } from '../../../core/sync/offline-mutation.service';

/** Compact single-line indicator, or the expanded diagnostic card. */
export type SyncIndicatorLayout = 'inline' | 'panel';

/**
 * Live sync / offline indicator.
 *
 * Combines the mutation outbox (queued check-ins) with the Firestore transport
 * diagnostics, so an operator can see at a glance whether scans are reaching the
 * backend. The expanded layout adds a manual flush control and the failure
 * counter, and every state is announced through `role="status"`.
 */
@Component({
  selector: 'app-sync-indicator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="sync-indicator"
      [class.layout-panel]="layout() === 'panel'"
      [class.is-offline]="!isOnline()"
      [class.is-syncing]="syncService.isSyncing()"
      [class.has-failures]="permanentFailureCount() > 0"
      role="status"
      [attr.aria-live]="layout() === 'panel' ? 'polite' : 'off'">
      <span class="indicator-dot" aria-hidden="true"></span>

      <span class="indicator-text">
        @if (syncService.isSyncing()) {
          SYNCING {{ pendingCount() }} {{ pendingCount() === 1 ? 'ENTRY' : 'ENTRIES' }}
        } @else if (isOnline()) {
          ONLINE
        } @else {
          OFFLINE &bull; {{ pendingCount() }} QUEUED
        }
      </span>

      @if (layout() === 'panel') {
        <dl class="diagnostics">
          <div class="diagnostic-row">
            <dt>Backend</dt>
            <dd>{{ offlineService.backendLabel() }}</dd>
          </div>
          <div class="diagnostic-row">
            <dt>Reachability</dt>
            <dd>{{ offlineService.reachability() }}</dd>
          </div>
          <div class="diagnostic-row">
            <dt>Last cache sync</dt>
            <dd>{{ lastSyncLabel() }}</dd>
          </div>
          <div class="diagnostic-row">
            <dt>Permanent failures</dt>
            <dd>{{ permanentFailureCount() }}</dd>
          </div>
        </dl>

        <p class="diagnostic-detail">{{ offlineService.statusDetail() }}</p>

        <div class="panel-actions">
          <button
            type="button"
            class="panel-btn"
            [disabled]="syncService.isSyncing() || pendingCount() === 0"
            (click)="flushNow()">
            {{ isFlushing() ? 'FLUSHING…' : 'FLUSH QUEUE' }}
          </button>
          <button type="button" class="panel-btn ghost" (click)="probeNow()">
            RE-CHECK BACKEND
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }

      .sync-indicator {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-pill);
        background: var(--color-surface);
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.6px;
        color: var(--color-emerald-deep);
      }

      .indicator-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: var(--color-emerald);
      }

      .is-offline {
        border-color: #fecaca;
        background: var(--color-danger-soft);
        color: var(--color-danger);
      }

      .is-offline .indicator-dot {
        background-color: var(--color-danger);
      }

      .is-syncing {
        border-color: #bfdbfe;
        background: var(--color-info-soft);
        color: var(--color-info);
      }

      .is-syncing .indicator-dot {
        background-color: var(--color-info);
        animation: sync-pulse 1s ease-in-out infinite;
      }

      .has-failures {
        border-color: #fed7aa;
        background: var(--color-amber-soft);
        color: #b45309;
      }

      @keyframes sync-pulse {
        0%,
        100% {
          opacity: 1;
          transform: scale(1);
        }
        50% {
          opacity: 0.4;
          transform: scale(0.75);
        }
      }

      /* Expanded diagnostic card */
      .layout-panel {
        display: block;
        width: 100%;
        padding: 16px;
        border-radius: var(--radius-lg);
        text-align: left;
      }

      .layout-panel .indicator-dot {
        display: inline-block;
        vertical-align: middle;
        margin-right: 8px;
      }

      .layout-panel .indicator-text {
        vertical-align: middle;
      }

      .diagnostics {
        margin: 12px 0 0 0;
        display: grid;
        gap: 6px;
      }

      .diagnostic-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        font-size: 12px;
        font-weight: 600;
      }

      .diagnostic-row dt {
        color: var(--color-muted);
        font-weight: 700;
        text-transform: uppercase;
        font-size: 10px;
        letter-spacing: 0.6px;
      }

      .diagnostic-row dd {
        margin: 0;
        font-family: var(--font-mono);
        color: var(--color-slate-700);
        text-align: right;
        word-break: break-word;
      }

      .diagnostic-detail {
        margin: 10px 0 0 0;
        font-size: 12px;
        font-weight: 500;
        color: var(--color-slate-600);
        line-height: 1.4;
      }

      .panel-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 14px;
      }

      .panel-btn {
        flex: 1 1 140px;
        min-height: var(--touch-target-min);
        padding: 10px 14px;
        border: 1px solid var(--color-border-strong);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        color: var(--color-slate-700);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.5px;
      }

      .panel-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .panel-btn.ghost {
        background: transparent;
      }
    `
  ]
})
export class SyncIndicatorComponent {
  private readonly offlineService = inject(FirestoreOfflineService);
  protected readonly syncService = inject(OfflineMutationService);

  /** Layout variant. */
  public readonly layout = input<SyncIndicatorLayout>('inline');

  /** Local busy flag for the manual flush control. */
  protected readonly isFlushing = signal<boolean>(false);

  /** Whether the kiosk currently has a usable transport. */
  public readonly isOnline = computed(() => this.offlineService.isBrowserOnline());

  /** Mutations still waiting to reach the backend. */
  public readonly pendingCount = computed(() => this.syncService.pendingCount());

  /** Mutations that exhausted their retries and need operator attention. */
  public readonly permanentFailureCount = computed(
    () => this.syncService.permanentFailures().length
  );

  /** Human readable timestamp of the last cache reconciliation. */
  public readonly lastSyncLabel = computed(() => {
    const lastSync = this.offlineService.lastCacheSyncAt();
    if (lastSync === null) {
      return 'not yet';
    }
    return new Date(lastSync).toLocaleTimeString();
  });

  /** Forces the outbox to drain and reports the outcome through the service state. */
  public async flushNow(): Promise<void> {
    if (this.isFlushing()) {
      return;
    }
    this.isFlushing.set(true);
    try {
      await this.syncService.flushOutbox();
    } finally {
      this.isFlushing.set(false);
    }
  }

  /** Re-runs the backend reachability probe. */
  public async probeNow(): Promise<void> {
    await this.offlineService.probeBackend();
  }
}
