/**
 * Locale-aware date and time helpers built exclusively on `Intl.DateTimeFormat`
 * and `Intl.RelativeTimeFormat`.
 *
 * No `moment`/`dayjs`/`date-fns` dependency: every function is a thin, cached
 * wrapper over the platform ICU data, which keeps the kiosk bundle small and
 * works fully offline.
 *
 * All inputs are ISO 8601 strings, matching the domain model contract. Invalid
 * or missing input never throws — the helpers return an explicit fallback so
 * templates stay branch-free.
 */

/** Fallback rendered whenever a timestamp cannot be parsed. */
export const INVALID_DATE_FALLBACK = '—';

/** Options accepted by the date formatting helpers. */
export interface DateFormatOptions {
  /** BCP-47 locale tag; defaults to the runtime locale. */
  readonly locale?: string;
  /** IANA time zone; defaults to the runtime zone or UTC when invalid. */
  readonly timeZone?: string;
}

/** Memoized `Intl.DateTimeFormat` instances, keyed by locale + option payload. */
const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();

/** Memoized `Intl.RelativeTimeFormat` instances, keyed by locale. */
const relativeFormatCache = new Map<string, Intl.RelativeTimeFormat>();

/**
 * Parses an ISO 8601 timestamp.
 *
 * @param value ISO string (or `null`/`undefined`).
 * @returns A valid `Date`, or `null` when the value cannot be parsed.
 */
export function parseIsoTimestamp(value: string | null | undefined): Date | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Normalizes a timestamp-like value (ISO string or `Date`) into a valid `Date`.
 *
 * @param value ISO string, `Date`, `null` or `undefined`.
 * @returns A valid `Date`, or `null` when the value cannot be parsed.
 */
export function toDate(value: string | Date | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  return parseIsoTimestamp(value);
}

/**
 * Validates an IANA time zone identifier.
 *
 * @param timeZone Candidate identifier, e.g. `America/Los_Angeles`.
 */
export function isValidTimeZone(timeZone: string | undefined): boolean {
  if (typeof timeZone !== 'string' || timeZone.trim().length === 0) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/** Date/time formatting helpers. */
export class DateFormatUtility {
  /**
   * Renders a full date and time, e.g. `Oct 24, 2026, 9:00 AM`.
   *
   * @param iso ISO 8601 timestamp.
   * @param options Locale and time zone overrides.
   */
  public static formatDateTime(iso: string | null | undefined, options: DateFormatOptions = {}): string {
    const date = parseIsoTimestamp(iso);
    if (date === null) {
      return INVALID_DATE_FALLBACK;
    }
    return DateFormatUtility.format(date, options, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  /**
   * Renders a date only, e.g. `Oct 24, 2026`.
   *
   * @param iso ISO 8601 timestamp.
   * @param options Locale and time zone overrides.
   */
  public static formatDate(iso: string | null | undefined, options: DateFormatOptions = {}): string {
    const date = parseIsoTimestamp(iso);
    if (date === null) {
      return INVALID_DATE_FALLBACK;
    }
    return DateFormatUtility.format(date, options, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  /**
   * Renders a weekday and date, e.g. `Sat, Oct 24, 2026`.
   *
   * @param iso ISO 8601 timestamp.
   * @param options Locale and time zone overrides.
   */
  public static formatWeekdayDate(
    iso: string | null | undefined,
    options: DateFormatOptions = {}
  ): string {
    const date = parseIsoTimestamp(iso);
    if (date === null) {
      return INVALID_DATE_FALLBACK;
    }
    return DateFormatUtility.format(date, options, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  /**
   * Renders a clock time together with the zone abbreviation, e.g. `9:00 AM PDT`.
   *
   * @param iso ISO 8601 timestamp.
   * @param options Locale and time zone overrides.
   */
  public static formatTime(iso: string | null | undefined, options: DateFormatOptions = {}): string {
    const date = parseIsoTimestamp(iso);
    if (date === null) {
      return INVALID_DATE_FALLBACK;
    }

    const time = DateFormatUtility.formatClock(date, options);
    const zone = DateFormatUtility.formatTimeZoneName(date, options);

    return zone.length > 0 ? `${time} ${zone}` : time;
  }

  /**
   * Renders a bare clock time without the zone suffix, e.g. `9:00 AM`.
   *
   * @param value ISO 8601 timestamp or `Date`.
   * @param options Locale and time zone overrides.
   */
  public static formatClock(
    value: string | Date | null | undefined,
    options: DateFormatOptions = {}
  ): string {
    const date = toDate(value);
    if (date === null) {
      return INVALID_DATE_FALLBACK;
    }

    return DateFormatUtility.format(date, options, {
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  /**
   * Renders an event window as a single readable line, collapsing the end date
   * when both instants fall on the same calendar day.
   *
   * Examples:
   * - same day: `Oct 24, 2026 · 9:00 AM – 5:00 PM`
   * - multi day: `Oct 24 – 26, 2026 · 9:00 AM`
   *
   * @param startIso Event start timestamp.
   * @param endIso Event end timestamp.
   * @param options Locale and time zone overrides.
   */
  public static formatEventDateRange(
    startIso: string | null | undefined,
    endIso: string | null | undefined,
    options: DateFormatOptions = {}
  ): string {
    const start = parseIsoTimestamp(startIso);
    const end = parseIsoTimestamp(endIso);

    if (start === null) {
      return INVALID_DATE_FALLBACK;
    }

    if (end === null) {
      return DateFormatUtility.formatDate(startIso, options);
    }

    if (DateFormatUtility.isSameDay(startIso, endIso, options)) {
      // The zone is rendered once, on the closing time, to avoid repetition.
      return `${DateFormatUtility.formatDate(startIso, options)} · ${DateFormatUtility.formatClock(
        start,
        options
      )} – ${DateFormatUtility.formatTime(endIso, options)}`;
    }

    const sameMonthAndYear = DateFormatUtility.isSameMonth(start, end, options);
    const endLabel = sameMonthAndYear
      ? DateFormatUtility.format(end, options, { day: 'numeric' })
      : DateFormatUtility.formatDate(endIso, options);

    const startLabel = sameMonthAndYear
      ? DateFormatUtility.format(start, options, { month: 'short', day: 'numeric', year: 'numeric' })
      : DateFormatUtility.formatDate(startIso, options);

    return `${startLabel} – ${endLabel}`;
  }

  /**
   * Renders a human relative time, e.g. `in 3 minutes` / `2 days ago`.
   *
   * @param iso Target timestamp.
   * @param reference Instant to measure from; defaults to now.
   * @param locale Optional BCP-47 locale tag.
   */
  public static formatRelative(
    iso: string | null | undefined,
    reference: Date = new Date(),
    locale?: string
  ): string {
    const target = parseIsoTimestamp(iso);
    if (target === null) {
      return INVALID_DATE_FALLBACK;
    }

    const deltaSeconds = (target.getTime() - reference.getTime()) / 1000;
    const absoluteSeconds = Math.abs(deltaSeconds);
    const formatter = getRelativeFormatter(locale);

    if (absoluteSeconds < 60) {
      return formatter.format(Math.round(deltaSeconds), 'second');
    }
    if (absoluteSeconds < 3600) {
      return formatter.format(Math.round(deltaSeconds / 60), 'minute');
    }
    if (absoluteSeconds < 86_400) {
      return formatter.format(Math.round(deltaSeconds / 3600), 'hour');
    }
    if (absoluteSeconds < 2_592_000) {
      return formatter.format(Math.round(deltaSeconds / 86_400), 'day');
    }
    return formatter.format(Math.round(deltaSeconds / 2_592_000), 'month');
  }

  /**
   * Renders a duration as `1h 05m` / `12m 30s` / `45s`.
   *
   * @param milliseconds Duration in milliseconds.
   */
  public static formatDuration(milliseconds: number): string {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      return INVALID_DATE_FALLBACK;
    }

    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${String(minutes).padStart(2, '0')}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    }
    return `${seconds}s`;
  }

  /**
   * Computes whole minutes between two instants (negative when in the past).
   *
   * @param iso Target timestamp.
   * @param reference Instant to measure from; defaults to now.
   */
  public static minutesBetween(iso: string | null | undefined, reference: Date = new Date()): number {
    const target = parseIsoTimestamp(iso);
    if (target === null) {
      return 0;
    }
    return Math.round((target.getTime() - reference.getTime()) / 60_000);
  }

  /**
   * Determines whether two timestamps fall on the same calendar day.
   *
   * @param leftIso First timestamp.
   * @param rightIso Second timestamp.
   * @param options Locale and time zone overrides.
   */
  public static isSameDay(
    leftIso: string | null | undefined,
    rightIso: string | null | undefined,
    options: DateFormatOptions = {}
  ): boolean {
    const left = parseIsoTimestamp(leftIso);
    const right = parseIsoTimestamp(rightIso);
    if (left === null || right === null) {
      return false;
    }

    return (
      DateFormatUtility.format(left, options, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }) ===
      DateFormatUtility.format(right, options, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
    );
  }

  /**
   * Renders the short zone name for an instant, e.g. `PDT`.
   *
   * @param iso ISO 8601 timestamp.
   * @param options Locale and time zone overrides.
   */
  public static formatTimeZoneName(
    iso: string | Date | null | undefined,
    options: DateFormatOptions = {}
  ): string {
    const date = toDate(iso);
    if (date === null) {
      return '';
    }

    const parts = DateFormatUtility.resolveFormatter(options, {
      hour: 'numeric',
      timeZoneName: 'short'
    }).formatToParts(date);

    return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  }

  /**
   * Formats a `Date` for an arbitrary option set, resolving locale, time zone
   * and the memoized formatter.
   *
   * @param date Instant to render.
   * @param options Locale and time zone overrides.
   * @param formatOptions `Intl.DateTimeFormatOptions` without zone fields.
   */
  public static format(
    date: Date,
    options: DateFormatOptions,
    formatOptions: Intl.DateTimeFormatOptions
  ): string {
    try {
      return DateFormatUtility.resolveFormatter(options, formatOptions).format(date);
    } catch {
      return INVALID_DATE_FALLBACK;
    }
  }

  /** Returns a cached formatter, falling back to UTC on an unusable zone. */
  private static resolveFormatter(
    options: DateFormatOptions,
    formatOptions: Intl.DateTimeFormatOptions
  ): Intl.DateTimeFormat {
    const locale = options.locale;
    const timeZone = isValidTimeZone(options.timeZone) ? options.timeZone : undefined;
    const cacheKey = `${locale ?? 'default'}|${timeZone ?? 'default'}|${JSON.stringify(formatOptions)}`;

    const cached = dateTimeFormatCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const formatter = new Intl.DateTimeFormat(locale, { ...formatOptions, timeZone });
    dateTimeFormatCache.set(cacheKey, formatter);
    return formatter;
  }

  /** True when both instants share a calendar month and year. */
  private static isSameMonth(left: Date, right: Date, options: DateFormatOptions): boolean {
    const monthKey = (date: Date): string =>
      DateFormatUtility.format(date, options, { year: 'numeric', month: '2-digit' });
    return monthKey(left) === monthKey(right);
  }
}

/** Returns a cached relative-time formatter for the locale. */
function getRelativeFormatter(locale?: string): Intl.RelativeTimeFormat {
  const key = locale ?? 'default';
  const cached = relativeFormatCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  relativeFormatCache.set(key, formatter);
  return formatter;
}
