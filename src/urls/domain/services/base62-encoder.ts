const ALPHABET =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE = ALPHABET.length;

export function encodeBase62(value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `encodeBase62: value must be a non-negative integer, got ${value}`,
    );
  }

  if (value === 0) {
    return ALPHABET[0];
  }

  let result = '';
  let remaining = value;
  while (remaining > 0) {
    result = ALPHABET[remaining % BASE] + result;
    remaining = Math.floor(remaining / BASE);
  }
  return result;
}
