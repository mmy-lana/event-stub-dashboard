/**
 * Web Audio API feedback synthesizer for the check-in terminal.
 *
 * Zero audio assets are downloaded: every cue is synthesized in memory from
 * oscillator nodes so acoustic confirmation works on a fully offline kiosk.
 *
 * Cues:
 * - `success`  – rising D5 + A5 sine chord, played on a successful admission.
 * - `duplicate`– single mid-register A4 blip, played when a pass was already used.
 * - `error`    – dissonant D3 + C#3 sawtooth pair, played on invalid scans.
 */

import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Available synthesized cues. */
export type AudioCueKind = 'success' | 'duplicate' | 'error';

/** Frequency table (Hz) for the fixed musical cues. */
const FREQUENCIES = {
  D3: 146.83,
  C_SHARP_3: 138.59,
  A4: 440.0,
  D5: 587.33,
  A5: 880.0
} as const;

/** Default output gain applied to every cue (0..1). */
const DEFAULT_MASTER_VOLUME = 0.6;

/** Injectable synthesizer; one instance per injector, safe to call from stores. */
@Injectable({ providedIn: 'root' })
export class AudioFeedbackService {
  private readonly destroyRef = inject(DestroyRef);

  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  private readonly mutedSignal = signal<boolean>(false);
  private readonly supportedSignal = signal<boolean>(isAudioContextSupported());

  /** `true` when the operator silenced terminal audio. */
  public readonly isMuted = this.mutedSignal.asReadonly();

  /** `true` when the runtime exposes the Web Audio API. */
  public readonly isSupported = this.supportedSignal.asReadonly();

  public constructor() {
    this.destroyRef.onDestroy(() => {
      void this.dispose();
    });
  }

  /**
   * Creates (or resumes) the shared `AudioContext`.
   *
   * Browsers start audio contexts in a `suspended` state until a user gesture
   * occurs; the kiosk calls this from the first tap so later automatic cues are
   * never swallowed.
   *
   * @returns The live context, or `null` when the API is unavailable.
   */
  public unlock(): AudioContext | null {
    if (!this.supportedSignal()) {
      return null;
    }

    if (this.audioContext === null) {
      const context = createAudioContext();
      if (context === null) {
        this.supportedSignal.set(false);
        return null;
      }
      this.audioContext = context;
      this.masterGain = context.createGain();
      this.masterGain.gain.value = DEFAULT_MASTER_VOLUME;
      this.masterGain.connect(context.destination);
    }

    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume().catch(() => {
        /* Autoplay policy still blocking; the next explicit gesture retries. */
      });
    }

    return this.audioContext;
  }

  /** Mutes or unmutes every cue. */
  public setMuted(muted: boolean): void {
    this.mutedSignal.set(muted);
  }

  /** Toggles mute state and returns the new value. */
  public toggleMuted(): boolean {
    const next = !this.mutedSignal();
    this.mutedSignal.set(next);
    return next;
  }

  /**
   * Plays the high-register chime chord (D5 + A5) used for successful
   * verification.
   */
  public playSuccessChime(): void {
    const context = this.prepareOutput();
    if (context === null) {
      return;
    }

    const startAt = context.currentTime;
    [FREQUENCIES.D5, FREQUENCIES.A5].forEach((frequency, index) => {
      const offset = index * 0.04;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startAt + offset);

      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(0.2, startAt + 0.02 + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.35 + offset);

      oscillator.connect(gain);
      gain.connect(this.masterGain ?? context.destination);

      oscillator.start(startAt + offset);
      oscillator.stop(startAt + 0.4 + offset);
    });
  }

  /**
   * Plays the dual low-register sawtooth tone for duplicates or invalid passes.
   */
  public playErrorBuzzer(): void {
    const context = this.prepareOutput();
    if (context === null) {
      return;
    }

    const startAt = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.25, startAt);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.45);
    gain.connect(this.masterGain ?? context.destination);

    [FREQUENCIES.D3, FREQUENCIES.C_SHARP_3].forEach((frequency) => {
      const oscillator = context.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(frequency, startAt);
      oscillator.connect(gain);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.5);
    });
  }

  /**
   * Plays a short mid-register blip for "already checked in" (a warning rather
   * than a hard failure).
   */
  public playDuplicateBlip(): void {
    const context = this.prepareOutput();
    if (context === null) {
      return;
    }

    const startAt = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(FREQUENCIES.A4, startAt);
    oscillator.frequency.setValueAtTime(FREQUENCIES.A4 * 0.75, startAt + 0.12);

    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(0.18, startAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.28);

    oscillator.connect(gain);
    gain.connect(this.masterGain ?? context.destination);

    oscillator.start(startAt);
    oscillator.stop(startAt + 0.3);
  }

  /**
   * Dispatches the cue matching an admission outcome.
   *
   * @param kind Which cue to play.
   */
  public playCue(kind: AudioCueKind): void {
    switch (kind) {
      case 'success':
        this.playSuccessChime();
        return;
      case 'duplicate':
        this.playDuplicateBlip();
        return;
      case 'error':
        this.playErrorBuzzer();
        return;
    }
  }

  /** Releases the audio hardware. */
  public async dispose(): Promise<void> {
    const context = this.audioContext;
    this.audioContext = null;
    this.masterGain = null;

    if (context !== null && context.state !== 'closed') {
      await context.close().catch(() => {
        /* Context already closing; nothing actionable. */
      });
    }
  }

  /** Resolves a usable context unless muted or unsupported. */
  private prepareOutput(): AudioContext | null {
    if (this.mutedSignal()) {
      return null;
    }
    return this.unlock();
  }
}

/** Feature-detects the Web Audio API including the legacy WebKit prefix. */
function isAudioContextSupported(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const candidate = window as Window & { webkitAudioContext?: typeof AudioContext };
  return typeof window.AudioContext === 'function' || typeof candidate.webkitAudioContext === 'function';
}

/** Instantiates an `AudioContext` across modern and legacy browsers. */
function createAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const candidate = window as Window & { webkitAudioContext?: typeof AudioContext };
  const AudioContextCtor = window.AudioContext ?? candidate.webkitAudioContext;
  if (typeof AudioContextCtor !== 'function') {
    return null;
  }
  return new AudioContextCtor();
}
