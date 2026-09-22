/**
 * Attendee roster view state.
 *
 * Owns search, filtering, sorting, pagination, row selection and the batch
 * actions (mark checked-in, export CSV) for the roster screen. All filtering is
 * signal-derived, so the list recomputes only when a filter or the underlying
 * attendee collection actually changes.
 */

import { Injectable, computed, inject, signal } from '@angular/core';

import type { AttendeeTicket, CheckInStatus } from '../../../core/models/ticket.model';
import { VALIDATION_RULES } from '../../../core/models/ticket.model';
import { EventDataStore } from '../../../core/state/event-data.store';

/** Sortable roster columns. */
export type RosterSortField = 'name' | 'tier' | 'stub' | 'status' | 'checkedInAt';

/** Sort direction. */
export type SortDirection = 'asc' | 'desc';

/** Status filter options. */
export type RosterStatusFilter = 'all' | CheckInStatus;

/** Result of a CSV export request. */
export interface CsvExportResult {
  readonly fileName: string;
  readonly rowCount: number;
  readonly content: string;
}

/** Row count options for the pager. */
export const ROSTER_PAGE_SIZES: readonly number[] = [10, 25, 50, 100];

/** Filter, sort, paginate and batch-act on the attendee roster. */
@Injectable({ providedIn: 'root' })
export class AttendeeRosterStore {
  private readonly data = inject(EventDataStore);

  private readonly searchTermSignal = signal<string>('');
  private readonly tierFilterSignal = signal<string>('all');
  private readonly statusFilterSignal = signal<RosterStatusFilter>('all');
  private readonly sortFieldSignal = signal<RosterSortField>('name');
  private readonly sortDirectionSignal = signal<SortDirection>('asc');
  private readonly pageSignal = signal<number>(1);
  private readonly pageSizeSignal = signal<number>(25);
  private readonly selectedIdsSignal = signal<readonly string[]>([]);
  private readonly filtersOpenSignal = signal<boolean>(false);
  private readonly pendingTicketIdsSignal = signal<readonly string[]>([]);
  private readonly lastBatchMessageSignal = signal<string | null>(null);

  /** All attendees for the active event. */
  public readonly allAttendees = this.data.attendees;

  /** Tiers used by the tier filter and the tier column. */
  public readonly tiers = this.data.ticketTiers;

  /** Current debounced search term. */
  public readonly searchTerm = this.searchTermSignal.asReadonly();

  /** Current tier filter (`all` or a tier id). */
  public readonly tierFilter = this.tierFilterSignal.asReadonly();

  /** Current admission-status filter. */
  public readonly statusFilter = this.statusFilterSignal.asReadonly();

  /** Current sort field. */
  public readonly sortField = this.sortFieldSignal.asReadonly();

  /** Current sort direction. */
  public readonly sortDirection = this.sortDirectionSignal.asReadonly();

  /** Current page, 1-based. */
  public readonly page = this.pageSignal.asReadonly();

  /** Rows per page. */
  public readonly pageSize = this.pageSizeSignal.asReadonly();

  /** Ids of the selected rows. */
  public readonly selectedIds = this.selectedIdsSignal.asReadonly();

  /** Whether the mobile filter drawer is open. */
  public readonly filtersOpen = this.filtersOpenSignal.asReadonly();

  /** Tickets with an in-flight write, rendered with an inline spinner. */
  public readonly pendingTicketIds = this.pendingTicketIdsSignal.asReadonly();

  /** Feedback line for the last batch action. */
  public readonly lastBatchMessage = this.lastBatchMessageSignal.asReadonly();

  /** Rows matching the active filters, before pagination. */
  public readonly filteredAttendees = computed<readonly AttendeeTicket[]>(() => {
    const term = this.searchTermSignal().trim().toLowerCase();
    const tierId = this.tierFilterSignal();
    const status = this.statusFilterSignal();

    return this.data.attendees().filter((attendee) => {
      if (tierId !== 'all' && attendee.ticketTierId !== tierId) {
        return false;
      }
      if (status !== 'all' && attendee.checkInStatus !== status) {
        return false;
      }
      if (term.length < VALIDATION_RULES.MIN_SEARCH_CHARACTERS) {
        return true;
      }
      return (
        attendee.firstName.toLowerCase().includes(term) ||
        attendee.lastName.toLowerCase().includes(term) ||
        attendee.email.toLowerCase().includes(term) ||
        attendee.companyOrAffiliation.toLowerCase().includes(term) ||
        attendee.ticketStubNumber.toLowerCase().includes(term)
      );
    });
  });

  /** Filtered rows in the active sort order. */
  public readonly sortedAttendees = computed<readonly AttendeeTicket[]>(() => {
    const field = this.sortFieldSignal();
    const direction = this.sortDirectionSignal() === 'asc' ? 1 : -1;

    return [...this.filteredAttendees()].sort((left, right) => {
      const comparison = compareAttendees(left, right, field);
      return comparison * direction;
    });
  });

  /** Total pages for the current filters. */
  public readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.sortedAttendees().length / this.pageSizeSignal()))
  );

  /** Rows for the current page. */
  public readonly pageAttendees = computed<readonly AttendeeTicket[]>(() => {
    const page = Math.min(this.pageSignal(), this.totalPages());
    const size = this.pageSizeSignal();
    const start = (page - 1) * size;
    return this.sortedAttendees().slice(start, start + size);
  });

  /** Selected attendee records, resolved from the current collection. */
  public readonly selectedAttendees = computed<readonly AttendeeTicket[]>(() => {
    const selected = new Set(this.selectedIdsSignal());
    return this.data.attendees().filter((attendee) => selected.has(attendee.id));
  });

  /** Selected rows that can still be admitted. */
  public readonly selectableForCheckIn = computed(() =>
    this.selectedAttendees().filter((attendee) => attendee.checkInStatus === 'confirmed')
  );

  /** Whether every row on the current page is selected. */
  public readonly isPageFullySelected = computed(() => {
    const rows = this.pageAttendees();
    if (rows.length === 0) {
      return false;
    }
    const selected = new Set(this.selectedIdsSignal());
    return rows.every((row) => selected.has(row.id));
  });

  /** Summary counts used by the roster header. */
  public readonly summary = computed(() => {
    const all = this.data.attendees();
    return {
      total: all.length,
      checkedIn: all.filter((attendee) => attendee.checkInStatus === 'checked_in').length,
      notArrived: all.filter((attendee) => attendee.checkInStatus === 'confirmed').length,
      cancelled: all.filter((attendee) => attendee.checkInStatus === 'cancelled').length,
      shown: this.filteredAttendees().length
    };
  });

  /** Applies a search term and resets to the first page. */
  public setSearchTerm(term: string): void {
    this.searchTermSignal.set(term);
    this.pageSignal.set(1);
  }

  /** Applies a tier filter and resets to the first page. */
  public setTierFilter(tierId: string): void {
    this.tierFilterSignal.set(tierId);
    this.pageSignal.set(1);
  }

  /** Applies a status filter and resets to the first page. */
  public setStatusFilter(status: RosterStatusFilter): void {
    this.statusFilterSignal.set(status);
    this.pageSignal.set(1);
  }

  /** Clears every filter. */
  public resetFilters(): void {
    this.searchTermSignal.set('');
    this.tierFilterSignal.set('all');
    this.statusFilterSignal.set('all');
    this.pageSignal.set(1);
  }

  /** Toggles the sort field, flipping direction when the same field is re-selected. */
  public toggleSort(field: RosterSortField): void {
    if (this.sortFieldSignal() === field) {
      this.sortDirectionSignal.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
      return;
    }
    this.sortFieldSignal.set(field);
    this.sortDirectionSignal.set(field === 'checkedInAt' ? 'desc' : 'asc');
  }

  /** Moves to a specific page, clamped into range. */
  public setPage(page: number): void {
    this.pageSignal.set(Math.min(Math.max(1, page), this.totalPages()));
  }

  /** Changes the page size and returns to the first page. */
  public setPageSize(size: number): void {
    this.pageSizeSignal.set(Math.max(1, size));
    this.pageSignal.set(1);
  }

  /** Sets or clears the mobile filter drawer state. */
  public setFiltersOpen(open: boolean): void {
    this.filtersOpenSignal.set(open);
  }

  /** Selects or deselects a single row. */
  public setSelection(ticketId: string, selected: boolean): void {
    this.selectedIdsSignal.update((current) =>
      selected
        ? current.includes(ticketId)
          ? current
          : [...current, ticketId]
        : current.filter((id) => id !== ticketId)
    );
  }

  /** Selects or clears every row on the current page. */
  public togglePageSelection(selected: boolean): void {
    const pageIds = this.pageAttendees().map((attendee) => attendee.id);
    this.selectedIdsSignal.update((current) => {
      const next = new Set(current);
      for (const id of pageIds) {
        if (selected) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return [...next];
    });
  }

  /** Clears the selection. */
  public clearSelection(): void {
    this.selectedIdsSignal.set([]);
  }

  /**
   * Admits every selected attendee that has not arrived yet.
   *
   * Writes go through the offline outbox, so a batch captured without connectivity
   * is replayed when the transport returns.
   *
   * @returns How many admissions were queued.
   */
  public async markSelectedCheckedIn(): Promise<number> {
    const targets = this.selectableForCheckIn();
    if (targets.length === 0) {
      this.lastBatchMessageSignal.set('No selected attendees are waiting to be admitted.');
      return 0;
    }

    this.pendingTicketIdsSignal.set(targets.map((ticket) => ticket.id));
    let queued = 0;

    try {
      for (const ticket of targets) {
        const applied = await this.data.admitAttendee(
          ticket,
          'roster_batch_operator',
          'manual_button'
        );
        if (applied) {
          queued += 1;
        }
      }
    } finally {
      this.pendingTicketIdsSignal.set([]);
    }

    this.selectedIdsSignal.set([]);
    this.lastBatchMessageSignal.set(
      queued === 1 ? '1 attendee checked in.' : `${queued} attendees checked in.`
    );
    return queued;
  }

  /** Reverses the admission of every selected attendee that is checked in. */
  public async reverseSelectedCheckIn(): Promise<number> {
    const targets = this.selectedAttendees().filter(
      (attendee) => attendee.checkInStatus === 'checked_in'
    );
    if (targets.length === 0) {
      this.lastBatchMessageSignal.set('No selected attendees are currently checked in.');
      return 0;
    }

    this.pendingTicketIdsSignal.set(targets.map((ticket) => ticket.id));
    let reversed = 0;

    try {
      for (const ticket of targets) {
        const applied = await this.data.reverseAdmission(ticket);
        if (applied) {
          reversed += 1;
        }
      }
    } finally {
      this.pendingTicketIdsSignal.set([]);
    }

    this.selectedIdsSignal.set([]);
    this.lastBatchMessageSignal.set(
      reversed === 1 ? '1 admission reversed.' : `${reversed} admissions reversed.`
    );
    return reversed;
  }

  /**
   * Builds a CSV export of the filtered roster.
   *
   * @returns The file name, row count and CSV body.
   */
  public buildCsvExport(): CsvExportResult {
    const rows = this.filteredAttendees();
    const eventTitle = this.data.event()?.title ?? 'event';
    const fileName = `${slugify(eventTitle)}-attendees-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

    const header = [
      'Stub number',
      'First name',
      'Last name',
      'Email',
      'Phone',
      'Company',
      'Tier',
      'Seat',
      'Status',
      'Checked in at',
      'Checked in by'
    ];

    const lines = rows.map((attendee) =>
      [
        attendee.ticketStubNumber,
        attendee.firstName,
        attendee.lastName,
        attendee.email,
        attendee.phoneNumber,
        attendee.companyOrAffiliation,
        attendee.ticketTierName,
        attendee.seatAssignment ?? '',
        attendee.checkInStatus,
        attendee.checkedInAt ?? '',
        attendee.checkedInByUserId ?? ''
      ]
        .map(escapeCsvCell)
        .join(',')
    );

    const content = [header.join(','), ...lines].join('\r\n');
    this.lastBatchMessageSignal.set(
      rows.length === 1 ? '1 attendee exported.' : `${rows.length} attendees exported.`
    );

    return { fileName, rowCount: rows.length, content };
  }

  /**
   * Triggers a CSV download in the browser.
   *
   * @returns The export summary, or `null` when the download API is unavailable.
   */
  public downloadCsvExport(): CsvExportResult | null {
    const exportResult = this.buildCsvExport();
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return null;
    }

    const blob = new Blob([exportResult.content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exportResult.fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);

    return exportResult;
  }
}

/** Compares two attendees by the requested column. */
function compareAttendees(
  left: AttendeeTicket,
  right: AttendeeTicket,
  field: RosterSortField
): number {
  switch (field) {
    case 'name':
      return `${left.lastName} ${left.firstName}`.localeCompare(
        `${right.lastName} ${right.firstName}`
      );
    case 'tier':
      return left.ticketTierName.localeCompare(right.ticketTierName);
    case 'stub':
      return left.ticketStubNumber.localeCompare(right.ticketStubNumber);
    case 'status':
      return left.checkInStatus.localeCompare(right.checkInStatus);
    case 'checkedInAt':
      return (left.checkedInAt ?? '').localeCompare(right.checkedInAt ?? '');
  }
}

/** Escapes a value for CSV output. */
function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Converts a title into a filesystem-safe slug. */
function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'event'
  );
}
