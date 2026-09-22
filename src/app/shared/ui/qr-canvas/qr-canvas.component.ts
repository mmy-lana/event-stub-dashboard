import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  viewChild
} from '@angular/core';

import {
  encodeQrMatrix,
  type QrErrorCorrectionLevel,
  type QrMatrix
} from '../../utils/qr-encoder';

/**
 * Canvas renderer for scannable QR symbols.
 *
 * The matrix comes from the in-house ISO/IEC 18004 encoder, so a rendered code is
 * readable by any camera — including the terminal's own scanner — with no runtime
 * dependency. The canvas is redrawn whenever the payload, size, colours, error
 * correction level or quiet zone change, and the component exposes the encoded
 * matrix for callers that need the module data (printing, PDF export, tests).
 */
@Component({
  selector: 'app-qr-canvas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="qr-wrapper">
      <canvas
        #qrCanvas
        class="qr-canvas"
        [style.width.px]="size()"
        [style.height.px]="size()"
        role="img"
        [attr.aria-label]="ariaLabelText()"></canvas>
      @if (caption() !== null) {
        <figcaption class="qr-caption">{{ caption() }}</figcaption>
      }
    </figure>
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }

      .qr-wrapper {
        margin: 0;
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 4px;
        background: var(--qr-light, #ffffff);
        border-radius: var(--radius-sm);
        box-shadow: var(--shadow-card);
      }

      .qr-canvas {
        display: block;
        image-rendering: pixelated;
      }

      .qr-caption {
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 1px;
        color: var(--color-muted);
        text-transform: uppercase;
      }
    `
  ]
})
export class QrCanvasComponent {
  /** Payload to encode (ticket token, URL, stub reference, …). */
  public readonly value = input.required<string>();

  /** Rendered size in CSS pixels (square). */
  public readonly size = input<number>(140);

  /** Dark module colour. */
  public readonly darkColor = input<string>('#1e222b');

  /** Light module colour. */
  public readonly lightColor = input<string>('#ffffff');

  /** Error correction level; `M` balances density and resilience. */
  public readonly errorCorrectionLevel = input<QrErrorCorrectionLevel>('M');

  /** Quiet zone in CSS pixels; the specification requires at least 4 modules. */
  public readonly quietZone = input<number>(6);

  /** Optional caption rendered under the symbol. */
  public readonly caption = input<string | null>(null);

  /** Overrides the generated accessible name. */
  public readonly ariaLabel = input<string | null>(null);

  /** Device-pixel multiplier; 3 keeps modules crisp on phone screens and print. */
  public readonly devicePixelRatio = input<number>(3);

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('qrCanvas');

  /** Backing-store size in device pixels. */
  public readonly pixelSize = computed(() =>
    Math.max(64, Math.round(this.size() * Math.max(1, this.devicePixelRatio())))
  );

  /** Accessible name describing the encoded payload. */
  public readonly ariaLabelText = computed(
    () => this.ariaLabel() ?? `QR code for ${this.value()}`
  );

  /**
   * The encoded symbol, or `null` when the payload cannot be represented.
   *
   * Exposed so printing and export flows can reuse the module data instead of
   * re-encoding.
   */
  public readonly symbol = computed(() => {
    try {
      return encodeQrMatrix(this.value(), { errorCorrectionLevel: this.errorCorrectionLevel() });
    } catch {
      return null;
    }
  });

  /** Human readable error when the payload cannot be encoded. */
  public readonly errorMessage = computed(() =>
    this.symbol() === null ? 'Payload cannot be encoded as a QR symbol.' : null
  );

  /** Most recently painted symbol; `null` when the last render failed. */
  private lastEncoded: QrMatrix | null = null;

  public constructor() {
    effect(() => {
      // Track every input that affects the rendered bitmap.
      const payload = this.value();
      const dark = this.darkColor();
      const light = this.lightColor();
      const level = this.errorCorrectionLevel();
      const pixelSize = this.pixelSize();
      const quietZone = this.quietZone();

      const canvas = this.canvasRef().nativeElement;
      this.render(canvas, payload, dark, light, level, pixelSize, quietZone);
    });
  }

  /** Encodes the payload and paints the matrix into the canvas backing store. */
  private render(
    canvas: HTMLCanvasElement,
    payload: string,
    dark: string,
    light: string,
    level: QrErrorCorrectionLevel,
    pixelSize: number,
    quietZone: number
  ): void {
    // The backing store is sized imperatively rather than through a template
    // binding: assigning `canvas.width`/`height` clears the bitmap, so a binding
    // re-applied after this paint would wipe the symbol. The element's CSS size
    // stays bound to `size()`, keeping the drawn bitmap and its display box
    // independent.
    if (canvas.width !== pixelSize) {
      canvas.width = pixelSize;
    }
    if (canvas.height !== pixelSize) {
      canvas.height = pixelSize;
    }

    const context = canvas.getContext('2d');
    if (context === null) {
      return;
    }

    context.fillStyle = light;
    context.fillRect(0, 0, pixelSize, pixelSize);

    let matrix: QrMatrix;
    try {
      matrix = encodeQrMatrix(payload, { errorCorrectionLevel: level });
    } catch {
      this.lastEncoded = null;
      // Unencodable payloads leave an explicit placeholder rather than a blank box.
      context.fillStyle = dark;
      context.font = `${Math.round(pixelSize / 16)}px ${getComputedStyle(canvas).fontFamily}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('INVALID PAYLOAD', pixelSize / 2, pixelSize / 2);
      return;
    }

    this.lastEncoded = matrix;

    // Modules plus the mandatory quiet zone, scaled to the device pixel grid.
    const totalModules = matrix.size + quietZone * 2;
    const moduleSize = pixelSize / totalModules;
    const offset = quietZone * moduleSize;

    context.fillStyle = dark;
    for (let row = 0; row < matrix.size; row += 1) {
      for (let column = 0; column < matrix.size; column += 1) {
        if (!matrix.modules[row][column]) {
          continue;
        }
        const x = offset + column * moduleSize;
        const y = offset + row * moduleSize;
        // Round outward so neighbouring modules never leave a seam.
        context.fillRect(
          Math.floor(x),
          Math.floor(y),
          Math.ceil(moduleSize),
          Math.ceil(moduleSize)
        );
      }
    }
  }

  /** The symbol painted by the most recent render, or `null` when it failed. */
  public getEncodedMatrix(): QrMatrix | null {
    return this.lastEncoded;
  }
}
