import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

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
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' })
    ),
    provideTicketingFirebase(resolveFirebaseEnvironmentConfig())
  ]
};
