import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';

import { routes } from './app.routes';
import { provideTicketingFirebase } from './core/firebase/firebase.config';
import { resolveFirebaseEnvironmentConfig } from './core/firebase/firebase-environment';

/**
 * Application bootstrap configuration.
 *
 * Firebase is initialized exactly once through `provideTicketingFirebase()`,
 * which registers the app, Firestore, Auth and Storage handles as injectable
 * tokens (see `core/firebase/firebase.config.ts`).
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      // Route parameters, query parameters and resolved data bind directly to the
      // matching component inputs (e.g. `ticketId` on the pass detail screen).
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' })
    ),
    provideTicketingFirebase(resolveFirebaseEnvironmentConfig())
  ]
};
