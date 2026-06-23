import { cwd as processCwd } from 'node:process';

import { commandName, isVideoCommand, sessionFromArgv, stripJsonFlags } from '../domain/commandSurface.js';
import { normalizeClosed, normalizeSessions } from '../domain/sessions.js';
import { handleVideoCommand } from '../domain/videoCommands.js';
import { createVideoStore, reconcileVideoState, type VideoSidecarState } from '../domain/videoState.js';
import { errorToStdout } from '../presenter/errors.js';
import { helpToStdout } from '../presenter/help.js';
import { homeModel } from '../presenter/home.js';
import { table, toToon, type ToonValue } from '../presenter/toon.js';
import { normalizeUpstreamError } from '../upstream/errors.js';
import { isObject, parseUpstreamOutput } from '../upstream/parse.js';
import { createUpstreamRunner, resolveUpstreamVersion, type UpstreamRunner } from '../upstream/runner.js';

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr?: string;
}

export interface CliDependencies {
  cwd?: string;
  executablePath?: string;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  upstreamVersion?: string;
  upstream?: UpstreamRunner;
}

export async function runCli(rawArgv: string[], dependencies: CliDependencies = {}): Promise<CliResult> {
  const deps = resolveDependencies(dependencies);
  const argv = stripJsonFlags(rawArgv);
  const command = commandName(argv);

  if (argv.length === 0) return await renderHome(deps);
  if (argv.includes('--help') || argv.includes('-h')) {
    if (!command || isVideoCommand(command)) return { exitCode: 0, stdout: helpToStdout(command) };
    return await runHelpCommand(argv, deps);
  }
  if (isVideoCommand(command)) {
    return await handleVideoCommand({ argv, upstream: deps.upstream, store: createVideoStore({ ...deps, session: sessionFromArgv(argv) }), now: deps.now });
  }
  if (command === 'close' || command === 'close-all' || command === 'kill' || command === 'kill-all' || command === 'delete-data') {
    return await runCloseLikeCommand(argv, deps);
  }
  return await runGenericCommand(argv, deps);
}

function resolveDependencies(dependencies: CliDependencies): Required<CliDependencies> {
  const cwd = dependencies.cwd ?? processCwd();
  const env = dependencies.env ?? process.env;
  return {
    cwd,
    executablePath: dependencies.executablePath ?? process.argv[1] ?? 'playwright-cli-axi',
    env,
    now: dependencies.now ?? (() => new Date()),
    upstreamVersion: dependencies.upstreamVersion ?? resolveUpstreamVersion(),
    upstream: dependencies.upstream ?? createUpstreamRunner({ cwd, env: env as NodeJS.ProcessEnv })
  };
}

async function renderHome(deps: Required<CliDependencies>): Promise<CliResult> {
  const store = createVideoStore(deps);
  const [listRun, video] = await Promise.all([deps.upstream(['list', '--all']), store.load()]);
  const parsed = parseUpstreamOutput(listRun.stdout, listRun.stderr, listRun.exitCode);
  const sessions = parsed.kind === 'json' && !parsed.isError ? normalizeSessions(parsed.value) : normalizeSessions(undefined);
  const reconciledVideo = reconcileVideoState(video, { browserCount: sessions.browsers.count });
  if (JSON.stringify(reconciledVideo) !== JSON.stringify(video)) await store.save(reconciledVideo);
  const model = homeModel({
    executablePath: deps.executablePath,
    cwd: deps.cwd,
    upstreamVersion: deps.upstreamVersion,
    sessions,
    video: reconciledVideo
  });
  return { exitCode: 0, stdout: toToon(model) };
}

async function runGenericCommand(argv: string[], deps: Required<CliDependencies>): Promise<CliResult> {
  const run = await deps.upstream(argv);
  const parsed = parseUpstreamOutput(run.stdout, run.stderr, run.exitCode);
  if (parsed.isError || run.exitCode !== 0) return normalizeUpstreamError(argv, run, parsed);
  return { exitCode: 0, stdout: toToon(successModel(argv, parsed)) };
}

async function runHelpCommand(argv: string[], deps: Required<CliDependencies>): Promise<CliResult> {
  const run = await deps.upstream(argv);
  const parsed = parseUpstreamOutput(run.stdout, run.stderr, run.exitCode);
  if (parsed.isError || run.exitCode !== 0) return normalizeUpstreamError(argv, run, parsed);
  const text = parsed.kind === 'text' ? parsed.text : JSON.stringify(parsed.value);
  const lines = text.split('\n').map((line) => line.trimEnd()).filter((line) => line.length > 0);
  const preview = lines.slice(0, 40);
  return {
    exitCode: 0,
    stdout: toToon({
      command: commandName(argv) ?? 'help',
      help: {
        source: '@playwright/cli',
        bytes: text.length,
        lines: preview.length,
        truncated: lines.length > preview.length
      },
      lines: preview
    })
  };
}

async function runCloseLikeCommand(argv: string[], deps: Required<CliDependencies>): Promise<CliResult> {
  const store = createVideoStore({ ...deps, session: sessionFromArgv(argv) });
  const command = commandName(argv) ?? argv[0];
  const priorStates = command === 'close-all' || command === 'kill-all' ? await store.loadAllForCwd() : [{ path: store.path, state: await store.load() }];
  const run = await deps.upstream(argv);
  const parsed = parseUpstreamOutput(run.stdout, run.stderr, run.exitCode);
  if (parsed.isError || run.exitCode !== 0) return normalizeUpstreamError(argv, run, parsed);

  const warnings: string[] = [];
  for (const record of priorStates) {
    if (record.state.recording.status !== 'active') continue;
    const sessionLabel = record.state.scope.session === 'default' ? '' : ` for session ${record.state.scope.session}`;
    const warning = `Recording was active${sessionLabel} before ${command}; video may be lost because video-stop was not run`;
    warnings.push(warning);
    const abandoned: VideoSidecarState = structuredClone(record.state);
    abandoned.recording = { ...abandoned.recording, status: 'abandoned', stoppedAt: deps.now().toISOString() };
    abandoned.lastError = warning;
    abandoned.warnings = abandoned.warnings.includes(warning) ? abandoned.warnings : [...abandoned.warnings, warning];
    await store.save(abandoned);
  }

  return { exitCode: 0, stdout: toToon({ ...successModel(argv, parsed), ...(warnings.length > 0 ? { warnings } : {}) }) };
}

function successModel(argv: string[], parsed: ReturnType<typeof parseUpstreamOutput>): ToonValue {
  const command = commandName(argv) ?? argv[0] ?? 'command';
  if (parsed.kind === 'json') {
    if (command === 'list') {
      const sessions = normalizeSessions(parsed.value);
      return {
        command,
        status: 'ok',
        browsers: {
          count: sessions.browsers.count,
          ...(sessions.browsers.empty ? { empty: sessions.browsers.empty } : {})
        },
        ...(sessions.browsers.rows.length > 0 ? { browser_rows: table(['id', 'name', 'status'], sessions.browsers.rows) } : {})
      };
    }
    if (command === 'close-all' || command === 'close') {
      const closed = normalizeClosed(parsed.value);
      return {
        command,
        status: 'ok',
        closed: {
          count: closed.count,
          ...(closed.empty ? { empty: closed.empty } : {})
        },
        ...(closed.rows.length > 0 ? { closed_rows: table(['id', 'status'], closed.rows) } : {})
      };
    }
    if (isObject(parsed.value)) return { command, status: 'ok', result: pruneJson(parsed.value) };
    return { command, status: 'ok', result: String(parsed.value) };
  }
  return {
    command,
    status: 'ok',
    output: parsed.text.length > 1200 ? `${parsed.text.slice(0, 1200)}… (${parsed.text.length} chars total)` : parsed.text
  };
}

function pruneJson(value: Record<string, unknown>): ToonValue {
  const output: Record<string, ToonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'isError') continue;
    if (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean' || child === null) output[key] = child;
    else if (Array.isArray(child)) output[key] = child.map((entry) => simpleValue(entry));
    else if (isObject(child)) output[key] = pruneJson(child);
    else output[key] = String(child);
  }
  return output;
}

function simpleValue(value: unknown): ToonValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.map((entry) => simpleValue(entry));
  if (isObject(value)) return pruneJson(value);
  return String(value);
}
