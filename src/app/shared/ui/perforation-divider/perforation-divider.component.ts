import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Orientation of the tear-off line. */
export type PerforationOrientation = 'horizontal' | 'vertical';

/**
 * Dashed tear-off divider with punched notches and a scissors marker.
 *
 * Used between the main ticket body and the tear-off coupon; switches orientation
 * with the responsive stub layout (vertical beside the coupon on desktop,
 * horizontal when the stub folds on mobile).
 */
@Component({
  selector: 'app-perforation-divider',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="perforation-container"
      [class.vertical]="orientation() === 'vertical'"
      [style]="notchStyle()"
      role="separator"
      [attr.aria-orientation]="orientation()">
      <span class="notch notch-start" [style.width.px]="notchSize()" [style.height.px]="notchSize()"></span>
      <span class="dash-line" [style.border-color]="lineColor()"></span>
      <span class="cut-marker" [class.hide-marker]="!showMarker()">
        <svg viewBox="0 0 24 24" class="scissors-icon" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <line x1="20" y1="4" x2="8.12" y2="15.88" />
          <line x1="14.47" y1="14.48" x2="20" y2="20" />
          <line x1="8.12" y1="8.12" x2="12" y2="12" />
        </svg>
      </span>
      <span class="notch notch-end" [style.width.px]="notchSize()" [style.height.px]="notchSize()"></span>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
      }

      .perforation-container {
        display: flex;
        align-items: center;
        position: relative;
        width: 100%;
        height: 24px;
      }

      .perforation-container.vertical {
        flex-direction: column;
        width: 24px;
        height: 100%;
      }

      .dash-line {
        flex: 1;
        height: 0;
        border-top: 2px dashed var(--color-border-strong);
      }

      .perforation-container.vertical .dash-line {
        width: 0;
        height: 100%;
        border-top: none;
        border-left: 2px dashed var(--color-border-strong);
      }

      .notch {
        position: absolute;
        background-color: var(--notch-color, var(--color-canvas));
        border-radius: 50%;
        z-index: 2;
      }

      .perforation-container:not(.vertical) .notch-start {
        left: -10px;
        top: calc(50% - 10px);
      }

      .perforation-container:not(.vertical) .notch-end {
        right: -10px;
        top: calc(50% - 10px);
      }

      .perforation-container.vertical .notch-start {
        top: -10px;
        left: calc(50% - 10px);
      }

      .perforation-container.vertical .notch-end {
        bottom: -10px;
        left: calc(50% - 10px);
      }

      .cut-marker {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 2px 6px;
        border-radius: var(--radius-sm);
        background: var(--color-surface);
        color: var(--color-muted-soft);
      }

      .perforation-container.vertical .cut-marker {
        transform: translate(-50%, -50%) rotate(90deg);
      }

      .hide-marker {
        display: none;
      }

      .scissors-icon {
        width: 14px;
        height: 14px;
        display: block;
      }
    `
  ]
})
export class PerforationDividerComponent {
  /** Tear-off line orientation. */
  public readonly orientation = input<PerforationOrientation>('horizontal');

  /** Diameter of the punched notches at each end. */
  public readonly notchSize = input<number>(20);

  /** Colour of the dashed cut line. */
  public readonly lineColor = input<string>('var(--color-border-strong)');

  /** Renders the scissors marker in the middle of the cut line. */
  public readonly showMarker = input<boolean>(true);

  /** Background colour painted inside the notches; must match the parent surface. */
  public readonly notchColor = input<string | null>(null);

  /** Inline style binding so the notch colour can be themed per surface. */
  public readonly notchStyle = computed(() => `--notch-color: ${this.notchColor() ?? 'var(--color-canvas)'}`);
}
