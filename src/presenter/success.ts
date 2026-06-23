import { normalizeClosed, normalizeSessions } from '../domain/sessions.js';
import { isObject, type ParsedUpstream } from '../upstream/parse.js';
import { table, type ToonValue } from './toon.js';

export function commandSuccessModel(command: string, parsed: ParsedUpstream): Record<string, ToonValue> {
  if (parsed.kind === 'json') {
    if (command === 'list') {
      const sessions = normalizeSessions(parsed.value);
      return {
        command,
        status: 'ok',
        browsers: {
          count: sessions.browsers.count,
          ...(sessions.browsers.empty ? { empty: sessions.browsers.empty } : {})
        },
        ...(sessions.browsers.rows.length > 0 ? { browser_rows: table(['id', 'name', 'status'], sessions.browsers.rows) } : {})
      };
    }
    if (command === 'close-all' || command === 'close') {
      const closed = normalizeClosed(parsed.value);
      return {
        command,
        status: 'ok',
        closed: {
          count: closed.count,
          ...(closed.empty ? { empty: closed.empty } : {})
        },
        ...(closed.rows.length > 0 ? { closed_rows: table(['id', 'status'], closed.rows) } : {})
      };
    }
    if (isObject(parsed.value)) return { command, status: 'ok', result: pruneJson(parsed.value) };
    return { command, status: 'ok', result: String(parsed.value) };
  }

  return {
    command,
    status: 'ok',
    output: parsed.text.length > 1200 ? `${parsed.text.slice(0, 1200)}… (${parsed.text.length} chars total)` : parsed.text
  };
}

function pruneJson(value: Record<string, unknown>): ToonValue {
  const output: Record<string, ToonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'isError') continue;
    if (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean' || child === null) output[key] = child;
    else if (Array.isArray(child)) output[key] = child.map((entry) => simpleValue(entry)) as ToonValue;
    else if (isObject(child)) output[key] = pruneJson(child);
    else output[key] = String(child);
  }
  return output;
}

function simpleValue(value: unknown): ToonValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.map((entry) => simpleValue(entry)) as ToonValue;
  if (isObject(value)) return pruneJson(value);
  return String(value);
}
