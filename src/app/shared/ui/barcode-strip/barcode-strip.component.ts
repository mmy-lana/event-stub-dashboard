import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { encodeCode128, type Code128Symbol } from '../../utils/code128-encoder';

/**
 * Scannable Code 128 barcode strip.
 *
 * The bars come from the in-house ISO/IEC 15417 encoder (Code Set B, mod-103
 * check symbol), so printed passes read on hardware laser scanners. Rendered as
 * SVG rects sized in modules, which stays crisp at any width and prints cleanly.
 */
@Component({
  selector: 'app-barcode-strip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (symbol(); as encoded) {
      <div class="barcode-container" [style.height.px]="height()">
        <svg
          class="barcode-svg"
          [attr.viewBox]="viewBox(encoded)"
          preserveAspectRatio="none"
          role="img"
          [attr.aria-label]="ariaLabelText()">
          @for (bar of bars(); track bar.x) {
            @if (bar.filled) {
              <rect
                [attr.x]="bar.x"
                y="0"
                [attr.width]="bar.width"
                [attr.height]="barHeight()"
                [attr.fill]="barColor()" />
            }
          }
        </svg>

        @if (showCode()) {
          <span class="barcode-text">{{ encoded.value }}</span>
        }
      </div>
    } @else {
      <p class="barcode-error" role="status">{{ errorMessage() }}</p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }

      .barcode-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        padding: 6px 8px 4px 8px;
        background: var(--color-surface);
        border-radius: var(--radius-sm);
        box-sizing: border-box;
      }

      .barcode-svg {
        display: block;
        width: 100%;
        flex: 1 1 auto;
        min-height: 0;
      }

      .barcode-text {
        margin-top: 4px;
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 2px;
        color: var(--color-slate-600);
        text-align: center;
        word-break: break-all;
      }

      .barcode-error {
        margin: 0;
        padding: 8px;
        border-radius: var(--radius-sm);
        background: var(--color-danger-soft);
        color: var(--color-danger);
        font-size: 11px;
        font-weight: 700;
        text-align: center;
      }
    `
  ]
})
export class BarcodeStripComponent {
  /** Barcode payload (printable ASCII, e.g. `EVT-8924-XQ9-SEC4-DOOR`). */
  public readonly code = input.required<string>();

  /** Rendered height of the bar area in CSS pixels. */
  public readonly height = input<number>(44);

  /** Renders the human readable payload under the bars. */
  public readonly showCode = input<boolean>(true);

  /** Bar colour. */
  public readonly barColor = input<string>('#1e222b');

  /** Overrides the generated accessible name. */
  public readonly ariaLabel = input<string | null>(null);

  /** Encoded symbol, or `null` when the payload is not representable. */
  public readonly symbol = computed<Code128Symbol | null>(() => {
    try {
      return encodeCode128(this.code());
    } catch {
      return null;
    }
  });

  /**
   * Draw-ready bars with their module offsets resolved once per payload change,
   * so rendering stays linear in the number of bars.
   */
  public readonly bars = computed<readonly DrawableBar[]>(() => {
    const encoded = this.symbol();
    if (encoded === null) {
      return [];
    }

    let x = 0;
    return encoded.bars.map((bar) => {
      const drawable: DrawableBar = { x, width: bar.width, filled: bar.filled };
      x += bar.width;
      return drawable;
    });
  });

  /** Error text shown when the payload cannot be encoded. */
  public readonly errorMessage = computed(() =>
    this.symbol() === null
      ? 'Barcode value contains characters that Code 128 cannot represent.'
      : ''
  );

  /** Accessible name describing the encoded payload. */
  public readonly ariaLabelText = computed(
    () => this.ariaLabel() ?? `Barcode for ${this.code()}`
  );

  /** Bar area height inside the SVG viewBox (the human readable line sits below). */
  public readonly barHeight = computed(() => 100);

  /** ViewBox covering the full symbol width in modules. */
  public viewBox(encoded: Code128Symbol): string {
    return `0 0 ${encoded.moduleCount} 100`;
  }
}

/** A bar with its horizontal module offset precomputed for rendering. */
interface DrawableBar {
  readonly x: number;
  readonly width: number;
  readonly filled: boolean;
}
