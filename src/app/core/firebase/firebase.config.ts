/**
 * Modular Firebase wiring for the ticketing dashboard.
 *
 * The service is intentionally DI driven: every SDK handle is exposed through an
 * `InjectionToken` so feature stores never import the Firebase singleton
 * directly and remain trivially testable.
 *
 * Offline strategy (see `plan.md` §5.2):
 * - Emulator mode uses an in-memory cache so a wiped emulator dataset does not
 *   resurrect ghost documents from IndexedDB.
 * - Cloud mode enables `persistentLocalCache` with the multi-tab manager, which
 *   gives durable IndexedDB caching shared across browser tabs.
 */

import { InjectionToken, makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore
} from 'firebase/firestore';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';

import {
  resolveFirebaseEnvironmentConfig,
  type FirebaseEnvironmentConfig
} from './firebase-environment';
import { TicketSecurityUtility } from '../../shared/utils/ticket-cryptography';

export type { FirebaseEnvironmentConfig } from './firebase-environment';

/** Build-time Firebase configuration (see `.env.example`). */
export const FIREBASE_CONFIG = new InjectionToken<FirebaseEnvironmentConfig>('FIREBASE_CONFIG');

/** Initialized Firebase application instance. */
export const FIREBASE_APP = new InjectionToken<FirebaseApp>('FIREBASE_APP');

/** Cloud Firestore handle, backed by the persistent multi-tab cache. */
export const FIRESTORE_DB = new InjectionToken<Firestore>('FIRESTORE_DB');

/** Firebase Authentication handle. */
export const FIREBASE_AUTH = new InjectionToken<Auth>('FIREBASE_AUTH');

/** Cloud Storage handle used for event banners and attachments. */
export const FIREBASE_STORAGE = new InjectionToken<FirebaseStorage>('FIREBASE_STORAGE');

/** Aggregate returned by {@link provideFirebaseApp}. */
export interface FirebaseInstances {
  readonly app: FirebaseApp;
  readonly firestore: Firestore;
  readonly auth: Auth;
  readonly storage: FirebaseStorage;
}

/**
 * Module level cache keyed by project id.
 *
 * `initializeApp`/`initializeFirestore` throw when called twice for the same
 * project, which happens during Vite HMR module re-evaluation and whenever a
 * provider factory is evaluated more than once. Reusing the cached instance
 * keeps those flows idempotent.
 */
const instanceCache = new Map<string, FirebaseInstances>();

/**
 * Initializes (or reuses) the Firebase SDK graph for the given configuration.
 *
 * @param config Resolved Firebase environment configuration.
 * @returns The application plus the Firestore, Auth and Storage handles.
 */
export function provideFirebaseApp(config: FirebaseEnvironmentConfig): FirebaseInstances {
  const cached = instanceCache.get(config.projectId);
  if (cached !== undefined) {
    return cached;
  }

  const app = getApps().length > 0 ? getApp() : initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId
  });

  const firestore = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: config.useEmulator
      ? memoryLocalCache()
      : persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        })
  });

  const auth = getAuth(app);
  const storage = getStorage(app);

  if (config.useEmulator) {
    connectFirestoreEmulator(firestore, config.emulatorHost, config.emulatorPorts.firestore);
    connectAuthEmulator(auth, `http://${config.emulatorHost}:${config.emulatorPorts.auth}`, {
      disableWarnings: true
    });
    connectStorageEmulator(storage, config.emulatorHost, config.emulatorPorts.storage);
  }

  const instances: FirebaseInstances = { app, firestore, auth, storage };
  instanceCache.set(config.projectId, instances);
  return instances;
}

/**
 * Registers every Firebase handle in the Angular injector.
 *
 * @param config Optional explicit configuration; falls back to the build-time
 *   environment resolved by `resolveFirebaseEnvironmentConfig()`.
 */
export function provideTicketingFirebase(
  config: FirebaseEnvironmentConfig = resolveFirebaseEnvironmentConfig()
): EnvironmentProviders {
  if (config.warning !== null) {
    // Surfaced once at bootstrap so a misconfigured deployment is obvious.
    console.warn(`[Event Stub Dashboard] ${config.warning}`);
  }

  // Keying the ticket digest must happen before any pass is minted or verified, so
  // it is applied here rather than at each call site.
  TicketSecurityUtility.setVerificationSecret(
    import.meta.env?.['VITE_TICKET_VERIFICATION_SECRET']
  );

  const instances = provideFirebaseApp(config);

  return makeEnvironmentProviders([
    { provide: FIREBASE_CONFIG, useValue: config },
    { provide: FIREBASE_APP, useValue: instances.app },
    { provide: FIRESTORE_DB, useValue: instances.firestore },
    { provide: FIREBASE_AUTH, useValue: instances.auth },
    { provide: FIREBASE_STORAGE, useValue: instances.storage }
  ]);
}
