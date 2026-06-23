export type ParsedUpstream =
  | { kind: 'json'; value: unknown; isError: boolean; error?: string }
  | { kind: 'text'; text: string; isError: boolean; error?: string };

export function parseUpstreamOutput(stdout: string, stderr: string, exitCode: number): ParsedUpstream {
  const trimmed = stdout.trim();
  if (trimmed.length > 0) {
    try {
      const value = JSON.parse(trimmed) as unknown;
      const isError = isObject(value) && value.isError === true;
      const error = isError && typeof value.error === 'string' ? value.error : undefined;
      return { kind: 'json', value, isError, error };
    } catch {
      return { kind: 'text', text: trimmed, isError: exitCode !== 0, error: exitCode !== 0 ? trimmed : undefined };
    }
  }

  const safeStderr = sanitizeDependencyText(stderr);
  return { kind: 'text', text: safeStderr, isError: exitCode !== 0, error: exitCode !== 0 ? safeStderr : undefined };
}

export function sanitizeDependencyText(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (/^\s*at\s/.test(line)) return false;
    if (/^Error:\s*$/.test(trimmed)) return false;
    if (/node:internal\//.test(trimmed)) return false;
    return true;
  });
  return kept.slice(0, 8).join('\n').trim();
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
