import { describe, expect, it } from 'vitest';
import { addDecimal, compareDecimal, formatDecimal, parseDecimal } from '../server/lib/decimal';

describe('decimal arithmetic', () => {
  it('adds values without float drift', () => {
    // 0.1 + 0.2 는 float 에서 0.30000000000000004 가 된다
    expect(addDecimal('0.10', '0.20')).toBe('0.30');
    expect(addDecimal('1234.56', '0.44')).toBe('1235.00');
  });

  it('compares values numerically, not as strings', () => {
    expect(compareDecimal('9.99', '10.00')).toBe(-1);
    expect(compareDecimal('10.00', '10')).toBe(0);
    expect(compareDecimal('100', '20.5')).toBe(1);
  });

  it('rejects malformed input', () => {
    expect(() => parseDecimal('12.345678')).toThrow();
    expect(() => parseDecimal('abc')).toThrow();
  });

  it('keeps at least two fraction digits when formatting', () => {
    expect(formatDecimal(parseDecimal('5'))).toBe('5.00');
    expect(formatDecimal(parseDecimal('5.5'))).toBe('5.50');
  });
});
