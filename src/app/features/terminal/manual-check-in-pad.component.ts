import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { VALIDATION_RULES } from '../../core/models/ticket.model';
import { ButtonComponent } from '../../shared/ui/button/button.component';

/**
 * Manual stub-number entry pad.
 *
 * Keyboard-first fallback for the kiosk: operators type the printed stub
 * reference when a pass is damaged, the camera is unavailable or a hardware
 * scanner is not attached. The input is normalized as it is typed, validated
 * against the printed format and submitted with Enter, so a door queue keeps
 * moving without a mouse.
 */
@Component({
  selector: 'app-manual-check-in-pad',
  standalone: true,
  imports: [ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="pad" (submit)="onSubmit($event)">
      <label class="pad-label" for="stub-entry">MANUAL STUB ENTRY</label>

      <div class="pad-row">
        <input
          id="stub-entry"
          #stubInput
          class="pad-input font-mono"
          type="text"
          name="stubNumber"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          [value]="draft()"
          [attr.aria-invalid]="hasError() ? 'true' : null"
          [attr.aria-describedby]="hasError() ? 'stub-entry-error' : 'stub-entry-hint'"
          [placeholder]="placeholder()"
          [disabled]="busy()"
          (input)="onInput($event)"
          (keydown.escape)="clear()" />

        <app-button
          type="submit"
          variant="coral"
          [loading]="busy()"
          [disabled]="!canSubmit()"
          ariaLabel="Verify stub number">
          VERIFY
        </app-button>
      </div>

      @if (hasError()) {
        <p id="stub-entry-error" class="pad-error" role="alert">{{ errorMessage() }}</p>
      } @else {
        <p id="stub-entry-hint" class="pad-hint">{{ hint() }}</p>
      }

      @if (recentCodes().length > 0) {
        <div class="pad-recent">
          <span class="pad-recent-label">RECENT</span>
          @for (code of recentCodes(); track code) {
            <button type="button" class="pad-chip font-mono" (click)="useRecent(code)">
              {{ code }}
            </button>
          }
        </div>
      }
    </form>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .pad {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 14px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
      }

      .pad-label {
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 1px;
        color: var(--color-muted-soft);
      }

      .pad-row {
        display: flex;
        gap: 8px;
        align-items: stretch;
      }

      .pad-input {
        flex: 1 1 auto;
        min-width: 0;
        min-height: var(--touch-target-min);
        padding: 10px 12px;
        border: 1px solid var(--color-border-strong);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        font-size: 15px;
        font-weight: 700;
        letter-spacing: 2px;
        text-transform: uppercase;
      }

      .pad-input[aria-invalid='true'] {
        border-color: var(--color-danger);
        background: var(--color-danger-soft);
      }

      .pad-input:disabled {
        opacity: 0.6;
      }

      .font-mono {
        font-family: var(--font-mono);
      }

      .pad-hint {
        font-size: 11px;
        color: var(--color-slate-500);
      }

      .pad-error {
        font-size: 11px;
        font-weight: 700;
        color: var(--color-danger);
      }

      .pad-recent {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-top: 2px;
      }

      .pad-recent-label {
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.8px;
        color: var(--color-muted-soft);
      }

      .pad-chip {
        min-height: 32px;
        padding: 4px 10px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-pill);
        background: var(--color-canvas);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1px;
        color: var(--color-slate-600);
      }

      @media (max-width: 430px) {
        .pad-row {
          flex-direction: column;
        }
      }
    `
  ]
})
export class ManualCheckInPadComponent {
  /** Emitted with the validated stub number. */
  public readonly submitted = output<string>();

  /** Placeholder shown inside the input. */
  public readonly placeholder = input<string>('EVT-8924-XQ9');

  /** `true` while the parent is resolving a scan. */
  public readonly busy = input<boolean>(false);

  /** Recently submitted codes offered as one-tap chips. */
  public readonly recentCodes = input<readonly string[]>([]);

  /** Current normalized draft. */
  public readonly draft = signal<string>('');

  /** Whether the current draft is a well-formed stub number. */
  public readonly isValid = computed(() => {
    const value = this.draft();
    return value.length === 0 || VALIDATION_RULES.TICKET_STUB_REGEX.test(value);
  });

  /** Whether a validation error should be shown. */
  public readonly hasError = computed(() => this.draft().length > 0 && !this.isValid());

  /** Validation message. */
  public readonly errorMessage = computed(() =>
    this.isValid()
      ? ''
      : 'Stub numbers look like EVT-8924-XQ9 (three letters, four digits, three characters).'
  );

  /** Hint describing the accepted input. */
  public readonly hint = computed(() =>
    'Type the stub reference printed under the barcode and press Enter.'
  );

  /** Whether the form can be submitted. */
  public readonly canSubmit = computed(() => this.isValid() && this.draft().length > 0 && !this.busy());

  /** Normalizes the draft as the operator types. */
  public onInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const normalized = raw.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 14);
    this.draft.set(normalized);
  }

  /** Submits the validated code. */
  public onSubmit(event: Event): void {
    event.preventDefault();
    if (!this.canSubmit()) {
      return;
    }
    const code = this.draft();
    this.submitted.emit(code);
    this.draft.set('');
  }

  /** Fills the input from a recent-code chip. */
  public useRecent(code: string): void {
    this.draft.set(code);
  }

  /** Clears the draft. */
  public clear(): void {
    this.draft.set('');
  }
}
