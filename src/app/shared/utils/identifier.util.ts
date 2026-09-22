/**
 * Canonical unique identifier generator.
 *
 * Every order, ticket, outbox mutation and audit document needs an id, and each
 * call site used to carry its own near-identical copy of this logic. Keeping one
 * implementation means the CSPRNG path and the legacy fallback stay in step.
 *
 * Ids are opaque: nothing parses them, so only the shape that callers already
 * depend on is preserved here.
 */

/**
 * Produces a unique identifier, preferring `crypto.randomUUID`.
 *
 * @returns A RFC 4122 UUID where available, otherwise a timestamp-plus-entropy id.
 */
export function createIdentifier(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Produces a hyphen-free alphanumeric identifier of a bounded length.
 *
 * Used where the id is embedded in a human-facing reference or a printed token and
 * the full UUID form is undesirable.
 *
 * @param length Maximum number of characters to return; defaults to 16.
 * @returns A lower-case alphanumeric id, at most `length` characters long.
 */
export function createShortIdentifier(length = 16): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, length);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, length);
}
