import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
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

const instances = provideFirebaseApp(environmentFirebaseConfig);

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    {
      provide: FIREBASE_CONFIG,
      useValue: environmentFirebaseConfig
    },
    {
      provide: FIREBASE_APP,
      useValue: instances.app
    },
    {
      provide: FIRESTORE_DB,
      useValue: instances.firestore
    },
    {
      provide: FIREBASE_AUTH,
      useValue: instances.auth
    }
  ]
};
