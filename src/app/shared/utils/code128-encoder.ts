/**
 * Dependency-free Code 128 encoder (ISO/IEC 15417).
 *
 * The dashboard prints a stub barcode under every tear-off pass. Rather than
 * drawing a decorative bar pattern, this encoder emits the real symbol: Code Set
 * B (full printable ASCII), the mandatory mod-103 check symbol, the start/stop
 * symbols and the 11-module patterns, so hardware laser scanners at the door can
 * read printed passes without the camera pipeline.
 */

import { CODE128_PATTERNS, CODE128_STOP_PATTERN } from './encoder-tables';

/** Code 128 start symbol values. */
export const CODE128_START_B = 104;

/** Number of modules each symbol occupies (stop symbol is longer). */
export const CODE128_MODULES_PER_SYMBOL = 11;

/** A single vertical bar in the rendered symbol. */
export interface Code128Bar {
  /** Bar width in modules (1-4). */
  readonly width: number;
  /** `true` for a dark bar, `false` for a light space. */
  readonly filled: boolean;
}

/** Fully encoded Code 128 symbol. */
export interface Code128Symbol {
  /** Payload that was encoded. */
  readonly value: string;
  /** Symbol values including start and check symbols, excluding the stop symbol. */
  readonly values: readonly number[];
  /** The mod-103 check symbol. */
  readonly checkSymbol: number;
  /** Module string (`1` = dark, `0` = light), including the stop pattern. */
  readonly modules: string;
  /** Bars and spaces in draw order. */
  readonly bars: readonly Code128Bar[];
  /** Total symbol width in modules. */
  readonly moduleCount: number;
}

/** Thrown when a payload contains characters Code Set B cannot represent. */
export class Code128EncodingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'Code128EncodingError';
  }
}

/** Parsed pattern cache. */
let parsedPatterns: readonly string[] | null = null;

/** Decodes the packed pattern table once per session. */
function patterns(): readonly string[] {
  if (parsedPatterns === null) {
    parsedPatterns = CODE128_PATTERNS.split(',');
  }
  return parsedPatterns;
}

/**
 * Encodes text as a Code 128 Set B symbol.
 *
 * @param value Printable ASCII payload (32-126), e.g. `EVT-8924-XQ9-SEC4-DOOR`.
 * @returns The encoded symbol with its module string and draw-ready bars.
 * @throws {Code128EncodingError} When the payload is empty or out of range.
 */
export function encodeCode128(value: string): Code128Symbol {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Code128EncodingError('Cannot encode an empty Code 128 payload.');
  }

  const values: number[] = [CODE128_START_B];

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    // Code Set B covers ASCII 32-126 (values 0-94); anything else is unsupported.
    if (codePoint < 32 || codePoint > 126) {
      throw new Code128EncodingError(
        `Character "${character}" (U+${codePoint.toString(16).toUpperCase()}) is not representable in Code Set B.`
      );
    }
    values.push(codePoint - 32);
  }

  const checkSymbol = calculateCheckSymbol(values);
  const encoded = [...values, checkSymbol];

  let modules = '';
  for (const symbol of encoded) {
    modules += patterns()[symbol];
  }
  modules += CODE128_STOP_PATTERN;

  return Object.freeze({
    value,
    values: Object.freeze(encoded),
    checkSymbol,
    modules,
    bars: Object.freeze(toBars(modules)),
    moduleCount: modules.length
  });
}

/**
 * Computes the mandatory mod-103 check symbol.
 *
 * @param values Symbol values starting with the start symbol.
 */
export function calculateCheckSymbol(values: readonly number[]): number {
  let sum = values[0] ?? 0;
  for (let index = 1; index < values.length; index += 1) {
    sum += index * values[index];
  }
  return sum % 103;
}

/** Converts a module string into alternating bars and spaces. */
function toBars(modules: string): Code128Bar[] {
  const bars: Code128Bar[] = [];
  let current = modules.charAt(0);
  let width = 0;

  for (let index = 0; index < modules.length; index += 1) {
    if (modules.charAt(index) === current) {
      width += 1;
      continue;
    }
    bars.push({ width, filled: current === '1' });
    current = modules.charAt(index);
    width = 1;
  }

  bars.push({ width, filled: current === '1' });
  return bars;
}

/** Number of bars/spaces the human readable text is split into for display. */
export function formatCode128Text(value: string): string {
  return value.trim().toUpperCase();
}
