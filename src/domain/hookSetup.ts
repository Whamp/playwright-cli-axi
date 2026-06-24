import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  accessSync,
  constants,
  realpathSync,
  copyFileSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
} from "node:fs";
import { dirname, join, sep } from "node:path";

export type HookTarget = "claude" | "codex";
export type HookScope = "user" | "project";

export const SETUP_TARGETS: readonly HookTarget[] = ["claude", "codex"];

/** Subcommand the hook invokes to emit session-start context. */
export const CONTEXT_SUBCOMMAND = "context";

export interface SetupDeps {
  /** Resolve a binary name to an absolute path (injectable for tests). */
  which?: (name: string) => string | undefined;
  /** Read a file as UTF-8 text; return undefined if it does not exist. */
  readFile?: (path: string) => string | undefined;
  /** Write text to a file. The default is atomic (temp + fsync + rename). */
  writeFile?: (path: string, content: string) => void;
  /** Whether a file exists (used for Codex config.toml checks). */
  exists?: (path: string) => boolean;
  /** Resolve a path to its canonical form, following symlinks. */
  realpath?: (path: string) => string;
}

export interface SetupInstall {
  target: HookTarget;
  path: string;
  action: "installed" | "repaired" | "noop" | "skipped";
  /** Present when a target was skipped (e.g. corrupt settings file). */
  error?: string;
}

export interface SetupInput {
  executablePath: string;
  cwd: string;
  home?: string;
  scope: HookScope;
  targets?: HookTarget[];
  deps?: SetupDeps;
}

export interface SetupResult {
  targets: HookTarget[];
  installed: SetupInstall[];
  binary: "path" | "name";
}

/**
 * Install/repair the SessionStart hook for the requested targets.
 *
 * The hook command mirrors the mainline hook shape (sh -c with
 * `command -v … && exec … || exit 0`) so it composes with existing mainline
 * hooks. It is idempotent: an existing entry with the same command is a silent
 * no-op, and an entry with a stale path is repaired in place.
 *
 * Safety guarantees:
 * - The executable path is never interpolated into a shell script body; the
 *   absolute-path form passes it as `$1` and shell-quotes it, defeating command
 *   injection via a hostile `executablePath`.
 * - A corrupt or non-object existing settings file is never overwritten.
 * - Config writes are atomic (temp + fsync + rename) with a `.bak` backup, and
 *   are rejected when the resolved path escapes the expected base directory
 *   (defends against symlinked `.claude`/`.codex` pointing elsewhere).
 */
export function installSessionStartHook(input: SetupInput): SetupResult {
  const deps = resolveDeps(input.deps);
  const targets = input.targets ?? [...SETUP_TARGETS];
  const binaryName = "playwright-cli-axi";
  const useName = resolvesToCurrent(binaryName, input.executablePath, deps.which, deps.realpath);
  const command = buildHookCommand(binaryName, input.executablePath, useName);
  const baseDir = input.scope === "project" ? input.cwd : input.home ?? "";

  const installed = targets.map((target) => {
    const settingsPath = settingsFilePath(target, input.scope, input.home, input.cwd);
    const outcome = mergeHookEntry(target, settingsPath, command, deps, baseDir);
    if (outcome.action !== "skipped" && target === "codex") {
      ensureCodexHooksFeature(settingsPath, input, deps);
    }
    return { target, path: settingsPath, action: outcome.action, error: outcome.error };
  });

  return { targets, installed, binary: useName ? "name" : "path" };
}

function resolveDeps(deps?: SetupDeps): Required<SetupDeps> {
  return {
    which: deps?.which ?? whichDefault,
    readFile: deps?.readFile ?? readFileDefault,
    writeFile: deps?.writeFile ?? writeFileDefault,
    exists: deps?.exists ?? existsDefault,
    realpath: deps?.realpath ?? realpathDefault,
  };
}

function whichDefault(name: string): string | undefined {
  const path = process.env.PATH ?? "";
  for (const dir of path.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not executable in this dir, keep searching
    }
  }
  return undefined;
}

function readFileDefault(path: string): string | undefined {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }
}

/**
 * Atomic write: write to a temp file, fsync, then rename over the target. When
 * the target already exists, back it up to `<path>.bak` first. This prevents
 * truncated/corrupt settings on crash or disk-full.
 */
function writeFileDefault(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    try {
      copyFileSync(path, `${path}.bak`);
    } catch {
      // best-effort backup; do not block the write
    }
  }
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content, "utf-8");
  try {
    const fd = openSync(tmp, "r");
    fsyncSync(fd);
    closeSync(fd);
  } catch {
    // fsync is best-effort on some platforms/filesystems
  }
  renameSync(tmp, path);
}

function existsDefault(path: string): boolean {
  return existsSync(path);
}

function realpathDefault(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Decide whether the bare binary name resolves to the SAME executable we are
 * running now. We compare realpaths so that a PATH-planted different binary is
 * never silently trusted over the current executable; when they differ we fall
 * back to the (shell-quoted) absolute path. If either path cannot be resolved,
 * we conservatively return false and use the absolute path.
 */
function resolvesToCurrent(
  binaryName: string,
  executablePath: string,
  which: (name: string) => string | undefined,
  realpath: (path: string) => string,
): boolean {
  const resolved = which(binaryName);
  if (!resolved) return false;
  try {
    return realpath(resolved) === realpath(executablePath);
  } catch {
    return false;
  }
}

/** POSIX single-quote: wrap in `'...'` and escape every embedded `'` as `'\''`. */
function shellQuote(value: string): string {
  const ESCAPED_QUOTE = "'\\''";
  return `'${value.split("'").join(ESCAPED_QUOTE)}'`;
}

function buildHookCommand(
  binaryName: string,
  executablePath: string,
  useName: boolean,
): string {
  if (useName) {
    // Both tokens are trusted constants (binaryName + CONTEXT_SUBCOMMAND).
    return `sh -c 'command -v ${binaryName} >/dev/null 2>&1 && exec ${binaryName} ${CONTEXT_SUBCOMMAND} || exit 0' ${HOOK_TAG}`;
  }
  // Absolute-path form: pass the path as $1 so it is NEVER interpolated into
  // the sh -c body, and shell-quote it at the command-string level so the host
  // shell passes it as a single argv token. This defeats command injection via a
  // hostile executablePath (e.g. one containing a single quote or backtick). We
  // do NOT use `exec`: a failed `exec` of a not-found command exits the shell
  // before `|| exit 0` runs, so running the binary as a child keeps the hook
  // non-fatal even if the installed path later breaks.
  const quotedPath = shellQuote(executablePath);
  return `sh -c '"$1" ${CONTEXT_SUBCOMMAND} || exit 0' playwright-cli-axi ${quotedPath} ${HOOK_TAG}`;
}

export function settingsFilePath(
  target: HookTarget,
  scope: HookScope,
  home: string | undefined,
  cwd: string,
): string {
  if (scope === "project") {
    if (target === "claude") return join(cwd, ".claude", "settings.json");
    return join(cwd, ".codex", "hooks.json");
  }
  if (target === "claude") return join(home ?? "", ".claude", "settings.json");
  return join(home ?? "", ".codex", "hooks.json");
}

/**
 * Stable tag embedded in every hook command so the installer can identify our
 * entry regardless of the executable path form (bare name or absolute path).
 */
const HOOK_TAG = "# playwright-cli-axi session-start";
/** Regex used to identify our hook entry among others (e.g. mainline's). */
const HOOK_MARKER_RE = /# playwright-cli-axi session-start/;

interface MergeOutcome {
  action: "installed" | "repaired" | "noop" | "skipped";
  error?: string;
}

function mergeHookEntry(
  target: HookTarget,
  settingsPath: string,
  command: string,
  deps: Required<SetupDeps>,
  baseDir: string,
): MergeOutcome {
  const raw = deps.readFile(settingsPath);
  const settings = parseSettings(raw);
  if (settings === null) {
    // Corrupt or non-object existing file: refuse to overwrite.
    return {
      action: "skipped",
      error: `${settingsPath} exists but is not a valid JSON object; refusing to overwrite it. Back up or remove it and re-run setup.`,
    };
  }

  const hooks = ensureHooksObject(settings);
  const sessionStart = ensureSessionStartArray(hooks);
  const index = findOurEntry(sessionStart, target);

  let action: "installed" | "repaired" | "noop";
  if (index !== -1) {
    const existing = extractCommand(sessionStart[index]!, target);
    if (existing === command) {
      action = "noop";
    } else {
      sessionStart[index] = buildEntry(command, target);
      action = "repaired";
    }
  } else {
    sessionStart.push(buildEntry(command, target));
    action = "installed";
  }

  if (action === "noop") return { action };

  try {
    assertWithinBase(dirname(settingsPath), baseDir, deps.realpath);
    deps.writeFile(settingsPath, serializeSettings(settings));
  } catch (err) {
    return {
      action: "skipped",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { action };
}

/**
 * Parse an existing settings file. Returns `null` when the file exists but is
 * corrupt (invalid JSON or a non-object top-level value) so the caller can
 * refuse to clobber it. Returns `{}` only when there is no file yet.
 */
function parseSettings(raw: string | undefined): Record<string, unknown> | null {
  if (raw === undefined) return {};
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function serializeSettings(settings: Record<string, unknown>): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

function ensureHooksObject(settings: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(settings.hooks)) settings.hooks = {};
  return settings.hooks as Record<string, unknown>;
}

function ensureSessionStartArray(hooks: Record<string, unknown>): unknown[] {
  if (!Array.isArray(hooks.SessionStart)) hooks.SessionStart = [];
  return hooks.SessionStart as unknown[];
}

function buildEntry(command: string, target: HookTarget): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    hooks: [{ type: "command", command }],
  };
  if (target === "codex") entry.matcher = "startup|resume";
  return entry;
}

function findOurEntry(sessionStart: unknown[], target: HookTarget): number {
  return sessionStart.findIndex((entry) => {
    if (!isPlainObject(entry)) return false;
    return HOOK_MARKER_RE.test(extractCommand(entry, target) ?? "");
  });
}

function extractCommand(entry: unknown, target: HookTarget): string | undefined {
  if (!isPlainObject(entry)) return undefined;
  const hooks = entry.hooks;
  if (!Array.isArray(hooks)) return undefined;
  for (const hook of hooks) {
    if (
      isPlainObject(hook) &&
      typeof hook.command === "string" &&
      HOOK_MARKER_RE.test(hook.command)
    )
      return hook.command;
  }
  return undefined;
}

/**
 * Reject config writes whose resolved location escapes the expected base
 * directory. This defends against symlinked `.claude`/`.codex` directories or
 * symlinked config files pointing at attacker-controlled locations.
 */
function assertWithinBase(
  targetPath: string,
  baseDir: string,
  realpath: (path: string) => string,
): void {
  if (!baseDir) return; // no base to check against (e.g. unknown HOME)
  const resolvedTarget = realpath(targetPath);
  const resolvedBase = realpath(baseDir);
  const baseWithSep = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(baseWithSep)) {
    throw new Error(
      `Refusing to write config outside ${baseDir}: ${targetPath} resolves to ${resolvedTarget}`,
    );
  }
}

/**
 * Ensure Codex config.toml has hooks enabled. The settings file is hooks.json;
 * Codex also requires `[features].hooks = true` in a sibling config.toml for the
 * hooks to fire. We do a conservative section-aware line patch (no TOML dep).
 */
function ensureCodexHooksFeature(
  hooksJsonPath: string,
  input: SetupInput,
  deps: Required<SetupDeps>,
): void {
  const configDir = dirname(hooksJsonPath);
  const configPath = join(configDir, "config.toml");
  let targetConfig = configPath;
  if (input.scope === "user") {
    const userConfig = join(input.home ?? "", ".codex", "config.toml");
    if (deps.exists(userConfig)) targetConfig = userConfig;
  }
  patchTomlFeature(targetConfig, dirname(targetConfig), deps);
}

/**
 * Section-aware TOML patcher: ensures exactly one `hooks = true` exists inside
 * the `[features]` table. Replaces `hooks = false` (or any non-true value),
 * preserves arrays/comments/CRLF, and never edits other tables.
 */
function patchTomlFeature(
  configPath: string,
  baseDir: string,
  deps: Required<SetupDeps>,
): void {
  const existing = deps.readFile(configPath) ?? "";
  const hadCrlf = existing.includes("\r\n");
  const lines = existing.split(/\r?\n/);

  let inFeatures = false;
  let featuresHeaderIdx = -1;
  let hooksLineIdx = -1;
  let hooksIsTrue = false;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]!.trim();
    if (/^\[.+\]$/.test(trimmed)) {
      inFeatures = /^\[features\]\s*$/i.test(trimmed);
      if (inFeatures && featuresHeaderIdx === -1) featuresHeaderIdx = i;
      continue;
    }
    if (inFeatures && /^hooks\s*=/.test(trimmed)) {
      hooksLineIdx = i;
      hooksIsTrue = /^hooks\s*=\s*true\s*$/i.test(trimmed);
    }
  }

  if (hooksIsTrue) return; // already enabled correctly inside [features]

  if (hooksLineIdx !== -1) {
    lines[hooksLineIdx] = "hooks = true"; // replace hooks = false / other
  } else if (featuresHeaderIdx !== -1) {
    lines.splice(featuresHeaderIdx + 1, 0, "hooks = true");
  } else {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push("[features]", "hooks = true");
  }

  const eol = hadCrlf ? "\r\n" : "\n";
  assertWithinBase(dirname(configPath), baseDir, deps.realpath);
  deps.writeFile(configPath, lines.join(eol));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
