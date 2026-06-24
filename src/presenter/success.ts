import {
  normalizeClosed,
  normalizeCloseStatus,
  normalizeSessions,
  resolveTableFields,
  BROWSER_TABLE_FIELDS,
  BROWSER_TABLE_FIELDS_ALL,
  SERVER_TABLE_FIELDS,
  CHANNEL_TABLE_FIELDS,
} from "../domain/sessions.js";
import { commandGroupFor } from "../domain/upstreamCommands.js";
import { isObject, type ParsedUpstream } from "../upstream/parse.js";
import { type ToonValue, table } from "./toon.js";

interface ArtifactRow extends Record<string, ToonValue> {
  path: string;
  type: string;
  source: string;
}

const MAX_RESULT_DEPTH = 40;
const ARTIFACT_SUMMARY_GROUP_IDS = new Set(["artifacts"]);
/** Above this serialized size, generic JSON results are previewed with a total
 * byte count and a `--full` escape hatch (AXI principle 3). */
const MAX_RESULT_BYTES = 1500;

export interface SuccessOptions {
  full?: boolean;
  fields?: string[];
}

export function commandSuccessModel(
  command: string,
  parsed: ParsedUpstream,
  options: SuccessOptions = {},
): Record<string, ToonValue> {
  if (parsed.kind === "json") {
    if (command === "list")
      return listModel(command, parsed.value, options.fields);
    if (command === "close") return closeModel(command, parsed.value);
    if (command === "close-all") return closeAllModel(command, parsed.value);
    return familyResultModel(command, parsed.value, options);
  }

  return {
    ...baseModel(command),
    output:
      parsed.text.length > 1200
        ? `${parsed.text.slice(0, 1200)}… (${parsed.text.length} chars total)`
        : parsed.text,
  };
}

function listModel(
  command: string,
  value: unknown,
  fields?: string[],
): Record<string, ToonValue> {
  const sessions = normalizeSessions(value);
  const browserFields = resolveTableFields(
    fields,
    BROWSER_TABLE_FIELDS,
    BROWSER_TABLE_FIELDS_ALL,
  );
  const serverFields = resolveTableFields(fields, SERVER_TABLE_FIELDS, SERVER_TABLE_FIELDS);
  const channelFields = resolveTableFields(fields, CHANNEL_TABLE_FIELDS, CHANNEL_TABLE_FIELDS);
  return {
    ...baseModel(command),
    browsers: {
      count: sessions.browsers.count,
      ...(sessions.browsers.empty ? { empty: sessions.browsers.empty } : {}),
    },
    ...(sessions.browsers.rows.length > 0
      ? {
          browser_rows: table(browserFields, sessions.browsers.rows),
        }
      : {}),
    servers: {
      count: sessions.servers.count,
      ...(sessions.servers.empty ? { empty: sessions.servers.empty } : {}),
    },
    ...(sessions.servers.rows.length > 0
      ? {
          server_rows: table(serverFields, sessions.servers.rows),
        }
      : {}),
    channel_sessions: {
      count: sessions.channelSessions.count,
      ...(sessions.channelSessions.empty
        ? { empty: sessions.channelSessions.empty }
        : {}),
    },
    ...(sessions.channelSessions.rows.length > 0
      ? {
          channel_session_rows: table(
            channelFields,
            sessions.channelSessions.rows,
          ),
        }
      : {}),
  };
}

function closeModel(
  command: string,
  value: unknown,
): Record<string, ToonValue> {
  const closed = normalizeCloseStatus(value);
  return {
    ...baseModel(command),
    session: closed.session,
    close: { status: closed.status },
  };
}

function closeAllModel(
  command: string,
  value: unknown,
): Record<string, ToonValue> {
  const closed = normalizeClosed(value);
  return {
    ...baseModel(command),
    closed: {
      count: closed.count,
      ...(closed.empty ? { empty: closed.empty } : {}),
    },
    ...(closed.rows.length > 0
      ? { closed_rows: table(["id", "status"], closed.rows) }
      : {}),
  };
}

function familyResultModel(
  command: string,
  value: unknown,
  options: SuccessOptions,
): Record<string, ToonValue> {
  const result = toResultValue(value);
  const artifacts = ARTIFACT_SUMMARY_GROUP_IDS.has(commandGroupFor(command)?.id ?? "")
    ? artifactRows(value)
    : [];
  const counts = arrayCounts(value);
  const base: Record<string, ToonValue> = {
    ...baseModel(command),
    ...(Object.keys(counts).length > 0 ? { counts } : {}),
    ...(artifacts.length > 0
      ? { artifacts: table(["path", "type", "source"], artifacts) }
      : {}),
  };
  const serialized = safeStringify(result);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (options.full || bytes <= MAX_RESULT_BYTES) {
    return { ...base, result };
  }
  return {
    ...base,
    result: `${truncateUtf8(serialized, MAX_RESULT_BYTES)}…`,
    result_truncated: true,
    result_bytes: bytes,
    help: [`playwright-cli-axi ${command} --full`],
  };
}

/** Serialize a value defensively; returns "" if JSON.stringify throws. */
function safeStringify(value: ToonValue): string {
  try {
    return value === undefined ? "" : JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * Truncate a UTF-8 string to at most `maxBytes` without splitting a multibyte
 * code point (so the result is always valid UTF-8 / no lone surrogates). Bytes
 * are counted with Buffer.byteLength, matching the `result_bytes` contract.
 */
function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxBytes) return value;
  const buf = Buffer.from(value, "utf8").subarray(0, maxBytes);
  // Back up to a complete code point. First walk back over trailing continuation
  // bytes (0x80..0xBF). Then, if the byte that remains is a leading byte
  // (0xc0-class), its sequence is incomplete (its continuations are beyond the
  // slice), so exclude it too. The result never splits a multibyte sequence, so
  // no lone surrogate / replacement char is produced.
  let cut = maxBytes;
  while (cut > 0 && (buf[cut - 1]! & 0xc0) === 0x80) cut -= 1;
  if (cut > 0 && (buf[cut - 1]! & 0xc0) === 0xc0) cut -= 1;
  return buf.subarray(0, cut).toString("utf8");
}

function baseModel(command: string): Record<string, ToonValue> {
  const group = commandGroupFor(command);
  return {
    command,
    status: "ok",
    ...(group ? { family: { id: group.id, title: group.title } } : {}),
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

function artifactRows(
  value: unknown,
  source = "result",
  rows: ArtifactRow[] = [],
  depth = 0,
): ArtifactRow[] {
  if (rows.length >= 20 || depth > MAX_RESULT_DEPTH) return rows;
  if (typeof value === "string") {
    const type = artifactType(value);
    if (type) rows.push({ path: value, type, source });
    return rows;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      artifactRows(entry, `${source}[${index}]`, rows, depth + 1),
    );
    return rows;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value))
      artifactRows(child, `${source}.${key}`, rows, depth + 1);
  }
  return rows;
}

function artifactType(path: string): string | undefined {
  const normalized = path.split("?")[0]?.toLowerCase() ?? "";
  if (/\.(png|jpe?g|webp)$/.test(normalized)) return "image";
  if (normalized.endsWith(".pdf")) return "pdf";
  if (normalized.endsWith(".webm")) return "video";
  if (/\.(zip|trace)$/.test(normalized)) return "trace";
  if (/\.(json|har)$/.test(normalized)) return "data";
  if (/\.(txt|log|html)$/.test(normalized)) return "text";
  return undefined;
}

function toResultValue(value: unknown): ToonValue {
  if (isObject(value)) return pruneJson(value);
  if (Array.isArray(value)) return simpleValue(value);
  return String(value);
}

function pruneJson(value: Record<string, unknown>, depth = 0): ToonValue {
  if (depth > MAX_RESULT_DEPTH) return "[max-depth]";
  const output: Record<string, ToonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "isError") continue;
    output[key] = simpleValue(child, depth + 1);
  }
  return output;
}

function simpleValue(value: unknown, depth = 0): ToonValue {
  if (depth > MAX_RESULT_DEPTH) return "[max-depth]";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  )
    return value;
  if (Array.isArray(value))
    return value.map((entry) => simpleValue(entry, depth + 1)) as ToonValue;
  if (isObject(value)) return pruneJson(value, depth + 1);
  return String(value);
}
