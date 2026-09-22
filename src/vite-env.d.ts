/// <reference types="vite/client" />

/**
 * Compile-time contract for the environment variables consumed by the
 * dashboard. Values are always injected as strings by Vite; consumers must
 * parse them (see `resolveFirebaseEnvironmentConfig`).
 */
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_USE_FIREBASE_EMULATOR?: string;
  readonly VITE_FIREBASE_EMULATOR_HOST?: string;
  readonly VITE_FIREBASE_EMULATOR_FIRESTORE_PORT?: string;
  readonly VITE_FIREBASE_EMULATOR_AUTH_PORT?: string;
  readonly VITE_FIREBASE_EMULATOR_STORAGE_PORT?: string;
  readonly VITE_TICKET_VERIFICATION_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
