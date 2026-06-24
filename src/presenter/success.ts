import {
	BROWSER_TABLE_FIELDS,
	BROWSER_TABLE_FIELDS_ALL,
	CHANNEL_TABLE_FIELDS,
	normalizeClosed,
	normalizeCloseStatus,
	normalizeSessions,
	resolveTableFields,
	SERVER_TABLE_FIELDS,
} from "../domain/sessions.js";
import { commandGroupFor } from "../domain/upstreamCommands.js";
import { canonicalizePath } from "../domain/commandSurface.js";
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
		if (FLAT_RESULT_COMMANDS.has(command))
			return flatResultModel(command, parsed.value);
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

/** Commands whose upstream payload wraps a single scalar in `{ result: <value> }`.
 * `eval` runs in the browser DOM context and `run-code` in the node context; both
 * JSON-encode their return value into `result`. We lift that value to the top
 * level and undo the JSON encoding so the agent reads it directly instead of
 * digging through `result: result: "\"…\""` (C-2). */
const FLAT_RESULT_COMMANDS = new Set(["eval", "run-code"]);

/** C-2: lift the single return value out of `{ result: <value> }` to the top
 * level and recover the real JS value (upstream JSON-encodes eval/run-code
 * returns into a string). Strings are JSON.parsed with a raw-string fallback
 * so non-JSON strings survive unchanged. */
function flatResultModel(
	command: string,
	value: unknown,
): Record<string, ToonValue> {
	const base = baseModel(command);
	if (isObject(value) && "result" in value) {
		return {
			...base,
			result: recoverScalarValue((value as { result: unknown }).result),
		};
	}
	return { ...base, result: toResultValue(value) };
}

/** Undo upstream's JSON encoding of an eval/run-code return value. A JSON
 * string is parsed back to its real value (number/boolean/string/object); a
 * non-JSON string is returned as-is; non-strings pass through simply. */
function recoverScalarValue(inner: unknown): ToonValue {
	if (typeof inner === "string") {
		try {
			return JSON.parse(inner) as ToonValue;
		} catch {
			return inner;
		}
	}
	return simpleValue(inner);
}

/** H3-2: true when `value` is a plain object whose only own enumerable key is
 * `result` — the shape upstream uses to wrap a family command's single return
 * value (storage reads, network, screenshot, pdf, state). */
function isSingleResultObject(value: unknown): value is { result: unknown } {
	if (!isObject(value)) return false;
	const keys = Object.keys(value);
	return keys.length === 1 && keys[0] === "result";
}

/** H3-2: lift a single-`result`-key upstream payload to its inner value so
 * family read commands do not double-nest as `result: result: <value>`. The
 * inner value is returned verbatim (no JSON parsing — these are literal
 * display strings, unlike eval/run-code). Multi-key or non-`result` payloads
 * pass through unchanged so artifact/counts enrichment is preserved. */
function liftSingleResultValue(value: unknown): unknown {
	return isSingleResultObject(value)
		? (value as { result: unknown }).result
		: value;
}

function familyResultModel(
	command: string,
	value: unknown,
	options: SuccessOptions,
): Record<string, ToonValue> {
	// H3-2: upstream wraps family command payloads as `{ result: <value> }`.
	// When that is the entire payload (single own `result` key), lift the inner
	// value to the top level so the agent reads it directly instead of digging
	// through `result: result: "…"` (generalizes C-2 to all family read
	// commands — storage, network, screenshot, pdf, state). Unlike eval/run-code
	// these values are literal display strings, so they are NOT JSON-parsed.
	const lifted = liftSingleResultValue(value);
	// H3-3: resolve relative paths inside the flattened result string (markdown
	// link targets like `](path)`) against the artifact base so screenshot/pdf/
	// state-save file paths are findable from the shell cwd instead of relative
	// to the daemon's spawn cwd. Already-absolute paths and non-link strings
	// (network/storage display text) pass through unchanged.
	const result = absolutizeResultPaths(
		toResultValue(lifted),
		options.artifactBase,
	);
	const artifacts = ARTIFACT_SUMMARY_GROUP_IDS.has(
		commandGroupFor(command)?.id ?? "",
	)
		? artifactRows(value)
		: [];
	const counts = arrayCounts(value);
	// H3-4: give storage read commands a definitive empty/not-found state so an
	// agent can assert emptiness without string-matching display text (AXI
	// principle 5). `found: false` is attached only for the known empty patterns.
	const foundFalse = storageFoundFalse(command, result);
	const base: Record<string, ToonValue> = {
		...baseModel(command),
		...(Object.keys(counts).length > 0 ? { counts } : {}),
		...(artifacts.length > 0
			? { artifacts: table(["path", "type", "source"], artifacts) }
			: {}),
		...(foundFalse ? { found: false } : {}),
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

/** H3-4: storage read commands whose empty/not-found state should be surfaced
 * as a definitive `found: false` field instead of only a display string. */
const STORAGE_READ_COMMANDS = new Set([
	"cookie-get",
	"cookie-list",
	"localstorage-get",
	"localstorage-list",
	"sessionstorage-get",
	"sessionstorage-list",
]);

/** H3-4: upstream empty/not-found display strings for storage reads. Matching
 * one means the read found nothing, so the model attaches `found: false`. */
const STORAGE_EMPTY_RE =
	/^(No (localStorage items|sessionStorage items|cookies) found|Cookie '.+' not found|(localStorage|sessionStorage) key '.+' not found)$/;

/** H3-4: return true when a storage read command's result is an empty/not-found
 * display string, so the model can attach a machine-readable `found: false`. */
function storageFoundFalse(command: string, result: ToonValue): boolean {
	if (!STORAGE_READ_COMMANDS.has(command)) return false;
	return typeof result === "string" && STORAGE_EMPTY_RE.test(result);
}

function resolveAgainst(path: string, base: string): string {
	if (path === "") return path;
	const isAbsolute =
		path.startsWith("/") ||
		/^[A-Za-z]:[\\/]/.test(path) ||
		path.startsWith("\\\\");
	return isAbsolute
		? path
		: canonicalizePath(`${base.replace(/\/+$/, "")}/${path}`);
}

/** H3-3: resolve relative markdown-link targets (`](path)`) inside a flattened
 * family result string against the artifact base. Upstream renders screenshot /
 * pdf / state-save file paths relative to its spawn cwd, which is invisible
 * from the agent's shell cwd; this makes them absolute and findable. Strings
 * without link targets (network/storage display text) and already-absolute
 * paths pass through unchanged. */
function absolutizeResultPaths(
	value: ToonValue,
	base?: string,
): ToonValue {
	if (!base || typeof value !== "string") return value;
	return value.replace(
		/\]\(([^)]+)\)/g,
		(_m, p: string) => `](${resolveAgainst(p, base)})`,
	);
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
