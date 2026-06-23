import { normalizeClosed, normalizeCloseStatus, normalizeSessions } from '../domain/sessions.js';
import { commandGroupFor } from '../domain/upstreamCommands.js';
import { isObject, type ParsedUpstream } from '../upstream/parse.js';
import { type ToonValue, table } from './toon.js';

interface ArtifactRow extends Record<string, ToonValue> {
  path: string;
  type: string;
  source: string;
}

export function commandSuccessModel(
  command: string,
  parsed: ParsedUpstream
): Record<string, ToonValue> {
  if (parsed.kind === 'json') {
    if (command === 'list') return listModel(command, parsed.value);
    if (command === 'close') return closeModel(command, parsed.value);
    if (command === 'close-all') return closeAllModel(command, parsed.value);
    return familyResultModel(command, parsed.value);
  }

  return {
    ...baseModel(command),
    output: parsed.text.length > 1200 ? `${parsed.text.slice(0, 1200)}… (${parsed.text.length} chars total)` : parsed.text
  };
}

function listModel(command: string, value: unknown): Record<string, ToonValue> {
  const sessions = normalizeSessions(value);
  return {
    ...baseModel(command),
    browsers: {
      count: sessions.browsers.count,
      ...(sessions.browsers.empty ? { empty: sessions.browsers.empty } : {})
    },
    ...(sessions.browsers.rows.length > 0 ? { browser_rows: table(['id', 'name', 'status'], sessions.browsers.rows) } : {}),
    servers: {
      count: sessions.servers.count,
      ...(sessions.servers.empty ? { empty: sessions.servers.empty } : {})
    },
    ...(sessions.servers.rows.length > 0 ? { server_rows: table(['title', 'browser', 'version', 'dataDir', 'workspace'], sessions.servers.rows) } : {}),
    channel_sessions: {
      count: sessions.channelSessions.count,
      ...(sessions.channelSessions.empty ? { empty: sessions.channelSessions.empty } : {})
    },
    ...(sessions.channelSessions.rows.length > 0
      ? { channel_session_rows: table(['channel', 'dataDir', 'extension', 'endpoint'], sessions.channelSessions.rows) }
      : {})
  };
}

function closeModel(command: string, value: unknown): Record<string, ToonValue> {
  const closed = normalizeCloseStatus(value);
  return {
    ...baseModel(command),
    session: closed.session,
    close: { status: closed.status }
  };
}

function closeAllModel(command: string, value: unknown): Record<string, ToonValue> {
  const closed = normalizeClosed(value);
  return {
    ...baseModel(command),
    closed: {
      count: closed.count,
      ...(closed.empty ? { empty: closed.empty } : {})
    },
    ...(closed.rows.length > 0 ? { closed_rows: table(['id', 'status'], closed.rows) } : {})
  };
}

function familyResultModel(command: string, value: unknown): Record<string, ToonValue> {
  const result = toResultValue(value);
  const artifacts = artifactRows(value);
  const counts = arrayCounts(value);
  return {
    ...baseModel(command),
    ...(Object.keys(counts).length > 0 ? { counts } : {}),
    ...(artifacts.length > 0 ? { artifacts: table(['path', 'type', 'source'], artifacts) } : {}),
    result
  };
}

function baseModel(command: string): Record<string, ToonValue> {
  const group = commandGroupFor(command);
  return {
    command,
    status: 'ok',
    ...(group ? { family: { id: group.id, title: group.title } } : {})
  };
}

function arrayCounts(value: unknown): Record<string, ToonValue> {
  if (!isObject(value)) return {};
  const counts: Record<string, ToonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) counts[key] = child.length;
  }
  return counts;
}

function artifactRows(value: unknown, source = 'result', rows: ArtifactRow[] = []): ArtifactRow[] {
  if (rows.length >= 20) return rows;
  if (typeof value === 'string') {
    const type = artifactType(value);
    if (type) rows.push({ path: value, type, source });
    return rows;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => artifactRows(entry, `${source}[${index}]`, rows));
    return rows;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) artifactRows(child, `${source}.${key}`, rows);
  }
  return rows;
}

function artifactType(path: string): string | undefined {
  const normalized = path.split('?')[0]?.toLowerCase() ?? '';
  if (/\.(png|jpe?g|webp)$/.test(normalized)) return 'image';
  if (normalized.endsWith('.pdf')) return 'pdf';
  if (normalized.endsWith('.webm')) return 'video';
  if (/\.(zip|trace)$/.test(normalized)) return 'trace';
  if (/\.(json|har)$/.test(normalized)) return 'data';
  if (/\.(txt|log|html)$/.test(normalized)) return 'text';
  return undefined;
}

function toResultValue(value: unknown): ToonValue {
  if (isObject(value)) return pruneJson(value);
  if (Array.isArray(value)) return simpleValue(value);
  return String(value);
}

function pruneJson(value: Record<string, unknown>): ToonValue {
  const output: Record<string, ToonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'isError') continue;
    output[key] = simpleValue(child);
  }
  return output;
}

function simpleValue(value: unknown): ToonValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.map((entry) => simpleValue(entry)) as ToonValue;
  if (isObject(value)) return pruneJson(value);
  return String(value);
}
