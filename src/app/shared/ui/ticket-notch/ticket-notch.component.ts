import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Edge of the ticket the notch is punched into. */
export type NotchEdge = 'top' | 'bottom' | 'left' | 'right';

/** Corner the notch sits on for corner-style cutouts. */
export type NotchCorner = 'start' | 'end';

/**
 * Semi-circular cut-out used to build the perforated silhouette of a ticket stub.
 *
 * Rendered as an inline SVG so the cut-out is resolution independent and works on
 * any parent background (the `color` input paints the punched hole with the
 * surrounding canvas colour, which is how the physical cut-out is faked without
 * `mask-image` support gaps).
 */
@Component({
  selector: 'app-ticket-notch',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="notch"
      [class.edge-top]="edge() === 'top'"
      [class.edge-bottom]="edge() === 'bottom'"
      [class.edge-left]="edge() === 'left'"
      [class.edge-right]="edge() === 'right'"
      [style.width.px]="size()"
      [style.height.px]="size()"
      aria-hidden="true">
      <svg [attr.viewBox]="viewBox()" class="notch-svg" focusable="false">
        <circle [attr.cx]="circleX()" [attr.cy]="circleY()" [attr.r]="radius()" [attr.fill]="color()" />
        <circle
          [attr.cx]="circleX()"
          [attr.cy]="circleY()"
          [attr.r]="radius()"
          fill="none"
          [attr.stroke]="strokeColor()"
          stroke-width="1" />
      </svg>
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        line-height: 0;
        pointer-events: none;
      }

      .notch {
        display: inline-block;
        position: relative;
      }

      .notch-svg {
        width: 100%;
        height: 100%;
        display: block;
        overflow: visible;
      }

      /* Half of the circle hangs outside the ticket edge, producing the punch. */
      .edge-top .notch-svg {
        transform: translateY(-50%);
      }

      .edge-bottom .notch-svg {
        transform: translateY(50%);
      }

      .edge-left .notch-svg {
        transform: translateX(-50%);
      }

      .edge-right .notch-svg {
        transform: translateX(50%);
      }
    `
  ]
})
export class TicketNotchComponent {
  /** Diameter of the punched hole in pixels. */
  public readonly size = input<number>(20);

  /** Which ticket edge the notch is cut into. */
  public readonly edge = input<NotchEdge>('top');

  /** Colour painted inside the cut-out; should match the surrounding canvas. */
  public readonly color = input<string>('var(--color-canvas)');

  /** Hairline stroke that keeps the cut-out readable on white surfaces. */
  public readonly strokeColor = input<string>('var(--color-border)');

  /** SVG viewBox matching the punched diameter. */
  public readonly viewBox = computed(() => `0 0 ${this.size()} ${this.size()}`);

  /** Circle radius with a one-pixel inset so the stroke stays inside the box. */
  public readonly radius = computed(() => Math.max(1, this.size() / 2 - 1));

  /** Horizontal centre of the punched circle. */
  public readonly circleX = computed(() => this.size() / 2);

  /** Vertical centre of the punched circle. */
  public readonly circleY = computed(() => this.size() / 2);
}
