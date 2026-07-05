import { encodeBase62 } from './base62-encoder';

describe('encodeBase62', () => {
  it('encodes single-digit values using the 0-9 range', () => {
    expect(encodeBase62(0)).toBe('0');
    expect(encodeBase62(9)).toBe('9');
  });

  it('encodes values in the a-z range (10-35)', () => {
    expect(encodeBase62(10)).toBe('a');
    expect(encodeBase62(35)).toBe('z');
  });

  it('encodes values in the A-Z range (36-61)', () => {
    expect(encodeBase62(36)).toBe('A');
    expect(encodeBase62(61)).toBe('Z');
  });

  it('encodes multi-digit values', () => {
    expect(encodeBase62(62)).toBe('10');
    expect(encodeBase62(63)).toBe('11');
  });

  it('throws for negative numbers', () => {
    expect(() => encodeBase62(-1)).toThrow();
  });
});
