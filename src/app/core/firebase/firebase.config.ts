import { InjectionToken } from '@angular/core';
import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
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

export function provideFirebaseApp(config: FirebaseEnvironmentConfig): {
  app: FirebaseApp;
  firestore: Firestore;
  auth: Auth;
} {
  const app = initializeApp({
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId
  });

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
