import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/** Visual treatment of a button. */
export type ButtonVariant = 'coral' | 'emerald' | 'neutral' | 'outline' | 'ghost' | 'perforated';

/** Control size; `md` and `lg` meet the 48px field touch target. */
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Primary action control.
 *
 * Renders a real `<button>` with `aria-busy` while loading and a native disabled
 * state (never a click guard alone), so keyboard and screen-reader users get the
 * same affordances as pointer users. The `perforated` variant carries the
 * skeuomorphic tear-off treatment used on stub actions.
 */
@Component({
  selector: 'app-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      class="btn"
      [class]="variantClass()"
      [class.size-sm]="size() === 'sm'"
      [class.size-md]="size() === 'md'"
      [class.size-lg]="size() === 'lg'"
      [class.full-width]="fullWidth()"
      [class.is-loading]="loading()"
      [type]="type()"
      [disabled]="isDisabled()"
      [attr.aria-busy]="loading() ? 'true' : null"
      [attr.aria-label]="ariaLabel() ?? null"
      (click)="onActivate($event)">
      @if (loading()) {
        <span class="spinner" aria-hidden="true"></span>
      } @else if (icon() !== null) {
        <span class="btn-icon" aria-hidden="true">{{ icon() }}</span>
      }

      <span class="btn-label"><ng-content /></span>

      @if (badge() !== null) {
        <span class="btn-badge">{{ badge() }}</span>
      }
    </button>
  `,
  styles: [
    `
      :host {
        display: inline-block;
        max-width: 100%;
      }

      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        border: 1px solid transparent;
        border-radius: var(--radius-md);
        font-weight: 700;
        letter-spacing: 0.2px;
        white-space: nowrap;
        transition:
          background-color var(--transition-fast),
          border-color var(--transition-fast),
          color var(--transition-fast),
          transform var(--transition-fast);
      }

      .btn:active:not(:disabled) {
        transform: scale(0.985);
      }

      .btn:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      /* Sizes: md/lg guarantee the 48px field touch target. */
      .size-sm {
        min-height: var(--control-height-sm);
        padding: 6px 12px;
        font-size: 12px;
      }

      .size-md {
        min-height: var(--touch-target-min);
        padding: 10px 16px;
        font-size: 14px;
      }

      .size-lg {
        min-height: var(--control-height-lg);
        padding: 14px 22px;
        font-size: 16px;
      }

      .full-width {
        width: 100%;
      }

      .variant-coral {
        background-color: var(--color-coral);
        color: #ffffff;
      }

      .variant-coral:not(:disabled):hover {
        background-color: var(--color-coral-strong);
      }

      .variant-emerald {
        background-color: var(--color-emerald-deep);
        color: #ffffff;
      }

      .variant-emerald:not(:disabled):hover {
        background-color: #047857;
      }

      .variant-neutral {
        background-color: var(--color-charcoal);
        color: #ffffff;
      }

      .variant-neutral:not(:disabled):hover {
        background-color: #0b0e13;
      }

      .variant-outline {
        background-color: var(--color-surface);
        border-color: var(--color-border-strong);
        color: var(--color-slate-700);
      }

      .variant-outline:not(:disabled):hover {
        border-color: var(--color-coral);
        color: var(--color-coral);
      }

      .variant-ghost {
        background-color: transparent;
        color: var(--color-slate-600);
      }

      .variant-ghost:not(:disabled):hover {
        background-color: rgba(15, 23, 42, 0.06);
      }

      /* Skeuomorphic perforated pass control: dashed cut line, punched edges. */
      .variant-perforated {
        position: relative;
        background-color: var(--color-coral-soft);
        border: 2px dashed var(--color-coral);
        color: var(--color-coral-strong);
      }

      .variant-perforated:not(:disabled):hover {
        background-color: #ffe4dd;
      }

      .variant-perforated::before,
      .variant-perforated::after {
        content: '';
        position: absolute;
        top: 50%;
        width: 12px;
        height: 12px;
        margin-top: -6px;
        border-radius: 50%;
        background-color: var(--color-surface);
        border: 1px solid var(--color-border);
      }

      .variant-perforated::before {
        left: -7px;
      }

      .variant-perforated::after {
        right: -7px;
      }

      .btn-icon {
        font-size: 1.05em;
        line-height: 1;
      }

      .btn-label {
        display: inline-flex;
        align-items: center;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .btn-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        border-radius: var(--radius-pill);
        background-color: rgba(255, 255, 255, 0.24);
        font-size: 11px;
        font-weight: 800;
      }

      .variant-outline .btn-badge,
      .variant-ghost .btn-badge {
        background-color: rgba(15, 23, 42, 0.08);
        color: var(--color-slate-700);
      }

      .spinner {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 2px solid currentColor;
        border-top-color: transparent;
        animation: btn-spin 700ms linear infinite;
      }

      @keyframes btn-spin {
        to {
          transform: rotate(360deg);
        }
      }
    `
  ]
})
export class ButtonComponent {
  /** Visual treatment. */
  public readonly variant = input<ButtonVariant>('coral');

  /** Control size. */
  public readonly size = input<ButtonSize>('md');

  /** Native button type; defaults to `button` so forms are never submitted by accident. */
  public readonly type = input<'button' | 'submit' | 'reset'>('button');

  /** Renders the busy spinner and marks the control `aria-busy`. */
  public readonly loading = input<boolean>(false);

  /** Disables the control; also implied while loading. */
  public readonly disabled = input<boolean>(false);

  /** Stretches the control to the full width of its container. */
  public readonly fullWidth = input<boolean>(false);

  /** Optional leading glyph (emoji or single character). */
  public readonly icon = input<string | null>(null);

  /** Optional trailing counter, e.g. a pending-sync total. */
  public readonly badge = input<number | string | null>(null);

  /** Accessible name when the projected content is not descriptive enough. */
  public readonly ariaLabel = input<string | null>(null);

  /** Emitted on activation; suppressed while disabled or loading. */
  public readonly pressed = output<MouseEvent>();

  /** True when activation must be blocked. */
  public readonly isDisabled = computed(() => this.disabled() || this.loading());

  /** CSS class for the active variant. */
  public readonly variantClass = computed(() => `variant-${this.variant()}`);

  /** Handles activation, guarding against clicks on a disabled control. */
  public onActivate(event: MouseEvent): void {
    if (this.isDisabled()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    this.pressed.emit(event);
  }
}
