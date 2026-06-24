import { readFileSync, writeFileSync, existsSync, mkdirSync, accessSync, constants } from "node:fs";
import { dirname, join } from "node:path";

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
  /** Write text to a file, creating parent directories. */
  writeFile?: (path: string, content: string) => void;
  /** Whether a file exists (used for Codex config.toml checks). */
  exists?: (path: string) => boolean;
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
  installed: { target: HookTarget; path: string; action: "installed" | "repaired" | "noop" }[];
  binary: "path" | "name";
}

/**
 * Install/repair the SessionStart hook for the requested targets.
 *
 * The hook command mirrors the mainline hook shape (sh -c with
 * `command -v … && exec … || exit 0`) so it composes with existing mainline
 * hooks. It is idempotent: an existing entry with the same command is a silent
 * no-op, and an entry with a stale path is repaired in place.
 */
export function installSessionStartHook(input: SetupInput): SetupResult {
  const deps = resolveDeps(input.deps);
  const targets = input.targets ?? [...SETUP_TARGETS];
  const binaryName = "playwright-cli-axi";
  const useName = resolvesToCurrent(binaryName, input.executablePath, deps.which);
  const command = buildHookCommand(binaryName, input.executablePath, useName);

  const installed = targets.map((target) => {
    const settingsPath = settingsFilePath(target, input.scope, input.home, input.cwd);
    const action = mergeHookEntry(target, settingsPath, command, deps);
    if (target === "codex") ensureCodexHooksFeature(settingsPath, input, deps);
    return { target, path: settingsPath, action };
  });

  return { targets, installed, binary: useName ? "name" : "path" };
}

function resolveDeps(deps?: SetupDeps): Required<SetupDeps> {
  return {
    which: deps?.which ?? whichDefault,
    readFile: deps?.readFile ?? readFileDefault,
    writeFile: deps?.writeFile ?? writeFileDefault,
    exists: deps?.exists ?? existsDefault,
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

function writeFileDefault(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function existsDefault(path: string): boolean {
  return existsSync(path);
}

function resolvesToCurrent(
  binaryName: string,
  executablePath: string,
  which: (name: string) => string | undefined,
): boolean {
  const resolved = which(binaryName);
  if (!resolved) return false;
  // If `command -v` found our binary name, it is on PATH and invocable by name.
  // We don't require the resolved path to exactly equal executablePath, because
  // npm installs a symlink whose realpath differs from the dev source path; the
  // name resolves to a runnable entry either way.
  return true;
}

function buildHookCommand(
  binaryName: string,
  executablePath: string,
  useName: boolean,
): string {
  const sub = useName
    ? `${binaryName} ${CONTEXT_SUBCOMMAND}`
    : `${executablePath} ${CONTEXT_SUBCOMMAND}`;
  if (useName) {
    return `sh -c 'command -v ${binaryName} >/dev/null 2>&1 && exec ${sub} || exit 0' ${HOOK_TAG}`;
  }
  return `sh -c 'exec ${sub} || exit 0' ${HOOK_TAG}`;
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

type MergeAction = "installed" | "repaired" | "noop";

function mergeHookEntry(
  target: HookTarget,
  settingsPath: string,
  command: string,
  deps: Required<SetupDeps>,
): MergeAction {
  const raw = deps.readFile(settingsPath);
  const settings = parseSettings(raw);
  const hooks = ensureHooksObject(settings);
  const sessionStart = ensureSessionStartArray(hooks);
  const index = findOurEntry(sessionStart, target);

  if (index !== -1) {
    const existing = extractCommand(sessionStart[index]!, target);
    if (existing === command) return "noop";
    sessionStart[index] = buildEntry(command, target);
  } else {
    sessionStart.push(buildEntry(command, target));
  }

  deps.writeFile(settingsPath, serializeSettings(settings));
  return index !== -1 ? "repaired" : "installed";
}

function parseSettings(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
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
 * Ensure Codex config.toml has hooks enabled. The settings file is hooks.json;
 * Codex also requires `[features].hooks = true` in a sibling config.toml for the
 * hooks to fire. We do a conservative line-based patch (no TOML dependency).
 */
function ensureCodexHooksFeature(
  hooksJsonPath: string,
  input: SetupInput,
  deps: Required<SetupDeps>,
): void {
  const configDir = dirname(hooksJsonPath);
  const configPath = join(configDir, "config.toml");
  if (input.scope === "user") {
    const root = input.home ?? "";
    const userConfig = join(root, ".codex", "config.toml");
    if (deps.exists(userConfig)) {
      patchTomlFeature(userConfig, deps);
      return;
    }
  }
  patchTomlFeature(configPath, deps);
}

function patchTomlFeature(configPath: string, deps: Required<SetupDeps>): void {
  const existing = deps.readFile(configPath) ?? "";
  if (/^hooks\s*=\s*true/m.test(existing)) return; // already enabled
  let updated: string;
  if (/\[features\]/i.test(existing)) {
    // Append hooks = true under the existing [features] table.
    updated = existing.replace(
      /(\[features\][^\[]*)/i,
      (match) => {
        if (/^hooks\s*=/m.test(match)) return match;
        return `${match.trimEnd()}\nhooks = true\n`;
      },
    );
  } else {
    updated = `${existing.trimEnd()}\n\n[features]\nhooks = true\n`;
  }
  deps.writeFile(configPath, updated);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
