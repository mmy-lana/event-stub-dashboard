import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import type { AttendeeTicket } from '../../core/models/ticket.model';
import { EventDataStore } from '../../core/state/event-data.store';
import { AttendeeRosterStore, ROSTER_PAGE_SIZES } from './stores/attendee-roster.store';
import { AttendeeRowItemComponent } from '../../shared/molecules/attendee-row-item/attendee-row-item.component';
import { SearchFilterToolbarComponent } from '../../shared/molecules/search-filter-toolbar/search-filter-toolbar.component';
import { TicketStubCardComponent } from '../../shared/molecules/ticket-stub-card/ticket-stub-card.component';
import { ButtonComponent } from '../../shared/ui/button/button.component';
import { DateFormatUtility } from '../../shared/utils/date-format.util';

/**
 * Attendee management roster.
 *
 * Filter toolbar, paginated list with batch actions, CSV export and a detail drawer
 * that renders the printable tear-off pass for the selected attendee.
 */
@Component({
  selector: 'app-attendee-roster',
  standalone: true,
  imports: [
    AttendeeRowItemComponent,
    ButtonComponent,
    SearchFilterToolbarComponent,
    TicketStubCardComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-header">
        <div>
          <h1 class="page-title">Attendee roster</h1>
          <p class="page-subtitle">
            {{ summary().total }} tickets · {{ summary().checkedIn }} admitted ·
            {{ summary().notArrived }} expected · {{ summary().cancelled }} cancelled
          </p>
        </div>

        <div class="header-actions">
          <app-button
            variant="coral"
            icon="✓"
            [disabled]="selectableForCheckIn().length === 0"
            [loading]="isBatching()"
            (pressed)="markSelected()">
            Mark {{ selectableForCheckIn().length }} checked in
          </app-button>
          <app-button
            variant="outline"
            icon="↺"
            [disabled]="selectedIds().length === 0"
            (pressed)="reverseSelected()">
            Reverse admission
          </app-button>
          <app-button variant="outline" icon="⇩" (pressed)="exportCsv()">Export CSV</app-button>
        </div>
      </header>

      @if (batchMessage() !== null) {
        <p class="batch-message" role="status">{{ batchMessage() }}</p>
      }

      <app-search-filter-toolbar
        [tiers]="tiers()"
        [searchTerm]="searchTerm()"
        [tierFilter]="tierFilter()"
        [statusFilter]="statusFilter()"
        [filtersOpen]="filtersOpen()"
        [resultCount]="summary().shown"
        [totalCount]="summary().total"
        (searchTermChange)="store.setSearchTerm($event)"
        (tierFilterChange)="store.setTierFilter($event)"
        (statusFilterChange)="store.setStatusFilter($event)"
        (filtersOpenChange)="store.setFiltersOpen($event)"
        (filtersReset)="store.resetFilters()" />

      <section class="list-panel" aria-labelledby="roster-heading">
        <h2 id="roster-heading" class="sr-only">Attendee list</h2>

        @if (pageAttendees().length === 0) {
          <div class="empty-state">
            <p class="empty-icon" aria-hidden="true">🔍</p>
            <p class="empty-title">No attendees match these filters</p>
            <p class="empty-body">
              Adjust the search term or clear the tier and status filters to see more of the roster.
            </p>
            <app-button variant="outline" (pressed)="store.resetFilters()">Reset filters</app-button>
          </div>
        } @else {
          <div class="list-head">
            <label class="head-select">
              <input
                type="checkbox"
                [checked]="isPageFullySelected()"
                aria-label="Select every attendee on this page"
                (change)="togglePageSelection($event)" />
            </label>

            @for (column of sortableColumns; track column.field) {
              <button
                type="button"
                class="head-sort"
                [class.active]="sortField() === column.field"
                (click)="store.toggleSort(column.field)">
                {{ column.label }}
                @if (sortField() === column.field) {
                  <span class="sort-arrow" aria-hidden="true">{{ sortDirection() === 'asc' ? '▲' : '▼' }}</span>
                }
              </button>
            }
          </div>

          <div class="list-body">
            @for (attendee of pageAttendees(); track attendee.id) {
              <app-attendee-row-item
                [ticket]="attendee"
                [selectable]="true"
                [selected]="selectedIds().includes(attendee.id)"
                [pending]="pendingTicketIds().includes(attendee.id)"
                (toggleCheckIn)="toggleAdmission($event)"
                (selectionChange)="onSelectionChange($event)"
                (openDetails)="openDetails($event)" />
            }
          </div>

          <footer class="pager">
            <span class="pager-info">
              Page {{ page() }} of {{ totalPages() }} · {{ summary().shown }} matching
            </span>

            <label class="pager-size">
              ROWS
              <select [value]="pageSize()" (change)="onPageSizeChange($event)">
                @for (size of ROSTER_PAGE_SIZES; track size) {
                  <option [value]="size">{{ size }}</option>
                }
              </select>
            </label>

            <div class="pager-controls">
              <button type="button" class="pager-btn" [disabled]="page() === 1" (click)="store.setPage(page() - 1)">
                ‹ Prev
              </button>
              <button
                type="button"
                class="pager-btn"
                [disabled]="page() >= totalPages()"
                (click)="store.setPage(page() + 1)">
                Next ›
              </button>
            </div>
          </footer>
        }
      </section>
    </div>

    <!-- Detail drawer with the printable pass -->
    @if (detailTicket(); as ticket) {
      <div class="drawer-backdrop" (click)="closeDetails()"></div>
      <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-heading">
        <header class="drawer-head">
          <div>
            <h2 id="drawer-heading" class="drawer-title">{{ ticket.firstName }} {{ ticket.lastName }}</h2>
            <p class="drawer-subtitle">
              {{ ticket.ticketTierName }} · {{ ticket.email }}
            </p>
          </div>
          <button type="button" class="drawer-close" aria-label="Close pass detail" (click)="closeDetails()">
            ×
          </button>
        </header>

        <app-ticket-stub-card
          [ticket]="ticket"
          [eventTitle]="eventTitle()"
          [venueName]="venueLine()"
          [formattedDateTime]="dateTimeLine()"
          [pending]="pendingTicketIds().includes(ticket.id)"
          (onToggleCheckIn)="toggleAdmission($event)" />

        <dl class="drawer-meta">
          <div>
            <dt>Order</dt>
            <dd class="font-mono">{{ ticket.orderId }}</dd>
          </div>
          <div>
            <dt>Issued</dt>
            <dd>{{ DateFormatUtility.formatDate(ticket.createdAt) }}</dd>
          </div>
          <div>
            <dt>Last update</dt>
            <dd>{{ DateFormatUtility.formatDateTime(ticket.updatedAt) }}</dd>
          </div>
          <div>
            <dt>Checked in</dt>
            <dd>
              {{ ticket.checkedInAt === null ? 'not yet' : DateFormatUtility.formatDateTime(ticket.checkedInAt) }}
            </dd>
          </div>
        </dl>

        <div class="drawer-actions">
          <app-button variant="neutral" icon="🖨" (pressed)="printPass()">Print pass</app-button>
          <app-button variant="outline" (pressed)="closeDetails()">Close</app-button>
        </div>
      </aside>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .page {
        display: flex;
        flex-direction: column;
        gap: 14px;
        width: 100%;
        max-width: var(--content-max-width);
        margin: 0 auto;
        padding: 18px 14px 32px 14px;
      }

      @media (min-width: 768px) {
        .page {
          padding: 24px 20px 40px 20px;
        }
      }

      @media (min-width: 1024px) {
        .page {
          padding: 28px 32px 48px 32px;
        }
      }

      .page-header {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .page-title {
        font-size: 22px;
        font-weight: 900;
        letter-spacing: -0.4px;
      }

      .page-subtitle {
        font-size: 13px;
        color: var(--color-slate-500);
      }

      .header-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .batch-message {
        padding: 10px 12px;
        border: 1px solid #bbf7d0;
        border-radius: var(--radius-md);
        background: var(--color-emerald-soft);
        font-size: 12px;
        font-weight: 700;
        color: var(--color-emerald-deep);
      }

      .list-panel {
        display: flex;
        flex-direction: column;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        overflow: hidden;
      }

      .list-head {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        background: var(--color-canvas);
        border-bottom: 1px solid var(--color-border);
      }

      .head-select {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--touch-target-min);
        height: 32px;
        margin-left: -10px;
      }

      .head-select input {
        width: 18px;
        height: 18px;
        accent-color: var(--color-coral);
      }

      .head-sort {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
        border: none;
        border-radius: var(--radius-sm);
        background: transparent;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.8px;
        color: var(--color-slate-500);
        text-transform: uppercase;
      }

      .head-sort.active {
        color: var(--color-coral);
      }

      .sort-arrow {
        font-size: 8px;
      }

      .list-body {
        display: flex;
        flex-direction: column;
      }

      .pager {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        padding: 12px;
        border-top: 1px solid var(--color-border);
        background: var(--color-canvas);
      }

      .pager-info {
        font-size: 12px;
        font-weight: 700;
        color: var(--color-slate-500);
      }

      .pager-size {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.8px;
        color: var(--color-muted-soft);
      }

      .pager-size select {
        min-height: 36px;
        padding: 4px 8px;
        border: 1px solid var(--color-border-strong);
        border-radius: var(--radius-sm);
        background: var(--color-surface);
        font-size: 12px;
        font-weight: 700;
      }

      .pager-controls {
        display: flex;
        gap: 6px;
        margin-left: auto;
      }

      .pager-btn {
        min-height: var(--touch-target-min);
        padding: 8px 14px;
        border: 1px solid var(--color-border-strong);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        font-size: 12px;
        font-weight: 700;
        color: var(--color-slate-700);
      }

      .pager-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 40px 20px;
        text-align: center;
      }

      .empty-icon {
        font-size: 32px;
      }

      .empty-title {
        font-size: 16px;
        font-weight: 800;
      }

      .empty-body {
        max-width: 460px;
        font-size: 12px;
        line-height: 1.6;
        color: var(--color-slate-500);
      }

      /* Detail drawer */
      .drawer-backdrop {
        position: fixed;
        inset: 0;
        z-index: 70;
        background: rgba(15, 23, 42, 0.45);
      }

      .drawer {
        position: fixed;
        z-index: 80;
        left: 0;
        right: 0;
        bottom: 0;
        max-height: 92vh;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 16px;
        background: var(--color-surface);
        border-radius: var(--radius-xl) var(--radius-xl) 0 0;
        box-shadow: var(--shadow-overlay);
      }

      .drawer-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }

      .drawer-title {
        font-size: 17px;
        font-weight: 900;
      }

      .drawer-subtitle {
        font-size: 12px;
        color: var(--color-slate-500);
      }

      .drawer-close {
        width: var(--touch-target-min);
        height: var(--touch-target-min);
        border: 1px solid var(--color-border);
        border-radius: 50%;
        background: var(--color-canvas);
        font-size: 20px;
        line-height: 1;
        color: var(--color-slate-600);
      }

      .drawer-meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin: 0;
        padding: 12px;
        background: var(--color-canvas);
        border-radius: var(--radius-md);
      }

      .drawer-meta dt {
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.8px;
        color: var(--color-muted-soft);
        text-transform: uppercase;
      }

      .drawer-meta dd {
        margin: 2px 0 0 0;
        font-size: 13px;
        font-weight: 700;
        color: var(--color-slate-800);
      }

      .font-mono {
        font-family: var(--font-mono);
      }

      .drawer-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      @media (min-width: 768px) {
        .drawer {
          left: auto;
          top: 0;
          bottom: 0;
          width: min(520px, 100%);
          max-height: none;
          border-radius: var(--radius-xl) 0 0 var(--radius-xl);
          padding: 20px;
        }

        .page-header {
          flex-direction: row;
          align-items: flex-end;
          justify-content: space-between;
        }
      }
    `
  ]
})
export class AttendeeRosterComponent {
  /** Roster view state. */
  protected readonly store = inject(AttendeeRosterStore);

  private readonly data = inject(EventDataStore);

  /** Attendee whose pass is open in the drawer. */
  protected readonly detailTicket = signal<AttendeeTicket | null>(null);

  /** Page size options exposed to the template. */
  protected readonly ROSTER_PAGE_SIZES = ROSTER_PAGE_SIZES;

  /** Date utilities exposed to the template. */
  protected readonly DateFormatUtility = DateFormatUtility;

  /** Rows for the current page. */
  protected readonly pageAttendees = this.store.pageAttendees;

  /** Rows matching the active filters. */
  protected readonly totalPages = this.store.totalPages;

  /** Current page number. */
  protected readonly page = this.store.page;

  /** Rows per page. */
  protected readonly pageSize = this.store.pageSize;

  /** Active sort field. */
  protected readonly sortField = this.store.sortField;

  /** Active sort direction. */
  protected readonly sortDirection = this.store.sortDirection;

  /** Selected row ids. */
  protected readonly selectedIds = this.store.selectedIds;

  /** Tickets with an in-flight write. */
  protected readonly pendingTicketIds = this.store.pendingTicketIds;

  /** Summary counters. */
  protected readonly summary = this.store.summary;

  /** Selected rows that can still be admitted. */
  protected readonly selectableForCheckIn = this.store.selectableForCheckIn;

  /** Whether the current page is fully selected. */
  protected readonly isPageFullySelected = this.store.isPageFullySelected;

  /** Last batch action message. */
  protected readonly batchMessage = this.store.lastBatchMessage;

  /** Current search term. */
  protected readonly searchTerm = this.store.searchTerm;

  /** Current tier filter. */
  protected readonly tierFilter = this.store.tierFilter;

  /** Current status filter. */
  protected readonly statusFilter = this.store.statusFilter;

  /** Mobile filter drawer state. */
  protected readonly filtersOpen = this.store.filtersOpen;

  /** Tiers available to the toolbar. */
  protected readonly tiers = this.store.tiers;

  /** `true` while a batch action is running. */
  protected readonly isBatching = signal<boolean>(false);

  /** Sortable column definitions. */
  protected readonly sortableColumns = [
    { field: 'name' as const, label: 'Attendee' },
    { field: 'tier' as const, label: 'Tier' },
    { field: 'stub' as const, label: 'Stub' },
    { field: 'status' as const, label: 'Status' },
    { field: 'checkedInAt' as const, label: 'Admitted' }
  ];

  /** Event title used by the pass preview. */
  protected readonly eventTitle = computed(() => this.data.event()?.title ?? 'Event pass');

  /** Venue line used by the pass preview. */
  protected readonly venueLine = computed(() => {
    const event = this.data.event();
    if (event === null) {
      return '';
    }
    return `${event.venue.venueName} · ${event.venue.city}, ${event.venue.stateProvince}`;
  });

  /** Date and time line used by the pass preview. */
  protected readonly dateTimeLine = computed(() => {
    const event = this.data.event();
    if (event === null) {
      return '';
    }
    return DateFormatUtility.formatEventDateRange(event.startDateTime, event.endDateTime, {
      timeZone: event.timezone
    });
  });

  public constructor() {
    void this.data.connect();
  }

  /** Applies a roster row selection change. */
  protected onSelectionChange(event: { ticket: AttendeeTicket; selected: boolean }): void {
    this.store.setSelection(event.ticket.id, event.selected);
  }

  /** Selects or clears every row on the current page. */
  protected togglePageSelection(event: Event): void {
    this.store.togglePageSelection((event.target as HTMLInputElement).checked);
  }

  /** Changes the page size from the pager select. */
  protected onPageSizeChange(event: Event): void {
    this.store.setPageSize(Number((event.target as HTMLSelectElement).value));
  }

  /** Admits every selected attendee. */
  protected async markSelected(): Promise<void> {
    this.isBatching.set(true);
    try {
      await this.store.markSelectedCheckedIn();
    } finally {
      this.isBatching.set(false);
    }
  }

  /** Reverses the admission of every selected attendee. */
  protected async reverseSelected(): Promise<void> {
    this.isBatching.set(true);
    try {
      await this.store.reverseSelectedCheckIn();
    } finally {
      this.isBatching.set(false);
    }
  }

  /** Downloads the filtered roster as CSV. */
  protected exportCsv(): void {
    this.store.downloadCsvExport();
  }

  /** Admits or reverses a single attendee from a row or the drawer. */
  protected async toggleAdmission(ticket: AttendeeTicket): Promise<void> {
    if (ticket.checkInStatus === 'checked_in') {
      await this.data.reverseAdmission(ticket);
    } else {
      await this.data.admitAttendee(ticket, 'roster_operator', 'manual_button');
    }

    const refreshed = this.data.attendees().find((attendee) => attendee.id === ticket.id);
    if (refreshed !== undefined && this.detailTicket()?.id === ticket.id) {
      this.detailTicket.set(refreshed);
    }
  }

  /**
   * Opens the pass drawer for an attendee.
   *
   * The drawer stays inline rather than navigating: the deep-linkable
   * `tickets/:ticketId` route renders the same pass as a standalone page.
   */
  protected openDetails(ticket: AttendeeTicket): void {
    this.detailTicket.set(ticket);
  }

  /** Closes the pass drawer. */
  protected closeDetails(): void {
    this.detailTicket.set(null);
  }

  /** Prints the currently open pass. */
  protected printPass(): void {
    if (typeof window !== 'undefined') {
      window.print();
    }
  }
}
