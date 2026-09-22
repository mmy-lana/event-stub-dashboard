/**
 * Connectivity and durability diagnostics for the local Firestore cache.
 *
 * The check-in kiosk runs on venue Wi-Fi that drops regularly, so operators need
 * a truthful answer to "will my scans survive?" at all times. This service owns
 * that answer: browser reachability, emulator health, cache sync heartbeats and
 * the flush/network escape hatches.
 *
 * Mutation queueing itself lives in `OfflineMutationService`; this service is the
 * transport layer that service and the sync indicator report against.
 */

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import {
  clearIndexedDbPersistence,
  disableNetwork,
  enableNetwork,
  onSnapshotsInSync,
  waitForPendingWrites
} from 'firebase/firestore';

import { FIREBASE_CONFIG, FIRESTORE_DB } from './firebase.config';
import { resolveEmulatorOrigin } from './firebase-environment';

/** Outcome of a reachability probe against the Firestore backend. */
export type BackendReachability = 'unknown' | 'checking' | 'reachable' | 'unreachable';

/** Result payload returned by {@link FirestoreOfflineService.probeBackend}. */
export interface BackendProbeResult {
  readonly reachability: BackendReachability;
  readonly checkedAt: string;
  readonly latencyMs: number | null;
  readonly detail: string;
}

/** Default probe budget in milliseconds. */
const DEFAULT_PROBE_TIMEOUT_MS = 2500;

/** Injectable diagnostics facade over the Firestore client. */
@Injectable({ providedIn: 'root' })
export class FirestoreOfflineService {
  private readonly firestore = inject(FIRESTORE_DB);
  private readonly config = inject(FIREBASE_CONFIG);
  private readonly destroyRef = inject(DestroyRef);

  private readonly browserOnlineSignal = signal<boolean>(readBrowserOnlineState());
  private readonly reachabilitySignal = signal<BackendReachability>('unknown');
  private readonly probeLatencySignal = signal<number | null>(null);
  private readonly lastCheckedAtSignal = signal<string | null>(null);
  private readonly detailSignal = signal<string>('No backend probe executed yet.');
  private readonly lastCacheSyncAtSignal = signal<string | null>(null);
  private readonly cacheSyncEventCountSignal = signal<number>(0);

  /** `true` while the browser reports a usable network interface. */
  public readonly isBrowserOnline = this.browserOnlineSignal.asReadonly();

  /** Reachability of the configured Firestore backend. */
  public readonly reachability = this.reachabilitySignal.asReadonly();

  /** Round-trip latency of the last successful probe, in milliseconds. */
  public readonly probeLatencyMs = this.probeLatencySignal.asReadonly();

  /** ISO 8601 timestamp of the last probe attempt. */
  public readonly lastCheckedAt = this.lastCheckedAtSignal.asReadonly();

  /** Human readable explanation of the current state, shown in the sync feed. */
  public readonly statusDetail = this.detailSignal.asReadonly();

  /** ISO 8601 timestamp of the last time the local cache reported a sync tick. */
  public readonly lastCacheSyncAt = this.lastCacheSyncAtSignal.asReadonly();

  /** How many cache sync ticks were observed since boot (diagnostic counter). */
  public readonly cacheSyncEventCount = this.cacheSyncEventCountSignal.asReadonly();

  /** `true` when the dashboard is talking to the Docker emulator suite. */
  public readonly isUsingEmulator = computed(() => this.config.useEmulator);

  /** Label of the configured backend, safe to render in the UI. */
  public readonly backendLabel = computed(() =>
    this.config.useEmulator
      ? `Emulator ${this.config.emulatorHost}:${this.config.emulatorPorts.firestore}`
      : `Cloud Firestore · ${this.config.projectId}`
  );

  /** `true` when the kiosk can be trusted to reach the backend right now. */
  public readonly isHealthy = computed(
    () => this.browserOnlineSignal() && this.reachabilitySignal() !== 'unreachable'
  );

  /** Tear-down handle for the `onSnapshotsInSync` subscription. */
  private snapshotsInSyncUnsubscribe: (() => void) | null = null;

  public constructor() {
    if (typeof window !== 'undefined') {
      const onOnline = (): void => {
        this.browserOnlineSignal.set(true);
        this.detailSignal.set('Network interface restored; verifying backend.');
        void this.probeBackend();
      };
      const onOffline = (): void => {
        this.browserOnlineSignal.set(false);
        this.reachabilitySignal.set('unreachable');
        this.detailSignal.set('Browser offline. Writes are queued in the local cache.');
      };

      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      });
    }

    this.attachSnapshotSyncListener();
    void this.probeBackend();
  }

  /**
   * Probes the configured backend with a request against the emulator origin
   * (emulator mode) or the Firestore REST endpoint (cloud mode).
   *
   * @param timeoutMs Probe budget; defaults to 2500ms.
   * @returns The structured probe result, also published through signals.
   */
  public async probeBackend(
    timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS
  ): Promise<BackendProbeResult> {
    if (!this.browserOnlineSignal()) {
      return this.publishProbe('unreachable', null, 'Browser reports no network connection.');
    }

    if (typeof fetch !== 'function') {
      return this.publishProbe('unknown', null, 'Fetch API unavailable in this runtime.');
    }

    this.reachabilitySignal.set('checking');

    const startedAt = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(250, timeoutMs));

    const url = this.config.useEmulator
      ? resolveEmulatorOrigin(this.config, this.config.emulatorPorts.firestore)
      : `https://firestore.googleapis.com/v1/projects/${this.config.projectId}/databases/(default)`;

    try {
      await fetch(url, { method: 'GET', mode: 'no-cors', signal: controller.signal });
      const latencyMs = Math.round(performance.now() - startedAt);
      return this.publishProbe(
        'reachable',
        latencyMs,
        this.config.useEmulator
          ? `Firestore emulator answered in ${latencyMs}ms.`
          : `Cloud Firestore answered in ${latencyMs}ms.`
      );
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'unknown transport error';
      return this.publishProbe('unreachable', null, `Backend probe failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Blocks until every locally buffered write has been acknowledged.
   *
   * @returns `true` when the cache drained, `false` when it did not (offline).
   */
  public async flushPendingWrites(): Promise<boolean> {
    try {
      await waitForPendingWrites(this.firestore);
      this.detailSignal.set('All queued writes acknowledged by the backend.');
      return true;
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.detailSignal.set(`Queued writes could not be flushed: ${reason}`);
      return false;
    }
  }

  /**
   * Toggles the Firestore transport.
   *
   * Disabling the network forces every subsequent write into the local cache,
   * which is exactly what the offline drill in the acceptance criteria requires.
   *
   * @param enabled `true` to restore the transport, `false` to sever it.
   * @returns `true` when the requested state was applied.
   */
  public async setNetworkEnabled(enabled: boolean): Promise<boolean> {
    try {
      if (enabled) {
        await enableNetwork(this.firestore);
        this.detailSignal.set('Firestore transport enabled.');
      } else {
        await disableNetwork(this.firestore);
        this.reachabilitySignal.set('unreachable');
        this.detailSignal.set('Firestore transport disabled; every write stays local.');
      }
      return true;
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.detailSignal.set(`Could not change Firestore transport state: ${reason}`);
      return false;
    }
  }

  /**
   * Purges the durable IndexedDB cache.
   *
   * Only meaningful outside emulator mode: emulator sessions already run on an
   * in-memory cache. Callers must treat a `false` result as "cache kept".
   *
   * @returns `true` when the cache was cleared.
   */
  public async clearLocalCache(): Promise<boolean> {
    if (this.config.useEmulator) {
      this.detailSignal.set('Emulator sessions use an in-memory cache; nothing to purge.');
      return false;
    }

    try {
      await clearIndexedDbPersistence(this.firestore);
      this.detailSignal.set('Durable Firestore cache cleared.');
      return true;
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.detailSignal.set(`Cache purge refused (close other tabs and retry): ${reason}`);
      return false;
    }
  }

  /**
   * Subscribes to the local cache sync signal so the sync feed can show when the
   * client last reconciled with the backend.
   */
  private attachSnapshotSyncListener(): void {
    this.snapshotsInSyncUnsubscribe = onSnapshotsInSync(this.firestore, () => {
      this.lastCacheSyncAtSignal.set(new Date().toISOString());
      this.cacheSyncEventCountSignal.update((count) => count + 1);
    });

    this.destroyRef.onDestroy(() => {
      this.snapshotsInSyncUnsubscribe?.();
      this.snapshotsInSyncUnsubscribe = null;
    });
  }

  /** Records a probe outcome and mirrors it into the reactive signals. */
  private publishProbe(
    reachability: BackendReachability,
    latencyMs: number | null,
    detail: string
  ): BackendProbeResult {
    const checkedAt = new Date().toISOString();
    this.reachabilitySignal.set(reachability);
    this.probeLatencySignal.set(latencyMs);
    this.lastCheckedAtSignal.set(checkedAt);
    this.detailSignal.set(detail);

    return Object.freeze({ reachability, checkedAt, latencyMs, detail });
  }
}

/** Reads `navigator.onLine` defensively for SSR and test environments. */
function readBrowserOnlineState(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') {
    return true;
  }
  return navigator.onLine;
}
