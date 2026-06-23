import { isObject } from '../upstream/parse.js';

export interface SessionSummary {
  browsers: { count: number; empty?: string; rows: BrowserRow[] };
}

export interface BrowserRow {
  id: string;
  name: string;
  status: string;
}

export function normalizeSessions(value: unknown): SessionSummary {
  if (!isObject(value)) return emptySessions();
  const browsers = Array.isArray(value.browsers) ? value.browsers : [];
  const rows = browsers.map((browser, index): BrowserRow => {
    if (!isObject(browser)) return { id: String(index + 1), name: 'browser', status: 'open' };
    return {
      id: stringField(browser, ['id', 'browserId', 'name'], String(index + 1)),
      name: stringField(browser, ['name', 'browserName', 'type'], 'browser'),
      status: stringField(browser, ['status', 'state'], 'open')
    };
  });

  return {
    browsers: {
      count: rows.length,
      empty: rows.length === 0 ? 'no open browsers' : undefined,
      rows
    }
  };
}

export function normalizeClosed(value: unknown): { count: number; empty?: string; rows: { id: string; status: string }[] } {
  if (!isObject(value) || !Array.isArray(value.closed)) return { count: 0, empty: 'no browsers were closed', rows: [] };
  const rows = value.closed.map((entry, index) => ({
    id: isObject(entry) ? stringField(entry, ['id', 'name'], String(index + 1)) : String(entry),
    status: 'closed'
  }));
  return { count: rows.length, empty: rows.length === 0 ? 'no browsers were closed' : undefined, rows };
}

function emptySessions(): SessionSummary {
  return { browsers: { count: 0, empty: 'no open browsers', rows: [] } };
}

function stringField(object: Record<string, unknown>, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number') return String(value);
  }
  return fallback;
}
