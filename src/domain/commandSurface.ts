export const VIDEO_COMMANDS = [
  'video-start',
  'video-stop',
  'video-chapter',
  'video-show-actions',
  'video-hide-actions'
] as const;

export type VideoCommandName = (typeof VIDEO_COMMANDS)[number];

const RAW_OUTPUT_COMMANDS = new Set(['install-browser']);
const GLOBAL_FLAGS_WITH_VALUE = new Set(['--session', '-s']);
const GLOBAL_BOOLEAN_FLAGS = new Set(['--json', '--raw', '--version']);

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
