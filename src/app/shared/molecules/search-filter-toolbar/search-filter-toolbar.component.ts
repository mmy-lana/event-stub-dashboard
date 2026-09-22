import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import type { CheckInStatus, TicketTier } from '../../../core/models/ticket.model';
import { VALIDATION_RULES } from '../../../core/models/ticket.model';

/** Status pill options for the roster filter. */
export type StatusFilter = 'all' | CheckInStatus;

/**
 * Search and filter toolbar for the attendee roster.
 *
 * The search term is debounced and only applied once it reaches
 * `VALIDATION_RULES.MIN_SEARCH_CHARACTERS`, so a single keystroke never triggers a
 * full roster re-filter. Filters collapse into a drawer below 768px.
 */
@Component({
  selector: 'app-search-filter-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toolbar">
      <div class="search-field">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input
          #searchInput
          class="search-input"
          type="search"
          autocomplete="off"
          spellcheck="false"
          [value]="searchTerm()"
          [attr.placeholder]="placeholder()"
          [attr.aria-label]="'Search attendees'"
          (input)="onSearchInput($event)" />
        @if (searchTerm().length > 0) {
          <button type="button" class="clear-btn" aria-label="Clear search" (click)="clearSearch()">
            ×
          </button>
        }
      </div>

      <button
        type="button"
        class="filter-toggle"
        [class.active]="filtersOpen() || activeFilterCount() > 0"
        [attr.aria-expanded]="filtersOpen()"
        aria-controls="roster-filters"
        (click)="toggleFilters()">
        FILTERS
        @if (activeFilterCount() > 0) {
          <span class="filter-count">{{ activeFilterCount() }}</span>
        }
      </button>

      <div id="roster-filters" class="filter-group" [class.open]="filtersOpen()">
        <label class="filter-field">
          <span class="filter-label">TIER</span>
          <select class="filter-select" [value]="tierFilter()" (change)="onTierChange($event)">
            <option value="all">All tiers</option>
            @for (tier of tiers(); track tier.id) {
              <option [value]="tier.id">{{ tier.name }}</option>
            }
          </select>
        </label>

        <div class="pill-group" role="group" aria-label="Admission status filter">
          @for (option of statusOptions; track option.value) {
            <button
              type="button"
              class="filter-pill"
              [class.active]="statusFilter() === option.value"
              [attr.aria-pressed]="statusFilter() === option.value"
              (click)="setStatusFilter(option.value)">
              {{ option.label }}
            </button>
          }
        </div>

        @if (activeFilterCount() > 0) {
          <button type="button" class="reset-btn" (click)="resetFilters()">RESET</button>
        }
      </div>

      <span class="result-count" role="status">{{ resultSummary() }}</span>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        padding: 12px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
      }

      .search-field {
        position: relative;
        display: flex;
        align-items: center;
        flex: 1 1 220px;
        min-width: 0;
      }

      .search-icon {
        position: absolute;
        left: 12px;
        font-size: 16px;
        color: var(--color-muted-soft);
      }

      .search-input {
        width: 100%;
        min-height: var(--touch-target-min);
        padding: 10px 48px 10px 34px;
        border: 1px solid var(--color-border-strong);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        font-size: 14px;
      }

      .search-input:focus {
        border-color: var(--color-coral);
      }

      .clear-btn {
        position: absolute;
        right: 2px;
        width: 44px;
        height: 44px;
        border: none;
        border-radius: 50%;
        background: var(--color-canvas);
        color: var(--color-slate-600);
        font-size: 18px;
        line-height: 1;
      }

      .filter-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: var(--touch-target-min);
        padding: 10px 14px;
        border: 1px solid var(--color-border-strong);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.6px;
        color: var(--color-slate-700);
      }

      .filter-toggle.active {
        border-color: var(--color-coral);
        color: var(--color-coral);
      }

      .filter-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: var(--radius-pill);
        background: var(--color-coral);
        color: #ffffff;
        font-size: 10px;
      }

      .filter-group {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
      }

      .filter-field {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .filter-label {
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.8px;
        color: var(--color-muted-soft);
      }

      .filter-select {
        min-height: var(--touch-target-min);
        padding: 8px 10px;
        border: 1px solid var(--color-border-strong);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        font-size: 13px;
        font-weight: 600;
      }

      .pill-group {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .filter-pill {
        min-height: 44px;
        padding: 6px 12px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-pill);
        background: var(--color-canvas);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.4px;
        color: var(--color-slate-600);
      }

      .filter-pill.active {
        border-color: var(--color-coral);
        background: var(--color-coral-soft);
        color: var(--color-coral-strong);
      }

      .reset-btn {
        min-height: 44px;
        padding: 6px 12px;
        border: none;
        background: transparent;
        color: var(--color-slate-500);
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.6px;
        text-decoration: underline;
      }

      .result-count {
        margin-left: auto;
        font-size: 12px;
        font-weight: 700;
        color: var(--color-slate-500);
      }

      /* Below 768px the filter controls collapse into a full-width drawer. */
      @media (max-width: 767px) {
        .filter-group {
          display: none;
          width: 100%;
          flex-direction: column;
          align-items: stretch;
          padding-top: 8px;
          border-top: 1px dashed var(--color-border);
        }

        .filter-group.open {
          display: flex;
        }

        .filter-field,
        .filter-select {
          width: 100%;
        }

        .result-count {
          margin-left: 0;
        }
      }

      @media (min-width: 768px) {
        .filter-toggle {
          display: none;
        }
      }
    `
  ]
})
export class SearchFilterToolbarComponent {
  /** Debounce applied to the search box, in milliseconds. */
  public readonly debounceMs = input<number>(180);

  /** Placeholder for the search box. */
  public readonly placeholder = input<string>('Search name, email, company or stub number');

  /** Tiers available for filtering. */
  public readonly tiers = input<readonly TicketTier[]>([]);

  /** Total results matching the active filters. */
  public readonly resultCount = input<number>(0);

  /** Total attendees before filtering. */
  public readonly totalCount = input<number>(0);

  /** Current search term (owned by the parent store). */
  public readonly searchTerm = input<string>('');

  /** Current tier filter (`all` or a tier id). */
  public readonly tierFilter = input<string>('all');

  /** Current status filter. */
  public readonly statusFilter = input<StatusFilter>('all');

  /** Whether the mobile filter drawer is open. */
  public readonly filtersOpen = input<boolean>(false);

  /** Emitted with the debounced search term. */
  public readonly searchTermChange = output<string>();

  /** Emitted when the tier filter changes. */
  public readonly tierFilterChange = output<string>();

  /** Emitted when the status filter changes. */
  public readonly statusFilterChange = output<StatusFilter>();

  /** Emitted when the mobile filter drawer is toggled. */
  public readonly filtersOpenChange = output<boolean>();

  /** Emitted when every filter is reset. */
  public readonly filtersReset = output<void>();

  /** Status pill definitions. */
  protected readonly statusOptions: readonly { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'ALL' },
    { value: 'confirmed', label: 'NOT ARRIVED' },
    { value: 'checked_in', label: 'CHECKED IN' },
    { value: 'cancelled', label: 'CANCELLED' }
  ];

  /** Number of filters currently applied. */
  public readonly activeFilterCount = computed(() => {
    let count = 0;
    if (this.tierFilter() !== 'all') {
      count += 1;
    }
    if (this.statusFilter() !== 'all') {
      count += 1;
    }
    if (this.searchTerm().trim().length >= VALIDATION_RULES.MIN_SEARCH_CHARACTERS) {
      count += 1;
    }
    return count;
  });

  /** Result summary line shown at the end of the toolbar. */
  public readonly resultSummary = computed(() => {
    const shown = this.resultCount();
    const total = this.totalCount();
    if (this.activeFilterCount() === 0) {
      return `${total} ${total === 1 ? 'attendee' : 'attendees'}`;
    }
    return `${shown} of ${total} shown`;
  });

  /** Pending debounce handle. */
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  /** Applies the search box value after the debounce window. */
  public onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;

    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
    }

    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = null;
      this.searchTermChange.emit(value.trim());
    }, Math.max(0, this.debounceMs()));
  }

  /** Clears the search box immediately. */
  public clearSearch(): void {
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    this.searchTermChange.emit('');
  }

  /** Applies a tier filter. */
  public onTierChange(event: Event): void {
    this.tierFilterChange.emit((event.target as HTMLSelectElement).value);
  }

  /** Applies a status filter. */
  public setStatusFilter(status: StatusFilter): void {
    this.statusFilterChange.emit(status);
  }

  /** Toggles the mobile filter drawer. */
  public toggleFilters(): void {
    this.filtersOpenChange.emit(!this.filtersOpen());
  }

  /** Clears the search box, tier filter and status filter. */
  public resetFilters(): void {
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    this.filtersReset.emit();
  }
}
