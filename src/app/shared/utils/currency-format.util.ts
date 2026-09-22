/**
 * Money and numeric formatting helpers built on `Intl.NumberFormat`.
 *
 * The domain model stores every monetary amount as integer minor units
 * (`priceCents`, `totalCents`, …), so all conversions funnel through this module
 * to keep rounding deterministic between the checkout dialog, the dashboard KPIs
 * and the stored order records.
 */

/** Fallback rendered whenever an amount cannot be formatted. */
export const INVALID_AMOUNT_FALLBACK = '—';

/** Currencies the dashboard guarantees formatting support for. */
const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP'] as const;

/** Default currency used when a caller supplies nothing usable. */
const DEFAULT_CURRENCY = 'USD';

/** Memoized `Intl.NumberFormat` instances, keyed by currency + option payload. */
const numberFormatCache = new Map<string, Intl.NumberFormat>();

/** Options accepted by the currency formatting helpers. */
export interface CurrencyFormatOptions {
  /** BCP-47 locale tag; defaults to the runtime locale. */
  readonly locale?: string;
  /** Render large amounts compactly, e.g. `$12.4K`. */
  readonly compact?: boolean;
  /** Always show the minor units (`$12.00` instead of `$12`). */
  readonly showCents?: boolean;
}

/**
 * Normalizes a currency code, falling back to USD when the runtime ICU data
 * rejects it.
 *
 * @param currency Candidate ISO 4217 code.
 */
export function normalizeCurrencyCode(currency: string | undefined): string {
  const candidate = (currency ?? '').trim().toUpperCase();
  if (candidate.length === 0) {
    return DEFAULT_CURRENCY;
  }

  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency: candidate }).format(0);
    return candidate;
  } catch {
    return DEFAULT_CURRENCY;
  }
}

/** Money and numeric formatting helpers. */
export class CurrencyFormatUtility {
  /** Currencies with first-class support in the dashboard UI. */
  public static readonly supportedCurrencies: readonly string[] = SUPPORTED_CURRENCIES;

  /**
   * Formats integer minor units as localized currency.
   *
   * @param cents Amount in minor units (e.g. 2500 → `$25.00`).
   * @param currency ISO 4217 code; defaults to USD.
   * @param options Locale, compaction and cent visibility.
   */
  public static formatCents(
    cents: number,
    currency: string = DEFAULT_CURRENCY,
    options: CurrencyFormatOptions = {}
  ): string {
    if (!Number.isFinite(cents)) {
      return INVALID_AMOUNT_FALLBACK;
    }

    const code = normalizeCurrencyCode(currency);
    const amount = cents / 100;
    const showCents = options.showCents ?? true;

    const formatOptions: Intl.NumberFormatOptions = {
      style: 'currency',
      currency: code,
      minimumFractionDigits: options.compact ? 0 : showCents ? 2 : 0,
      maximumFractionDigits: options.compact ? 1 : showCents ? 2 : 0,
      notation: options.compact ? 'compact' : 'standard'
    };

    return CurrencyFormatUtility.formatNumber(amount, options.locale, formatOptions);
  }

  /**
   * Formats integer minor units compactly for KPI tiles, e.g. `$12.4K`.
   *
   * @param cents Amount in minor units.
   * @param currency ISO 4217 code; defaults to USD.
   * @param options Locale override.
   */
  public static formatCentsCompact(
    cents: number,
    currency: string = DEFAULT_CURRENCY,
    options: CurrencyFormatOptions = {}
  ): string {
    return CurrencyFormatUtility.formatCents(cents, currency, { ...options, compact: true });
  }

  /**
   * Converts a decimal amount into integer minor units, rounding half away from
   * zero so totals stay consistent with the payment provider.
   *
   * @param amount Decimal amount, e.g. `25.005`.
   * @returns Amount in minor units, or `0` for non-finite input.
   */
  public static toCents(amount: number): number {
    if (!Number.isFinite(amount)) {
      return 0;
    }
    return Math.round(amount * 100);
  }

  /**
   * Converts integer minor units back into a decimal amount.
   *
   * @param cents Amount in minor units.
   */
  public static fromCents(cents: number): number {
    if (!Number.isFinite(cents)) {
      return 0;
    }
    return cents / 100;
  }

  /**
   * Parses operator input such as `$1,234.50` or `1 234,50 €` into minor units.
   *
   * @param input Raw user input.
   * @returns Minor units, or `null` when the input is not a usable amount.
   */
  public static parseToCents(input: string | null | undefined): number | null {
    if (typeof input !== 'string') {
      return null;
    }

    const cleaned = input
      .replace(/[\s\u00A0]/g, '')
      .replace(/[^0-9.,-]/g, '')
      .trim();

    if (cleaned.length === 0) {
      return null;
    }

    // Treat the last separator as the decimal mark and drop all grouping marks.
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    const decimalIndex = Math.max(lastComma, lastDot);

    let normalized: string;
    if (decimalIndex === -1) {
      normalized = cleaned;
    } else {
      const integerPart = cleaned.slice(0, decimalIndex).replace(/[.,]/g, '');
      const fractionPart = cleaned.slice(decimalIndex + 1).replace(/[.,]/g, '');
      normalized = fractionPart.length === 0 ? integerPart : `${integerPart}.${fractionPart}`;
    }

    const parsed = Number.parseFloat(normalized);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return CurrencyFormatUtility.toCents(parsed);
  }

  /**
   * Formats a ratio (`0.734`) or an already-scaled percentage (`73.4`) as a
   * localized percentage string.
   *
   * @param value Ratio when `isRatio` is true, otherwise a percentage number.
   * @param fractionDigits Digits after the decimal mark (default 0).
   * @param locale Optional BCP-47 locale tag.
   * @param isRatio Whether `value` is a 0..1 ratio (default `true`).
   */
  public static formatPercentage(
    value: number,
    fractionDigits = 0,
    locale?: string,
    isRatio = true
  ): string {
    if (!Number.isFinite(value)) {
      return INVALID_AMOUNT_FALLBACK;
    }

    return CurrencyFormatUtility.formatNumber(isRatio ? value : value / 100, locale, {
      style: 'percent',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    });
  }

  /**
   * Formats a plain count with grouping, e.g. `1,248`.
   *
   * @param value Number to render.
   * @param locale Optional BCP-47 locale tag.
   */
  public static formatCount(value: number, locale?: string): string {
    if (!Number.isFinite(value)) {
      return INVALID_AMOUNT_FALLBACK;
    }
    return CurrencyFormatUtility.formatNumber(value, locale, {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0
    });
  }

  /**
   * Formats a count compactly for KPI tiles, e.g. `1.2K`.
   *
   * @param value Number to render.
   * @param locale Optional BCP-47 locale tag.
   */
  public static formatCountCompact(value: number, locale?: string): string {
    if (!Number.isFinite(value)) {
      return INVALID_AMOUNT_FALLBACK;
    }
    return CurrencyFormatUtility.formatNumber(value, locale, {
      notation: 'compact',
      maximumFractionDigits: 1
    });
  }

  /**
   * Formats a decimal amount with a fixed number of fraction digits.
   *
   * @param value Number to render.
   * @param fractionDigits Digits after the decimal mark (default 2).
   * @param locale Optional BCP-47 locale tag.
   */
  public static formatDecimal(value: number, fractionDigits = 2, locale?: string): string {
    if (!Number.isFinite(value)) {
      return INVALID_AMOUNT_FALLBACK;
    }
    return CurrencyFormatUtility.formatNumber(value, locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    });
  }

  /** Formats a number through a cached `Intl.NumberFormat` instance. */
  private static formatNumber(
    value: number,
    locale: string | undefined,
    formatOptions: Intl.NumberFormatOptions
  ): string {
    const cacheKey = `${locale ?? 'default'}|${JSON.stringify(formatOptions)}`;
    let formatter = numberFormatCache.get(cacheKey);
    if (formatter === undefined) {
      formatter = new Intl.NumberFormat(locale, formatOptions);
      numberFormatCache.set(cacheKey, formatter);
    }

    try {
      return formatter.format(value);
    } catch {
      return INVALID_AMOUNT_FALLBACK;
    }
  }
}
