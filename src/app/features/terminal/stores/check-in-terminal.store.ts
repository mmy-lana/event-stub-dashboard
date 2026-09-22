/**
 * Kiosk check-in state machine.
 *
 * Owns the door workflow: scan (camera, hardware scanner or manual pad) → resolve
 * the pass from the local roster cache first (so the kiosk keeps admitting people
 * offline) → verify the token digest → admit optimistically, play the audio cue and
 * queue the durable mutation in the outbox.
 */

import { Injectable, computed, inject, signal } from '@angular/core';

import { AudioFeedbackService } from '../../../core/audio/audio-feedback.service';
import { FirestoreOfflineService } from '../../../core/firebase/firestore-offline.service';
import type { AttendeeTicket, ScanMethod } from '../../../core/models/ticket.model';
import { EventDataStore } from '../../../core/state/event-data.store';
import { OfflineMutationService } from '../../../core/sync/offline-mutation.service';
import { TicketSecurityUtility } from '../../../shared/utils/ticket-cryptography';

/** Outcome of the last scan. */
export type VerificationState =
  | 'idle'
  | 'validating'
  | 'success'
  | 'already_checked_in'
  | 'not_found'
  | 'cancelled'
  | 'tampered';

/** One entry in the terminal's activity feed. */
export interface ScanActivityEntry {
  readonly id: string;
  readonly scannedAt: string;
  readonly outcome: VerificationState;
  readonly attendeeName: string | null;
  readonly stubNumber: string;
  readonly tierName: string | null;
  readonly queuedOffline: boolean;
}

/** Aggregate counters shown on the kiosk header. */
export interface TerminalCounters {
  readonly scans: number;
  readonly admitted: number;
  readonly duplicates: number;
  readonly rejected: number;
}

/** Injectable kiosk scan state machine. */
@Injectable({ providedIn: 'root' })
export class CheckInTerminalStore {
  private readonly data = inject(EventDataStore);
  private readonly outbox = inject(OfflineMutationService);
  private readonly audio = inject(AudioFeedbackService);
  private readonly transport = inject(FirestoreOfflineService);

  private readonly scannedCodeSignal = signal<string>('');
  private readonly verificationStateSignal = signal<VerificationState>('idle');
  private readonly lastScannedTicketSignal = signal<AttendeeTicket | null>(null);
  private readonly activitySignal = signal<readonly ScanActivityEntry[]>([]);
  private readonly countersSignal = signal<TerminalCounters>({
    scans: 0,
    admitted: 0,
    duplicates: 0,
    rejected: 0
  });
  private readonly lastMessageSignal = signal<string>('Awaiting the first pass.');
  private readonly isProcessingSignal = signal<boolean>(false);

  /** Raw payload of the last scan. */
  public readonly scannedCode = this.scannedCodeSignal.asReadonly();

  /** Current verification state. */
  public readonly verificationState = this.verificationStateSignal.asReadonly();

  /** Attendee resolved by the last scan. */
  public readonly lastScannedTicket = this.lastScannedTicketSignal.asReadonly();

  /** Newest-first activity feed, capped at 25 entries. */
  public readonly activity = this.activitySignal.asReadonly();

  /** Session counters. */
  public readonly counters = this.countersSignal.asReadonly();

  /** Operator-facing status line. */
  public readonly lastMessage = this.lastMessageSignal.asReadonly();

  /** `true` while a scan is being resolved. */
  public readonly isProcessing = this.isProcessingSignal.asReadonly();

  /** `true` when the kiosk is admitting without a backend connection. */
  public readonly isOperatingOffline = computed(
    () => !this.outbox.isOnline() || !this.transport.isHealthy()
  );

  /** Attendees currently on site, derived from the live roster. */
  public readonly onSiteCount = computed(
    () =>
      this.data.attendees().filter((attendee) => attendee.checkInStatus === 'checked_in').length
  );

  /** Whether audio feedback is muted. */
  public readonly isMuted = this.audio.isMuted;

  /** `true` when the runtime exposes the Web Audio API. */
  public readonly isAudioSupported = this.audio.isSupported;

  /** Unlocks audio output; call from the first operator gesture. */
  public unlockAudio(): void {
    this.audio.unlock();
  }

  /** Toggles terminal audio feedback. */
  public toggleMute(): boolean {
    return this.audio.toggleMuted();
  }

  /**
   * Processes a scanner payload.
   *
   * Accepts a full `TICKET_ID::STUB::HASH` token, a bare stub number or a Code 128
   * barcode value; the stub reference is extracted in every case.
   *
   * @param rawPayload Raw scanner or keypad input.
   * @param scanMethod How the payload was captured.
   * @returns The resulting verification state.
   */
  public async submitScan(
    rawPayload: string,
    scanMethod: ScanMethod = 'camera_qr'
  ): Promise<VerificationState> {
    const raw = rawPayload.trim();
    if (raw.length === 0 || this.isProcessingSignal()) {
      return this.verificationStateSignal();
    }

    this.isProcessingSignal.set(true);
    this.scannedCodeSignal.set(raw);
    this.verificationStateSignal.set('validating');

    try {
      const attendee = this.resolveAttendee(raw);

      if (attendee === null) {
        return this.reject('not_found', raw, 'Pass not recognised. Check the stub number.', null);
      }

      const eventId = this.data.activeEventId();
      const token = TicketSecurityUtility.parseToken(raw);
      if (token !== null && eventId !== null) {
        const verified = TicketSecurityUtility.verifyPayload(token, eventId);
        if (!verified) {
          return this.reject(
            'tampered',
            raw,
            'Verification hash does not match this event. Do not admit.',
            attendee
          );
        }
      }

      if (attendee.checkInStatus === 'cancelled') {
        return this.reject('cancelled', raw, 'Ticket was cancelled or refunded.', attendee);
      }

      if (attendee.checkInStatus === 'checked_in') {
        this.lastScannedTicketSignal.set(attendee);
        this.verificationStateSignal.set('already_checked_in');
        this.audio.playCue('duplicate');
        this.countersSignal.update((counters) => ({
          ...counters,
          scans: counters.scans + 1,
          duplicates: counters.duplicates + 1
        }));
        this.pushActivity(attendee, 'already_checked_in', false);
        this.lastMessageSignal.set(
          `${attendee.firstName} ${attendee.lastName} was already admitted.`
        );
        return 'already_checked_in';
      }

      return await this.admit(attendee, scanMethod);
    } finally {
      this.isProcessingSignal.set(false);
    }
  }

  /** Clears the current result and returns the terminal to its idle state. */
  public reset(): void {
    this.verificationStateSignal.set('idle');
    this.scannedCodeSignal.set('');
    this.lastScannedTicketSignal.set(null);
    this.lastMessageSignal.set('Awaiting the next pass.');
  }

  /** Empties the session activity feed and counters. */
  public resetSession(): void {
    this.activitySignal.set([]);
    this.countersSignal.set({ scans: 0, admitted: 0, duplicates: 0, rejected: 0 });
    this.reset();
  }

  /**
   * Admits a resolved attendee: optimistic local state, audio cue, outbox write.
   *
   * @returns `'success'` when the admission was applied.
   */
  private async admit(attendee: AttendeeTicket, scanMethod: ScanMethod): Promise<VerificationState> {
    const wasOffline = this.isOperatingOffline();

    const applied = await this.data.admitAttendee(
      attendee,
      'kiosk_door_b',
      scanMethod
    );

    if (!applied) {
      return this.reject('not_found', attendee.ticketStubNumber, 'Admission could not be applied.', attendee);
    }

    this.lastScannedTicketSignal.set(attendee);
    this.verificationStateSignal.set('success');
    this.audio.playCue('success');
    this.countersSignal.update((counters) => ({
      ...counters,
      scans: counters.scans + 1,
      admitted: counters.admitted + 1
    }));
    this.pushActivity(attendee, 'success', wasOffline);
    this.lastMessageSignal.set(
      wasOffline
        ? `${attendee.firstName} ${attendee.lastName} admitted offline and queued for sync.`
        : `${attendee.firstName} ${attendee.lastName} admitted.`
    );

    return 'success';
  }

  /** Records a rejection: buzzer, counters, feed and status line. */
  private reject(
    state: VerificationState,
    stubNumber: string,
    message: string,
    attendee: AttendeeTicket | null
  ): VerificationState {
    this.lastScannedTicketSignal.set(attendee);
    this.verificationStateSignal.set(state);
    this.audio.playCue('error');
    this.countersSignal.update((counters) => ({
      ...counters,
      scans: counters.scans + 1,
      rejected: counters.rejected + 1
    }));
    this.pushActivity(attendee, state, false, stubNumber);
    this.lastMessageSignal.set(message);
    return state;
  }

  /**
   * Resolves a scan against the live roster cache.
   *
   * The cache is the kiosk's offline safety net: it is populated by the Firestore
   * snapshot listener that also serves the dashboard, so a pass issued before the
   * connection dropped still admits without a network round trip.
   */
  private resolveAttendee(raw: string): AttendeeTicket | null {
    const attendees = this.data.attendees();
    const token = TicketSecurityUtility.parseToken(raw);

    if (token !== null) {
      const byId = attendees.find((attendee) => attendee.id === token.ticketId);
      if (byId !== undefined) {
        return byId;
      }
      const byStub = attendees.find(
        (attendee) => attendee.ticketStubNumber === token.stubNumber
      );
      return byStub ?? null;
    }

    const stub = TicketSecurityUtility.extractStubNumber(raw) ?? TicketSecurityUtility.sanitizeScanInput(raw);
    return attendees.find((attendee) => attendee.ticketStubNumber === stub) ?? null;
  }

  /** Prepends an entry to the activity feed, keeping the newest 25. */
  private pushActivity(
    attendee: AttendeeTicket | null,
    outcome: VerificationState,
    queuedOffline: boolean,
    stubOverride?: string
  ): void {
    const entry: ScanActivityEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      scannedAt: new Date().toISOString(),
      outcome,
      attendeeName:
        attendee === null ? null : `${attendee.firstName} ${attendee.lastName}`.trim(),
      stubNumber: stubOverride ?? attendee?.ticketStubNumber ?? '—',
      tierName: attendee?.ticketTierName ?? null,
      queuedOffline
    };

    this.activitySignal.update((entries) => [entry, ...entries].slice(0, 25));
  }
}
