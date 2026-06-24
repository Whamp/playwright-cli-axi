export const VIDEO_COMMANDS = [
  'video-start',
  'video-stop',
  'video-chapter',
  'video-chapters',
  'video-status',
  'video-show-actions',
  'video-hide-actions'
] as const;

export type VideoCommandName = (typeof VIDEO_COMMANDS)[number];

const RAW_OUTPUT_COMMANDS = new Set(['install-browser']);
const GLOBAL_FLAGS_WITH_VALUE = new Set(['--session', '-s', '--fields', '--wait']);
const GLOBAL_BOOLEAN_FLAGS = new Set(['--json', '--raw', '--version', '--full']);

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
    if (arg.startsWith('-')) continue;
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
    if (arg.startsWith('-s=')) return nonEmpty(arg.slice(3));
    if (arg.startsWith('--session=')) return nonEmpty(arg.slice('--session='.length));
    if (arg === '-s' || arg === '--session') return nonEmpty(argv[index + 1]);
  }
  return undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export function stripJsonFlags(argv: string[]): string[] {
  return argv.filter((arg) => arg !== '--json');
}

/** Value-bearing flags whose argument is a file path the agent names explicitly. */
const FILE_VALUE_FLAGS = new Set(['--filename', '--path']);

/**
 * F-3: resolve relative file paths against the agent's shell cwd so named
 * screenshots/pdfs/videos land where the agent expects even though upstream
 * runs with a different (artifact-dir) cwd. Absolute paths and non-file args
 * are passed through untouched. Inline `flag=value` forms are handled too.
 */
export function resolveRelativeFilePaths(argv: string[], shellCwd: string): string[] {
  const isAbsolute = (p: string) =>
    p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
  const absolutize = (p: string) => (isAbsolute(p) || p === '' ? p : `${shellCwd}/${p}`);
  const result: string[] = [];
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
    if (!matched) result.push(arg);
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
    if (arg === '--json' || arg === '--full') continue;
    if (arg === '--fields' || arg === '--wait') {
      index += 1; // also drop the value token
      continue;
    }
    if (arg.startsWith('--fields=')) continue;
    if (arg.startsWith('--wait=')) continue;
    result.push(arg);
  }
  return result;
}

/** Whether the caller asked for untruncated output (`--full`). */
export function hasFullFlag(argv: string[]): boolean {
  return argv.includes('--full');
}

/**
 * Read a `--wait <state>` request (P-5). Returns undefined when absent.
 * Valid states: load, domcontentloaded, networkidle.
 */
export function parseWaitFlag(argv: string[]): string | undefined {
  let raw: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg.startsWith('--wait=')) raw = arg.slice('--wait='.length);
    else if (arg === '--wait') raw = argv[index + 1];
    if (raw !== undefined) break;
  }
  if (raw === undefined) return undefined;
  const state = raw.trim();
  if (['load', 'domcontentloaded', 'networkidle'].includes(state)) return state;
  return undefined;
}

export function isValidWaitState(state: string): boolean {
  return ['load', 'domcontentloaded', 'networkidle'].includes(state);
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
    if (arg.startsWith('--fields=')) raw = arg.slice('--fields='.length);
    else if (arg === '--fields') raw = argv[index + 1];
    if (raw === undefined) continue;
    return raw
      .split(',')
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
  const dashDash = argv.indexOf('--');
  const scope = dashDash === -1 ? argv : argv.slice(0, dashDash);
  const hasFlag = scope.includes('--version') || scope.includes('-v');
  return hasFlag && commandName(argv) === undefined;
}

export function shouldInjectJson(argv: string[]): boolean {
  const command = commandName(argv);
  if (!command) return false;
  if (RAW_OUTPUT_COMMANDS.has(command)) return false;
  if (argv.includes('--help') || argv.includes('-h')) return false;
  return true;
}

export function isVideoCommand(command: string | undefined): command is VideoCommandName {
  return VIDEO_COMMANDS.includes(command as VideoCommandName);
}

/** Wrapper-only commands that never forward to upstream. */
export const WRAPPER_COMMANDS = ['setup', 'context', 'scroll', 'wait'] as const;

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
    arg.startsWith('-s=') ||
    arg.startsWith('--session=') ||
    arg.startsWith('--fields=') ||
    arg.startsWith('--wait=')
  );
}
