import { Component, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { OfflineMutationService } from '../sync/offline-mutation.service';

@Component({
  selector: 'app-dashboard-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell-container">
      <header class="top-nav">
        <div class="nav-left">
          <div class="brand-logo">
            <span class="logo-mark">&#9670;</span>
            <span class="logo-text">STUBDECK</span>
          </div>
          <div class="event-context-pill">
            <span class="pulse-indicator"></span>
            <span class="event-label">DEVCON SUMMIT 2026</span>
          </div>
        </div>

        <div class="nav-right">
          <div
            class="sync-pill"
            [class.is-offline]="!syncService.isOnline()"
            [class.is-syncing]="syncService.isSyncing()">
            @if (syncService.isSyncing()) {
              <span class="sync-spinner"></span>
              <span>SYNCING...</span>
            } @else if (syncService.isOnline()) {
              <span class="status-indicator-dot online"></span>
              <span>ONLINE</span>
            } @else {
              <span class="status-indicator-dot offline"></span>
              <span>OFFLINE ({{ syncService.pendingCount() }})</span>
            }
          </div>
        </div>
      </header>

      <main class="content-canvas">
        <div class="p-6">
          <div class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 class="text-xl font-bold text-slate-900">Event RSVP &amp; Ticketing Terminal</h1>
            <p class="mt-2 text-sm text-slate-600">
              Station operational. Ticket stub engine ready with offline persistent caching.
            </p>
          </div>
        </div>
      </main>

      <nav class="mobile-bottom-dock" aria-label="Mobile Navigation Dock">
        <button
          type="button"
          class="dock-item"
          [class.active]="activeTab() === 'overview'"
          (click)="activeTab.set('overview')">
          <span class="dock-icon">&#9638;</span>
          <span class="dock-label">Overview</span>
        </button>
        <button
          type="button"
          class="dock-item"
          [class.active]="activeTab() === 'attendees'"
          (click)="activeTab.set('attendees')">
          <span class="dock-icon">&#9776;</span>
          <span class="dock-label">Roster</span>
        </button>
        <button
          type="button"
          class="dock-item highlight"
          [class.active]="activeTab() === 'scanner'"
          (click)="activeTab.set('scanner')">
          <span class="dock-icon">&#128247;</span>
          <span class="dock-label">Terminal</span>
        </button>
        <button
          type="button"
          class="dock-item"
          [class.active]="activeTab() === 'rsvp'"
          (click)="activeTab.set('rsvp')">
          <span class="dock-icon">&#43;</span>
          <span class="dock-label">RSVP</span>
        </button>
      </nav>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      background-color: #F8FAFC;
      color: #0F172A;
    }
    .shell-container {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }
    .top-nav {
      height: 60px;
      background: #FFFFFF;
      border-bottom: 1px solid #E2E8F0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    @media (min-width: 1024px) {
      .top-nav {
        padding: 0 32px;
      }
    }
    .nav-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .brand-logo {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 900;
      letter-spacing: -0.5px;
      color: #0F172A;
    }
    .logo-mark {
      color: #FF5A36;
      font-size: 20px;
    }
    .event-context-pill {
      display: none;
      align-items: center;
      gap: 6px;
      background: #F1F5F9;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      color: #334155;
    }
    @media (min-width: 640px) {
      .event-context-pill {
        display: flex;
      }
    }
    .pulse-indicator {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #10B981;
    }
    .sync-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.5px;
      background: #ECFDF5;
      color: #059669;
      border: 1px solid #A7F3D0;
    }
    .sync-pill.is-offline {
      background: #FFFBEB;
      color: #D97706;
      border-color: #FDE68A;
    }
    .status-indicator-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
    }
    .status-indicator-dot.online { background: #10B981; }
    .status-indicator-dot.offline { background: #F59E0B; }
    .sync-spinner {
      width: 10px;
      height: 10px;
      border: 2px solid #059669;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .content-canvas {
      flex: 1;
      padding: 16px;
      padding-bottom: 84px;
      max-width: 1400px;
      width: 100%;
      margin: 0 auto;
      box-sizing: border-box;
    }
    @media (min-width: 768px) {
      .content-canvas {
        padding: 24px;
        padding-bottom: 24px;
      }
    }
    .mobile-bottom-dock {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 64px;
      background: #FFFFFF;
      border-top: 1px solid #E2E8F0;
      display: flex;
      align-items: center;
      justify-content: space-around;
      z-index: 50;
      padding-bottom: env(safe-area-inset-bottom);
    }
    @media (min-width: 768px) {
      .mobile-bottom-dock {
        display: none;
      }
    }
    .dock-item {
      flex: 1;
      height: 100%;
      background: none;
      border: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      color: #64748B;
      cursor: pointer;
      min-width: 48px;
      min-height: 48px;
    }
    .dock-item.active {
      color: #FF5A36;
    }
    .dock-item.highlight {
      color: #0F172A;
    }
    .dock-item.highlight.active {
      color: #FF5A36;
    }
    .dock-icon {
      font-size: 18px;
    }
    .dock-label {
      font-size: 10px;
      font-weight: 700;
    }
  `]
})
export class DashboardShellComponent {
  public readonly syncService = inject(OfflineMutationService);
  public readonly activeTab = signal<'overview' | 'attendees' | 'scanner' | 'rsvp'>('overview');
}
