// Pure secret-scrubbing — no I/O, no side effects. Apply before storing any shell command.

type Rule = [RegExp, string | ((m: string) => string)];

const RULES: Rule[] = [
  // JWTs (3-part base64url)
  [/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[JWT]'],
  // GitHub PATs and fine-grained tokens
  [/gh[pousr]_[A-Za-z0-9]{36,}/g, '[REDACTED]'],
  // npm publish tokens
  [/npm_[A-Za-z0-9]{36}/g, '[REDACTED]'],
  // Bearer tokens
  [/Bearer\s+\S+/gi, 'Bearer [REDACTED]'],
  // AWS secret key value
  [/AWS_SECRET_ACCESS_KEY\s*=\s*\S+/gi, 'AWS_SECRET_ACCESS_KEY=[REDACTED]'],
  // AWS access key ID (20-char uppercase alphanumeric starting with AKIA)
  [/AKIA[A-Z0-9]{16}/g, '[REDACTED]'],
  // Generic api_key / secret / token / password assignments
  [/(?:api[_-]?key|secret|token|password|passwd|pwd)s?\s*[=:]\s*['"]?\S{8,}['"]?/gi,
    (m: string) => m.replace(/([=:])\s*['"]?\S+['"]?$/, '$1[REDACTED]')],
  // Long env-var assignments (VAR=longvalue — value ≥ 16 chars)
  [/(^|\s)([A-Z][A-Z0-9_]{3,})=([^\s]{16,})/gm, '$1$2=[REDACTED]'],
];

export function redact(input: string): string {
  let out = input;
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern as RegExp, replacement as string);
  }
  return out;
}
