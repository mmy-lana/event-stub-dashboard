/**
 * Offline ticket verification utilities.
 *
 * Every issued pass carries a three-part token:
 *
 * ```
 * TICKET_ID::STUB_NUMBER::HASH
 * ```
 *
 * where `HASH` is a keyed FNV-1a digest of `TICKET_ID__STUB_NUMBER__EVENT_ID` plus
 * the configured verification secret, rendered as a fixed-width 8-character
 * lower-case hex string (zero padded). The digest is a tamper-detection checksum,
 * not a signature — it lets a kiosk reject hand-typed or re-encoded passes without
 * a network round trip, while the authoritative admission decision still happens
 * inside a Firestore transaction.
 *
 * {@link TicketSecurityUtility.generateVerifiableToken} and
 * {@link TicketSecurityUtility.verifyPayload} must render the digest identically.
 *
 * Changing the secret invalidates every pass already stored in
 * `attendees/{id}.qrVerificationSecret`: those tokens were minted with the previous
 * key and will verify as `tampered`. Re-issue passes after any key change.
 *
 * Depends only on `VALIDATION_RULES` from the domain model.
 */

import { VALIDATION_RULES } from '../../core/models/ticket.model';

/** Parsed representation of a scanned ticket token. */
export interface TicketTokenPayload {
  readonly ticketId: string;
  readonly stubNumber: string;
  readonly hash: string;
}

/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET_BASIS = 0x811c9dc5;

/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193;

/** Characters used for stub and coupon codes (no ambiguous 0/O/1/I). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Characters used for the numeric segment of a stub number. */
const DIGIT_ALPHABET = '0123456789';

/**
 * Fallback salt used when no verification secret is configured at runtime.
 *
 * The value ships inside the client bundle either way, so it is obscurity rather
 * than a secret: it defeats forging a pass from the public `TICKET_ID::STUB::`
 * plaintext, but a reader of the bundle can still compute valid digests. Treat a
 * real guarantee as requiring a server-issued signature.
 *
 * Set `VITE_TICKET_VERIFICATION_SECRET` to override it per environment. Note that
 * Vite inlines `VITE_*` values at build time, so the override is compiled into the
 * bundle too — it enables rotation between deployments, not secrecy.
 *
 * The literal below intentionally keeps its original `STUBDECK_` prefix. It is a
 * digest key, not a display string: changing it changes every digest, and every pass
 * already stored in `attendees/{id}.qrVerificationSecret` would begin verifying as
 * `tampered`. Rebranding this value would silently invalidate all issued passes, so
 * it may only change together with a re-issue of every ticket.
 */
const DEFAULT_VERIFICATION_SECRET = 'STUBDECK_GATE_SECURITY_SALT_9841';

/** Ticket security helpers. Digest rendering is pure; the key is configurable. */
export class TicketSecurityUtility {
  /** Key mixed into every digest; defaults to {@link DEFAULT_VERIFICATION_SECRET}. */
  private static verificationSecret = DEFAULT_VERIFICATION_SECRET;

  /**
   * Overrides the digest key, typically from `VITE_TICKET_VERIFICATION_SECRET` at
   * bootstrap.
   *
   * Blank and non-string values are ignored so an unset variable keeps the default
   * rather than silently keying every digest with an empty string.
   *
   * @param secret Candidate secret; ignored when absent or blank.
   */
  public static setVerificationSecret(secret: string | undefined): void {
    if (typeof secret === 'string' && secret.trim().length > 0) {
      TicketSecurityUtility.verificationSecret = secret.trim();
    }
  }
  /**
   * Creates a verifiable QR code payload.
   *
   * Format: `TICKET_ID::STUB_NUMBER::HASH`
   *
   * @param ticketId Firestore document id of the attendee ticket.
   * @param stubNumber Printed stub reference, e.g. `EVT-8924-XQ9`.
   * @param eventId Owning event id; binds the token to a single event.
   */
  public static generateVerifiableToken(
    ticketId: string,
    stubNumber: string,
    eventId: string
  ): string {
    const payloadRaw = TicketSecurityUtility.buildHashInput(ticketId, stubNumber, eventId);
    const hashFragment = TicketSecurityUtility.computeSaltedDigest(payloadRaw);
    return `${ticketId}${VALIDATION_RULES.QR_HASH_SEPARATOR}${stubNumber}${
      VALIDATION_RULES.QR_HASH_SEPARATOR
    }${hashFragment}`;
  }

  /**
   * Parses and validates the format of a scanned string.
   *
   * @param rawScan Raw scanner payload, with or without leading whitespace.
   * @returns The parsed token, or `null` when the payload is not a ticket token.
   */
  public static parseToken(rawScan: string): TicketTokenPayload | null {
    if (typeof rawScan !== 'string') {
      return null;
    }

    const parts = rawScan.trim().split(VALIDATION_RULES.QR_HASH_SEPARATOR);
    if (parts.length !== 3) {
      return null;
    }

    const [ticketId, stubNumber, hash] = parts.map((part) => part.trim());
    if (ticketId.length === 0 || stubNumber.length === 0 || hash.length === 0) {
      return null;
    }

    return { ticketId, stubNumber, hash };
  }

  /**
   * Verifies the integrity hash of a scanned token.
   *
   * @param rawScan Raw scanner payload.
   * @param eventId Event the scan is being validated against.
   * @returns `true` only when the token parses and its hash matches.
   */
  public static verifyToken(rawScan: string, eventId: string): boolean {
    const parsed = TicketSecurityUtility.parseToken(rawScan);
    if (parsed === null) {
      return false;
    }

    // The digest segment is compared case-insensitively: hardware scanners may
    // hand back an uppercased payload, while ticket ids and stub numbers are
    // matched verbatim.
    return TicketSecurityUtility.verifyPayload(parsed, eventId);
  }

  /**
   * Verifies a parsed token payload against the recomputed digest.
   *
   * @param payload Parsed token parts.
   * @param eventId Event the token was issued for.
   */
  public static verifyPayload(payload: TicketTokenPayload, eventId: string): boolean {
    const expected = TicketSecurityUtility.computeSaltedDigest(
      TicketSecurityUtility.buildHashInput(payload.ticketId, payload.stubNumber, eventId)
    );
    return TicketSecurityUtility.constantTimeEquals(
      payload.hash.trim().toLowerCase().padStart(8, '0'),
      expected
    );
  }

  /** Computes a keyed tamper-detection digest over token segments. */
  private static computeSaltedDigest(input: string): string {
    const salted = `${input}::${TicketSecurityUtility.verificationSecret}`;
    return TicketSecurityUtility.computeFnv1aHash(salted).toString(16).padStart(8, '0');
  }

  /**
   * Generates a printed stub number, e.g. `EVT-8924-XQ9`.
   *
   * Matches {@link VALIDATION_RULES.TICKET_STUB_REGEX}.
   *
   * @param prefix 3–4 letter event prefix (defaults to `EVT`).
   */
  public static generateStubNumber(prefix = 'EVT'): string {
    const safePrefix = TicketSecurityUtility.normalizePrefix(prefix);
    const numeric = TicketSecurityUtility.randomFrom(DIGIT_ALPHABET, 4);
    const suffix = TicketSecurityUtility.randomFrom(CODE_ALPHABET, 3);
    return `${safePrefix}-${numeric}-${suffix}`;
  }

  /**
   * Builds the human readable Code 128 payload printed under a stub, e.g.
   * `EVT-8924-XQ9-SEC4-DOOR-B`.
   *
   * @param stubNumber Printed stub reference.
   * @param section Section or zone the pass admits to.
   * @param gate Door or gate label.
   */
  public static generateBarcodeValue(
    stubNumber: string,
    section = 'GA',
    gate = 'MAIN'
  ): string {
    const sectionCode = TicketSecurityUtility.normalizeCode(section, 4);
    const gateCode = TicketSecurityUtility.normalizeCode(gate, 4);
    return `${stubNumber.trim().toUpperCase()}-${sectionCode}-${gateCode}`;
  }

  /**
   * Extracts the stub number from a scanned barcode payload.
   *
   * @param rawScan Raw scanner payload (bare stub number or full barcode value).
   * @returns The stub number when present and well formed, otherwise `null`.
   */
  public static extractStubNumber(rawScan: string): string | null {
    if (typeof rawScan !== 'string') {
      return null;
    }

    const normalized = TicketSecurityUtility.sanitizeScanInput(rawScan);
    const candidate = normalized.split('-').slice(0, 3).join('-');

    return VALIDATION_RULES.TICKET_STUB_REGEX.test(candidate) ? candidate : null;
  }

  /**
   * Validates a stub number against the printed format.
   *
   * @param stubNumber Candidate stub reference.
   */
  public static isValidStubNumber(stubNumber: string): boolean {
    return (
      typeof stubNumber === 'string' &&
      VALIDATION_RULES.TICKET_STUB_REGEX.test(TicketSecurityUtility.sanitizeScanInput(stubNumber))
    );
  }

  /**
   * Normalizes scanner output: uppercased, whitespace and zero-width characters
   * removed, so OCR and laser-scanner artifacts do not cause false rejections.
   *
   * @param rawScan Raw scanner payload.
   */
  public static sanitizeScanInput(rawScan: string): string {
    if (typeof rawScan !== 'string') {
      return '';
    }
    return rawScan
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, '')
      .toUpperCase();
  }

  /**
   * Compares two strings without short-circuiting on the first differing byte.
   *
   * @param left First value.
   * @param right Second value.
   */
  public static constantTimeEquals(left: string, right: string): boolean {
    if (left.length !== right.length) {
      return false;
    }

    let mismatch = 0;
    for (let index = 0; index < left.length; index += 1) {
      mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return mismatch === 0;
  }

  /** Builds the canonical hash input for a ticket token. */
  private static buildHashInput(ticketId: string, stubNumber: string, eventId: string): string {
    return `${ticketId.trim()}__${stubNumber.trim()}__${eventId.trim()}`;
  }

  /**
   * FNV-1a non-cryptographic hash for quick offline integrity verification.
   *
   * @param str Input string.
   * @returns Unsigned 32-bit digest.
   */
  private static computeFnv1aHash(str: string): number {
    let hash = FNV_OFFSET_BASIS;
    for (let index = 0; index < str.length; index += 1) {
      hash ^= str.charCodeAt(index);
      hash = Math.imul(hash, FNV_PRIME);
    }
    return hash >>> 0;
  }

  /** Uppercases and constrains an event prefix to 3–4 letters. */
  private static normalizePrefix(prefix: string): string {
    const letters = (prefix || 'EVT').toUpperCase().replace(/[^A-Z]/g, '');
    const padded = letters.padEnd(3, 'X');
    return padded.slice(0, 4);
  }

  /** Uppercases and constrains an alphanumeric code to a fixed length. */
  private static normalizeCode(value: string, length: number): string {
    const cleaned = (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return cleaned.padEnd(length, 'X').slice(0, length);
  }

  /** Draws `length` characters from an alphabet using a CSPRNG when available. */
  private static randomFrom(alphabet: string, length: number): string {
    const randomValues = createRandomValues(length);
    let output = '';
    for (let index = 0; index < length; index += 1) {
      output += alphabet.charAt(randomValues[index] % alphabet.length);
    }
    return output;
  }
}

/**
 * Produces `length` unbiased-enough random integers.
 *
 * Uses `crypto.getRandomValues` when the runtime exposes it and falls back to
 * `Math.random` (documented, non-security-critical: stub numbers are printed
 * identifiers, not secrets).
 */
function createRandomValues(length: number): Uint32Array {
  const values = new Uint32Array(length);

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(values);
    return values;
  }

  for (let index = 0; index < length; index += 1) {
    values[index] = Math.floor(Math.random() * 0xffffffff);
  }
  return values;
}
