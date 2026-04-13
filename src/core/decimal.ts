export function normalizeDecimalString(value: string): string {
  return value
    .trim()
    .replace(/^(-?)0+(?=\d)/, "$1")
    .replace(/\.0*$|(\.\d+?)0+$/, "$1")
    .replace(/^(-?)\./, "$10.")
    .replace(/^-?$/, "0")
    .replace(/^-0$/, "0");
}

export function addDecimalStrings(left: string, right: string): string {
  const leftParsed = parseDecimal(left);
  const rightParsed = parseDecimal(right);
  const scale = Math.max(leftParsed.scale, rightParsed.scale);
  const sum =
    BigInt(leftParsed.sign) * scaleDigits(leftParsed.digits, leftParsed.scale, scale) +
    BigInt(rightParsed.sign) * scaleDigits(rightParsed.digits, rightParsed.scale, scale);

  if (sum === 0n) {
    return "0";
  }

  return formatParsedDecimal(sum < 0n ? -1 : 1, absBigInt(sum), scale);
}

export function subtractDecimalStrings(left: string, right: string): string {
  const normalizedRight = normalizeDecimalString(right);
  return addDecimalStrings(left, normalizedRight.startsWith("-") ? normalizedRight.slice(1) : `-${normalizedRight}`);
}

export function multiplyDecimalStrings(left: string, right: string): string {
  const leftParsed = parseDecimal(left);
  const rightParsed = parseDecimal(right);
  const sign: 1 | -1 = leftParsed.sign === rightParsed.sign ? 1 : -1;
  const digits = leftParsed.digits * rightParsed.digits;
  const scale = leftParsed.scale + rightParsed.scale;

  if (digits === 0n) {
    return "0";
  }

  return formatParsedDecimal(sign, digits, scale);
}

export function divideDecimalStrings(
  dividend: string,
  divisor: string,
  precision = 12
): string {
  if (!Number.isInteger(precision) || precision < 0) {
    throw new RangeError("precision must be a non-negative integer");
  }

  const leftParsed = parseDecimal(dividend);
  const rightParsed = parseDecimal(divisor);

  if (rightParsed.digits === 0n) {
    throw new RangeError("cannot divide by zero");
  }

  const sign: 1 | -1 = leftParsed.sign === rightParsed.sign ? 1 : -1;
  const numerator =
    leftParsed.digits * pow10(precision + rightParsed.scale);
  const quotient = numerator / rightParsed.digits;
  const scale = leftParsed.scale + precision;

  if (quotient === 0n) {
    return "0";
  }

  return formatParsedDecimal(sign, quotient, scale);
}

export function compareDecimalStrings(left: string, right: string): number {
  const leftParsed = parseDecimal(left);
  const rightParsed = parseDecimal(right);
  const scale = Math.max(leftParsed.scale, rightParsed.scale);
  const leftScaled = BigInt(leftParsed.sign) * scaleDigits(leftParsed.digits, leftParsed.scale, scale);
  const rightScaled = BigInt(rightParsed.sign) * scaleDigits(rightParsed.digits, rightParsed.scale, scale);

  if (leftScaled === rightScaled) {
    return 0;
  }

  return leftScaled > rightScaled ? 1 : -1;
}

export function isPositiveDecimal(value: string): boolean {
  return compareDecimalStrings(value, "0") === 1;
}

interface ParsedDecimal {
  readonly sign: 1 | -1;
  readonly digits: bigint;
  readonly scale: number;
}

function parseDecimal(value: string): ParsedDecimal {
  const normalized = normalizeDecimalString(value);

  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) {
    throw new TypeError(`Invalid decimal string: ${value}`);
  }

  const sign: 1 | -1 = normalized.startsWith("-") ? -1 : 1;
  const absolute = sign === -1 ? normalized.slice(1) : normalized;
  const [integerPart, fractionalPart = ""] = absolute.split(".");
  const digits = BigInt(`${integerPart}${fractionalPart}` || "0");

  return {
    sign,
    digits,
    scale: fractionalPart.length
  };
}

function scaleDigits(digits: bigint, currentScale: number, targetScale: number): bigint {
  if (targetScale < currentScale) {
    throw new RangeError("target scale cannot be smaller than current scale");
  }

  return digits * pow10(targetScale - currentScale);
}

function formatParsedDecimal(sign: 1 | -1, digits: bigint, scale: number): string {
  const rawDigits = digits.toString();

  if (scale === 0) {
    return normalizeDecimalString(`${sign === -1 ? "-" : ""}${rawDigits}`);
  }

  const padded = rawDigits.padStart(scale + 1, "0");
  const splitIndex = padded.length - scale;
  const integerPart = padded.slice(0, splitIndex);
  const fractionalPart = padded.slice(splitIndex);

  return normalizeDecimalString(
    `${sign === -1 ? "-" : ""}${integerPart}.${fractionalPart}`
  );
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}
