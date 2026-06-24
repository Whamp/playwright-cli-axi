import { cwd as processCwd } from "node:process";

import {
  commandName,
  hasVersionFlag,
  hasFullFlag,
  isVideoCommand,
  isWrapperCommand,
  parseFieldsFlag,
  sessionFromArgv,
  stripJsonFlags,
  stripWrapperFlags,
} from "../domain/commandSurface.js";
import { normalizeSessions } from "../domain/sessions.js";
import {
  closeScopeFor,
  isCloseLikeCommand,
} from "../domain/upstreamCommands.js";
import {
  installSessionStartHook,
  type HookScope,
  type SetupDeps,
} from "../domain/hookSetup.js";
import { handleVideoCommand } from "../domain/videoCommands.js";
import {
  createVideoStore,
  reconcileVideoState,
  type VideoSidecarState,
} from "../domain/videoState.js";
import {
  helpToStdout,
  upstreamHelpPreviewToStdout,
} from "../presenter/help.js";
import { homeModel } from "../presenter/home.js";
import { contextModel } from "../presenter/context.js";
import { commandSuccessModel } from "../presenter/success.js";
import { toToon, type ToonValue } from "../presenter/toon.js";
import { versionModel } from "../presenter/version.js";
import { normalizeUpstreamError } from "../upstream/errors.js";
import { parseUpstreamOutput } from "../upstream/parse.js";
import {
  createUpstreamRunner,
  resolveUpstreamVersion,
  resolveWrapperVersion,
  type UpstreamRunner,
} from "../upstream/runner.js";

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
  wrapperVersion?: string;
  upstream?: UpstreamRunner;
  setupDeps?: SetupDeps;
}

export async function runCli(
  rawArgv: string[],
  dependencies: CliDependencies = {},
): Promise<CliResult> {
  const deps = resolveDependencies(dependencies);
  const argv = stripJsonFlags(rawArgv);
  const command = commandName(argv);

  if (argv.length === 0) return await renderHome(deps);
  if (hasVersionFlag(argv)) return renderVersion(deps);
  if (argv.includes("--help") || argv.includes("-h")) {
    if (!command || isVideoCommand(command) || isWrapperCommand(command))
      return { exitCode: 0, stdout: helpToStdout(command) };
    return await runHelpCommand(argv, deps);
  }
  if (command === "setup") return runSetup(argv, deps);
  if (command === "context") return await runContext(deps);
  if (isVideoCommand(command)) {
    return await handleVideoCommand({
      argv,
      upstream: deps.upstream,
      store: createVideoStore({ ...deps, session: sessionFromArgv(argv) }),
      now: deps.now,
    });
  }
  if (isCloseLikeCommand(command)) return await runCloseLikeCommand(argv, deps);
  return await runGenericCommand(argv, deps);
}

function resolveDependencies(
  dependencies: CliDependencies,
): Required<CliDependencies> {
  const cwd = dependencies.cwd ?? processCwd();
  const env = dependencies.env ?? process.env;
  return {
    cwd,
    executablePath:
      dependencies.executablePath ?? process.argv[1] ?? "playwright-cli-axi",
    env,
    now: dependencies.now ?? (() => new Date()),
    upstreamVersion: dependencies.upstreamVersion ?? resolveUpstreamVersion(),
    wrapperVersion: dependencies.wrapperVersion ?? resolveWrapperVersion(),
    upstream:
      dependencies.upstream ??
      createUpstreamRunner({ cwd, env: env as NodeJS.ProcessEnv }),
    setupDeps: dependencies.setupDeps ?? {},
  };
}

function renderVersion(deps: Required<CliDependencies>): CliResult {
  return {
    exitCode: 0,
    stdout: toToon(
      versionModel({
        wrapperVersion: deps.wrapperVersion,
        upstreamPackage: "@playwright/cli",
        upstreamVersion: deps.upstreamVersion,
      }),
    ),
  };
}

function runSetup(argv: string[], deps: Required<CliDependencies>): CliResult {
  const scope: HookScope = argv.includes("--scope")
    ? (argv[argv.indexOf("--scope") + 1] === "project" ? "project" : "user")
    : "user";
  const result = installSessionStartHook({
    executablePath: deps.executablePath,
    cwd: deps.cwd,
    home: deps.env.HOME,
    scope,
    deps: deps.setupDeps,
  });
  return { exitCode: 0, stdout: toToon(setupModel(scope, result)) };
}

function setupModel(scope: HookScope, result: ReturnType<typeof installSessionStartHook>): ToonValue {
  return {
    command: "setup",
    status: "ok",
    scope,
    binary: result.binary,
    installed: result.installed.map((entry) => ({
      target: entry.target,
      path: entry.path,
      action: entry.action,
    })),
    next: [
      "Start a new agent session in this directory to see live context",
      "Run `playwright-cli-axi` for the full home view",
    ],
  };
}

async function runContext(deps: Required<CliDependencies>): Promise<CliResult> {
  const store = createVideoStore(deps);
  const [listRun, video] = await Promise.all([
    deps.upstream(["list", "--all"]),
    store.load(),
  ]);
  const parsed = parseUpstreamOutput(
    listRun.stdout,
    listRun.stderr,
    listRun.exitCode,
  );
  const sessions =
    parsed.kind === "json" && !parsed.isError
      ? normalizeSessions(parsed.value)
      : normalizeSessions(undefined);
  const reconciled = reconcileVideoState(video, {
    browserCount: sessions.browsers.count,
  });
  return {
    exitCode: 0,
    stdout: toToon(
      contextModel({
        executablePath: deps.executablePath,
        home: deps.env.HOME,
        cwd: deps.cwd,
        sessions,
        video: reconciled,
      }),
    ),
  };
}

async function renderHome(deps: Required<CliDependencies>): Promise<CliResult> {
  const store = createVideoStore(deps);
  const [listRun, video] = await Promise.all([
    deps.upstream(["list", "--all"]),
    store.load(),
  ]);
  const parsed = parseUpstreamOutput(
    listRun.stdout,
    listRun.stderr,
    listRun.exitCode,
  );
  const sessions =
    parsed.kind === "json" && !parsed.isError
      ? normalizeSessions(parsed.value)
      : normalizeSessions(undefined);
  const reconciledVideo = reconcileVideoState(video, {
    browserCount: sessions.browsers.count,
  });
  if (
    reconciledVideo.recording.status !== video.recording.status ||
    reconciledVideo.warnings.length !== video.warnings.length
  )
    await store.save(reconciledVideo);
  const model = homeModel({
    executablePath: deps.executablePath,
    cwd: deps.cwd,
    upstreamVersion: deps.upstreamVersion,
    sessions,
    video: reconciledVideo,
    home: deps.env.HOME,
  });
  return { exitCode: 0, stdout: toToon(model) };
}

async function runGenericCommand(
  argv: string[],
  deps: Required<CliDependencies>,
): Promise<CliResult> {
  const full = hasFullFlag(argv);
  const fields = parseFieldsFlag(argv);
  const run = await deps.upstream(stripWrapperFlags(argv));
  const parsed = parseUpstreamOutput(run.stdout, run.stderr, run.exitCode);
  if (parsed.isError || run.exitCode !== 0)
    return normalizeUpstreamError(argv, run, parsed);
  const command = commandName(argv) ?? argv[0] ?? "command";
  return {
    exitCode: 0,
    stdout: toToon(commandSuccessModel(command, parsed, { full, fields })),
  };
}

async function runHelpCommand(
  argv: string[],
  deps: Required<CliDependencies>,
): Promise<CliResult> {
  const run = await deps.upstream(stripWrapperFlags(argv));
  const parsed = parseUpstreamOutput(run.stdout, run.stderr, run.exitCode);
  if (parsed.isError || run.exitCode !== 0)
    return normalizeUpstreamError(argv, run, parsed);
  const text =
    parsed.kind === "text" ? parsed.text : JSON.stringify(parsed.value);
  return {
    exitCode: 0,
    stdout: upstreamHelpPreviewToStdout(commandName(argv) ?? "help", text),
  };
}

async function runCloseLikeCommand(
  argv: string[],
  deps: Required<CliDependencies>,
): Promise<CliResult> {
  const store = createVideoStore({ ...deps, session: sessionFromArgv(argv) });
  const command = commandName(argv) ?? argv[0] ?? "command";
  const scope = closeScopeFor(command);
  const priorStates =
    scope === "global"
      ? await store.loadAll()
      : scope === "cwd"
        ? await store.loadAllForCwd()
        : [{ path: store.path, state: await store.load() }];
  const run = await deps.upstream(stripWrapperFlags(argv));
  const parsed = parseUpstreamOutput(run.stdout, run.stderr, run.exitCode);
  if (parsed.isError || run.exitCode !== 0)
    return normalizeUpstreamError(argv, run, parsed);

  const warnings: string[] = [];
  for (const record of priorStates) {
    if (record.state.recording.status !== "active") continue;
    const sessionLabel =
      record.state.scope.session === "default"
        ? ""
        : ` for session ${record.state.scope.session}`;
    const warning = `Recording was active${sessionLabel} before ${command}; video may be lost because video-stop was not run`;
    warnings.push(warning);
    const abandoned: VideoSidecarState = structuredClone(record.state);
    abandoned.recording = {
      ...abandoned.recording,
      status: "abandoned",
      stoppedAt: deps.now().toISOString(),
    };
    abandoned.lastError = warning;
    abandoned.warnings = abandoned.warnings.includes(warning)
      ? abandoned.warnings
      : [...abandoned.warnings, warning];
    await store.save(abandoned);
  }

  return {
    exitCode: 0,
    stdout: toToon({
      ...commandSuccessModel(command, parsed),
      ...(warnings.length > 0 ? { warnings } : {}),
    }),
  };
}
