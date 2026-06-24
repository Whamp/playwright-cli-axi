import { cwd as processCwd } from "node:process";

import {
  commandName,
  hasVersionFlag,
  hasFullFlag,
  isVideoCommand,
  isWrapperCommand,
  isValidWaitState,
  parseFieldsFlag,
  parseWaitFlag,
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
import { helpToStdout, upstreamHelpPreviewToStdout } from "../presenter/help.js";
import { homeModel } from "../presenter/home.js";
import { contextModel } from "../presenter/context.js";
import { commandSuccessModel } from "../presenter/success.js";
import { toToon, type ToonValue } from "../presenter/toon.js";
import { versionModel } from "../presenter/version.js";
import { errorToStdout } from "../presenter/errors.js";
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
  // F-1: accept `playwright-cli-axi help [command]` as an alias for
  // `<command> --help`, so help is discoverable without learning the flag form.
  if (command === "help") {
    const sub = argv[argv.indexOf("help") + 1];
    const helpArgv = sub ? [sub, "--help"] : ["--help"];
    return runCli(helpArgv, deps);
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    if (!command || isVideoCommand(command) || isWrapperCommand(command))
      return { exitCode: 0, stdout: helpToStdout(command) };
    return await runHelpCommand(argv, deps);
  }
  if (command === "setup") return runSetup(argv, deps);
  if (command === "context") return await runContext(deps);
  if (command === "scroll") return await runScrollCommand(argv, deps);
  if (command === "wait") return await runWaitCommand(argv, deps);
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
  const skipped = result.installed.filter((entry) => entry.action === "skipped");
  return {
    command: "setup",
    status: skipped.length > 0 ? "partial" : "ok",
    scope,
    binary: result.binary,
    installed: result.installed.map((entry) => ({
      target: entry.target,
      path: entry.path,
      action: entry.action,
      ...(entry.error ? { error: entry.error } : {}),
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
  const wait = parseWaitFlag(argv);
  const run = await deps.upstream(stripWrapperFlags(argv));
  const parsed = parseUpstreamOutput(run.stdout, run.stderr, run.exitCode);
  if (parsed.isError || run.exitCode !== 0)
    return normalizeUpstreamError(argv, run, parsed);
  const command = commandName(argv) ?? argv[0] ?? "command";
  // P-5: optionally wait for the page to settle after a navigation-producing
  // command, so the post-action state is trustworthy without manual sleep.
  if (wait) {
    const waitResult = await runPageWait(wait, deps);
    if (waitResult.kind === "error") return waitResult.result;
  }
  return {
    exitCode: 0,
    stdout: toToon(commandSuccessModel(command, parsed, { full, fields, artifactBase: run.artifactBase })),
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

/**
 * P-4: scroll convenience command. Translates to an upstream `eval` so agents
 * do not hand-write scrollIntoView/scrollBy JS on every navigation.
 */
async function runScrollCommand(
  argv: string[],
  deps: Required<CliDependencies>,
): Promise<CliResult> {
  const rest = argv.slice(argv.indexOf("scroll") + 1);
  let toRef: string | undefined;
  let byPx: string | undefined;
  let where: "top" | "bottom" | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]!;
    if (a === "--to") {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--"))
        return usageError("scroll", "--to requires a reference value");
      toRef = next;
    } else if (a.startsWith("--to=")) {
      toRef = a.slice("--to=".length);
    } else if (a === "--by") {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--"))
        return usageError("scroll", "--by requires a pixel value");
      byPx = next;
    } else if (a.startsWith("--by=")) {
      byPx = a.slice("--by=".length);
    } else if (a === "--top") {
      where = "top";
    } else if (a === "--bottom") {
      where = "bottom";
    }
  }
  let evalArgv: string[];
  let description: string;
  if (toRef) {
    evalArgv = [
      "eval",
      "(element) => element.scrollIntoView({ block: 'center', inline: 'nearest' })",
      toRef,
    ];
    description = `scrolled ref ${toRef} into view`;
  } else if (where === "top") {
    evalArgv = ["eval", "() => window.scrollTo(0, 0)"];
    description = "scrolled to top";
  } else if (where === "bottom") {
    evalArgv = [
      "eval",
      "() => window.scrollTo(0, document.body.scrollHeight)",
    ];
    description = "scrolled to bottom";
  } else if (byPx !== undefined) {
    if (!/^-?\d+$/.test(byPx))
      return usageError("scroll", `--by must be an integer number of pixels`);
    evalArgv = ["eval", `() => window.scrollBy(0, ${byPx})`];
    description = `scrolled by ${byPx}px`;
  } else {
    return usageError(
      "scroll",
      "scroll needs one of --to <ref>, --top, --bottom, or --by <px>",
      [
        "playwright-cli-axi scroll --to e55",
        "playwright-cli-axi scroll --bottom",
        "playwright-cli-axi scroll --by 600",
      ],
    );
  }
  const run = await deps.upstream(stripWrapperFlags(evalArgv));
  const parsed = parseUpstreamOutput(run.stdout, run.stderr, run.exitCode);
  if (parsed.isError || run.exitCode !== 0)
    return normalizeUpstreamError(evalArgv, run, parsed);
  return {
    exitCode: 0,
    stdout: toToon({
      command: "scroll",
      status: "ok",
      action: description,
      result: successTextOf(parsed),
    }),
  };
}

/**
 * P-5: wait command. Forwards a Playwright `waitForLoadState` via `run-code`
 * so agents can make post-navigation state deterministic without sleep.
 */
async function runWaitCommand(
  argv: string[],
  deps: Required<CliDependencies>,
): Promise<CliResult> {
  const rest = argv.slice(argv.indexOf("wait") + 1);
  let state = "networkidle";
  let timeout = "5000";
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]!;
    if (a === "--state") state = rest[i + 1] ?? state;
    else if (a.startsWith("--state=")) state = a.slice("--state=".length);
    else if (a === "--timeout") timeout = rest[i + 1] ?? timeout;
    else if (a.startsWith("--timeout=")) timeout = a.slice("--timeout=".length);
  }
  if (!isValidWaitState(state))
    return usageError(
      "wait",
      "--state must be one of load, domcontentloaded, networkidle",
    );
  if (!/^[1-9]\d*$/.test(timeout))
    return usageError("wait", "--timeout must be a positive integer (ms)");
  const code = `await page.waitForLoadState('${state}', { timeout: ${timeout} }).catch(() => {})`;
  const run = await deps.upstream(["run-code", code]);
  const parsed = parseUpstreamOutput(run.stdout, run.stderr, run.exitCode);
  if (parsed.isError || run.exitCode !== 0)
    return normalizeUpstreamError(["wait", ...rest], run, parsed);
  return {
    exitCode: 0,
    stdout: toToon({
      command: "wait",
      status: "ok",
      state,
      timeout_ms: Number(timeout),
    }),
  };
}

/** Issue a bounded page wait after a navigation command (P-5). */
async function runPageWait(
  state: string,
  deps: Required<CliDependencies>,
): Promise<{ kind: "ok" } | { kind: "error"; result: CliResult }> {
  const code = `await page.waitForLoadState('${state}', { timeout: 5000 }).catch(() => {})`;
  const run = await deps.upstream(["run-code", code]);
  const parsed = parseUpstreamOutput(run.stdout, run.stderr, run.exitCode);
  if (parsed.isError || run.exitCode !== 0)
    return {
      kind: "error",
      result: normalizeUpstreamError(["--wait", state], run, parsed),
    };
  return { kind: "ok" };
}

function successTextOf(parsed: ReturnType<typeof parseUpstreamOutput>): string {
  if (parsed.kind === "text") return parsed.text;
  if (parsed.value && typeof parsed.value === "object" && "result" in parsed.value) {
    const v = (parsed.value as { result?: unknown }).result;
    return typeof v === "string" ? v : "";
  }
  return "";
}

function usageError(
  command: string,
  message: string,
  help?: string[],
): CliResult {
  return {
    exitCode: 2,
    stdout: errorToStdout({
      kind: "usage",
      message,
      command,
      help: help ?? [`playwright-cli-axi ${command} --help`],
    }),
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
