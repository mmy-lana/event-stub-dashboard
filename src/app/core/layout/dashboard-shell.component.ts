import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { EventDataStore } from '../state/event-data.store';
import { SyncIndicatorComponent } from '../../shared/ui/sync-indicator/sync-indicator.component';

/**
 * Application shell.
 *
 * Persistent chrome around every screen: brand, active-event context, live sync
 * badge, primary navigation on tablet and up, and a thumb-reachable bottom dock on
 * phones. The shell owns the navigation surface only — data loading happens in the
 * routed feature screens, which share the same live event data layer.
 */
@Component({
  selector: 'app-dashboard-shell',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, SyncIndicatorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell">
      <a class="skip-link" href="#main-content">Skip to content</a>

      <header class="top-nav">
        <div class="nav-left">
          <a class="brand-logo" routerLink="/" aria-label="Event Stub Dashboard home">
            <span class="logo-mark" aria-hidden="true">◆</span>
            <span class="logo-text">EVENT STUB DASHBOARD</span>
          </a>

          <span class="event-context-pill" [class.is-empty]="eventTitle() === null">
            <span class="pulse-indicator" aria-hidden="true"></span>
            <span class="event-label">{{ eventTitle() ?? 'NO EVENT SELECTED' }}</span>
          </span>
        </div>

        <nav class="nav-links" aria-label="Primary">
          @for (link of primaryLinks; track link.path) {
            <a
              class="nav-link"
              [routerLink]="link.path"
              routerLinkActive="active"
              [routerLinkActiveOptions]="{ exact: link.exact }">
              {{ link.label }}
            </a>
          }
        </nav>

        <div class="nav-right">
          <app-sync-indicator />
        </div>
      </header>

      <main id="main-content" class="content-canvas">
        <router-outlet />
      </main>

      <nav class="mobile-bottom-dock" aria-label="Mobile navigation">
        @for (link of dockLinks; track link.path) {
          <a
            class="dock-item"
            [class.highlight]="link.highlight"
            [routerLink]="link.path"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: link.exact }">
            <span class="dock-icon" aria-hidden="true">{{ link.icon }}</span>
            <span class="dock-label">{{ link.label }}</span>
          </a>
        }
      </nav>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
        background-color: var(--color-canvas);
        color: var(--color-ink);
      }

      .shell {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
      }

      .skip-link {
        position: absolute;
        left: -9999px;
        top: 0;
        z-index: 100;
        display: inline-flex;
        align-items: center;
        min-height: 44px;
        padding: 12px 16px;
        background: var(--color-charcoal);
        color: #ffffff;
        font-size: 13px;
        font-weight: 700;
        border-radius: 0 0 var(--radius-md) 0;
      }

      .skip-link:focus {
        left: 0;
      }

      .top-nav {
        position: sticky;
        top: 0;
        z-index: 50;
        display: flex;
        align-items: center;
        gap: 12px;
        height: var(--shell-nav-height);
        padding: 0 14px;
        background: var(--color-surface);
        border-bottom: 1px solid var(--color-border);
      }

      .nav-left {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .brand-logo {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 44px;
        padding: 0 4px;
        color: var(--color-ink);
        font-weight: 900;
        letter-spacing: -0.5px;
        text-decoration: none;
      }

      .logo-mark {
        color: var(--color-coral);
        font-size: 18px;
      }

      .logo-text {
        font-size: 15px;
      }

      .event-context-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 46vw;
        padding: 5px 10px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-pill);
        background: var(--color-canvas);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.4px;
        color: var(--color-slate-600);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .event-context-pill.is-empty {
        color: var(--color-muted);
      }

      .pulse-indicator {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--color-emerald);
        animation: shell-pulse 2s ease-in-out infinite;
        flex-shrink: 0;
      }

      @keyframes shell-pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.35;
        }
      }

      .nav-links {
        display: none;
        gap: 4px;
        margin-left: 12px;
      }

      .nav-link {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
        padding: 8px 12px;
        border-radius: var(--radius-md);
        font-size: 13px;
        font-weight: 700;
        color: var(--color-slate-600);
        text-decoration: none;
      }

      .nav-link.active {
        background: var(--color-coral-soft);
        color: var(--color-coral-strong);
      }

      .nav-right {
        margin-left: auto;
        display: flex;
        align-items: center;
      }

      .content-canvas {
        flex: 1 1 auto;
        padding-bottom: calc(var(--dock-height) + 12px);
      }

      /* Bottom dock: phones only, thumb reachable, 48px+ targets. */
      .mobile-bottom-dock {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 60;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        height: var(--dock-height);
        background: var(--color-surface);
        border-top: 1px solid var(--color-border);
        padding-bottom: env(safe-area-inset-bottom, 0);
      }

      .dock-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        min-height: var(--touch-target-min);
        color: var(--color-slate-500);
        text-decoration: none;
      }

      .dock-item.active {
        color: var(--color-coral);
      }

      .dock-item.highlight .dock-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        margin-top: -14px;
        border-radius: 50%;
        background: var(--color-coral);
        color: #ffffff;
        box-shadow: 0 6px 14px rgba(255, 90, 54, 0.35);
      }

      .dock-icon {
        font-size: 17px;
        line-height: 1;
      }

      .dock-label {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.3px;
      }

      @media (min-width: 768px) {
        .top-nav {
          padding: 0 20px;
        }

        .nav-links {
          display: flex;
        }

        .logo-text {
          font-size: 17px;
        }

        .content-canvas {
          padding-bottom: 24px;
        }

        .mobile-bottom-dock {
          display: none;
        }
      }

      @media (min-width: 1024px) {
        .top-nav {
          padding: 0 32px;
        }

        .event-context-pill {
          max-width: 320px;
        }
      }
    `
  ]
})
export class DashboardShellComponent {
  private readonly data = inject(EventDataStore);

  /** Primary navigation shown from tablet width up. */
  protected readonly primaryLinks = [
    { path: '/', label: 'Overview', exact: true },
    { path: '/attendees', label: 'Roster', exact: false },
    { path: '/terminal', label: 'Check-in', exact: false },
    { path: '/gallery', label: 'Design system', exact: false }
  ] as const;

  /** Thumb-reachable dock shown on phones. */
  protected readonly dockLinks = [
    { path: '/', label: 'Overview', icon: '[O]', exact: true, highlight: false },
    { path: '/attendees', label: 'Roster', icon: '[R]', exact: false, highlight: false },
    { path: '/terminal', label: 'Terminal', icon: '[T]', exact: false, highlight: true },
    { path: '/gallery', label: 'System', icon: '[S]', exact: false, highlight: false }
  ] as const;

  /** Active event title, or `null` before a dataset exists. */
  protected readonly eventTitle = computed(() => this.data.event()?.title ?? null);
}
