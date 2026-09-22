/**
 * Minimal, dependency-free QR Code encoder (ISO/IEC 18004).
 *
 * Scope: byte mode (UTF-8) payloads, versions 1-40, error correction levels
 * L/M/Q/H, automatic version selection, and mask selection by the standard
 * penalty rules. The output is a real, scannable symbol — not a decorative
 * matrix — so the tear-off stubs printed by the dashboard can be read by any
 * camera scanner, including the terminal's own `BarcodeDetector` pipeline.
 *
 * The implementation follows the specification directly: Galois-field Reed-Solomon
 * error correction, block interleaving, function-pattern placement, zig-zag data
 * placement, BCH format/version information and the four masking penalty rules.
 *
 * Verified during development against the `qrcode` reference implementation:
 * data and error correction codewords, function patterns, format/version
 * information and data placement are byte-identical for every version/level
 * combination exercised. Mask selection may differ from that reference because
 * the penalty score here is computed on the complete symbol (format information
 * included), matching the ZXing approach, while `qrcode` scores with the format
 * modules blanked. Both selections are valid — the chosen mask is carried in the
 * format information, so any reader recovers it.
 */

import { QR_ALIGNMENT_POSITION_TABLE, QR_RS_BLOCK_TABLE } from './encoder-tables';

/** Error correction levels, weakest to strongest (each step ~doubles redundancy). */
export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

/** Options accepted by {@link encodeQrMatrix}. */
export interface QrEncodeOptions {
  /** Error correction level; defaults to `M` (~15% recovery capacity). */
  readonly errorCorrectionLevel?: QrErrorCorrectionLevel;
  /**
   * Smallest version to consider. Useful for keeping a batch of stubs at a
   * uniform physical size; the encoder still grows the version if needed.
   */
  readonly minVersion?: number;
}

/** A fully encoded QR symbol. */
export interface QrMatrix {
  /** QR version, 1-40 (symbol size is `17 + 4 * version`). */
  readonly version: number;
  /** Module count per side. */
  readonly size: number;
  /** Error correction level actually used. */
  readonly errorCorrectionLevel: QrErrorCorrectionLevel;
  /** Mask pattern index, 0-7. */
  readonly maskPattern: number;
  /** `true` marks a dark module; indexed as `modules[row][column]`. */
  readonly modules: readonly (readonly boolean[])[];
}

/** Thrown when a payload cannot be represented as a QR symbol. */
export class QrEncodingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'QrEncodingError';
  }
}

/** Two-bit indicator per error correction level, as used in the format information. */
const ERROR_CORRECTION_INDICATOR: Record<QrErrorCorrectionLevel, number> = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2
};

/** Row offset of each level inside a version's four-row block in the table. */
const ERROR_CORRECTION_ROW: Record<QrErrorCorrectionLevel, number> = {
  L: 0,
  M: 1,
  Q: 2,
  H: 3
};

/** BCH(15,5) generator polynomial for format information. */
const FORMAT_INFO_GENERATOR = 0b10100110111;

/** Mask applied to the format information to keep it from being all zeroes. */
const FORMAT_INFO_MASK = 0b101010000010010;

/** BCH(18,6) generator polynomial for version information. */
const VERSION_INFO_GENERATOR = 0b1111100100101;

/** First version that carries explicit version information. */
const VERSION_INFO_MIN_VERSION = 7;

/** Smallest and largest supported symbol versions. */
const MIN_VERSION = 1;
const MAX_VERSION = 40;

/** Error correction codewords per block, grouped by version block. */
interface ReedSolomonBlock {
  readonly totalCodewords: number;
  readonly dataCodewords: number;
  readonly count: number;
}

/** Parsed table caches; the packed strings are decoded once per session. */
let parsedBlockTable: readonly (readonly ReedSolomonBlock[])[] | null = null;
let parsedAlignmentTable: readonly (readonly number[])[] | null = null;

/**
 * Encodes a UTF-8 payload into a QR symbol matrix.
 *
 * @param value Payload text (ticket tokens, URLs, stub references, …).
 * @param options Error correction level and minimum version.
 * @returns The encoded matrix plus the metadata needed for rendering.
 * @throws {QrEncodingError} When the payload is empty or exceeds version 40.
 */
export function encodeQrMatrix(value: string, options: QrEncodeOptions = {}): QrMatrix {
  if (typeof value !== 'string' || value.length === 0) {
    throw new QrEncodingError('Cannot encode an empty QR payload.');
  }

  const level = options.errorCorrectionLevel ?? 'M';
  const payload = utf8Bytes(value);
  const requestedMinVersion = clampVersion(options.minVersion ?? MIN_VERSION);

  let version = 0;
  let blocks: readonly ReedSolomonBlock[] = [];

  for (let candidate = requestedMinVersion; candidate <= MAX_VERSION; candidate += 1) {
    const candidateBlocks = reedSolomonBlocks(candidate, level);
    if (payload.length <= byteCapacity(candidate, candidateBlocks)) {
      version = candidate;
      blocks = candidateBlocks;
      break;
    }
  }

  if (version === 0) {
    throw new QrEncodingError(
      `Payload of ${payload.length} bytes exceeds the capacity of a version 40 ${level} symbol.`
    );
  }

  const dataCodewords = buildDataCodewords(payload, version, blocks);
  const codewords = interleaveWithErrorCorrection(dataCodewords, blocks);

  const { matrix, maskPattern } = buildBestMatrix(version, level, codewords);

  return Object.freeze({
    version,
    size: matrix.length,
    errorCorrectionLevel: level,
    maskPattern,
    modules: Object.freeze(matrix.map((row) => Object.freeze(row)))
  });
}

/**
 * Renders a matrix as text, one character per module (`##` / `..`).
 *
 * Intended for debugging, snapshot tests and terminal output.
 *
 * @param matrix Encoded symbol.
 * @param dark Character(s) used for dark modules.
 * @param light Character(s) used for light modules.
 */
export function renderQrMatrixAsText(
  matrix: QrMatrix,
  dark = '##',
  light = '..'
): string {
  return matrix.modules
    .map((row) => row.map((module) => (module ? dark : light)).join(''))
    .join('\n');
}

/* -------------------------------------------------------------------------- */
/* Capacity helpers                                                           */
/* -------------------------------------------------------------------------- */

/** Number of bits the mode and character-count headers occupy for a version. */
function headerLength(version: number): number {
  const characterCountBits = version < 10 ? 8 : 16;
  return 4 + characterCountBits;
}

/** Total data codewords available across all blocks. */
function dataCodewordCount(blocks: readonly ReedSolomonBlock[]): number {
  return blocks.reduce((total, block) => total + block.count * block.dataCodewords, 0);
}

/**
 * Byte-mode payload capacity of a version at a given level.
 *
 * The mode indicator and character-count header share the data codeword budget,
 * so the usable byte count is `(dataBits - headerBits) / 8`, rounded down.
 */
function byteCapacity(version: number, blocks: readonly ReedSolomonBlock[]): number {
  const dataBits = dataCodewordCount(blocks) * 8;
  return Math.max(0, Math.floor((dataBits - headerLength(version)) / 8));
}

/** Clamps a requested version into the supported range. */
function clampVersion(version: number): number {
  if (!Number.isFinite(version)) {
    return MIN_VERSION;
  }
  return Math.min(MAX_VERSION, Math.max(MIN_VERSION, Math.trunc(version)));
}

/* -------------------------------------------------------------------------- */
/* Table parsing                                                              */
/* -------------------------------------------------------------------------- */

/** Decodes the packed Reed-Solomon layout table once per session. */
function blockTable(): readonly (readonly ReedSolomonBlock[])[] {
  if (parsedBlockTable !== null) {
    return parsedBlockTable;
  }

  parsedBlockTable = QR_RS_BLOCK_TABLE.split(';').map((row) => {
    const numbers = row.split(',').map((token) => Number.parseInt(token, 10));
    const blocks: ReedSolomonBlock[] = [];
    for (let index = 0; index < numbers.length; index += 3) {
      blocks.push({
        count: numbers[index],
        totalCodewords: numbers[index + 1],
        dataCodewords: numbers[index + 2]
      });
    }
    return blocks;
  });

  return parsedBlockTable;
}

/** Decodes the packed alignment-pattern position table once per session. */
function alignmentTable(): readonly (readonly number[])[] {
  if (parsedAlignmentTable !== null) {
    return parsedAlignmentTable;
  }

  parsedAlignmentTable = QR_ALIGNMENT_POSITION_TABLE.split(';').map((row) =>
    row.length === 0 ? [] : row.split(',').map((token) => Number.parseInt(token, 10))
  );

  return parsedAlignmentTable;
}

/**
 * Resolves the Reed-Solomon block layout for a version and level.
 *
 * @throws {QrEncodingError} When the version is outside 1-40.
 */
function reedSolomonBlocks(
  version: number,
  level: QrErrorCorrectionLevel
): readonly ReedSolomonBlock[] {
  const row = (version - 1) * 4 + ERROR_CORRECTION_ROW[level];
  const blocks = blockTable()[row];
  if (blocks === undefined) {
    throw new QrEncodingError(`No Reed-Solomon layout for version ${version} level ${level}.`);
  }
  return blocks;
}

/* -------------------------------------------------------------------------- */
/* Data encoding                                                              */
/* -------------------------------------------------------------------------- */

/** Encodes text as UTF-8 bytes. */
function utf8Bytes(value: string): Uint8Array {
  if (typeof TextEncoder === 'function') {
    return new TextEncoder().encode(value);
  }

  // Minimal fallback for runtimes without TextEncoder (older WebViews).
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = ((codePoint - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
        index += 1;
      }
    }

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return Uint8Array.from(bytes);
}

/**
 * Builds the padded data codeword stream: mode indicator, character count,
 * payload, terminator, bit padding and the alternating 0xEC/0x11 pad bytes.
 */
function buildDataCodewords(
  payload: Uint8Array,
  version: number,
  blocks: readonly ReedSolomonBlock[]
): Uint8Array {
  const capacityBits = dataCodewordCount(blocks) * 8;
  const bits: number[] = [];

  pushBits(bits, 0b0100, 4); // Byte mode indicator.
  pushBits(bits, payload.length, version < 10 ? 8 : 16);
  for (const byte of payload) {
    pushBits(bits, byte, 8);
  }

  const terminator = Math.min(4, capacityBits - bits.length);
  pushBits(bits, 0, terminator);

  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const codewords = new Uint8Array(capacityBits / 8);
  for (let index = 0; index < bits.length; index += 8) {
    let byte = 0;
    for (let offset = 0; offset < 8; offset += 1) {
      byte = (byte << 1) | bits[index + offset];
    }
    codewords[index / 8] = byte;
  }

  const padBytes = [0xec, 0x11];
  let padIndex = 0;
  for (let index = bits.length / 8; index < codewords.length; index += 1) {
    codewords[index] = padBytes[padIndex % 2];
    padIndex += 1;
  }

  return codewords;
}

/** Appends the low `length` bits of `value`, most significant bit first. */
function pushBits(target: number[], value: number, length: number): void {
  for (let shift = length - 1; shift >= 0; shift -= 1) {
    target.push((value >> shift) & 1);
  }
}

/* -------------------------------------------------------------------------- */
/* Reed-Solomon over GF(256)                                                  */
/* -------------------------------------------------------------------------- */

/** Galois-field exponent/log tables for the QR primitive polynomial 0x11D. */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisField(): void {
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    GF_EXP[index] = value;
    GF_LOG[value] = index;
    value <<= 1;
    if ((value & 0x100) !== 0) {
      value ^= 0x11d;
    }
  }
  for (let index = 255; index < 512; index += 1) {
    GF_EXP[index] = GF_EXP[index - 255];
  }
})();

/** Multiplies two field elements. */
function gfMultiply(left: number, right: number): number {
  if (left === 0 || right === 0) {
    return 0;
  }
  return GF_EXP[GF_LOG[left] + GF_LOG[right]];
}

/**
 * Builds the generator polynomial for `degree` error correction codewords.
 *
 * Coefficients are returned in the conventional highest-degree-first order
 * (`result[0]` is the leading 1), which is what {@link errorCorrectionCodewords}
 * expects for synthetic division.
 */
function generatorPolynomial(degree: number): Uint8Array {
  let polynomial = Uint8Array.from([1]);

  for (let index = 0; index < degree; index += 1) {
    const next = new Uint8Array(polynomial.length + 1);
    for (let position = 0; position < polynomial.length; position += 1) {
      // Multiply by (x + α^index): shift one degree, then add the scaled term.
      next[position] ^= polynomial[position];
      next[position + 1] ^= gfMultiply(polynomial[position], GF_EXP[index]);
    }
    polynomial = next;
  }

  return polynomial;
}

/** Computes the Reed-Solomon remainder (error correction codewords) for a block. */
function errorCorrectionCodewords(data: Uint8Array, ecCount: number): Uint8Array {
  const generator = generatorPolynomial(ecCount);
  const remainder = new Uint8Array(data.length + ecCount);
  remainder.set(data);

  for (let index = 0; index < data.length; index += 1) {
    const factor = remainder[index];
    if (factor === 0) {
      continue;
    }
    // Offset 0 is the leading coefficient (always 1) and cancels `remainder[index]`.
    for (let offset = 1; offset < generator.length; offset += 1) {
      remainder[index + offset] ^= gfMultiply(generator[offset], factor);
    }
  }

  return remainder.slice(data.length);
}

/**
 * Splits data codewords into blocks, appends error correction codewords to each,
 * and interleaves the result as required by the specification.
 */
function interleaveWithErrorCorrection(
  dataCodewords: Uint8Array,
  blocks: readonly ReedSolomonBlock[]
): Uint8Array {
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];

  let offset = 0;
  for (const block of blocks) {
    for (let copy = 0; copy < block.count; copy += 1) {
      const slice = dataCodewords.slice(offset, offset + block.dataCodewords);
      offset += block.dataCodewords;
      dataBlocks.push(slice);
      ecBlocks.push(errorCorrectionCodewords(slice, block.totalCodewords - block.dataCodewords));
    }
  }

  const maxDataLength = Math.max(...dataBlocks.map((block) => block.length));
  const maxEcLength = Math.max(...ecBlocks.map((block) => block.length));

  const output: number[] = [];
  for (let index = 0; index < maxDataLength; index += 1) {
    for (const block of dataBlocks) {
      if (index < block.length) {
        output.push(block[index]);
      }
    }
  }
  for (let index = 0; index < maxEcLength; index += 1) {
    for (const block of ecBlocks) {
      if (index < block.length) {
        output.push(block[index]);
      }
    }
  }

  return Uint8Array.from(output);
}

/* -------------------------------------------------------------------------- */
/* Matrix construction                                                        */
/* -------------------------------------------------------------------------- */

/** Builds the symbol for every mask and keeps the one with the lowest penalty. */
function buildBestMatrix(
  version: number,
  level: QrErrorCorrectionLevel,
  codewords: Uint8Array
): { matrix: boolean[][]; maskPattern: number } {
  let bestMatrix: boolean[][] | null = null;
  let bestMask = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;

  for (let mask = 0; mask < 8; mask += 1) {
    const matrix = buildMatrix(version, level, codewords, mask);
    const penalty = calculatePenalty(matrix);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
      bestMatrix = matrix;
    }
  }

  // `bestMatrix` is always assigned: the loop above runs eight times.
  return { matrix: bestMatrix as boolean[][], maskPattern: bestMask };
}

/** Creates the empty module grid with function patterns already drawn. */
function createBaseMatrix(version: number): (boolean | null)[][] {
  const size = version * 4 + 17;
  const modules: (boolean | null)[][] = Array.from({ length: size }, () =>
    Array.from<boolean | null>({ length: size }).fill(null)
  );

  drawFinderPattern(modules, 0, 0);
  drawFinderPattern(modules, size - 7, 0);
  drawFinderPattern(modules, 0, size - 7);

  drawTimingPatterns(modules);
  drawAlignmentPatterns(modules, version);
  reserveFormatInformation(modules, version);
  drawDarkModule(modules, version);

  if (version >= VERSION_INFO_MIN_VERSION) {
    reserveVersionInformation(modules, version);
  }

  return modules;
}

/** Draws a 7x7 finder pattern plus its separator at (row, column). */
function drawFinderPattern(modules: (boolean | null)[][], row: number, column: number): void {
  const size = modules.length;
  for (let rowOffset = -1; rowOffset <= 7; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 7; columnOffset += 1) {
      const targetRow = row + rowOffset;
      const targetColumn = column + columnOffset;
      if (targetRow < 0 || targetRow >= size || targetColumn < 0 || targetColumn >= size) {
        continue;
      }

      const isBorder =
        (rowOffset === 0 || rowOffset === 6) && columnOffset >= 0 && columnOffset <= 6;
      const isSide =
        (columnOffset === 0 || columnOffset === 6) && rowOffset >= 0 && rowOffset <= 6;
      const isCore =
        rowOffset >= 2 && rowOffset <= 4 && columnOffset >= 2 && columnOffset <= 4;

      modules[targetRow][targetColumn] = isBorder || isSide || isCore;
    }
  }
}

/** Draws the horizontal and vertical timing patterns. */
function drawTimingPatterns(modules: (boolean | null)[][]): void {
  const size = modules.length;
  for (let index = 8; index < size - 8; index += 1) {
    if (modules[index][6] === null) {
      modules[index][6] = index % 2 === 0;
    }
    if (modules[6][index] === null) {
      modules[6][index] = index % 2 === 0;
    }
  }
}

/** Draws the 5x5 alignment patterns for the version, skipping finder overlaps. */
function drawAlignmentPatterns(modules: (boolean | null)[][], version: number): void {
  const positions = alignmentTable()[version - 1] ?? [];
  for (const row of positions) {
    for (const column of positions) {
      if (modules[row][column] !== null) {
        continue;
      }
      for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
        for (let columnOffset = -2; columnOffset <= 2; columnOffset += 1) {
          const isEdge = Math.abs(rowOffset) === 2 || Math.abs(columnOffset) === 2;
          const isCenter = rowOffset === 0 && columnOffset === 0;
          modules[row + rowOffset][column + columnOffset] = isEdge || isCenter;
        }
      }
    }
  }
}

/** Marks the format information modules as reserved (light) before masking. */
function reserveFormatInformation(modules: (boolean | null)[][], version: number): void {
  const size = modules.length;

  for (let index = 0; index <= 8; index += 1) {
    if (index !== 6) {
      if (modules[8][index] === null) {
        modules[8][index] = false;
      }
      if (modules[index][8] === null) {
        modules[index][8] = false;
      }
    }
  }

  for (let index = 0; index < 8; index += 1) {
    if (modules[8][size - 1 - index] === null) {
      modules[8][size - 1 - index] = false;
    }
    if (modules[size - 1 - index][8] === null) {
      modules[size - 1 - index][8] = false;
    }
  }

  void version;
}

/** Sets the always-dark module below the top-left format information. */
function drawDarkModule(modules: (boolean | null)[][], version: number): void {
  modules[version * 4 + 9][8] = true;
}

/** Marks the version information areas (versions 7+) as reserved. */
function reserveVersionInformation(modules: (boolean | null)[][], version: number): void {
  const size = modules.length;
  const start = size - 11;

  for (let index = 0; index < 18; index += 1) {
    const row = Math.floor(index / 3);
    const column = (index % 3) + start;
    if (modules[row][column] === null) {
      modules[row][column] = false;
    }
    if (modules[column][row] === null) {
      modules[column][row] = false;
    }
  }

  void version;
}

/** Produces the final masked matrix for one mask pattern. */
function buildMatrix(
  version: number,
  level: QrErrorCorrectionLevel,
  codewords: Uint8Array,
  maskPattern: number
): boolean[][] {
  const base = createBaseMatrix(version);
  placeData(base, codewords, maskPattern);
  const matrix = base.map((row) => row.map((module) => module === true));

  writeFormatInformation(matrix, level, maskPattern);
  if (version >= VERSION_INFO_MIN_VERSION) {
    writeVersionInformation(matrix, version);
  }

  return matrix;
}

/** Walks the zig-zag data path and writes masked data modules. */
function placeData(
  modules: (boolean | null)[][],
  codewords: Uint8Array,
  maskPattern: number
): void {
  const size = modules.length;
  let direction = -1;
  let row = size - 1;
  let bitIndex = 7;
  let byteIndex = 0;

  for (let column = size - 1; column > 0; column -= 2) {
    const pairStart = column <= 6 ? column - 1 : column;

    for (;;) {
      for (const targetColumn of [pairStart, pairStart - 1]) {
        if (modules[row][targetColumn] !== null) {
          continue;
        }

        let dark = false;
        if (byteIndex < codewords.length) {
          dark = ((codewords[byteIndex] >> bitIndex) & 1) === 1;
        }
        if (isMasked(row, targetColumn, maskPattern)) {
          dark = !dark;
        }

        modules[row][targetColumn] = dark;
        bitIndex -= 1;
        if (bitIndex === -1) {
          byteIndex += 1;
          bitIndex = 7;
        }
      }

      row += direction;
      if (row < 0 || row >= size) {
        row -= direction;
        direction = -direction;
        break;
      }
    }
  }
}

/** Evaluates one of the eight data mask predicates. */
function isMasked(row: number, column: number, maskPattern: number): boolean {
  switch (maskPattern) {
    case 0:
      return (row + column) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return column % 3 === 0;
    case 3:
      return (row + column) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    case 5:
      return ((row * column) % 2) + ((row * column) % 3) === 0;
    case 6:
      return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
    case 7:
      return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0;
    default:
      return false;
  }
}

/** Writes the 15-bit BCH protected format information in both copies. */
function writeFormatInformation(
  matrix: boolean[][],
  level: QrErrorCorrectionLevel,
  maskPattern: number
): void {
  const size = matrix.length;
  const bits = formatInformationBits(ERROR_CORRECTION_INDICATOR[level], maskPattern);

  for (let index = 0; index < 15; index += 1) {
    const dark = ((bits >> index) & 1) === 1;

    if (index < 6) {
      matrix[index][8] = dark;
    } else if (index < 8) {
      matrix[index + 1][8] = dark;
    } else {
      matrix[size - 15 + index][8] = dark;
    }

    if (index < 8) {
      matrix[8][size - 1 - index] = dark;
    } else if (index < 9) {
      matrix[8][15 - index - 1 + 1] = dark;
    } else {
      matrix[8][15 - index - 1] = dark;
    }
  }

  matrix[size - 8][8] = true;
}

/** Writes the 18-bit BCH protected version information in both copies. */
function writeVersionInformation(matrix: boolean[][], version: number): void {
  const size = matrix.length;
  const bits = versionInformationBits(version);
  const start = size - 11;

  for (let index = 0; index < 18; index += 1) {
    const dark = ((bits >> index) & 1) === 1;
    matrix[Math.floor(index / 3)][(index % 3) + start] = dark;
    matrix[(index % 3) + start][Math.floor(index / 3)] = dark;
  }
}

/** Computes the 15-bit format information word. */
function formatInformationBits(errorCorrectionIndicator: number, maskPattern: number): number {
  const data = (errorCorrectionIndicator << 3) | maskPattern;
  let remainder = data << 10;

  while (bitLength(remainder) - bitLength(FORMAT_INFO_GENERATOR) >= 0) {
    remainder ^= FORMAT_INFO_GENERATOR << (bitLength(remainder) - bitLength(FORMAT_INFO_GENERATOR));
  }

  return ((data << 10) | remainder) ^ FORMAT_INFO_MASK;
}

/** Computes the 18-bit version information word. */
function versionInformationBits(version: number): number {
  let remainder = version << 12;

  while (bitLength(remainder) - bitLength(VERSION_INFO_GENERATOR) >= 0) {
    remainder ^=
      VERSION_INFO_GENERATOR << (bitLength(remainder) - bitLength(VERSION_INFO_GENERATOR));
  }

  return (version << 12) | remainder;
}

/** Number of significant bits in an integer. */
function bitLength(value: number): number {
  let length = 0;
  let remaining = value;
  while (remaining !== 0) {
    length += 1;
    remaining >>>= 1;
  }
  return length;
}

/* -------------------------------------------------------------------------- */
/* Mask penalty scoring                                                       */
/* -------------------------------------------------------------------------- */

/** Applies the four standard penalty rules to a masked matrix. */
function calculatePenalty(matrix: boolean[][]): number {
  return (
    penaltyForRuns(matrix) +
    penaltyForBlocks(matrix) +
    penaltyForFinderLikePatterns(matrix) +
    penaltyForDarkRatio(matrix)
  );
}

/** Rule 1: runs of five or more identical modules in a row or column. */
function penaltyForRuns(matrix: boolean[][]): number {
  const size = matrix.length;
  let penalty = 0;

  const scoreLine = (getValue: (index: number) => boolean): void => {
    let runLength = 1;
    for (let index = 1; index < size; index += 1) {
      if (getValue(index) === getValue(index - 1)) {
        runLength += 1;
      } else {
        if (runLength >= 5) {
          penalty += 3 + (runLength - 5);
        }
        runLength = 1;
      }
    }
    if (runLength >= 5) {
      penalty += 3 + (runLength - 5);
    }
  };

  for (let row = 0; row < size; row += 1) {
    scoreLine((column) => matrix[row][column]);
  }
  for (let column = 0; column < size; column += 1) {
    scoreLine((row) => matrix[row][column]);
  }

  return penalty;
}

/** Rule 2: 2x2 blocks of identical modules. */
function penaltyForBlocks(matrix: boolean[][]): number {
  const size = matrix.length;
  let penalty = 0;

  for (let row = 0; row < size - 1; row += 1) {
    for (let column = 0; column < size - 1; column += 1) {
      const value = matrix[row][column];
      if (
        value === matrix[row][column + 1] &&
        value === matrix[row + 1][column] &&
        value === matrix[row + 1][column + 1]
      ) {
        penalty += 3;
      }
    }
  }

  return penalty;
}

/** Rule 3: finder-like 1:1:3:1:1 patterns with a four-module light margin. */
function penaltyForFinderLikePatterns(matrix: boolean[][]): number {
  const size = matrix.length;
  const patterns = [
    [true, false, true, true, true, false, true, false, false, false, false],
    [false, false, false, false, true, false, true, true, true, false, true]
  ];

  let penalty = 0;

  const matchesAt = (values: boolean[], offset: number, pattern: boolean[]): boolean =>
    pattern.every((expected, index) => values[offset + index] === expected);

  for (let row = 0; row < size; row += 1) {
    const values = matrix[row];
    for (let column = 0; column + 11 <= size; column += 1) {
      for (const pattern of patterns) {
        if (matchesAt(values, column, pattern)) {
          penalty += 40;
        }
      }
    }
  }

  for (let column = 0; column < size; column += 1) {
    const values = matrix.map((row) => row[column]);
    for (let row = 0; row + 11 <= size; row += 1) {
      for (const pattern of patterns) {
        if (matchesAt(values, row, pattern)) {
          penalty += 40;
        }
      }
    }
  }

  return penalty;
}

/** Rule 4: deviation of the dark-module ratio from 50%. */
function penaltyForDarkRatio(matrix: boolean[][]): number {
  const size = matrix.length;
  let dark = 0;

  for (const row of matrix) {
    for (const module of row) {
      if (module) {
        dark += 1;
      }
    }
  }

  const total = size * size;
  const percent = (dark * 100) / total;
  return Math.floor(Math.abs(percent - 50) / 5) * 10;
}
