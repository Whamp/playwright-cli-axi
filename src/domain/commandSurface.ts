import {
  isCloseLikeCommand,
  isKnownUpstreamCommand,
} from "./upstreamCommands.js";

export const VIDEO_COMMANDS = [
  "video-start",
  "video-stop",
  "video-chapter",
  "video-chapters",
  "video-status",
  "video-show-actions",
  "video-hide-actions",
] as const;

export type VideoCommandName = (typeof VIDEO_COMMANDS)[number];

const RAW_OUTPUT_COMMANDS = new Set(["install-browser"]);
const GLOBAL_FLAGS_WITH_VALUE = new Set([
  "--session",
  "-s",
  "--fields",
  "--wait",
  "--settle",
  "--dialog",
]);
const GLOBAL_BOOLEAN_FLAGS = new Set([
  "--json",
  "--raw",
  "--version",
  "--full",
]);

export function commandName(argv: string[]): string | undefined {
  const index = commandIndex(argv);
  return index === -1 ? undefined : argv[index];
}

export function commandIndex(argv: string[]): number {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (isInlineValueFlag(arg) || GLOBAL_BOOLEAN_FLAGS.has(arg)) continue;
    if (GLOBAL_FLAGS_WITH_VALUE.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return index;
  }
  return -1;
}

export function argsAfterCommand(argv: string[]): string[] {
  const index = commandIndex(argv);
  return index === -1 ? [] : stripGlobalFlags(argv.slice(index + 1));
}

export function sessionFromArgv(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg.startsWith("-s=")) return nonEmpty(arg.slice(3));
    if (arg.startsWith("--session="))
      return nonEmpty(arg.slice("--session=".length));
    if (arg === "-s" || arg === "--session") return nonEmpty(argv[index + 1]);
  }
  return undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export function stripJsonFlags(argv: string[]): string[] {
  return argv.filter((arg) => arg !== "--json");
}

/** Value-bearing flags whose argument is a file path the agent names explicitly. */
const FILE_VALUE_FLAGS = new Set(["--filename", "--path"]);

/**
 * Commands whose first positional argument is a file path the agent names
 * explicitly (e.g. `video-start ./out.webm`). Like `--filename`, these must be
 * resolved against the shell cwd so the file lands where the agent expects
 * regardless of the daemon's spawn cwd (N-9: otherwise a relative positional is
 * resolved daemon-side and orphaned in the artifact cache dir).
 */
const COMMAND_FILE_POSITIONALS = new Set([
  "video-start",
  "state-save",
  "state-load",
]);

/**
 * F-3 / N-9: resolve relative file paths against the agent's shell cwd so named
 * screenshots/pdfs/videos land where the agent expects even though upstream
 * runs with a different (artifact-dir) cwd. Absolute paths and non-file args
 * are passed through untouched. Inline `flag=value` forms are handled too, as is
 * the `video-start` positional filename.
 */

/** H3-1/H3-3: lexical path canonicalization — collapse `.` and `..` segments so
 * joined paths are clean and absolute (e.g. `/cwd/./x` → `/cwd/x`,
 * `/a/b/../../c` → `/c`). Pure string operation; does not touch the filesystem
 * so it is safe for display/input normalization. Preserves a leading root and
 * Windows drive/UNC prefixes. */
export function canonicalizePath(p: string): string {
  if (p === "") return p;
  const isWindowsDrive = /^[A-Za-z]:[\\/]/.test(p);
  const prefix = isWindowsDrive
    ? ""
    : p.startsWith("//")
      ? "//"
      : p.startsWith("/")
        ? "/"
        : "";
  const drive = isWindowsDrive ? `${p.slice(0, 2)}/` : "";
  const body = isWindowsDrive ? p.slice(2) : p.slice(prefix.length);
  const out: string[] = [];
  for (const seg of body.split(/[\\/]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length) out.pop();
      continue;
    }
    out.push(seg);
  }
  return `${drive || prefix}${out.join("/")}`;
}
export function resolveRelativeFilePaths(
  argv: string[],
  shellCwd: string,
): string[] {
  const isAbsolute = (p: string) =>
    p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");
  // H3-1: join against the shell cwd then canonicalize so `./state.json` and
  // `../x` produce clean absolute paths (`/cwd/state.json`, not `/cwd/./…`).
  const absolutize = (p: string) =>
    isAbsolute(p) || p === "" ? p : canonicalizePath(`${shellCwd}/${p}`);
  const result: string[] = [];
  const cmdIdx = commandIndex(argv);
  const cmdName = cmdIdx === -1 ? undefined : argv[cmdIdx];
  const resolveFilePositional =
    cmdName !== undefined && COMMAND_FILE_POSITIONALS.has(cmdName);
  let positionalSeenAfterCommand = 0;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    let matched = false;
    for (const flag of FILE_VALUE_FLAGS) {
      if (arg === flag) {
        result.push(flag);
        const value = argv[index + 1];
        result.push(value === undefined ? value : absolutize(value));
        index += 1;
        matched = true;
        break;
      }
      const prefix = `${flag}=`;
      if (arg.startsWith(prefix)) {
        result.push(`${prefix}${absolutize(arg.slice(prefix.length))}`);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // N-9: the video-start positional filename is a named output file.
      if (
        resolveFilePositional &&
        index > cmdIdx &&
        !arg.startsWith("-") &&
        positionalSeenAfterCommand === 0
      ) {
        result.push(absolutize(arg));
        positionalSeenAfterCommand += 1;
        continue;
      }
      result.push(arg);
      if (resolveFilePositional && index > cmdIdx && !arg.startsWith("-")) {
        positionalSeenAfterCommand += 1;
      }
    }
  }
  return result;
}

/**
 * Remove wrapper-only flags before forwarding argv to upstream.
 *
 * `--json` is injected by the wrapper itself; `--full`, `--fields`, and
 * `--wait` are wrapper-consumed flags. Upstream's own flags (e.g. `--raw`,
 * or `--version` when a command resolves) are preserved as passthrough.
 */
export function stripWrapperFlags(argv: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--json" || arg === "--full") continue;
    if (arg === "--fields" || arg === "--wait" || arg === "--dialog") {
      index += 1; // also drop the value token
      continue;
    }
    if (arg === "--settle") {
      // --settle takes an OPTIONAL value: drop a following recognized state, but
      // leave the next token if it is the command's own positional/flag.
      const next = argv[index + 1];
      if (next !== undefined && isValidWaitState(next)) index += 1;
      continue;
    }
    if (
      arg.startsWith("--fields=") ||
      arg.startsWith("--wait=") ||
      arg.startsWith("--dialog=")
    )
      continue;
    if (arg.startsWith("--settle=")) continue;
    result.push(arg);
  }
  return result;
}

/** Whether the caller asked for untruncated output (`--full`). */
export function hasFullFlag(argv: string[]): boolean {
  return argv.includes("--full");
}

/**
 * Read a `--wait <state>` request (P-5). Returns undefined when absent.
 * Valid states: load, domcontentloaded, networkidle.
 */
export function parseWaitFlag(argv: string[]): string | undefined {
  let raw: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg.startsWith("--wait=")) raw = arg.slice("--wait=".length);
    else if (arg === "--wait") raw = argv[index + 1];
    if (raw !== undefined) break;
  }
  if (raw === undefined) return undefined;
  const state = raw.trim();
  if (["load", "domcontentloaded", "networkidle"].includes(state)) return state;
  return undefined;
}

export function isValidWaitState(state: string): boolean {
  return ["load", "domcontentloaded", "networkidle"].includes(state);
}

/**
 * D-1: parse a `--dialog accept:<text>|dismiss` request on click/dblclick so a
 * JS alert/confirm/prompt is handled atomically in the same call that opens it
 * (upstream leaves the modal pending after the click, wedging every later
 * command). Returns undefined when absent or malformed.
 */
export function parseDialogFlag(
  argv: string[],
): { action: "accept" | "dismiss"; text?: string } | undefined {
  let raw: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg.startsWith("--dialog=")) raw = arg.slice("--dialog=".length);
    else if (arg === "--dialog") raw = argv[index + 1];
    if (raw !== undefined) break;
  }
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (value === "dismiss") return { action: "dismiss" };
  if (value === "accept") return { action: "accept" };
  const acceptMatch = value.match(/^accept:(.*)$/);
  if (acceptMatch) return { action: "accept", text: acceptMatch[1] };
  // ponytail: a bare value is treated as accept-with-text for prompts, the
  // common case; explicit `dismiss` is required to cancel.
  if (value.length > 0) return { action: "accept", text: value };
  return undefined;
}

/** Read a `--settle [state]` request (C-4). Returns the load state to settle on
 * (default `networkidle`) when present, else undefined. */
export function parseSettleFlag(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    let raw: string | undefined;
    if (arg.startsWith("--settle=")) raw = arg.slice("--settle=".length);
    else if (arg === "--settle") {
      const next = argv[index + 1];
      // `--settle` takes an optional value; only consume the next token when it
      // is a recognized load state (so `click e5 --settle` works stateless).
      if (next !== undefined && isValidWaitState(next)) raw = next;
      else raw = "networkidle";
    }
    if (raw !== undefined) {
      const state = raw.trim();
      return isValidWaitState(state) ? state : "networkidle";
    }
  }
  return undefined;
}

/**
 * N-1: build the Playwright `run-code` snippet that waits for a load state.
 *
 * Upstream `run-code` wraps the snippet in a NON-async function body and invokes
 * it with a single `page` argument, so a bare `await ...` is a SyntaxError
 * (`Unexpected identifier 'page'`). The snippet MUST be an async arrow function
 * expression that receives `page`. Exported so a contract test can pin the
 * emitted shape (the gap that let the broken bare-`await` form ship).
 */
export function waitForLoadStateCode(state: string, timeoutMs: number): string {
  return `async (page) => { await page.waitForLoadState('${state}', { timeout: ${timeoutMs} }).catch(() => {}); }`;
}

/**
 * C-4: build the `run-code` snippet for a deterministic SPA settle. `--wait
 * networkidle` settles the network layer only; client-side route mounting can
 * lag, so a follow-up read can race the transition and come back empty. `--settle`
 * waits for the load state AND then polls `page.url()` until it stops changing
 * (SPA route quiesced), so the next read sees settled state. Uses
 * `page.waitForTimeout` because upstream's run-code sandbox does not expose the
 * node `setTimeout` global.
 *
 * Like `waitForLoadStateCode`, this is an async arrow expression receiving
 * `page` (upstream wraps it in a non-async body). Exported for a contract test.
 */
export function settleLoadStateCode(state: string, timeoutMs: number): string {
  return `async (page) => { await page.waitForLoadState('${state}', { timeout: ${timeoutMs} }).catch(() => {}); let prev = page.url(); for (let i = 0; i < 12; i += 1) { await page.waitForTimeout(100); const cur = page.url(); if (cur === prev) { break; } prev = cur; } }`;
}

/** Commands that trigger a form submit, after which the wrapper probes HTML5
 * constraint validation so a blocked submit is not silently reported as ok. */
export const VALIDATION_PROBE_COMMANDS = new Set(["click", "dblclick"]);

/**
 * C-1: build the `run-code` snippet that probes HTML5 form constraint validation.
 *
 * HTML5 validation bubbles are not in the accessibility tree, so a submit
 * blocked by an invalid field looks identical to a successful submit in the
 * snapshot (and the click returns `ok`). After a submit-triggering click, the
 * browser focuses the first invalid field, so `activeIsInvalid` reliably
 * distinguishes a blocked submit from a navigating/non-submit click. The probe
 * returns the offending fields with identifying metadata so the wrapper can
 * surface `validation: { ok: false, invalid_fields: [...] }`.
 *
 * D-8: the same probe also reports the open pages in the context. When a click
 * spawns a popup (`window.open` / `target=_blank`), the page count grows, so the
 * wrapper surfaces `new_tabs` without a second round-trip — every upstream call
 * is ~1-2s, so piggy-backing keeps the common (no-popup) click fast.
 *
 * The `pca-validation-probe` comment marker inside the emitted snippet lets tests
 * identify this internal call without consuming the command-under-test response
 * queue. Like the other run-code snippets, this is an async arrow expression
 * receiving `page`.
 */
export function validationProbeCode(): string {
  return `async (page) => { /* pca-validation-probe */ const info = await page.evaluate(() => { const sel = "input:invalid, select:invalid, textarea:invalid"; const invalid = Array.from(document.querySelectorAll(sel)); const active = document.activeElement; return { activeIsInvalid: !!(active && typeof active.matches === "function" && active.matches(":invalid")), fields: invalid.map((el) => ({ tag: el.tagName.toLowerCase(), type: el.getAttribute("type") || null, name: el.getAttribute("name") || null, id: el.id || null, placeholder: el.getAttribute("placeholder") || null, label: el.labels && el.labels[0] ? el.labels[0].innerText.trim() : null, message: el.validationMessage || null })) }; }); const ctx = page.context(); const pages = await Promise.all(ctx.pages().map(async (p, i) => ({ index: i, current: p === page, url: p.url(), title: await p.title().catch(() => "") }))); return { ...info, pageCount: pages.length, currentUrl: page.url(), pages }; }`;
}

/**
 * Parse a `--fields a,b,c` request into a trimmed list of column names.
 * Returns undefined when the flag is absent (so callers keep their default
 * schema).
 */
export function parseFieldsFlag(argv: string[]): string[] | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    let raw: string | undefined;
    if (arg.startsWith("--fields=")) raw = arg.slice("--fields=".length);
    else if (arg === "--fields") raw = argv[index + 1];
    if (raw === undefined) continue;
    return raw
      .split(",")
      .map((field) => field.trim())
      .filter((field) => field.length > 0);
  }
  return undefined;
}

/**
 * Whether the caller asked for the wrapper version.
 *
 * `--version` is the canonical global flag. `-v` is also honoured, but ONLY
 * when no command resolves AND the flag appears before any `--` separator, so
 * that `-- --version` forwards to upstream and a command's own `-v` (e.g.
 * `list -v`) continues to pass through to upstream unchanged.
 */
export function hasVersionFlag(argv: string[]): boolean {
  const dashDash = argv.indexOf("--");
  const scope = dashDash === -1 ? argv : argv.slice(0, dashDash);
  const hasFlag = scope.includes("--version") || scope.includes("-v");
  return hasFlag && commandName(argv) === undefined;
}

export function shouldInjectJson(argv: string[]): boolean {
  const command = commandName(argv);
  if (!command) return false;
  if (RAW_OUTPUT_COMMANDS.has(command)) return false;
  if (argv.includes("--help") || argv.includes("-h")) return false;
  return true;
}

export function isVideoCommand(
  command: string | undefined,
): command is VideoCommandName {
  return VIDEO_COMMANDS.includes(command as VideoCommandName);
}

/** Whether a command name is any command the wrapper recognizes: a wrapper
 * command (setup/context/scroll/wait), a video command, a close-like command,
 * or a known upstream command. Used by the help router so `help <x>` and the
 * run router agree on whether `x` exists (C-5). */
export function isKnownCommand(command: string | undefined): boolean {
  if (!command) return false;
  return (
    isWrapperCommand(command) ||
    isVideoCommand(command) ||
    isCloseLikeCommand(command) ||
    isKnownUpstreamCommand(command)
  );
}

/** Wrapper-only commands that never forward to upstream. */
export const WRAPPER_COMMANDS = [
  "setup",
  "context",
  "scroll",
  "wait",
  "find",
] as const;

export type WrapperCommandName = (typeof WRAPPER_COMMANDS)[number];

export function isWrapperCommand(
  command: string | undefined,
): command is WrapperCommandName {
  return WRAPPER_COMMANDS.includes(command as WrapperCommandName);
}

function stripGlobalFlags(args: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (isInlineValueFlag(arg) || GLOBAL_BOOLEAN_FLAGS.has(arg)) continue;
    if (GLOBAL_FLAGS_WITH_VALUE.has(arg)) {
      index += 1;
      continue;
    }
    result.push(arg);
  }
  return result;
}

/** Inline `name=value` forms for value-bearing global flags (space and equals). */
function isInlineValueFlag(arg: string): boolean {
  return (
    arg.startsWith("-s=") ||
    arg.startsWith("--session=") ||
    arg.startsWith("--fields=") ||
    arg.startsWith("--wait=") ||
    arg.startsWith("--settle=") ||
    arg.startsWith("--dialog=")
  );
}
