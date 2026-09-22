import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';

import { ButtonComponent } from '../../shared/ui/button/button.component';

/** Camera lifecycle state. */
export type ScannerState = 'idle' | 'starting' | 'streaming' | 'denied' | 'unsupported' | 'error';

/** Minimal structural type for the native BarcodeDetector API. */
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<readonly { rawValue: string }[]>;
}

/** Constructor signature of the native BarcodeDetector. */
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike;

/** Detection cadence in milliseconds. */
const DETECTION_INTERVAL_MS = 260;

/** Minimum gap between two accepted detections of the same payload. */
const DUPLICATE_SUPPRESSION_MS = 2500;

/**
 * Camera scanner overlay.
 *
 * Streams the rear camera with `getUserMedia`, decodes QR and Code 128 symbols
 * through the native `BarcodeDetector` when the runtime provides it, and reports
 * every detection through {@link detected}. Permission, hardware and API support
 * failures each get an explicit, actionable state instead of a silent black box,
 * and the stream is always released on destroy.
 */
@Component({
  selector: 'app-camera-scanner-modal',
  standalone: true,
  imports: [ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="scanner" aria-label="Camera pass scanner">
      <div class="viewport" [class.flash]="flash()">
        <video #videoElement class="stream" playsinline muted [class.hidden]="state() !== 'streaming'"></video>

        @switch (state()) {
          @case ('streaming') {
            <div class="reticle" aria-hidden="true">
              <span class="bracket top-left"></span>
              <span class="bracket top-right"></span>
              <span class="bracket bottom-left"></span>
              <span class="bracket bottom-right"></span>
              <span class="laser"></span>
            </div>
            <p class="viewport-hint">Align the QR code or barcode inside the frame</p>
          }

          @case ('starting') {
            <div class="placeholder">
              <span class="big-spinner" aria-hidden="true"></span>
              <p class="placeholder-title">Starting camera…</p>
              <p class="placeholder-body">Grant camera access when your browser asks.</p>
            </div>
          }

          @case ('denied') {
            <div class="placeholder" role="alert">
              <svg class="placeholder-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
              <p class="placeholder-title">Camera permission denied</p>
              <p class="placeholder-body">
                Allow camera access for this site in your browser settings, then start the scanner
                again. You can still admit attendees with the manual entry pad.
              </p>
              <app-button variant="outline" (pressed)="start()">Try again</app-button>
            </div>
          }

          @case ('unsupported') {
            <div class="placeholder" role="alert">
              <svg class="placeholder-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <line x1="6" y1="8" x2="6" y2="8" />
                <line x1="10" y1="8" x2="10" y2="8" />
                <line x1="14" y1="8" x2="14" y2="8" />
                <line x1="18" y1="8" x2="18" y2="8" />
                <line x1="6" y1="12" x2="18" y2="12" />
              </svg>
              <p class="placeholder-title">Camera not available</p>
              <p class="placeholder-body">
                {{ unsupportedReason() }} Use a hardware barcode scanner or the manual entry pad
                instead.
              </p>
            </div>
          }

          @case ('error') {
            <div class="placeholder" role="alert">
              <svg class="placeholder-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <p class="placeholder-title">Scanner error</p>
              <p class="placeholder-body">{{ errorDetail() }}</p>
              <app-button variant="outline" (pressed)="start()">Retry</app-button>
            </div>
          }

          @default {
            <div class="placeholder">
              <svg class="placeholder-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <p class="placeholder-title">Camera is inactive</p>
              <p class="placeholder-body">
                Start the scanner to admit attendees by scanning their tear-off pass.
              </p>
              <app-button (pressed)="start()">Initialize camera scanner</app-button>
            </div>
          }
        }
      </div>

      <footer class="scanner-controls">
        @if (state() === 'streaming') {
          <app-button variant="outline" (pressed)="stop()">Stop camera</app-button>
        } @else {
          <app-button variant="coral" [loading]="state() === 'starting'" (pressed)="start()">
            {{ state() === 'idle' ? 'Start camera' : 'Restart camera' }}
          </app-button>
        }
        <span class="detection-count" role="status">
          {{ detectionCount() }} {{ detectionCount() === 1 ? 'pass read' : 'passes read' }}
        </span>
      </footer>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .scanner {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .viewport {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        aspect-ratio: 4 / 3;
        width: 100%;
        overflow: hidden;
        background: var(--color-charcoal);
        border-radius: var(--radius-lg);
        transition: box-shadow var(--transition-fast);
      }

      .viewport.flash {
        box-shadow: inset 0 0 0 6px var(--color-emerald);
      }

      .stream {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .stream.hidden {
        display: none;
      }

      .reticle {
        position: relative;
        width: min(72%, 320px);
        aspect-ratio: 1;
      }

      .bracket {
        position: absolute;
        width: 34px;
        height: 34px;
        border: 4px solid var(--color-coral);
      }

      .top-left {
        top: 0;
        left: 0;
        border-right: none;
        border-bottom: none;
        border-top-left-radius: 8px;
      }

      .top-right {
        top: 0;
        right: 0;
        border-left: none;
        border-bottom: none;
        border-top-right-radius: 8px;
      }

      .bottom-left {
        bottom: 0;
        left: 0;
        border-right: none;
        border-top: none;
        border-bottom-left-radius: 8px;
      }

      .bottom-right {
        bottom: 0;
        right: 0;
        border-left: none;
        border-top: none;
        border-bottom-right-radius: 8px;
      }

      .laser {
        position: absolute;
        left: 4%;
        right: 4%;
        top: 50%;
        height: 2px;
        background: linear-gradient(90deg, transparent, var(--color-coral), transparent);
        animation: laser-sweep 2.4s ease-in-out infinite;
      }

      @keyframes laser-sweep {
        0%,
        100% {
          transform: translateY(-46px);
          opacity: 0.35;
        }
        50% {
          transform: translateY(46px);
          opacity: 1;
        }
      }

      .viewport-hint {
        position: absolute;
        bottom: 10px;
        left: 0;
        right: 0;
        text-align: center;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.4px;
        color: rgba(255, 255, 255, 0.86);
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
      }

      .placeholder {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 20px;
        text-align: center;
        color: #ffffff;
      }

      .placeholder-svg {
        width: 32px;
        height: 32px;
      }

      .placeholder-title {
        font-size: 15px;
        font-weight: 800;
      }

      .placeholder-body {
        max-width: 320px;
        font-size: 12px;
        line-height: 1.5;
        color: rgba(255, 255, 255, 0.78);
      }

      .big-spinner {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: 3px solid rgba(255, 255, 255, 0.3);
        border-top-color: #ffffff;
        animation: scanner-spin 800ms linear infinite;
      }

      @keyframes scanner-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .scanner-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .detection-count {
        font-size: 12px;
        font-weight: 700;
        color: var(--color-slate-500);
      }

      @media (prefers-reduced-motion: reduce) {
        .laser {
          animation: none;
          top: 50%;
        }
      }
    `
  ]
})
export class CameraScannerModalComponent {
  private readonly destroyRef = inject(DestroyRef);

  /** Emitted with the decoded payload of every accepted detection. */
  public readonly detected = output<string>();

  /** Emitted when the camera cannot be used, with a human readable reason. */
  public readonly failed = output<string>();

  /** Starts the stream automatically when the component is created. */
  public readonly autoStart = input<boolean>(false);

  /** Camera facing mode requested from `getUserMedia`. */
  public readonly facingMode = input<'environment' | 'user'>('environment');

  private readonly stateSignal = signal<ScannerState>('idle');
  private readonly flashSignal = signal<boolean>(false);
  private readonly errorDetailSignal = signal<string>('');
  private readonly detectionCountSignal = signal<number>(0);

  /** Current camera lifecycle state. */
  public readonly state = this.stateSignal.asReadonly();

  /** `true` for a moment after a successful detection, driving the visual flash. */
  public readonly flash = this.flashSignal.asReadonly();

  /** Detail message for the error state. */
  public readonly errorDetail = this.errorDetailSignal.asReadonly();

  /** Number of accepted detections in this session. */
  public readonly detectionCount = this.detectionCountSignal.asReadonly();

  /** Reason shown when the runtime cannot scan at all. */
  public readonly unsupportedReason = computed(() => {
    if (typeof navigator === 'undefined' || navigator.mediaDevices === undefined) {
      return 'This browser does not expose camera access (a secure context is required).';
    }
    return 'This browser cannot decode QR or barcode symbols natively.';
  });

  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('videoElement');

  private stream: MediaStream | null = null;
  private detectionTimer: ReturnType<typeof setInterval> | null = null;
  private detector: BarcodeDetectorLike | null = null;
  private lastPayload = '';
  private lastPayloadAt = 0;

  public constructor() {
    this.destroyRef.onDestroy(() => this.stop());

    // `afterNextRender` guarantees the view (and therefore the <video> element)
    // exists before the stream is requested.
    afterNextRender(() => {
      if (this.autoStart()) {
        void this.start();
      }
    });
  }

  /**
   * Requests the camera stream and begins decoding frames.
   *
   * @returns The resulting scanner state.
   */
  public async start(): Promise<ScannerState> {
    if (this.stateSignal() === 'starting' || this.stateSignal() === 'streaming') {
      return this.stateSignal();
    }

    const video = this.resolveVideoElement();
    if (video === null) {
      this.errorDetailSignal.set('Video element is not ready yet. Try again in a moment.');
      this.stateSignal.set('error');
      this.failed.emit('Video element unavailable');
      return 'error';
    }

    if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
      this.stateSignal.set('unsupported');
      this.failed.emit(this.unsupportedReason());
      return 'unsupported';
    }

    this.stateSignal.set('starting');
    this.errorDetailSignal.set('');

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.facingMode() },
        audio: false
      });
      video.srcObject = this.stream;
      await video.play();
      this.stateSignal.set('streaming');
      this.startDetectionLoop();
      return 'streaming';
    } catch (error: unknown) {
      const detail = describeMediaError(error);
      this.stateSignal.set(detail.state);
      this.errorDetailSignal.set(detail.message);
      this.failed.emit(detail.message);
      return detail.state;
    }
  }

  /** Stops the stream, releases the camera and clears the decode loop. */
  public stop(): void {
    if (this.detectionTimer !== null) {
      clearInterval(this.detectionTimer);
      this.detectionTimer = null;
    }

    if (this.stream !== null) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }

    const video = this.resolveVideoElement();
    if (video !== null) {
      video.srcObject = null;
    }

    if (this.stateSignal() === 'streaming' || this.stateSignal() === 'starting') {
      this.stateSignal.set('idle');
    }
  }

  /** Toggles between streaming and idle. */
  public async toggle(): Promise<ScannerState> {
    if (this.stateSignal() === 'streaming') {
      this.stop();
      return 'idle';
    }
    return this.start();
  }

  /** Resolves the video element from the component's view. */
  private resolveVideoElement(): HTMLVideoElement | null {
    return this.videoRef()?.nativeElement ?? null;
  }

  /** Starts the frame decode loop, or reports that native decoding is unavailable. */
  private startDetectionLoop(): void {
    const detectorConstructor = (
      window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }
    ).BarcodeDetector;

    if (detectorConstructor === undefined) {
      this.stateSignal.set('unsupported');
      this.failed.emit(this.unsupportedReason());
      this.stop();
      return;
    }

    this.detector = new detectorConstructor({ formats: ['qr_code', 'code_128'] });

    this.detectionTimer = setInterval(() => {
      void this.detectFrame();
    }, DETECTION_INTERVAL_MS);
  }

  /** Decodes the current frame and emits a payload when one is found. */
  private async detectFrame(): Promise<void> {
    const video = this.resolveVideoElement();
    const detector = this.detector;

    if (video === null || detector === null || video.readyState < 2) {
      return;
    }

    try {
      const results = await detector.detect(video);
      const payload = results[0]?.rawValue?.trim();
      if (payload === undefined || payload.length === 0) {
        return;
      }

      const now = Date.now();
      if (payload === this.lastPayload && now - this.lastPayloadAt < DUPLICATE_SUPPRESSION_MS) {
        return;
      }

      this.lastPayload = payload;
      this.lastPayloadAt = now;
      this.detectionCountSignal.update((count) => count + 1);
      this.flashSignal.set(true);
      setTimeout(() => this.flashSignal.set(false), 320);
      this.detected.emit(payload);
    } catch {
      // A single unreadable frame is expected while the camera refocuses.
    }
  }
}

/** Maps a `getUserMedia` rejection onto a scanner state and operator message. */
function describeMediaError(error: unknown): { state: ScannerState; message: string } {
  const name = error instanceof Error ? error.name : '';

  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      state: 'denied',
      message: 'Camera permission was denied.'
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return {
      state: 'unsupported',
      message: 'No camera matching the requested facing mode was found.'
    };
  }
  if (name === 'NotSupportedError' || name === 'TypeError') {
    return {
      state: 'unsupported',
      message: 'This device or browser cannot provide a camera stream.'
    };
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return {
      state: 'error',
      message: 'The camera is already in use by another application.'
    };
  }

  return {
    state: 'error',
    message: error instanceof Error ? error.message : 'The camera could not be started.'
  };
}
