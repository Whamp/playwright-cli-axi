export const VIDEO_COMMANDS = [
  'video-start',
  'video-stop',
  'video-chapter',
  'video-show-actions',
  'video-hide-actions'
] as const;

export type VideoCommandName = (typeof VIDEO_COMMANDS)[number];

const RAW_OUTPUT_COMMANDS = new Set(['install-browser']);
const GLOBAL_FLAGS_WITH_VALUE = new Set(['--session', '-s', '--fields']);
const GLOBAL_BOOLEAN_FLAGS = new Set(['--json', '--raw', '--version', '--full']);

export function commandName(argv: string[]): string | undefined {
  const index = commandIndex(argv);
  return index === -1 ? undefined : argv[index];
}

export function commandIndex(argv: string[]): number {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (isInlineSessionFlag(arg) || GLOBAL_BOOLEAN_FLAGS.has(arg)) continue;
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

/**
 * Remove wrapper-only flags before forwarding argv to upstream.
 *
 * `--json` is injected by the wrapper itself; `--full` and `--fields` are
 * presentation flags the wrapper consumes. Upstream's own flags (e.g. `--raw`,
 * or `--version` when a command resolves) are preserved as passthrough.
 */
export function stripWrapperFlags(argv: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--json' || arg === '--full') continue;
    if (arg === '--fields') {
      index += 1; // also drop the value token
      continue;
    }
    if (arg.startsWith('--fields=')) continue;
    result.push(arg);
  }
  return result;
}

/** Whether the caller asked for untruncated output (`--full`). */
export function hasFullFlag(argv: string[]): boolean {
  return argv.includes('--full');
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
 * when no command resolves, so that a command's own `-v` (e.g. `list -v`)
 * continues to pass through to upstream unchanged.
 */
export function hasVersionFlag(argv: string[]): boolean {
  const hasFlag = argv.includes('--version') || argv.includes('-v');
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
export const WRAPPER_COMMANDS = ['setup', 'context'] as const;

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
    if (isInlineSessionFlag(arg) || GLOBAL_BOOLEAN_FLAGS.has(arg)) continue;
    if (GLOBAL_FLAGS_WITH_VALUE.has(arg)) {
      index += 1;
      continue;
    }
    result.push(arg);
  }
  return result;
}

function isInlineSessionFlag(arg: string): boolean {
  return arg.startsWith('-s=') || arg.startsWith('--session=');
}
