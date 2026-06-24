import { cwd as processCwd } from "node:process";

import {
  commandName,
  hasVersionFlag,
  hasFullFlag,
  isKnownCommand,
  isVideoCommand,
  isWrapperCommand,
  isValidWaitState,
  parseFieldsFlag,
  parseSettleFlag,
  parseWaitFlag,
  sessionFromArgv,
  settleLoadStateCode,
  stripJsonFlags,
  stripWrapperFlags,
  validationProbeCode,
  VALIDATION_PROBE_COMMANDS,
  waitForLoadStateCode,
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
  findInTree,
  parseSnapshotTree,
  snapshotTextOf,
} from "../domain/snapshotFind.js";
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
import { toToon, table, type ToonValue } from "../presenter/toon.js";
import { versionModel } from "../presenter/version.js";
import { errorToStdout } from "../presenter/errors.js";
import { normalizeUpstreamError } from "../upstream/errors.js";
import { isObject, parseUpstreamOutput } from "../upstream/parse.js";
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
    // C-5: surface Unknown command consistently with the run router instead
    // of forwarding `<unknown> --help` to upstream, which returns permissive
    // help metadata for non-commands (e.g. `help get-url`).
    if (!isKnownCommand(command))
      return usageError(
        command,
        `Unknown command: ${command}`,
        ["playwright-cli-axi --help"],
      );
    return await runHelpCommand(argv, deps);
  }
  if (command === "setup") return runSetup(argv, deps);
  if (command === "context") return await runContext(deps);
  if (command === "scroll") return await runScrollCommand(argv, deps);
  if (command === "wait") return await runWaitCommand(argv, deps);
  if (command === "find") return await runFindCommand(argv, deps);
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
    ? argv[argv.indexOf("--scope") + 1] === "project"
      ? "project"
      : "user"
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

function setupModel(
  scope: HookScope,
  result: ReturnType<typeof installSessionStartHook>,
): ToonValue {
  const skipped = result.installed.filter(
    (entry) => entry.action === "skipped",
  );
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
  const settle = parseSettleFlag(argv);
  const run = await deps.upstream(stripWrapperFlags(argv));
  const parsed = parseUpstreamOutput(run.stdout, run.stderr, run.exitCode);
  if (parsed.isError || run.exitCode !== 0)
    return normalizeUpstreamError(argv, run, parsed);
  const command = commandName(argv) ?? argv[0] ?? "command";
  // P-5: optionally wait for the page to settle after a navigation-producing
  // command, so the post-action state is trustworthy without manual sleep.
  // N-2: a wait failure must NOT mask the primary command's success — surface
  // it as a bounded `wait_warning` on the ok result instead.
  // C-4: `--settle` is the deterministic variant (load state + URL-stability
  // poll); `--wait` settles network only and may race SPA route mounting.
  let waitWarning: string | undefined;
  if (settle) {
    const settleResult = await runSettle(settle, deps);
    if (settleResult.kind === "error") waitWarning = settleResult.warning;
  } else if (wait) {
    const waitResult = await runPageWait(wait, deps);
    if (waitResult.kind === "error") waitWarning = waitResult.warning;
  }
  const model = commandSuccessModel(command, parsed, {
    full,
    fields,
    artifactBase: run.artifactBase,
  });
  if (waitWarning) model.wait_warning = waitWarning;
  // C-1: after a submit-triggering click, probe HTML5 constraint validation
  // so a submit blocked by an invalid field is not silently reported as ok
  // (the validation bubble is not in the accessibility tree). Never masks the
  // primary result and never fails the command.
  if (VALIDATION_PROBE_COMMANDS.has(command)) {
    const validation = await runValidationProbe(deps);
    if (validation) model.validation = validation;
  }
  return { exitCode: 0, stdout: toToon(model) };
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
  const scrollFlagsFound: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]!;
    if (a === "--to") {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--"))
        return usageError("scroll", "--to requires a reference value");
      toRef = next;
      scrollFlagsFound.push("--to");
    } else if (a.startsWith("--to=")) {
      toRef = a.slice("--to=".length);
      scrollFlagsFound.push("--to");
    } else if (a === "--by") {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--"))
        return usageError("scroll", "--by requires a pixel value");
      byPx = next;
      scrollFlagsFound.push("--by");
    } else if (a.startsWith("--by=")) {
      byPx = a.slice("--by=".length);
      scrollFlagsFound.push("--by");
    } else if (a === "--top") {
      where = "top";
      scrollFlagsFound.push("--top");
    } else if (a === "--bottom") {
      where = "bottom";
      scrollFlagsFound.push("--bottom");
    }
  }

  if (scrollFlagsFound.length > 1) {
    return usageError(
      "scroll",
      `only one scroll action can be specified at a time (found: ${scrollFlagsFound.join(", ")})`,
      [
        "playwright-cli-axi scroll --to e55",
        "playwright-cli-axi scroll --bottom",
        "playwright-cli-axi scroll --by 600",
      ],
    );
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
    evalArgv = ["eval", "() => window.scrollTo(0, document.body.scrollHeight)"];
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
  const code = waitForLoadStateCode(state, Number(timeout));
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

/** Issue a bounded page wait after a navigation command (P-5). N-2: a wait
 * failure here is reported as a warning, never a hard error, so it cannot mask
 * the primary command's success. */
async function runPageWait(
  state: string,
  deps: Required<CliDependencies>,
): Promise<{ kind: "ok" } | { kind: "error"; warning: string }> {
  const code = waitForLoadStateCode(state, 5000);
  const run = await deps.upstream(["run-code", code]);
  const parsed = parseUpstreamOutput(run.stdout, run.stderr, run.exitCode);
  if (parsed.isError || run.exitCode !== 0) {
    const detail =
      successTextOf(parsed) ||
      (parsed.kind === "text" ? parsed.text : run.stderr) ||
      "upstream error";
    return {
      kind: "error",
      warning: `post-action wait for '${state}' failed: ${detail}`,
    };
  }
  return { kind: "ok" };
}

/** Issue a deterministic SPA settle after a navigation command (C-4). Like
 * `runPageWait`, a failure is a warning, never a hard error. */
async function runSettle(
  state: string,
  deps: Required<CliDependencies>,
): Promise<{ kind: "ok" } | { kind: "error"; warning: string }> {
  const code = settleLoadStateCode(state, 5000);
  const run = await deps.upstream(["run-code", code]);
  const parsed = parseUpstreamOutput(run.stdout, run.stderr, run.exitCode);
  if (parsed.isError || run.exitCode !== 0) {
    const detail =
      successTextOf(parsed) ||
      (parsed.kind === "text" ? parsed.text : run.stderr) ||
      "upstream error";
    return {
      kind: "error",
      warning: `post-action settle for '${state}' failed: ${detail}`,
    };
  }
  return { kind: "ok" };
}

/**
 * C-1: probe HTML5 form constraint validation after a submit-triggering click.
 * Returns `{ ok: false, invalid_fields }` when a submit appears blocked (the
 * browser focused an invalid field), so a blocked submit is surfaced instead
 * of silently reported as ok. Returns undefined (adds nothing) otherwise, so
 * navigating/non-submit clicks are unaffected.
 */
async function runValidationProbe(
  deps: Required<CliDependencies>,
): Promise<{ ok: false; invalid_fields: ToonValue[] } | undefined> {
  try {
    const run = await deps.upstream(["run-code", validationProbeCode()]);
    const parsed = parseUpstreamOutput(run.stdout, run.stderr, run.exitCode);
    if (parsed.isError || run.exitCode !== 0) return undefined;
    const raw = parsed.kind === "json" ? parsed.value : undefined;
    if (!isObject(raw)) return undefined;
    // run-code wraps its return value in { result: "<json>" }; unwrap and parse.
    let probe: Record<string, unknown> = raw;
    if ("result" in probe && typeof probe.result === "string") {
      try {
        const parsedResult = JSON.parse(probe.result);
        if (isObject(parsedResult)) probe = parsedResult;
        else return undefined;
      } catch {
        return undefined;
      }
    }
    const active = Boolean(probe.activeIsInvalid);
    const fields = probe.fields;
    if (!active || !Array.isArray(fields) || fields.length === 0) return undefined;
    return { ok: false, invalid_fields: fields as ToonValue[] };
  } catch {
    return undefined;
  }
}

function successTextOf(parsed: ReturnType<typeof parseUpstreamOutput>): string {
  if (parsed.kind === "text") return parsed.text;
  if (
    parsed.value &&
    typeof parsed.value === "object" &&
    "result" in parsed.value
  ) {
    const v = (parsed.value as { result?: unknown }).result;
    return typeof v === "string" ? v : "";
  }
  return "";
}

/**
 * C-3: structured lookup over the current snapshot. Runs upstream `snapshot`,
 * parses the a11y tree, and returns labelled matches with refs and paired
 * sibling values — so an agent reads page data (KPIs, labels) as structured
 * values instead of grepping a flat tree.
 */
async function runFindCommand(
  argv: string[],
  deps: Required<CliDependencies>,
): Promise<CliResult> {
  const rest = argv.slice(argv.indexOf("find") + 1);
  const query = rest.find((arg) => !arg.startsWith("-"));
  if (!query) {
    return usageError("find", "find needs a label to look up", [
      'playwright-cli-axi find "Classrooms"',
      "playwright-cli-axi find Start",
    ]);
  }
  const run = await deps.upstream(stripWrapperFlags(["snapshot"]));
  const parsed = parseUpstreamOutput(run.stdout, run.stderr, run.exitCode);
  if (parsed.isError || run.exitCode !== 0)
    return normalizeUpstreamError(["snapshot"], run, parsed);
  const treeText =
    parsed.kind === "json"
      ? snapshotTextOf(parsed.value)
      : parsed.kind === "text"
        ? parsed.text
        : "";
  const matches = findInTree(parseSnapshotTree(treeText), query);
  const base: Record<string, ToonValue> = {
    command: "find",
    status: "ok",
    query,
    matches: matches.length,
    ...(matches.length === 0
      ? { empty: "no snapshot nodes matched the query" }
      : {}),
  };
  if (matches.length === 0) return { exitCode: 0, stdout: toToon(base) };
  return {
    exitCode: 0,
    stdout: toToon({
      ...base,
      match_rows: table(
        ["ref", "role", "name", "value", "text"],
        matches.map((m) => ({
          ref: m.ref ?? "",
          role: m.role,
          name: m.name ?? "",
          value: m.value ?? "",
          text: m.text ?? "",
        })),
      ),
    }),
  };
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
