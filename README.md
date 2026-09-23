# StubDeck | Event RSVP & Ticketing Dashboard

> High-throughput, offline-first admission terminal and ticket stub platform built with Angular Signals, modular Firebase, and zero-dependency ISO matrix encoders.

[Live Deployment: event-stub-dashboard.vercel.app](https://event-stub-dashboard.vercel.app)

---

## Executive Overview

Most ticketing web applications fail at the venue door: cell reception collapses inside underground convention halls, concurrent scans oversell tier quotas, and asset-heavy scanner interfaces lag on field mobile devices.

**StubDeck** is engineered as a resilient, Tier-1 gate admission and ticketing system that operates with deterministic reliability across flaky connections or total offline blackouts. It blends modern Eventbrite operational workflows with skeuomorphic physical ticket stubs, backed by an atomic transaction engine and client-side cryptographic verification.

```
                    +------------------------------------------+
                    |       Angular Standalone Application     |
                    |   (Signal-Driven, OnPush, Web Audio)     |
                    +---------------------+--------------------+
                                          |
                      +-------------------+--------------------+
                      |                                        |
           [ Angular State Stores ]                [ Synthesizer Service ]
           - EventDashboardStore                   - Web Audio API (Sine/Saw)
           - CheckInTerminalStore                  - D5+A5 Admission Chimes
           - OfflineMutationService                - Auto-Disconnect Memory GC
                      |
     +----------------+----------------+
     |                                 |
[ Modular Firebase SDK ]     [ Local IndexedDB Store ]
- memoryLocalCache (Dev)     - Persistent Mutation Outbox
- persistentLocalCache (Prod)- Continuous Queue Drain Engine
- Transactional Pre-checks   - Re-entrant Deduplication
     |
     +----------------+----------------+
                      |
         +------------+------------+
         |                         |
[ Docker Emulator Suite ]  [ Production Firestore ]
- Auth :9099               - Role-based Rules
- Firestore :8080          - Scoped Claims
- Storage :9199            - Append-only Audit Logs
```

---

## Core Engineering Highlights

### 1. Offline Gate Survivability (IndexedDB Outbox Engine)
* **Zero Dropped Passes:** Scans performed while disconnected commit instantly to an IndexedDB outbox (`stubdeck_offline_db`) and update local signal stores optimistically.
* **Continuous Drain Loop:** Upon network reconnection, `OfflineMutationService` drains the queue sequentially. Mutations queued in the middle of an in-flight sync cycle are captured without queue starvation.
* **Idempotent Reconciliation:** Server-side `runTransaction` checks guard against duplicate admissions and audit-trail drift, preventing double-counts when multiple kiosks synchronize simultaneously.

### 2. Zero-Dependency ISO Symbol Encoders
* **ISO/IEC 18004 QR Matrix Generator:** Pure TypeScript implementation of Galois-Field Reed-Solomon error correction, interleaving, and penalty-mask selection. Generates scannable QR passes directly on HTML5 canvas with no third-party CDN or binary dependencies.
* **ISO/IEC 15417 Code 128 Engine:** Code Set B encoder with native mod-103 check-symbol calculations, rendering hardware-scannable barcodes as scalable SVG vector bars.

### 3. Cryptographic Tamper Detection
* Every tear-off pass carries a keyed verification token:
  ```
  TICKET_ID::STUB_NUMBER::SALTED_HASH
  ```
* Tokens are verified in constant time (`TicketSecurityUtility.constantTimeEquals`) against a runtime-injected environment salt (`VITE_TICKET_VERIFICATION_SECRET`), eliminating offline ticket forgery.

### 4. Zero-Asset Synthesized Audio Feedback
* **Instant Acoustic Cues:** Replaces network-fetched MP3/WAV files with real-time Web Audio API oscillators.
* **Harmonic Success Chord:** High-register D5 (587.33 Hz) + A5 (880.00 Hz) sine wave combination.
* **Dissonant Warning Buzzer:** Dual low-register D3 (146.83 Hz) + C#3 (138.59 Hz) sawtooth tone.
* **Node Lifecycle Management:** Explicit `onended` garbage collection disconnects gain and oscillator nodes from the audio graph, preventing memory leaks during 8+ hour continuous scanning shifts.

### 5. Atomic Capacity Reservations
* Checkout reservations execute within single atomic Firestore transactions: reads precede writes, quotas decrement conditionally, and orders/tickets are minted atomically to prevent overselling on flash-sale tiers.

---

## Technical Stack Matrix

| Layer | Technologies & Standards |
| :--- | :--- |
| **Framework** | Angular (Standalone Components, Signals, Signal Queries, OnPush Change Detection) |
| **Styling & Theme** | Modern Eventbrite Aesthetic, Skeuomorphic Perforated Ticket Notches, Tailwind CSS v4 |
| **Cloud Infrastructure** | Firebase Cloud Firestore, Authentication, Cloud Storage, Security Rules |
| **Offline Persistence** | Native IndexedDB API, Firebase Multi-Tab Cache Manager |
| **Symbol Standards** | ISO/IEC 18004 (QR Code), ISO/IEC 15417 (Code 128 Barcode) |
| **Audio Synthesizer** | Web Audio API (`AudioContext`, `GainNode`, `OscillatorNode`) |
| **Build & Tooling** | Vite, AnalogJS Vite Plugin, TypeScript (Strict Mode), pnpm |
| **Emulation** | Docker Compose, Firebase Local Emulator Suite (OpenJDK 21 Headless) |

---

## Responsive Viewport Validation

Tested and hardened across standard mobile, tablet, and desktop viewports. Critical actions strictly avoid hover dependencies and guarantee a minimum touch target of 44x44px (48px default for field controls).

| Breakpoint | Target Screen | UI Structural Behavior |
| :--- | :--- | :--- |
| **360px** | Small Handhelds | Ticket stub folds vertically; actions lock to sticky thumb dock; 2x2 counter grid. |
| **390px** | Modern Phones | 16px fluid grid margins; search drawer collapses; full-width stepper buttons. |
| **430px** | Large Handhelds | Extended roster rows with inline status chips and side-by-side action controls. |
| **768px** | Tablets / iPads | Split kiosk view (Camera Stream + Live Activity Feed); horizontal perforated stub. |
| **1024px+** | Desktop Terminals | Full 3-column overview: Real-time KPIs, live arrival feed, and tier quota health. |

---

## Quick Start (Local Development)

### Prerequisites
* Node.js (Active LTS)
* pnpm (`corepack enable pnpm`)
* Docker and Docker Compose (for local Firebase emulation)

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/your-org/event-stub-dashboard.git
cd event-stub-dashboard
pnpm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```
Default `.env` settings connect directly to the local Docker Firebase Emulator suite (`127.0.0.1:8080`).

### 3. Start Local Firebase Emulator
```bash
pnpm emulator:up
```
* Firestore Emulator: `localhost:8080`
* Auth Emulator: `localhost:9099`
* Storage Emulator: `localhost:9199`
* Emulator Web UI: `localhost:4000`

### 4. Run Development Server
```bash
pnpm dev
```
Open `http://localhost:3000` in your browser. The application detects the emulator and offers a one-click seed button to populate a full conference dataset with pre-issued tiers, orders, and tickets.

---

## Verification & Build Commands

* **Static Typecheck:**
  ```bash
  pnpm typecheck
  ```
* **Production Build:**
  ```bash
  pnpm build
  ```
* **Deploy Security Rules:**
  ```bash
  pnpm deploy:rules
  ```
* **Stop Docker Emulator:**
  ```bash
  pnpm emulator:down
  ```

---

## Security & Architecture Audit Compliance

* [x] **OWASP Top 10 Enforced:** Firestore production rules strictly restrict unauthenticated mutations and validate order creation statuses.
* [x] **Tamper Detection:** QR passes require cryptographic token fragments with constant-time equality checks.
* [x] **WCAG 2.5.5 / 2.5.8 Compliance:** All interactive elements maintain accessible hit targets across all breakpoints.
* [x] **Zero External Asset Latency:** Pure client-side synthesis for barcodes, QR codes, and acoustic feedback.
* [x] **Zero Decorative Emojis:** Interface iconography adheres to standard inline SVGs and high-contrast status tokens.
