export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

// 로그와 응답에 비밀값이 섞이지 않도록 마스킹한다.
const SECRET_PATTERNS: RegExp[] = [
  /(password|secret|token|key|authorization|cookie)=([^&\s]+)/gi,
  /(Bearer\s+)[A-Za-z0-9._-]+/gi,
  /postgres(ql)?:\/\/[^\s]+/gi,
];

export function redact(text: string): string {
  return SECRET_PATTERNS.reduce(
    (acc, pattern) => acc.replace(pattern, (_match, prefix: string) => `${prefix ?? ''}***`),
    text,
  );
}
