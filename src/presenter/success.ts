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
  /** F-3: cwd upstream ran in; relative returned paths are resolved against it. */
  artifactBase?: string;
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
    if (command === "snapshot")
      return snapshotModel(command, parsed.value, options);
    if (NAVIGATION_COMMANDS.has(command))
      return navigationModel(command, parsed.value, options);
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

/** Commands whose payload carries an auto-generated snapshot/artifact file (P-1). */
const NAVIGATION_COMMANDS = new Set([
  "open",
  "goto",
  "click",
  "dblclick",
  "fill",
  "select",
  "check",
  "uncheck",
  "hover",
  "drag",
  "drop",
  "reload",
  "go-back",
  "go-forward",
  "tab-new",
  "tab-select",
]);

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
  const serverFields = resolveTableFields(
    fields,
    SERVER_TABLE_FIELDS,
    SERVER_TABLE_FIELDS,
  );
  const channelFields = resolveTableFields(
    fields,
    CHANNEL_TABLE_FIELDS,
    CHANNEL_TABLE_FIELDS,
  );
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
  const artifacts = ARTIFACT_SUMMARY_GROUP_IDS.has(
    commandGroupFor(command)?.id ?? "",
  )
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
    return value === undefined ? "" : (JSON.stringify(value) ?? "");
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

/**
 * P-1: flatten navigation results so the snapshot/artifact file is top-level
 * instead of buried under a redundant `result.result.snapshot` envelope.
 * Siblings like session/pid are preserved.
 */
function navigationModel(
  command: string,
  value: unknown,
  options: SuccessOptions,
): Record<string, ToonValue> {
  const base = baseModel(command);
  if (!isObject(value)) return { ...base, result: toResultValue(value) };

  const lifted: Record<string, ToonValue> = { ...base };
  const remaining: Record<string, ToonValue> = {};

  for (const [key, child] of Object.entries(value)) {
    if (key === "result" && isObject(child) && "snapshot" in child) {
      // Lift the snapshot out of the redundant `result` wrapper.
      lifted.snapshot = resolveSnapshot(
        simpleValue(child.snapshot),
        options.artifactBase,
      );
      // Keep any non-snapshot siblings of the inner result.
      for (const [innerKey, innerChild] of Object.entries(child)) {
        if (innerKey === "snapshot") continue;
        remaining[innerKey] = simpleValue(innerChild);
      }
    } else if (key === "snapshot") {
      lifted.snapshot = resolveSnapshot(
        simpleValue(child),
        options.artifactBase,
      );
    } else {
      remaining[key] = simpleValue(child);
    }
  }

  if (Object.keys(remaining).length > 0) lifted.result = remaining;
  else if (lifted.snapshot === undefined) lifted.result = toResultValue(value);
  return lifted;
}

/**
 * F-3: resolve a returned snapshot file path against the artifact dir so the
 * agent can find it regardless of where upstream ran. Text snapshots (the a11y
 * tree) and already-absolute paths pass through unchanged.
 */
function resolveSnapshot(
  snapshot: ToonValue,
  artifactBase?: string,
): ToonValue {
  if (!artifactBase) return snapshot;
  if (isObject(snapshot) && typeof snapshot.file === "string") {
    return { ...snapshot, file: resolveAgainst(snapshot.file, artifactBase) };
  }
  if (typeof snapshot === "string" && snapshot.includes("\n")) {
    // A11y tree text: multi-line YAML-like tree structure starting with "- "
    // More robust than just checking for newlines
    const trimmed = snapshot.trimStart();
    if (trimmed.startsWith("- ")) {
      return snapshot;
    }
  }
  if (typeof snapshot === "string")
    return resolveAgainst(snapshot, artifactBase);
  return snapshot;
}

function resolveAgainst(path: string, base: string): string {
  if (path === "") return path;
  const isAbsolute =
    path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.startsWith("\\\\");
  return isAbsolute ? path : `${base.replace(/\/+$/, "")}/${path}`;
}

/**
 * P-2: render the accessibility-tree snapshot as readable bounded text instead
 * of a double-escaped JSON-string-of-YAML. Truncate the tree with a total
 * char count and the `--full` escape hatch (AXI principle 3).
 */
function snapshotModel(
  command: string,
  value: unknown,
  options: SuccessOptions,
): Record<string, ToonValue> {
  const payload = unwrapResult(value);
  const text =
    isObject(payload) && typeof payload.snapshot === "string"
      ? payload.snapshot
      : typeof value === "string"
        ? value
        : "";
  const base = baseModel(command);
  if (text.length === 0) {
    return { ...base, result: toResultValue(value) };
  }
  if (options.full || text.length <= 1200) {
    return { ...base, snapshot: text };
  }
  return {
    ...base,
    snapshot: `${text.slice(0, 1200)}…`,
    snapshot_truncated: true,
    snapshot_chars: text.length,
    help: [`playwright-cli-axi snapshot --full`],
  };
}

/** Unwrap upstream's `{ result: <payload> }` convention when present. */
function unwrapResult(value: unknown): unknown {
  if (isObject(value) && isObject(value.result)) return value.result;
  return value;
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
