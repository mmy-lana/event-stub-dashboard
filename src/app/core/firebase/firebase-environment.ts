/**
 * Environment resolution for the Firebase client.
 *
 * Vite injects every variable as an optional string, so this module owns all
 * parsing, defaulting and validation. It is deliberately free of Angular
 * imports so it can also be executed by Node scripts (emulator seeding, CI
 * smoke checks) without bootstrapping a browser platform.
 */

/** Fully resolved Firebase client configuration used across the app. */
export interface FirebaseEnvironmentConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly storageBucket: string;
  readonly messagingSenderId: string;
  readonly appId: string;
  readonly useEmulator: boolean;
  readonly emulatorHost: string;
  readonly emulatorPorts: EmulatorPorts;
}

/** TCP ports exposed by the Docker based Firebase Emulator Suite. */
export interface EmulatorPorts {
  readonly firestore: number;
  readonly auth: number;
  readonly storage: number;
}

/** Shape of the raw environment bag (`import.meta.env` compatible). */
export interface FirebaseEnvironmentSource {
  readonly [key: string]: string | boolean | undefined;
}

/** Thrown when the environment cannot be turned into a usable configuration. */
export class FirebaseEnvironmentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'FirebaseEnvironmentError';
  }
}

/** Project id used by the bundled `docker-compose.yml` emulator stack. */
export const DEFAULT_FIREBASE_PROJECT_ID = 'event-rsvp-ticketing';

/** Loopback host used when the emulator flag is enabled but no host is set. */
export const DEFAULT_EMULATOR_HOST = '127.0.0.1';

/** Published emulator ports; mirrors `docker-compose.yml`. */
export const DEFAULT_EMULATOR_PORTS: EmulatorPorts = {
  firestore: 8080,
  auth: 9099,
  storage: 9199
};

/**
 * Normalizes a raw environment value into a trimmed string.
 *
 * @param value Raw value coming from `import.meta.env`.
 * @returns The trimmed string, or `undefined` when empty/absent.
 */
function readString(value: string | boolean | undefined): string | undefined {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Parses a permissive boolean flag (`true/1/yes/on` are truthy).
 *
 * @param value Raw environment value.
 * @param fallback Value returned when the flag is absent or unrecognized.
 */
function readBoolean(value: string | boolean | undefined, fallback: boolean): boolean {
  const raw = readString(value)?.toLowerCase();
  if (raw === undefined) {
    return fallback;
  }
  if (['true', '1', 'yes', 'on', 'enabled'].includes(raw)) {
    return true;
  }
  if (['false', '0', 'no', 'off', 'disabled'].includes(raw)) {
    return false;
  }
  return fallback;
}

/**
 * Parses a TCP port, falling back to the supplied default.
 *
 * @throws {FirebaseEnvironmentError} When the value is not a valid port.
 */
function readPort(value: string | boolean | undefined, fallback: number, label: string): number {
  const raw = readString(value);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new FirebaseEnvironmentError(
      `Invalid ${label} "${raw}". Expected an integer between 1 and 65535.`
    );
  }
  return parsed;
}

/**
 * Resolves the Firebase client configuration from the build-time environment.
 *
 * Emulator mode is detected from `VITE_USE_FIREBASE_EMULATOR`; when a local dev
 * build leaves the Firebase keys unset the demo project credentials are used so
 * the emulator suite (which never validates API keys) still boots.
 *
 * @param env Raw environment bag; defaults to `import.meta.env`.
 * @returns A frozen, fully typed configuration object.
 * @throws {FirebaseEnvironmentError} When a provided value is malformed.
 */
export function resolveFirebaseEnvironmentConfig(
  env: FirebaseEnvironmentSource = import.meta.env
): FirebaseEnvironmentConfig {
  const useEmulator = readBoolean(env['VITE_USE_FIREBASE_EMULATOR'], false);
  const projectId = readString(env['VITE_FIREBASE_PROJECT_ID']) ?? DEFAULT_FIREBASE_PROJECT_ID;

  const apiKey = readString(env['VITE_FIREBASE_API_KEY']);
  const appId = readString(env['VITE_FIREBASE_APP_ID']);

  if (!useEmulator && (apiKey === undefined || appId === undefined)) {
    throw new FirebaseEnvironmentError(
      'Production Firebase configuration is incomplete: VITE_FIREBASE_API_KEY and ' +
        'VITE_FIREBASE_APP_ID are required when VITE_USE_FIREBASE_EMULATOR is disabled.'
    );
  }

  const emulatorHost = readString(env['VITE_FIREBASE_EMULATOR_HOST']) ?? DEFAULT_EMULATOR_HOST;

  const emulatorPorts: EmulatorPorts = {
    firestore: readPort(
      env['VITE_FIREBASE_EMULATOR_FIRESTORE_PORT'],
      DEFAULT_EMULATOR_PORTS.firestore,
      'Firestore emulator port'
    ),
    auth: readPort(
      env['VITE_FIREBASE_EMULATOR_AUTH_PORT'],
      DEFAULT_EMULATOR_PORTS.auth,
      'Auth emulator port'
    ),
    storage: readPort(
      env['VITE_FIREBASE_EMULATOR_STORAGE_PORT'],
      DEFAULT_EMULATOR_PORTS.storage,
      'Storage emulator port'
    )
  };

  return Object.freeze({
    apiKey: apiKey ?? 'demo-api-key',
    authDomain: readString(env['VITE_FIREBASE_AUTH_DOMAIN']) ?? `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: readString(env['VITE_FIREBASE_STORAGE_BUCKET']) ?? `${projectId}.appspot.com`,
    messagingSenderId: readString(env['VITE_FIREBASE_MESSAGING_SENDER_ID']) ?? '123456789',
    appId: appId ?? '1:123456789:web:abcdef',
    useEmulator,
    emulatorHost,
    emulatorPorts: Object.freeze(emulatorPorts)
  });
}

/** Builds the emulator origin for a given port, e.g. `http://127.0.0.1:8080`. */
export function resolveEmulatorOrigin(config: FirebaseEnvironmentConfig, port: number): string {
  return `http://${config.emulatorHost}:${port}`;
}
