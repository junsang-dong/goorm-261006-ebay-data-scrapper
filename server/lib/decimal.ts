// 금액은 float 대신 정수 스케일(10^-4)로 계산한다. DB 컬럼 numeric(18,4)와 같은 정밀도다.
const SCALE = 10_000n;
const DECIMAL_PATTERN = /^\d{1,14}(\.\d{1,4})?$/;

export function parseDecimal(value: string): bigint {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new Error(`Invalid decimal: ${value}`);
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, '0'));
}

export function formatDecimal(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = (abs / SCALE).toString();
  const fraction = (abs % SCALE).toString().padStart(4, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function addDecimal(a: string, b: string): string {
  return formatDecimal(parseDecimal(a) + parseDecimal(b));
}

export function compareDecimal(a: string, b: string): number {
  const diff = parseDecimal(a) - parseDecimal(b);
  return diff === 0n ? 0 : diff < 0n ? -1 : 1;
}
