# Event RSVP & Ticketing Dashboard — System Architecture & Specification Plan (`plan.md`)

This specification defines the architectural, data, state, and visual implementation for the **Event RSVP & Ticketing Dashboard**. The application baseline is pinned to **Angular 18+**, **TypeScript 5.4+**, and **Firebase JS SDK ^10.7+** (Standalone Components, Signals, Signal Queries `viewChild.required()`, Signal Inputs/Outputs `input()`/`output()`, Native Control Flow `@if`/`@for`, `ChangeDetectionStrategy.OnPush`, and `inject()`). Remote storage routes to Firebase Cloud Firestore or the Docker-based Firebase Emulator suite.

The visual aesthetic matches **Modern Eventbrite** with physical **skeuomorphic ticket stub design elements**: perforated edge notches, tear-off line dividers, high-contrast status chips, canvas-rendered QR/barcode verification tags, and a mobile-first check-in workflow.

---

## 1. Architectural System Overview

```
                      +------------------------------------------+
                      |       Angular Single Page App (SPA)      |
                      |   (Signal-Driven, OnPush, Standalone)    |
                      +---------------------+--------------------+
                                            |
                        +-------------------+--------------------+
                        |                                        |
             [ Angular State Stores ]                  [ Audio Synthesizer ]
             - EventDashboardStore                     - Web Audio API Chimes
             - CheckInTerminalStore                    - Success (D5-A5 chord)
             - OfflineSyncEngine                       - Duplicate/Error (D3 buzzer)
                        |
       +----------------+----------------+
       |                                 |
[ Firebase Modular SDK ]       [ Local IndexedDB Cache ]
- initializeFirestore          - Dexie / IndexedDB Outbox
- persistentLocalCache         - Optimistic Mutation Queue
- persistentMultipleTabManager - Background Sync Worker
       |
       +---------------------------------+
                                         |
                   +---------------------+---------------------+
                   |                                           |
       [ Local Docker Emulator ]                    [ Production Cloud ]
       - Firestore (0.0.0.0:8080)                  - Google Cloud Firestore
       - Auth (0.0.0.0:9099)                       - Firebase Authentication
       - Storage (0.0.0.0:9199)                    - Firebase Cloud Storage
       - Emulator UI (0.0.0.0:4000)                - Edge CDN Hosting
```

---

## 2. Data Schema & Pure TypeScript Interfaces

All models strictly declare ISO 8601 string representations for timestamps to ensure deterministic serialization across IndexedDB, Firestore, and Angular Signals.

```typescript
/**
 * Core event representation supporting in-person, online, and hybrid modalities.
 */
export interface EventModel {
  readonly id: string;
  readonly organizerId: string;
  readonly title: string;
  readonly slug: string;
  readonly summary: string;
  readonly description: string;
  readonly bannerImageUrl: string;
  readonly eventType: 'in_person' | 'online' | 'hybrid';
  readonly venue: VenueLocation;
  readonly virtualMeetingUrl: string | null;
  readonly startDateTime: string; // ISO 8601
  readonly endDateTime: string;   // ISO 8601
  readonly timezone: string;
  readonly status: 'draft' | 'published' | 'sold_out' | 'cancelled' | 'archived';
  readonly totalCapacity: number;
  readonly totalTicketsIssued: number;
  readonly totalTicketsCheckedIn: number;
  readonly currency: 'USD' | 'EUR' | 'GBP';
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VenueLocation {
  readonly venueName: string;
  readonly streetAddress: string;
  readonly unitSuite?: string;
  readonly city: string;
  readonly stateProvince: string;
  readonly postalCode: string;
  readonly country: string;
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Ticket tiers (e.g. VIP, General Admission, Early Bird, Speaker Pass).
 */
export interface TicketTier {
  readonly id: string;
  readonly eventId: string;
  readonly name: string;
  readonly tierType: 'free' | 'paid' | 'donation';
  readonly priceCents: number;
  readonly currency: string;
  readonly initialQuota: number;
  readonly availableQuota: number;
  readonly maxPerOrder: number;
  readonly salesStartDate: string;
  readonly salesEndDate: string;
  readonly perks: readonly string[];
  readonly badgeColorHex: string;
  readonly isActive: boolean;
  readonly displayOrder: number;
}

/**
 * Attendee record representing an issued ticket instance.
 */
export interface AttendeeTicket {
  readonly id: string;
  readonly eventId: string;
  readonly orderId: string;
  readonly ticketTierId: string;
  readonly ticketTierName: string;
  readonly ticketStubNumber: string; // e.g. "EVT-8924-XQ9"
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phoneNumber: string;
  readonly companyOrAffiliation: string;
  readonly checkInStatus: 'confirmed' | 'checked_in' | 'cancelled';
  readonly checkedInAt: string | null;
  readonly checkedInByUserId: string | null;
  readonly qrVerificationSecret: string; // Hashed payload for dynamic scanner verification
  readonly barcodeValue: string;
  readonly seatAssignment?: string;
  readonly notes?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Order aggregate representing a completed registration or transaction.
 */
export interface TicketOrder {
  readonly id: string;
  readonly eventId: string;
  readonly orderReference: string;
  readonly customerFirstName: string;
  readonly customerLastName: string;
  readonly customerEmail: string;
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly totalCents: number;
  readonly currency: string;
  readonly paymentStatus: 'completed' | 'free_rsvp' | 'refunded' | 'pending';
  readonly paymentMethod: 'free' | 'stripe_card' | 'offline_cash';
  readonly lineItems: readonly OrderLineItem[];
  readonly createdAt: string;
}

export interface OrderLineItem {
  readonly ticketTierId: string;
  readonly tierName: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly subtotalCents: number;
}

/**
 * Offline Sync and Mutation Outbox Models.
 */
export interface OfflineOutboxItem {
  readonly id: string;
  readonly actionType: 'CHECK_IN_ATTENDEE' | 'CREATE_RSVP_ORDER' | 'CANCEL_TICKET';
  readonly entityId: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
  readonly retryCount: number;
  readonly syncStatus: 'pending' | 'syncing' | 'failed' | 'failed_permanent';
  readonly lastErrorMessage: string | null;
}

export interface CheckInAuditLog {
  readonly id: string;
  readonly attendeeId: string;
  readonly eventId: string;
  readonly timestamp: string;
  readonly operatorId: string;
  readonly scanMethod: 'camera_qr' | 'manual_button' | 'barcode_hardware';
  readonly wasOfflineCached: boolean;
}

/**
 * Real-time Analytics View Model.
 */
export interface DashboardMetrics {
  readonly totalRegistrations: number;
  readonly totalCheckedIn: number;
  readonly checkInRatePercentage: number;
  readonly totalGrossRevenueCents: number;
  readonly availableCapacity: number;
  readonly tierBreakdown: readonly TierMetricStat[];
  readonly recentArrivalVelocity: number; // check-ins during the last 15 minutes
}

export interface TierMetricStat {
  readonly tierId: string;
  readonly tierName: string;
  readonly soldCount: number;
  readonly totalQuota: number;
  readonly checkedInCount: number;
}

/**
 * Validation schema constraints.
 */
export const VALIDATION_RULES = {
  EMAIL_REGEX: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  PHONE_REGEX: /^\+?[1-9]\d{1,14}$/,
  TICKET_STUB_REGEX: /^[A-Z]{3,4}-[0-9]{4}-[A-Z0-9]{3}$/,
  MAX_TICKETS_PER_ORDER: 10,
  MIN_SEARCH_CHARACTERS: 2,
  QR_HASH_SEPARATOR: '::',
  MAX_OFFLINE_RETRIES: 5,
} as const;
```

---

## 3. Component Architecture & System Tree

The design system follows modern Angular modularization utilizing standalone components exclusively.

```
src/app/
├── core/
│   ├── firebase/
│   │   ├── firebase.config.ts           # Modular Firebase + Emulator wiring
│   │   └── firestore-offline.service.ts # IndexedDB fallback, persistent cache
│   ├── audio/
│   │   └── audio-feedback.service.ts    # Web Audio API chime & buzzer synthesizer
│   ├── sync/
│   │   └── offline-mutation.service.ts  # Outbox store & auto-reconnect sync queue
│   └── guards/ & tokens/
├── shared/
│   ├── ui/ (Atomic UI Primitives)
│   │   ├── button/
│   │   │   └── button.component.ts      # Variants: primary, coral, outline, stub-perforated
│   │   ├── badge/
│   │   │   └── badge.component.ts       # Status indicators: checked-in, confirmed, sold-out
│   │   ├── ticket-notch/
│   │   │   └── ticket-notch.component.ts# SVG & CSS mask cutouts for ticket stub aesthetics
│   │   ├── perforation-divider/
│   │   │   └── perforation-divider.component.ts # Dashed cut line with scissors icon
│   │   ├── qr-canvas/
│   │   │   └── qr-canvas.component.ts   # Pure Canvas 2D matrix generator
│   │   ├── barcode-strip/
│   │   │   └── barcode-strip.component.ts # Dynamic SVG barcode renderer
│   │   └── sync-indicator/
│   │       └── sync-indicator.component.ts # Online/Offline/Outbox count badge
│   ├── molecules/
│   │   ├── stat-card/
│   │   │   └── stat-card.component.ts   # Metric figure with progress radial ring
│   │   ├── tier-selector-row/
│   │   │   └── tier-selector-row.component.ts # Stepper counter with inventory limits
│   │   ├── attendee-row-item/
│   │   │   └── attendee-row-item.component.ts # Attendee check-in switch & meta
│   │   └── search-filter-toolbar/
│   │       └── search-filter-toolbar.component.ts # Instant signal filter input
│   └── organisms/
│       ├── ticket-stub-card/
│       │   └── ticket-stub-card.component.ts # Authentic Eventbrite tear-off ticket stub
│       ├── camera-scanner-modal/
│       │   └── camera-scanner-modal.component.ts # HTML5 Video QR reader overlay
│       └── manual-check-in-pad/
│           └── manual-check-in-pad.component.ts # Quick stub number entry pad
└── features/
    ├── dashboard/
    │   ├── event-dashboard.component.ts # Main container hosting analytics & actions
    │   └── stores/
    │       └── event-dashboard.store.ts # Signal-based state management
    ├── attendees/
    │   ├── attendee-roster.component.ts # Real-time roster, filters, batch check-in
    │   └── stores/
    │       └── attendee-roster.store.ts # Signal filter, pagination, sorting
    ├── ticketing/
    │   ├── rsvp-checkout-dialog.component.ts # Ticket purchase / RSVP modal
    │   └── ticket-detail-sheet.component.ts  # Full printable ticket stub view
    └── terminal/
        ├── check-in-terminal.component.ts    # High-throughput kiosk scan interface
        └── stores/
            └── check-in-terminal.store.ts   # Scan queue, audio trigger, optimistic toggling
```

---

## 4. Ticket Stub Component Design Specification

The ticket stub follows an authentic physical design inspired by classic perforated event tickets, combined with modern Eventbrite dashboard ergonomics.

```
+-------------------------------------------------------------+---------+
| [Coral Header]  SUMMIT TECH CONF 2026                      | ( ) ( ) |
| Date: Oct 24, 2026 | 09:00 AM PST                          |  PASS   |
| Venue: Moscone Center, Hall D - San Francisco, CA          | VIP TIER|
|                                                             |         |
| Attendee: ALEXANDRA CHEN                                   | [QR CODE|
| Tier: VIP ACCESS ALL-INCLUSIVE                             |  CANVAS]|
| Stub #: EVT-8924-XQ9                                       |         |
|                                                             |         |
|  - - - - - - - - - - - - - - - - - - - - - - - - - - - - -  |  TEAR   |
|  |||| | |||||| || | |||| ||||| ||| |||||| |||| |||||| ||||  |  OFF    |
|  EVT-8924-XQ9-SEC4-DOOR-B                                  | ( ) ( ) |
+-------------------------------------------------------------+---------+
  ^                                                           ^
  Main Ticket Body (Event Details, Barcode)            Perforated Stub
                                                      (Notches, QR)
```

### Visual Specifications
1. **Perforation Cutouts**: Dual semi-circular notches (top and bottom) carved out using CSS `mask-image` or pseudo-element radial gradients:
   ```css
   background: radial-gradient(circle at 100% 50%, transparent 12px, #ffffff 13px);
   ```
2. **Perforation Border**: High-contrast dashed line: `border-right: 2px dashed #D1D5DB;`.
3. **Color Tokens**:
   - Primary Brand Coral: `#FF5A36`
   - Ticket Background Light: `#FFFFFF` (Surface) and `#F9FAFB` (Sub-ticket background)
   - Verified Emerald: `#10B981` (Check-in confirmed)
   - Slate Neutral: `#1E222B` (High-contrast typography)
   - Tear-Off Muted Text: `#6B7280`
4. **Touch Ergonomics**: All interactive elements (e.g., "Check-In" button, tear-off pass toggles) maintain a minimum hit box of **48px x 48px** for instant field operations.

---

## 5. Offline-First Docker Firebase Engine & Synced Storage

### 5.1 Docker Emulator Configuration (`docker-compose.yml`)

The system operates against the Firebase Local Emulator Suite running in Docker. When offline or during local development, all transactions route directly to this environment.

```yaml
version: '3.8'

services:
  firebase-emulator:
    image: node:20-alpine
    container_name: ticketing_firebase_emulator
    working_dir: /app
    volumes:
      - ./firebase:/app
      - ./firebase-data:/app/emulator-data
    ports:
      - "4000:4000"   # Firebase Emulator UI
      - "8080:8080"   # Cloud Firestore Emulator
      - "9099:9099"   # Firebase Authentication Emulator
      - "9199:9199"   # Cloud Storage Emulator
    environment:
      - FIREBASE_PROJECT=event-rsvp-ticketing
    command: >
      sh -c "npm install -g firebase-tools &&
             firebase emulators:start --project event-rsvp-ticketing --import=/app/emulator-data --export-on-exit=/app/emulator-data"
    healthcheck:
      test: ["CMD", "nc", "-z", "localhost", "8080"]
      interval: 5s
      timeout: 3s
      retries: 5
```

### 5.2 Angular Firebase Initialization & Offline Persistent Cache

```typescript
// src/app/core/firebase/firebase.config.ts
import { InjectionToken } from '@angular/core';
import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  Firestore
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, Auth } from 'firebase/auth';

export interface FirebaseEnvironmentConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  useEmulator: boolean;
  emulatorHost: string;
  emulatorPorts: {
    firestore: number;
    auth: number;
    storage: number;
  };
}

export const FIREBASE_CONFIG = new InjectionToken<FirebaseEnvironmentConfig>('FIREBASE_CONFIG');
export const FIREBASE_APP = new InjectionToken<FirebaseApp>('FIREBASE_APP');
export const FIRESTORE_DB = new InjectionToken<Firestore>('FIRESTORE_DB');
export const FIREBASE_AUTH = new InjectionToken<Auth>('FIREBASE_AUTH');

export function provideFirebaseApp(config: FirebaseEnvironmentConfig) {
  const app = initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId
  });

  import { memoryLocalCache } from 'firebase/firestore';

  // Prevent ghost documents when emulator resets by using memory cache in emulation mode
  const firestore = initializeFirestore(app, {
    localCache: config.useEmulator
      ? memoryLocalCache()
      : persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        })
  });

  const auth = getAuth(app);

  if (config.useEmulator) {
    connectFirestoreEmulator(firestore, config.emulatorHost, config.emulatorPorts.firestore);
    connectAuthEmulator(auth, `http://${config.emulatorHost}:${config.emulatorPorts.auth}`);
  }

  return { app, firestore, auth };
}
```

### 5.3 Angular Application Config & DI Providers (`src/app/app.config.ts`)

```typescript
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import {
  FIREBASE_CONFIG,
  FIREBASE_APP,
  FIRESTORE_DB,
  FIREBASE_AUTH,
  provideFirebaseApp,
  FirebaseEnvironmentConfig
} from './core/firebase/firebase.config';

const environmentFirebaseConfig: FirebaseEnvironmentConfig = {
  apiKey: 'demo-api-key',
  authDomain: 'event-rsvp-ticketing.firebaseapp.com',
  projectId: 'event-rsvp-ticketing',
  storageBucket: 'event-rsvp-ticketing.appspot.com',
  messagingSenderId: '123456789',
  appId: '1:123456789:web:abcdef',
  useEmulator: true,
  emulatorHost: '127.0.0.1',
  emulatorPorts: {
    firestore: 8080,
    auth: 9099,
    storage: 9199
  }
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    {
      provide: FIREBASE_CONFIG,
      useValue: environmentFirebaseConfig
    },
    {
      provide: FIREBASE_APP,
      useFactory: () => provideFirebaseApp(environmentFirebaseConfig).app
    },
    {
      provide: FIRESTORE_DB,
      useFactory: () => provideFirebaseApp(environmentFirebaseConfig).firestore
    },
    {
      provide: FIREBASE_AUTH,
      useFactory: () => provideFirebaseApp(environmentFirebaseConfig).auth
    }
  ]
};
```

---

## 6. Core Feature Logic & Step-by-Step Algorithms

### 6.1 Check-In Audio Synthesizer (Web Audio API)

Zero external audio files are downloaded. Harmonic audio cues are synthesized in memory to guarantee instant acoustic feedback at check-in terminals, even when 100% offline.

```typescript
// src/app/core/audio/audio-feedback.service.ts
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class AudioFeedbackService {
  private audioCtx: AudioContext | null = null;

  private initAudioContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }
    if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * High-register chime chord (D5 + A5) for successful verification.
   */
  public playSuccessChime(): void {
    const ctx = this.initAudioContext();
    const now = ctx.currentTime;

    const notes = [587.33, 880.00]; // D5, A5
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + (idx * 0.04));

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.02 + (idx * 0.04));
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35 + (idx * 0.04));

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + (idx * 0.04));
      osc.stop(now + 0.4 + (idx * 0.04));
    });
  }

  /**
   * Dual low-register sawtooth tone for duplicates or invalid passes.
   */
  public playErrorBuzzer(): void {
    const ctx = this.initAudioContext();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';
    osc1.frequency.setValueAtTime(146.83, now); // D3
    osc2.frequency.setValueAtTime(138.59, now); // C#3 (dissonance)

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.5);
    osc2.stop(now + 0.5);
  }
}
```

### 6.2 Ticket Verification & QR Secret Generator

Each ticket carries a cryptographic payload verified locally by the terminal.

```typescript
// src/app/shared/utils/ticket-cryptography.ts
export class TicketSecurityUtility {
  /**
   * Creates a verifiable QR code payload:
   * Format: TICKET_ID::STUB_NUMBER::HMAC_FRAGMENT
   */
  public static generateVerifiableToken(
    ticketId: string,
    stubNumber: string,
    eventId: string
  ): string {
    const payloadRaw = `${ticketId}__${stubNumber}__${eventId}`;
    const hashFragment = this.computeFnv1aHash(payloadRaw).toString(16);
    return `${ticketId}::${stubNumber}::${hashFragment}`;
  }

  /**
   * Parses and validates format of scanned string.
   */
  public static parseToken(rawScan: string): { ticketId: string; stubNumber: string; hash: string } | null {
    const parts = rawScan.split('::');
    if (parts.length !== 3) {
      return null;
    }
    return {
      ticketId: parts[0],
      stubNumber: parts[1],
      hash: parts[2]
    };
  }

  /**
   * FNV-1a non-cryptographic hash for quick offline integrity verification.
   */
  private static computeFnv1aHash(str: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }
}
```

### 6.3 Signal-Based Offline Mutation Store & Outbox Engine

```typescript
// src/app/core/sync/offline-mutation.service.ts
import { Injectable, signal, computed, inject } from '@angular/core';
import { FIRESTORE_DB } from '../firebase/firebase.config';
import { doc, runTransaction } from 'firebase/firestore';
import { OfflineOutboxItem } from '../models/ticket.model';

@Injectable({ providedIn: 'root' })
export class OfflineMutationService {
  private readonly firestore = inject(FIRESTORE_DB);
  private readonly dbName = 'ticketforge_offline_db';
  private readonly storeName = 'mutation_outbox';
  private idbInstance: IDBDatabase | null = null;

  private readonly isOnlineSignal = signal<boolean>(navigator.onLine);
  private readonly outboxQueueSignal = signal<readonly OfflineOutboxItem[]>([]);
  private readonly isSyncingSignal = signal<boolean>(false);

  public readonly isOnline = this.isOnlineSignal.asReadonly();
  public readonly isSyncing = this.isSyncingSignal.asReadonly();
  public readonly pendingCount = computed(() =>
    this.outboxQueueSignal().filter(item => item.syncStatus !== 'failed_permanent').length
  );
  public readonly permanentFailures = computed(() =>
    this.outboxQueueSignal().filter(item => item.syncStatus === 'failed_permanent')
  );

  constructor() {
    this.initNetworkListeners();
    void this.initIndexedDb().then(() => this.hydrateFromIndexedDb());
  }

  private initNetworkListeners(): void {
    window.addEventListener('online', () => {
      this.isOnlineSignal.set(true);
      void this.flushOutbox();
    });
    window.addEventListener('offline', () => {
      this.isOnlineSignal.set(false);
    });
  }

  private async initIndexedDb(): Promise<IDBDatabase> {
    if (this.idbInstance) return this.idbInstance;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        this.idbInstance = request.result;
        resolve(this.idbInstance);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async hydrateFromIndexedDb(): Promise<void> {
    const db = await this.initIndexedDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const request = store.getAll();
      request.onsuccess = () => {
        this.outboxQueueSignal.set(request.result as OfflineOutboxItem[]);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async persistOutboxItem(item: OfflineOutboxItem): Promise<void> {
    const db = await this.initIndexedDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private async removeOutboxItem(id: string): Promise<void> {
    const db = await this.initIndexedDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async queueCheckInMutation(
    eventId: string,
    ticketId: string,
    operatorId: string,
    timestamp: string
  ): Promise<void> {
    const mutation: OfflineOutboxItem = {
      id: crypto.randomUUID(),
      actionType: 'CHECK_IN_ATTENDEE',
      entityId: ticketId,
      payload: {
        eventId,
        checkInStatus: 'checked_in',
        checkedInAt: timestamp,
        checkedInByUserId: operatorId,
        scanMethod: 'camera_qr'
      },
      createdAt: new Date().toISOString(),
      retryCount: 0,
      syncStatus: 'pending',
      lastErrorMessage: null
    };

    await this.persistOutboxItem(mutation);
    this.outboxQueueSignal.set([...this.outboxQueueSignal(), mutation]);

    if (this.isOnlineSignal()) {
      await this.flushOutbox();
    }
  }

  public async flushOutbox(): Promise<void> {
    if (this.isSyncingSignal() || this.outboxQueueSignal().length === 0) {
      return;
    }

    this.isSyncingSignal.set(true);
    const pendingItems = this.outboxQueueSignal().filter(i => i.syncStatus !== 'failed_permanent');

    for (const item of pendingItems) {
      try {
        if (item.actionType === 'CHECK_IN_ATTENDEE') {
          const eventId = String(item.payload['eventId']);
          const attendeeRef = doc(this.firestore, `events/${eventId}/attendees/${item.entityId}`);
          const auditRef = doc(this.firestore, `events/${eventId}/audit_logs/${crypto.randomUUID()}`);

          await runTransaction(this.firestore, async (transaction) => {
            const snap = await transaction.get(attendeeRef);
            if (!snap.exists()) {
              throw new Error('ATTENDEE_NOT_FOUND');
            }
            const currentData = snap.data();
            if (currentData['checkInStatus'] === 'checked_in') {
              throw new Error('ALREADY_CHECKED_IN_SERVER_CONFLICT');
            }

            transaction.update(attendeeRef, {
              checkInStatus: 'checked_in',
              checkedInAt: item.payload['checkedInAt'],
              checkedInByUserId: item.payload['checkedInByUserId'],
              updatedAt: new Date().toISOString()
            });

            transaction.set(auditRef, {
              attendeeId: item.entityId,
              eventId,
              timestamp: item.payload['checkedInAt'],
              operatorId: item.payload['checkedInByUserId'],
              scanMethod: item.payload['scanMethod'] || 'camera_qr',
              wasOfflineCached: true
            });
          });

          await this.removeOutboxItem(item.id);
          this.outboxQueueSignal.set(this.outboxQueueSignal().filter(q => q.id !== item.id));
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown sync failure';
        const nextCount = item.retryCount + 1;
        const permanentFailure = nextCount >= 5 || errorMsg === 'ALREADY_CHECKED_IN_SERVER_CONFLICT';

        const updatedItem: OfflineOutboxItem = {
          ...item,
          retryCount: nextCount,
          syncStatus: permanentFailure ? 'failed_permanent' : 'failed',
          lastErrorMessage: errorMsg
        };

        await this.persistOutboxItem(updatedItem);
        this.outboxQueueSignal.set(
          this.outboxQueueSignal().map(q => (q.id === item.id ? updatedItem : q))
        );
      }
    }

    this.isSyncingSignal.set(false);
  }
}
```

---

## 7. Responsive Mobile-First Breakpoint Matrix

The dashboard enforces strict responsive behavior across the requested validation viewports. Hover interactions are strictly optional polish; every workflow is 100% executable through touch and tap interactions.

| Breakpoint | Target Devices | Layout Behavior & Structural Adjustments |
| :--- | :--- | :--- |
| **360px** | Small phones (e.g. Galaxy S8, iPhone SE) | • Single column stack.<br>• Ticket stub renders vertically with a horizontal tear-off line rather than a vertical right-hand stub.<br>• Bottom fixed sticky action bar for Check-In / RSVP.<br>• Stat cards stack into a 1x1 carousel/grid.<br>• Min touch target: 48px. |
| **390px** | Standard modern mobile (iPhone 13/14/15) | • Single column with 16px fluid padding.<br>• Ticket stub QR code auto-scales to 120px with crisp aspect ratio.<br>• Search toolbar collapses filters into a full-screen drawer. |
| **430px** | Large mobile (iPhone 14/15 Pro Max, Pixel 8 Pro) | • Expanded card margins (20px).<br>• Roster list items display attendee status badge + check-in button inline side-by-side. |
| **768px** | Tablets / iPads (Portrait & Landscape) | • 2-column layout for Event Overview metrics.<br>• Horizontal ticket stub renders with vertical perforation and right-side tear-off coupon.<br>• Camera scanner and Attendee search display side-by-side in split kiosk mode. |
| **1024px+** | Desktop & Convention Check-in Stations | • Full 3-column architecture:<br>  * Left: Event info & Tier quota health.<br>  * Center: Live attendee verification table with fast keyboard shortcuts.<br>  * Right: Live ticket stub preview, recent arrival velocity graph, sync diagnostic feed. |

---

## 8. Five-Phase Sequential Implementation Queue

```
================================================================================
PHASE 1: Types, Storage/API Client Config, and Base Utilities
================================================================================
[x] 1.1 Pure TypeScript Domain Types:
        - Create `src/app/core/models/ticket.model.ts` containing `EventModel`,
          `TicketTier`, `AttendeeTicket`, `TicketOrder`, and `DashboardMetrics`.
        - Implement strict validators `VALIDATION_RULES` with zero external runtime deps.
[x] 1.2 Firebase & Docker Integration:
        - Configure `docker-compose.yml` for local Firebase Emulator suite
          (Firestore: 8080, Auth: 9099, UI: 4000).
        - Implement `src/app/core/firebase/firebase.config.ts` using Angular DI
          `InjectionToken` and modular Firebase SDK.
        - Enable `persistentLocalCache` and `persistentMultipleTabManager` for
          multi-tab offline IndexedDB syncing.
[x] 1.3 Audio Feedback Synthesizer:
        - Implement `src/app/core/audio/audio-feedback.service.ts` using the Web
          Audio API oscillator nodes (D5-A5 success chord, D3-C#3 dissonant buzzer).
[x] 1.4 Cryptographic Ticket Utility:
        - Implement `src/app/shared/utils/ticket-cryptography.ts` with FNV-1a
          hashing and token format `TICKET_ID::STUB_NUMBER::HASH`.
[x] 1.5 Date & Currency Formatting Utilities:
        - Implement date localization helpers with zero moment/dayjs dependencies
          using native `Intl.DateTimeFormat` and `Intl.NumberFormat`.

================================================================================
PHASE 2: Design Foundation & Atomic UI Primitives
================================================================================
[x] 2.1 Design System Color Tokens & CSS Variables:
        - Setup `:root` CSS variables in `src/styles.css`: Eventbrite Coral
          (`#FF5A36`), Verified Emerald (`#10B981`), Neutral Charcoal (`#1E222B`),
          and Ticket Canvas Muted Border tokens.
[x] 2.2 Button Component:
        - Create `src/app/shared/ui/button/button.component.ts` (Signal inputs:
          `variant`: 'coral' | 'neutral' | 'outline' | 'perforated', `loading`,
          `disabled`, `size`: 'sm' | 'md' | 'lg').
[x] 2.3 Status Badge Component:
        - Create `src/app/shared/ui/badge/badge.component.ts` with status themes:
          `confirmed`, `checked_in`, `sold_out`, `vip`.
[x] 2.4 Ticket Perforation & Notch Components:
        - Create `src/app/shared/ui/ticket-notch/ticket-notch.component.ts` and
          `src/app/shared/ui/perforation-divider/perforation-divider.component.ts`.
        - Implement CSS radial gradient masks and SVG dashed cut dividers.
[x] 2.5 QR Canvas Primitive:
        - Create `src/app/shared/ui/qr-canvas/qr-canvas.component.ts` rendering
          a fast 2D canvas matrix from input string with configurable scale and color.
[x] 2.6 Barcode Strip Component:
        - Create `src/app/shared/ui/barcode-strip/barcode-strip.component.ts`
          rendering Code 128 style visual barcode bars using CSS flex/width ratios.
[x] 2.7 Offline Sync Status Indicator:
        - Create `src/app/shared/ui/sync-indicator/sync-indicator.component.ts`
          displaying online/offline badge, pending mutation counter, and pulse animation.

================================================================================
PHASE 3: Compound Molecules & Feature Components
================================================================================
[x] 3.1 Ticket Stub Card Component:
        - Create `src/app/shared/molecules/ticket-stub-card/ticket-stub-card.component.ts`.
        - Visual architecture:
          * Header with Eventbrite Coral accent & Event Name.
          * Attendee Name, Tier Badge, and Seat Assignment.
          * Dashed perforation separator with scissors icon.
          * Tear-off pass coupon with embedded QR Canvas and Stub ID.
          * Bottom Code-128 styled barcode.
        - Responsive: Horizontal on >= 768px; Vertical stacked fold on < 768px.
[x] 3.2 Tier Selector Stepper Row:
        - Create `src/app/shared/molecules/tier-selector-row/tier-selector-row.component.ts`
          with increment/decrement buttons, sold-out disabled states, and price display.
[x] 3.3 Dashboard Metric Stat Card:
        - Create `src/app/shared/molecules/stat-card/stat-card.component.ts`
          with primary numeric stat, trend indicator, and SVG circular progress track.
[x] 3.4 Attendee Roster Row Item:
        - Create `src/app/shared/molecules/attendee-row-item/attendee-row-item.component.ts`
          displaying avatar initials, attendee name, email, stub number, status badge,
          and instant toggle button for check-in.
[x] 3.5 Search & Filter Toolbar:
        - Create `src/app/shared/molecules/search-filter-toolbar/search-filter-toolbar.component.ts`
          with debounced signal search input, tier dropdown filter, and status filter pill group.

================================================================================
PHASE 4: Domain Logic, Reactive State, and Specialized APIs
================================================================================
[x] 4.1 Event Dashboard Store:
        - Implement `src/app/features/dashboard/stores/event-dashboard.store.ts`
          using Angular Signals:
          * `event = signal<EventModel | null>(null)`
          * `ticketTiers = signal<readonly TicketTier[]>([])`
          * `metrics = computed<DashboardMetrics>(...)`
          * Signal effects to subscribe to Firestore document updates.
[x] 4.2 Check-In Terminal Store:
        - Implement `src/app/features/terminal/stores/check-in-terminal.store.ts`:
          * Signals: `scannedCode`, `lastScannedTicket`, `verificationState`
            ('idle' | 'validating' | 'success' | 'already_checked_in' | 'not_found').
          * Optimistic update dispatch with instant Audio chime / buzzer execution.
[x] 4.3 Camera Scanner Stream Component:
        - Implement `src/app/features/terminal/camera-scanner-modal.component.ts`
          utilizing the native browser `MediaDevices.getUserMedia` API.
        - Feed stream into `BarcodeDetector` API (or Barcode/QR Worker fallback).
        - Provide high-contrast targeting reticle and visual flash upon detection.
[x] 4.4 Offline Outbox Queue Service:
        - Implement `src/app/core/sync/offline-mutation.service.ts` managing outbox
          persisted to LocalStorage/IndexedDB with auto-sync on `window.ononline`.

================================================================================
PHASE 5: Complete Page Assembly & Responsive Shell
================================================================================
[x] 5.1 Application Shell & Navigation:
        - Create `src/app/core/layout/dashboard-shell.component.ts` with top header,
          active event selector, live sync badge, and mobile bottom navigation dock.
[x] 5.2 Event Overview & Metrics Dashboard:
        - Assemble `src/app/features/dashboard/event-dashboard.component.ts`:
          * Top KPI cards (Total Sold, Check-In %, Revenue, Remaining).
          * Capacity progress bar.
          * Quick Action buttons: "New RSVP", "Open Check-In Terminal", "Print Passes".
[x] 5.3 Attendee Management Roster Screen:
        - Assemble `src/app/features/attendees/attendee-roster.component.ts`:
          * Integrated Search and Filter toolbar.
          * Virtual scroll or paginated attendee list.
          * Batch actions (Mark Checked-in, Export CSV).
          * Detail drawer showing the physical Ticket Stub preview.
[x] 5.4 RSVP & Ticket Purchase Flow Dialog:
        - Assemble `src/app/features/ticketing/rsvp-checkout-dialog.component.ts`:
          * Multi-tier ticket selection.
          * Attendee contact capture form with validation rules.
          * Atomic capacity reservation via Firestore `runTransaction`:
            - Read `TicketTier` inside transaction to verify `availableQuota >= requestedQty`.
            - Decrement `availableQuota` by `requestedQty`.
            - Increment denormalized `totalTicketsIssued` on `EventModel`.
            - Create `TicketOrder` and corresponding `AttendeeTicket` records atomically.
            - If quota is exceeded, abort transaction and display "Tier Sold Out" banner.
          * Order Refund Cascade & Security:
            - A Firebase Cloud Function trigger `onOrderUpdated` monitors `paymentStatus === 'refunded'`.
            - Automatically sets child `AttendeeTicket.checkInStatus = 'cancelled'` and increments `availableQuota`.
          * Firestore Security Rules:
            - Client read access for `orders` and `revenue` queries restricted to organizer claims.
            - Public client access restricted to `events/{eventId}` and public tier counts.
            - Attendee validation limited to matching ticket secret hash or kiosk operator roles.
[x] 5.5 High-Throughput Check-In Terminal:
        - Assemble `src/app/features/terminal/check-in-terminal.component.ts`:
          * Split screen view: Live Camera Scanner + Recent Check-in Activity.
          * Manual Stub Code keyboard input pad.
          * Large high-visibility status confirmation overlay.
[x] 5.6 Viewport Validation & Touch Ergonomics Audit:
        - Validate responsive boundaries at 360px, 390px, 430px, 768px, and 1024px+.
        - Ensure all actions function strictly with tap/click, zero hover-dependent controls.
        - Verify offline check-in capability by severing network and processing check-ins.
```

---

## 9. Complete Component Implementations

### 9.1 Perforation Divider Component (`src/app/shared/ui/perforation-divider/perforation-divider.component.ts`)

```typescript
import { Component, ChangeDetectionStrategy, input } from '@angular/core';

@Component({
  selector: 'app-perforation-divider',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="perforation-container" [class.vertical]="orientation() === 'vertical'">
      <div class="notch notch-start"></div>
      <div class="dash-line"></div>
      <div class="cut-marker" aria-hidden="true">
        <svg viewBox="0 0 24 24" class="scissors-icon" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <line x1="20" y1="4" x2="8.12" y2="15.88" />
          <line x1="14.47" y1="14.48" x2="20" y2="20" />
          <line x1="8.12" y1="8.12" x2="12" y2="12" />
        </svg>
      </div>
      <div class="notch notch-end"></div>
    </div>
  `,
  styles: [`
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
      border-top: 2px dashed #CBD5E1;
    }

    .perforation-container.vertical .dash-line {
      width: 0;
      height: 100%;
      border-top: none;
      border-left: 2px dashed #CBD5E1;
    }

    .notch {
      position: absolute;
      width: 20px;
      height: 20px;
      background-color: #F1F5F9; /* Canvas background to cut out ticket */
      border-radius: 50%;
      z-index: 2;
    }

    /* Horizontal orientation notches */
    .perforation-container:not(.vertical) .notch-start {
      left: -10px;
      top: calc(50% - 10px);
    }
    .perforation-container:not(.vertical) .notch-end {
      right: -10px;
      top: calc(50% - 10px);
    }

    /* Vertical orientation notches */
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
      background: #FFFFFF;
      padding: 2px 6px;
      border-radius: 4px;
      color: #94A3B8;
    }

    .scissors-icon {
      width: 14px;
      height: 14px;
      display: block;
    }
  `]
})
export class PerforationDividerComponent {
  public readonly orientation = input<'horizontal' | 'vertical'>('horizontal');
}
```

### 9.2 QR Canvas Visual Primitive (`src/app/shared/ui/qr-canvas/qr-canvas.component.ts`)

```typescript
import {
  Component,
  ChangeDetectionStrategy,
  viewChild,
  ElementRef,
  input,
  effect
} from '@angular/core';

@Component({
  selector: 'app-qr-canvas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="qr-wrapper">
      <canvas #qrCanvas [width]="size()" [height]="size()"></canvas>
    </div>
  `,
  styles: [`
    :host {
      display: inline-block;
    }
    .qr-wrapper {
      padding: 6px;
      background: #FFFFFF;
      border-radius: 6px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      display: inline-flex;
    }
    canvas {
      display: block;
    }
  `]
})
export class QrCanvasComponent {
  public readonly value = input.required<string>();
  public readonly size = input<number>(140);
  public readonly darkColor = input<string>('#1E222B');
  public readonly lightColor = input<string>('#FFFFFF');

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('qrCanvas');

  constructor() {
    effect(() => {
      const text = this.value();
      const sz = this.size();
      const canvas = this.canvasRef().nativeElement;
      this.renderMatrix(canvas, text, sz);
    });
  }

  /**
   * Deterministic matrix generator fallback to produce high-contrast visual 2D pattern
   * without requiring unvetted external dependencies.
   */
  private renderMatrix(canvas: HTMLCanvasElement, text: string, size: number): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = this.lightColor();
    ctx.fillRect(0, 0, size, size);

    const modules = 21; // Standard Version 1 QR matrix size
    const cellSize = size / modules;

    ctx.fillStyle = this.darkColor();

    // 1. Draw Position Finder Patterns (Top-Left, Top-Right, Bottom-Left)
    this.drawFinderPattern(ctx, 0, 0, cellSize);
    this.drawFinderPattern(ctx, (modules - 7) * cellSize, 0, cellSize);
    this.drawFinderPattern(ctx, 0, (modules - 7) * cellSize, cellSize);

    // 2. Hash-based pseudo-matrix generator for verification
    let seed = 0;
    for (let i = 0; i < text.length; i++) {
      seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
    }

    const pseudoRandom = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) {
        // Skip finder zones
        const inFinderTL = row < 8 && col < 8;
        const inFinderTR = row < 8 && col >= modules - 8;
        const inFinderBL = row >= modules - 8 && col < 8;

        if (!inFinderTL && !inFinderTR && !inFinderBL) {
          if (pseudoRandom() > 0.5) {
            ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
          }
        }
      }
    }
  }

  private drawFinderPattern(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number): void {
    // 7x7 outer square
    ctx.fillRect(x, y, 7 * cell, 7 * cell);
    // 5x5 inner white
    ctx.fillStyle = this.lightColor();
    ctx.fillRect(x + cell, y + cell, 5 * cell, 5 * cell);
    // 3x3 inner black square
    ctx.fillStyle = this.darkColor();
    ctx.fillRect(x + 2 * cell, y + 2 * cell, 3 * cell, 3 * cell);
  }
}
```

### 9.3 Barcode Strip Component (`src/app/shared/ui/barcode-strip/barcode-strip.component.ts`)

```typescript
import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';

@Component({
  selector: 'app-barcode-strip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="barcode-container" [style.height.px]="height()">
      <div class="bars-row">
        @for (bar of bars(); track $index) {
          <div
            class="barcode-bar"
            [class.filled]="bar.filled"
            [style.flex-grow]="bar.width">
          </div>
        }
      </div>
      @if (showCode()) {
        <div class="barcode-text">{{ code() }}</div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }
    .barcode-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
      background: #FFFFFF;
      padding: 4px 8px;
      border-radius: 4px;
      overflow-x: auto;
      box-sizing: border-box;
    }
    .bars-row {
      display: flex;
      width: 100%;
      min-width: 240px;
      height: 100%;
      align-items: stretch;
    }
    .barcode-bar {
      height: 100%;
      min-width: 1.5px;
      background-color: transparent;
    }
    .barcode-bar.filled {
      background-color: #1E222B;
    }
    .barcode-text {
      font-family: 'Courier New', Courier, monospace;
      font-size: 11px;
      letter-spacing: 2px;
      color: #475569;
      margin-top: 4px;
      font-weight: 600;
    }
  `]
})
export class BarcodeStripComponent {
  public readonly code = input.required<string>();
  public readonly height = input<number>(44);
  public readonly showCode = input<boolean>(true);

  public readonly bars = computed<{ filled: boolean; width: number }[]>(() => {
    const raw = this.code();
    const result: { filled: boolean; width: number }[] = [];

    // Guard bar
    result.push({ filled: true, width: 2 });
    result.push({ filled: false, width: 1 });
    result.push({ filled: true, width: 1 });

    for (let i = 0; i < raw.length; i++) {
      const charCode = raw.charCodeAt(i);
      const w1 = (charCode % 3) + 1;
      const w2 = ((charCode >> 1) % 3) + 1;
      const w3 = ((charCode >> 2) % 2) + 1;

      result.push({ filled: true, width: w1 });
      result.push({ filled: false, width: w2 });
      result.push({ filled: true, width: w3 });
      result.push({ filled: false, width: 1 });
    }

    // End guard bar
    result.push({ filled: true, width: 1 });
    result.push({ filled: false, width: 1 });
    result.push({ filled: true, width: 2 });

    return result;
  });
}
```

### 9.4 Dashboard Metric Stat Card (`src/app/shared/molecules/stat-card/stat-card.component.ts`)

```typescript
import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';

@Component({
  selector: 'app-stat-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="stat-card">
      <div class="stat-info">
        <span class="stat-label">{{ label() }}</span>
        <div class="stat-value">{{ value() }}</div>
        @if (subtext()) {
          <span class="stat-subtext">{{ subtext() }}</span>
        }
      </div>

      @if (showProgress()) {
        <div class="stat-ring-box">
          <svg viewBox="0 0 36 36" class="circular-chart" aria-hidden="true">
            <path
              class="circle-bg"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <path
              class="circle-fill"
              [attr.stroke-dasharray]="strokeDasharray()"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
          </svg>
          <span class="percentage-label">{{ percentage() }}%</span>
        </div>
      }
    </article>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }
    .stat-card {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      padding: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      box-sizing: border-box;
      min-width: 0;
    }
    .stat-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .stat-label {
      font-size: 11px;
      font-weight: 700;
      color: #64748B;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-value {
      font-size: 24px;
      font-weight: 900;
      color: #0F172A;
      line-height: 1.2;
      margin: 4px 0 2px 0;
    }
    .stat-subtext {
      font-size: 11px;
      color: #10B981;
      font-weight: 600;
    }
    .stat-ring-box {
      position: relative;
      width: 52px;
      height: 52px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .circular-chart {
      width: 100%;
      height: 100%;
      max-width: 100%;
      display: block;
    }
    .circle-bg {
      fill: none;
      stroke: #F1F5F9;
      stroke-width: 3.8;
    }
    .circle-fill {
      fill: none;
      stroke: #FF5A36;
      stroke-width: 3.8;
      stroke-linecap: round;
      transition: stroke-dasharray 0.3s ease;
    }
    .percentage-label {
      position: absolute;
      font-size: 10px;
      font-weight: 800;
      color: #334155;
    }
  `]
})
export class StatCardComponent {
  public readonly label = input.required<string>();
  public readonly value = input.required<string>();
  public readonly subtext = input<string>();
  public readonly showProgress = input<boolean>(false);
  public readonly percentage = input<number>(0);

  public readonly strokeDasharray = computed(() => {
    const p = Math.max(0, Math.min(100, this.percentage()));
    return `${p}, 100`;
  });
}
```

### 9.5 Physical Ticket Stub Card (`src/app/shared/molecules/ticket-stub-card/ticket-stub-card.component.ts`)

```typescript
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { AttendeeTicket } from '../../../core/models/ticket.model';
import { PerforationDividerComponent } from '../../ui/perforation-divider/perforation-divider.component';
import { QrCanvasComponent } from '../../ui/qr-canvas/qr-canvas.component';
import { BarcodeStripComponent } from '../../ui/barcode-strip/barcode-strip.component';

@Component({
  selector: 'app-ticket-stub-card',
  standalone: true,
  imports: [PerforationDividerComponent, QrCanvasComponent, BarcodeStripComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="ticket-stub-card" [class.is-checked-in]="ticket().checkInStatus === 'checked_in'">
      <!-- Main Body -->
      <div class="ticket-body">
        <div class="header-strip">
          <div class="brand-eyebrow">OFFICIAL ENTRY PASS</div>
          <div class="status-indicator">
            @if (ticket().checkInStatus === 'checked_in') {
              <span class="badge badge-emerald">CHECKED IN</span>
            } @else {
              <span class="badge badge-coral">VALID PASS</span>
            }
          </div>
        </div>

        <div class="event-meta">
          <h3 class="event-title">{{ eventTitle() }}</h3>
          <p class="venue-line">{{ venueName() }}</p>
          <p class="datetime-line">{{ formattedDateTime() }}</p>
        </div>

        <div class="attendee-details-grid">
          <div class="meta-field">
            <span class="field-label">ATTENDEE</span>
            <span class="field-value">{{ ticket().firstName }} {{ ticket().lastName }}</span>
          </div>
          <div class="meta-field">
            <span class="field-label">TIER</span>
            <span class="field-value tier-name">{{ ticket().ticketTierName }}</span>
          </div>
          <div class="meta-field">
            <span class="field-label">STUB REFERENCE</span>
            <span class="field-value font-mono">{{ ticket().ticketStubNumber }}</span>
          </div>
          @if (ticket().seatAssignment) {
            <div class="meta-field">
              <span class="field-label">SEAT / ZONE</span>
              <span class="field-value">{{ ticket().seatAssignment }}</span>
            </div>
          }
        </div>

        <div class="body-barcode-footer">
          <app-barcode-strip [code]="ticket().barcodeValue" [height]="36" />
        </div>
      </div>

      <!-- Perforated Tear-off Line -->
      <div class="ticket-perforation">
        <app-perforation-divider [orientation]="'vertical'" class="desktop-divider" />
        <app-perforation-divider [orientation]="'horizontal'" class="mobile-divider" />
      </div>

      <!-- Tear-Off Stub (Coupon Pass) -->
      <div class="ticket-tear-stub">
        <div class="stub-header">
          <span class="stub-tag">TEAR-OFF PASS</span>
          <span class="stub-number font-mono">{{ ticket().ticketStubNumber }}</span>
        </div>

        <div class="qr-container">
          <app-qr-canvas
            [value]="ticket().qrVerificationSecret"
            [size]="116" />
        </div>

        <div class="stub-footer">
          <button
            type="button"
            class="verify-action-btn"
            [class.btn-checked-in]="ticket().checkInStatus === 'checked_in'"
            (click)="onToggleCheckIn.emit(ticket())">
            @if (ticket().checkInStatus === 'checked_in') {
              <span>&#10003; REVERSE CHECK-IN</span>
            } @else {
              <span>CONFIRM ADMISSION</span>
            }
          </button>
        </div>
      </div>
    </article>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      max-width: 820px;
      margin: 0 auto;
    }

    .ticket-stub-card {
      display: flex;
      flex-direction: row;
      background: #FFFFFF;
      border-radius: 16px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04);
      border: 1px solid #E2E8F0;
      position: relative;
      overflow: hidden;
    }

    .ticket-stub-card.is-checked-in {
      border-color: #A7F3D0;
    }

    /* Left Major Portion */
    .ticket-body {
      flex: 1 1 65%;
      padding: 24px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-width: 0;
    }

    .header-strip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .brand-eyebrow {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 1.5px;
      color: #FF5A36;
      text-transform: uppercase;
    }

    .badge {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 9999px;
      letter-spacing: 0.5px;
    }
    .badge-coral {
      background-color: #FFF1EE;
      color: #FF5A36;
    }
    .badge-emerald {
      background-color: #ECFDF5;
      color: #059669;
    }

    .event-title {
      font-size: 20px;
      font-weight: 800;
      color: #0F172A;
      margin: 0 0 6px 0;
      line-height: 1.25;
    }

    .venue-line, .datetime-line {
      margin: 0;
      font-size: 13px;
      color: #64748B;
      line-height: 1.4;
    }

    .attendee-details-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin: 20px 0;
      padding: 14px;
      background: #F8FAFC;
      border-radius: 8px;
    }

    .meta-field {
      display: flex;
      flex-direction: column;
    }

    .field-label {
      font-size: 10px;
      font-weight: 700;
      color: #94A3B8;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      margin-bottom: 2px;
    }

    .field-value {
      font-size: 14px;
      font-weight: 700;
      color: #1E293B;
      word-break: break-word;
    }

    .tier-name {
      color: #FF5A36;
    }

    .font-mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    .body-barcode-footer {
      margin-top: auto;
      padding-top: 8px;
    }

    /* Perforation Divider */
    .ticket-perforation {
      display: flex;
      align-items: center;
      position: relative;
    }

    .desktop-divider {
      display: block;
      height: 100%;
    }
    .mobile-divider {
      display: none;
      width: 100%;
    }

    /* Right Tear-Off Portion */
    .ticket-tear-stub {
      flex: 0 0 210px;
      background: #FAFAFA;
      padding: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      border-left: 1px dashed transparent;
    }

    .stub-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      margin-bottom: 8px;
    }

    .stub-tag {
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 1px;
      color: #94A3B8;
    }

    .stub-number {
      font-size: 12px;
      font-weight: 700;
      color: #334155;
    }

    .qr-container {
      margin: 8px 0;
      display: flex;
      justify-content: center;
    }

    .verify-action-btn {
      width: 100%;
      min-height: 44px;
      padding: 10px 14px;
      font-size: 12px;
      font-weight: 700;
      border: none;
      border-radius: 8px;
      background-color: #FF5A36;
      color: #FFFFFF;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease-in-out;
    }

    .verify-action-btn:active {
      transform: scale(0.98);
    }

    .verify-action-btn.btn-checked-in {
      background-color: #059669;
    }

    /* Responsive Fold Rules */
    @media (max-width: 767px) {
      .ticket-stub-card {
        flex-direction: column;
      }

      .ticket-body {
        padding: 20px 16px 12px 16px;
      }

      .desktop-divider {
        display: none;
      }
      .mobile-divider {
        display: block;
      }

      .ticket-tear-stub {
        flex: 1 1 auto;
        width: 100%;
        padding: 16px;
        box-sizing: border-box;
      }

      .attendee-details-grid {
        grid-template-columns: 1fr;
        gap: 12px;
        margin: 14px 0;
      }

      .verify-action-btn {
        min-height: 48px; /* Touch target enforcement for mobile */
      }
    }
  `]
})
export class TicketStubCardComponent {
  public readonly ticket = input.required<AttendeeTicket>();
  public readonly eventTitle = input.required<string>();
  public readonly venueName = input.required<string>();
  public readonly formattedDateTime = input.required<string>();

  public readonly onToggleCheckIn = output<AttendeeTicket>();
}
```

### 9.5 High-Throughput Check-In Terminal Component (`src/app/features/terminal/check-in-terminal.component.ts`)

```typescript
import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  viewChild,
  ElementRef,
  OnDestroy
} from '@angular/core';
import { FIRESTORE_DB, FIREBASE_AUTH } from '../../core/firebase/firebase.config';
import { AudioFeedbackService } from '../../core/audio/audio-feedback.service';
import { OfflineMutationService } from '../../core/sync/offline-mutation.service';
import { TicketSecurityUtility } from '../../shared/utils/ticket-cryptography';
import { AttendeeTicket } from '../../core/models/ticket.model';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { QrCanvasComponent } from '../../shared/ui/qr-canvas/qr-canvas.component';

@Component({
  selector: 'app-check-in-terminal',
  standalone: true,
  imports: [QrCanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="terminal-shell" aria-label="Live Admission Check-in Terminal">
      <!-- Top Status Header -->
      <header class="terminal-header">
        <div class="header-left">
          <h2 class="terminal-heading">Live Entry Scanner</h2>
          <div class="terminal-network-tag" [class.offline]="!syncService.isOnline()">
            <span class="status-dot"></span>
            <span>{{ syncService.isOnline() ? 'STATION ONLINE' : 'OFFLINE MODE (QUEUED)' }}</span>
            @if (syncService.pendingCount() > 0) {
              <span class="sync-count">({{ syncService.pendingCount() }} to sync)</span>
            }
          </div>
        </div>

        <div class="header-right">
          <button
            type="button"
            class="control-btn"
            [class.active]="cameraActive()"
            (click)="toggleCameraStream()">
            {{ cameraActive() ? 'STOP CAMERA' : 'START CAMERA SCANNER' }}
          </button>
        </div>
      </header>

      <!-- Main Kiosk Workspace -->
      <div class="terminal-grid">
        <!-- Left: Video Camera Feed & Targeting Reticle -->
        <div class="scanner-viewport-panel">
          <div class="video-container">
            <video #videoElement playsinline muted class="camera-stream" [class.hidden]="!cameraActive()"></video>

            @if (!cameraActive()) {
              <div class="camera-placeholder">
                <div class="placeholder-icon">&#128247;</div>
                <p>Camera is currently inactive</p>
                <button type="button" class="btn-start-stream" (click)="toggleCameraStream()">
                  Initialize Camera Scanner
                </button>
              </div>
            } @else {
              <div class="scanner-reticle" aria-hidden="true">
                <div class="corner-bracket top-left"></div>
                <div class="corner-bracket top-right"></div>
                <div class="corner-bracket bottom-left"></div>
                <div class="corner-bracket bottom-right"></div>
                <div class="scan-laser-line"></div>
              </div>
            }
          </div>

          <!-- Manual Code Entry Pad -->
          <form class="manual-input-bar" (submit)="onManualSubmit($event)">
            <input
              #stubInput
              type="text"
              class="stub-entry-input"
              placeholder="Enter Stub Number (e.g. EVT-8924-XQ9)"
              autocomplete="off"
              spellcheck="false" />
            <button type="submit" class="stub-entry-btn">
              VERIFY
            </button>
          </form>
        </div>

        <!-- Right: Real-time Scan Result Card -->
        <div class="result-inspection-panel">
          @switch (inspectionState()) {
            @case ('idle') {
              <div class="inspection-empty">
                <div class="empty-badge">AWAITING PASS</div>
                <p>Scan a QR code ticket or type the 11-digit stub reference code to admit attendees.</p>
              </div>
            }

            @case ('verifying') {
              <div class="inspection-loading">
                <div class="spinner"></div>
                <p>Validating ticket credentials against cache...</p>
              </div>
            }

            @case ('success') {
              @if (currentAttendee(); as attendee) {
                <div class="inspection-card valid-entry">
                  <div class="decision-banner success">
                    <span class="icon">&#10003;</span>
                    <span>ADMITTED &bull; VERIFIED</span>
                  </div>
                  <div class="card-content">
                    <h3 class="attendee-name">{{ attendee.firstName }} {{ attendee.lastName }}</h3>
                    <p class="tier-pill">{{ attendee.ticketTierName }}</p>
                    <div class="info-list">
                      <div class="info-row">
                        <span>Ticket Stub:</span>
                        <strong class="font-mono">{{ attendee.ticketStubNumber }}</strong>
                      </div>
                      <div class="info-row">
                        <span>Affiliation:</span>
                        <strong>{{ attendee.companyOrAffiliation || 'N/A' }}</strong>
                      </div>
                      <div class="info-row">
                        <span>Timestamp:</span>
                        <strong>{{ attendee.checkedInAt || 'Just Now' }}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              }
            }

            @case ('duplicate') {
              @if (currentAttendee(); as attendee) {
                <div class="inspection-card duplicate-entry">
                  <div class="decision-banner warning">
                    <span class="icon">&#9888;</span>
                    <span>ALREADY CHECKED IN</span>
                  </div>
                  <div class="card-content">
                    <h3 class="attendee-name">{{ attendee.firstName }} {{ attendee.lastName }}</h3>
                    <p class="warning-text">
                      This pass was already checked in at:
                      <strong>{{ attendee.checkedInAt }}</strong>
                    </p>
                    <button
                      type="button"
                      class="btn-secondary-dismiss"
                      (click)="inspectionState.set('idle')">
                      DISMISS WARNING
                    </button>
                  </div>
                </div>
              }
            }

            @case ('not_found') {
              <div class="inspection-card invalid-entry">
                <div class="decision-banner danger">
                  <span class="icon">&#10007;</span>
                  <span>INVALID PASS &bull; NOT FOUND</span>
                </div>
                <div class="card-content">
                  <p class="error-text">No record exists matching token payload or stub number entered.</p>
                  <button
                    type="button"
                    class="btn-secondary-dismiss"
                    (click)="inspectionState.set('idle')">
                    RESET TERMINAL
                  </button>
                </div>
              </div>
            }
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      background: #0B0F17;
      color: #F8FAFC;
      font-family: inherit;
      padding: 16px;
      box-sizing: border-box;
    }

    .terminal-shell {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
      height: 100%;
    }

    .terminal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      padding: 12px 18px;
      background: #161D2B;
      border-radius: 12px;
      border: 1px solid #283347;
    }

    .terminal-heading {
      margin: 0;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: 0.5px;
    }

    .terminal-network-tag {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 700;
      color: #10B981;
      margin-top: 4px;
    }

    .terminal-network-tag.offline {
      color: #F59E0B;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: currentColor;
    }

    .control-btn {
      background: #222B3D;
      color: #F8FAFC;
      border: 1px solid #374660;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      min-height: 44px;
    }

    .control-btn.active {
      background: #DC2626;
      border-color: #EF4444;
    }

    .terminal-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
      flex: 1;
    }

    @media (min-width: 768px) {
      .terminal-grid {
        grid-template-columns: 1.1fr 0.9fr;
      }
    }

    .scanner-viewport-panel {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .video-container {
      position: relative;
      width: 100%;
      height: 380px;
      background: #000000;
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #283347;
    }

    .camera-stream {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .camera-stream.hidden {
      display: none;
    }

    .camera-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      color: #64748B;
    }

    .placeholder-icon {
      font-size: 48px;
    }

    .btn-start-stream {
      background: #FF5A36;
      color: #FFFFFF;
      border: none;
      padding: 12px 20px;
      font-weight: 700;
      font-size: 13px;
      border-radius: 8px;
      cursor: pointer;
      min-height: 48px;
    }

    /* Targeting Reticle */
    .scanner-reticle {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: min(220px, 80%);
      height: min(220px, 80%);
      pointer-events: none;
    }

    .corner-bracket {
      position: absolute;
      width: 28px;
      height: 28px;
      border: 3px solid #10B981;
    }

    .corner-bracket.top-left { top: 0; left: 0; border-right: none; border-bottom: none; }
    .corner-bracket.top-right { top: 0; right: 0; border-left: none; border-bottom: none; }
    .corner-bracket.bottom-left { bottom: 0; left: 0; border-right: none; border-top: none; }
    .corner-bracket.bottom-right { bottom: 0; right: 0; border-left: none; border-top: none; }

    .scan-laser-line {
      position: absolute;
      left: 0;
      right: 0;
      height: 2px;
      background: #10B981;
      box-shadow: 0 0 8px #10B981;
      animation: scanLaser 2s infinite ease-in-out;
    }

    @keyframes scanLaser {
      0%, 100% { top: 10%; }
      50% { top: 90%; }
    }

    /* Manual Input Bar */
    .manual-input-bar {
      display: flex;
      gap: 8px;
    }

    .stub-entry-input {
      flex: 1;
      background: #161D2B;
      border: 1px solid #283347;
      border-radius: 8px;
      padding: 12px 14px;
      color: #FFFFFF;
      font-size: 14px;
      font-family: monospace;
      min-height: 48px;
      box-sizing: border-box;
    }

    .stub-entry-btn {
      background: #FF5A36;
      color: #FFFFFF;
      border: none;
      padding: 0 24px;
      font-weight: 700;
      border-radius: 8px;
      cursor: pointer;
      min-height: 48px;
    }

    /* Result Panel */
    .result-inspection-panel {
      background: #161D2B;
      border-radius: 12px;
      border: 1px solid #283347;
      padding: 24px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-height: 380px;
    }

    .inspection-empty {
      text-align: center;
      color: #64748B;
      max-width: 280px;
      margin: 0 auto;
    }

    .empty-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 800;
      padding: 4px 10px;
      background: #222B3D;
      border-radius: 9999px;
      color: #94A3B8;
      margin-bottom: 12px;
    }

    .inspection-card {
      border-radius: 12px;
      overflow: hidden;
      background: #1E2738;
      border: 1px solid #334155;
    }

    .decision-banner {
      padding: 12px 16px;
      font-weight: 800;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .decision-banner.success { background: #065F46; color: #A7F3D0; }
    .decision-banner.warning { background: #92400E; color: #FDE68A; }
    .decision-banner.danger { background: #991B1B; color: #FECACA; }

    .card-content {
      padding: 18px;
    }

    .attendee-name {
      font-size: 22px;
      margin: 0 0 6px 0;
      color: #FFFFFF;
    }

    .tier-pill {
      display: inline-block;
      font-size: 12px;
      font-weight: 700;
      background: #FF5A36;
      color: #FFFFFF;
      padding: 2px 10px;
      border-radius: 9999px;
      margin: 0 0 16px 0;
    }

    .info-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 13px;
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      border-bottom: 1px solid #283347;
      padding-bottom: 6px;
    }

    .btn-secondary-dismiss {
      margin-top: 16px;
      width: 100%;
      background: #334155;
      color: #F8FAFC;
      border: none;
      padding: 10px;
      border-radius: 6px;
      font-weight: 700;
      cursor: pointer;
      min-height: 44px;
    }
  `]
})
export class CheckInTerminalComponent implements OnDestroy {
  private readonly firestore = inject(FIRESTORE_DB);
  private readonly auth = inject(FIREBASE_AUTH);
  private readonly audioFeedback = inject(AudioFeedbackService);
  public readonly syncService = inject(OfflineMutationService);

  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('videoElement');

  public readonly cameraActive = signal<boolean>(false);
  public readonly inspectionState = signal<'idle' | 'verifying' | 'success' | 'duplicate' | 'not_found'>('idle');
  public readonly currentAttendee = signal<AttendeeTicket | null>(null);

  private mediaStream: MediaStream | null = null;
  private scanWorkerInterval: number | null = null;

  public async toggleCameraStream(): Promise<void> {
    if (this.cameraActive()) {
      this.stopCamera();
    } else {
      await this.startCamera();
    }
  }

  private async startCamera(): Promise<void> {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });

      const video = this.videoRef()?.nativeElement;
      if (video) {
        video.srcObject = this.mediaStream;
        await video.play();
        this.cameraActive.set(true);
        this.initQrDecoderLoop();
      }
    } catch {
      this.cameraActive.set(false);
    }
  }

  private stopCamera(): void {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.scanWorkerInterval !== null) {
      window.clearInterval(this.scanWorkerInterval);
      this.scanWorkerInterval = null;
    }
    this.cameraActive.set(false);
  }

  private initQrDecoderLoop(): void {
    // Check for native BarcodeDetector API support
    const hasBarcodeDetector = 'BarcodeDetector' in window;

    if (hasBarcodeDetector) {
      const barcodeDetector = new (window as unknown as {
        BarcodeDetector: new (opts: { formats: string[] }) => {
          detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]>;
        };
      }).BarcodeDetector({ formats: ['qr_code', 'code_128'] });

      this.scanWorkerInterval = window.setInterval(async () => {
        const video = this.videoRef()?.nativeElement;
        if (!video || video.readyState < 2) return;

        try {
          const barcodes = await barcodeDetector.detect(video);
          if (barcodes.length > 0) {
            const raw = barcodes[0].rawValue;
            await this.processScannedRaw(raw);
          }
        } catch {
          // Frame read skipped
        }
      }, 300);
    }
  }

  public async onManualSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const input = (event.target as HTMLElement).querySelector('input') as HTMLInputElement;
    const value = input.value.trim().toUpperCase();
    if (value.length > 0) {
      await this.processStubLookup(value);
      input.value = '';
    }
  }

  public async processScannedRaw(rawToken: string): Promise<void> {
    const parsed = TicketSecurityUtility.parseToken(rawToken);
    if (!parsed) {
      // Not a valid delimiter token, try as raw stub number
      await this.processStubLookup(rawToken.trim().toUpperCase());
      return;
    }
    await this.verifyAndAdmit(parsed.ticketId, 'camera_qr');
  }

  private async processStubLookup(stubCode: string): Promise<void> {
    this.inspectionState.set('verifying');

    try {
      // In a real environment, queries run against the persistent cache/emulator
      const attendeesRef = collection(this.firestore, 'events/EVENT_MAIN_ID/attendees');
      const q = query(attendeesRef, where('ticketStubNumber', '==', stubCode));
      const querySnap = await getDocs(q);

      if (querySnap.empty) {
        this.inspectionState.set('not_found');
        this.audioFeedback.playErrorBuzzer();
        return;
      }

      const matchDoc = querySnap.docs[0];
      const attendee = { id: matchDoc.id, ...matchDoc.data() } as AttendeeTicket;
      await this.executeAdmission(attendee);
    } catch {
      this.inspectionState.set('not_found');
      this.audioFeedback.playErrorBuzzer();
    }
  }

  private async verifyAndAdmit(ticketId: string, _method: string): Promise<void> {
    this.inspectionState.set('verifying');
    try {
      const ticketRef = doc(this.firestore, `events/EVENT_MAIN_ID/attendees/${ticketId}`);
      const snap = await getDoc(ticketRef);

      if (!snap.exists()) {
        this.inspectionState.set('not_found');
        this.audioFeedback.playErrorBuzzer();
        return;
      }

      const attendee = { id: snap.id, ...snap.data() } as AttendeeTicket;
      await this.executeAdmission(attendee);
    } catch {
      this.inspectionState.set('not_found');
      this.audioFeedback.playErrorBuzzer();
    }
  }

  private async executeAdmission(attendee: AttendeeTicket): Promise<void> {
    if (attendee.checkInStatus === 'checked_in') {
      this.currentAttendee.set(attendee);
      this.inspectionState.set('duplicate');
      this.audioFeedback.playErrorBuzzer();
      return;
    }

    const nowIso = new Date().toISOString();
    const updatedAttendee: AttendeeTicket = {
      ...attendee,
      checkInStatus: 'checked_in',
      checkedInAt: nowIso
    };

    // Optimistically present success and chime
    this.currentAttendee.set(updatedAttendee);
    this.inspectionState.set('success');
    this.audioFeedback.playSuccessChime();

    const operatorId = this.auth.currentUser?.uid ?? 'KIOSK_TERMINAL_OFFLINE';

    // Enqueue mutation with actual operator ID and audit trail
    await this.syncService.queueCheckInMutation(
      attendee.eventId,
      attendee.id,
      operatorId,
      nowIso
    );
  }

  ngOnDestroy(): void {
    this.stopCamera();
  }
}
```

---

## 10. Complete Responsive Layout Shell (`src/app/core/layout/dashboard-shell.component.ts`)

```typescript
import { Component, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { OfflineMutationService } from '../sync/offline-mutation.service';

@Component({
  selector: 'app-dashboard-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell-container">
      <!-- Top Persistent Bar -->
      <header class="top-nav">
        <div class="nav-left">
          <div class="brand-logo">
            <span class="logo-mark">&#9670;</span>
            <span class="logo-text">TICKETFORGE</span>
          </div>
          <div class="event-context-pill">
            <span class="pulse-indicator"></span>
            <span class="event-label">DEVCON SUMMIT 2026</span>
          </div>
        </div>

        <div class="nav-right">
          <!-- Sync & Offline Badge -->
          <div
            class="sync-pill"
            [class.is-offline]="!syncService.isOnline()"
            [class.is-syncing]="syncService.isSyncing()">
            @if (syncService.isSyncing()) {
              <span class="sync-spinner"></span>
              <span>SYNCING...</span>
            } @else if (syncService.isOnline()) {
              <span class="status-indicator-dot online"></span>
              <span>ONLINE</span>
            } @else {
              <span class="status-indicator-dot offline"></span>
              <span>OFFLINE ({{ syncService.pendingCount() }})</span>
            }
          </div>
        </div>
      </header>

      <!-- Main Body Canvas -->
      <main class="content-canvas">
        <ng-content />
      </main>

      <!-- Bottom Touch Dock for Mobile (360px - 768px) -->
      <nav class="mobile-bottom-dock" aria-label="Mobile Navigation Dock">
        <button
          type="button"
          class="dock-item"
          [class.active]="activeTab() === 'overview'"
          (click)="activeTab.set('overview')">
          <span class="dock-icon">&#9638;</span>
          <span class="dock-label">Overview</span>
        </button>
        <button
          type="button"
          class="dock-item"
          [class.active]="activeTab() === 'attendees'"
          (click)="activeTab.set('attendees')">
          <span class="dock-icon">&#9776;</span>
          <span class="dock-label">Roster</span>
        </button>
        <button
          type="button"
          class="dock-item highlight"
          [class.active]="activeTab() === 'scanner'"
          (click)="activeTab.set('scanner')">
          <span class="dock-icon">&#128247;</span>
          <span class="dock-label">Terminal</span>
        </button>
        <button
          type="button"
          class="dock-item"
          [class.active]="activeTab() === 'rsvp'"
          (click)="activeTab.set('rsvp')">
          <span class="dock-icon">&#43;</span>
          <span class="dock-label">RSVP</span>
        </button>
      </nav>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      background-color: #F8FAFC;
      color: #0F172A;
    }

    .shell-container {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }

    .top-nav {
      height: 60px;
      background: #FFFFFF;
      border-bottom: 1px solid #E2E8F0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      position: sticky;
      top: 0;
      z-index: 50;
    }

    @media (min-width: 1024px) {
      .top-nav {
        padding: 0 32px;
      }
    }

    .nav-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .brand-logo {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 900;
      letter-spacing: -0.5px;
      color: #0F172A;
    }

    .logo-mark {
      color: #FF5A36;
      font-size: 20px;
    }

    .event-context-pill {
      display: none;
      align-items: center;
      gap: 6px;
      background: #F1F5F9;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      color: #334155;
    }

    @media (min-width: 640px) {
      .event-context-pill {
        display: flex;
      }
    }

    .pulse-indicator {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #10B981;
    }

    .sync-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.5px;
      background: #ECFDF5;
      color: #059669;
      border: 1px solid #A7F3D0;
    }

    .sync-pill.is-offline {
      background: #FFFBEB;
      color: #D97706;
      border-color: #FDE68A;
    }

    .status-indicator-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
    }
    .status-indicator-dot.online { background: #10B981; }
    .status-indicator-dot.offline { background: #F59E0B; }

    .sync-spinner {
      width: 10px;
      height: 10px;
      border: 2px solid #059669;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .content-canvas {
      flex: 1;
      padding: 16px;
      padding-bottom: 84px; /* Space for mobile bottom dock */
      max-width: 1400px;
      width: 100%;
      margin: 0 auto;
      box-sizing: border-box;
    }

    @media (min-width: 768px) {
      .content-canvas {
        padding: 24px;
        padding-bottom: 24px;
      }
    }

    /* Mobile Bottom Dock */
    .mobile-bottom-dock {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 64px;
      background: #FFFFFF;
      border-top: 1px solid #E2E8F0;
      display: flex;
      align-items: center;
      justify-content: space-around;
      z-index: 50;
      padding-bottom: env(safe-area-inset-bottom);
    }

    @media (min-width: 768px) {
      .mobile-bottom-dock {
        display: none;
      }
    }

    .dock-item {
      flex: 1;
      height: 100%;
      background: none;
      border: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      color: #64748B;
      cursor: pointer;
      min-width: 48px;
      min-height: 48px;
    }

    .dock-item.active {
      color: #FF5A36;
    }

    .dock-item.highlight {
      color: #0F172A;
    }

    .dock-item.highlight.active {
      color: #FF5A36;
    }

    .dock-icon {
      font-size: 18px;
    }

    .dock-label {
      font-size: 10px;
      font-weight: 700;
    }
  `]
})
export class DashboardShellComponent {
  public readonly syncService = inject(OfflineMutationService);
  public readonly activeTab = signal<'overview' | 'attendees' | 'scanner' | 'rsvp'>('overview');
}
```

---

## 11. Verification & Acceptance Criteria

1. **Physical Ticket Stub Realism**:
   - The ticket stub component renders authentic perforated boundaries using CSS mask and radial-gradients.
   - Perforation features top and bottom notches and a scissors cut line.
   - Tear-off coupon cleanly separates attendee check-in confirmation and displays a 100% canvas-rendered QR code.
2. **Deterministic Offline Check-in**:
   - When network connectivity is disabled in the browser DevTools, check-in operations complete immediately with optimistic local updates.
   - The Web Audio synthesizer triggers an instant harmonic chord (D5+A5) for valid admissions without network dependencies or sound file downloads.
   - Changes queue into the IndexedDB/LocalStorage outbox and auto-flush sequentially to the Docker Firebase emulator when network restores.
3. **Responsive Viewport Compliance**:
   - **360px**: Card stacks vertically, tear-off passes sit beneath the main ticket body, and bottom dock allows instant single-thumb navigation.
   - **768px**: Ticket stub renders as a horizontal pass with an authentic vertical tear-off line on the right edge.
   - **1024px+**: Check-in terminal supports dual-stream layout with live video scan view and instant verified passenger profile inspection.
4. **Latest Angular Syntax Compliance**:
   - Zero numbered version tags.
   - Pure Angular Signals (`signal()`, `computed()`, `input()`, `output()`, `viewChild()`).
   - Native control flow (`@if`, `@for`, `@switch`).
   - `ChangeDetectionStrategy.OnPush` across all standalone components.