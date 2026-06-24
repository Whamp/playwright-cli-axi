import type { CliResult } from "../cli/main.js";
import {
  argsAfterCommand,
  commandName,
  type VideoCommandName,
} from "./commandSurface.js";
import type { VideoStore, VideoSidecarState } from "./videoState.js";
import { parseUpstreamOutput, isObject } from "../upstream/parse.js";
import type { UpstreamRunner } from "../upstream/runner.js";
import { errorToStdout } from "../presenter/errors.js";
import { toToon, type ToonValue } from "../presenter/toon.js";
import { normalizeUpstreamError } from "../upstream/errors.js";

const POSITIONS = [
  "top-left",
  "top",
  "top-right",
  "bottom-left",
  "bottom",
  "bottom-right",
] as const;
const CURSORS = ["pointer", "none"] as const;

export interface VideoCommandContext {
  argv: string[];
  upstream: UpstreamRunner;
  store: VideoStore;
  now: () => Date;
}

export async function handleVideoCommand(
  context: VideoCommandContext,
): Promise<CliResult> {
  const command = commandName(context.argv) as VideoCommandName;
  const state = await context.store.load();
  const validation = validateVideoCommand(
    command,
    argsAfterCommand(context.argv),
  );
  if (!validation.ok) {
    return {
      exitCode: 2,
      stdout: errorToStdout({
        kind: "usage",
        message: validation.message,
        command: context.argv.join(" "),
        help: validation.help,
      }),
    };
  }

  if (command === "video-start" && state.recording.status === "active") {
    return {
      exitCode: 2,
      stdout: errorToStdout({
        kind: "already_recording",
        message: "video recording is already active; run video-stop first",
        command: context.argv.join(" "),
        help: ["playwright-cli-axi video-stop"],
      }),
    };
  }

  const run = await context.upstream(context.argv);
  const parsed = parseUpstreamOutput(run.stdout, run.stderr, run.exitCode);
  if (parsed.isError || run.exitCode !== 0)
    return normalizeUpstreamError(context.argv, run, parsed);
  if (command === "video-start" && !videoStartConfirmed(parsed)) {
    return {
      exitCode: 1,
      stdout: errorToStdout({
        kind: "upstream_error",
        message:
          "video-start completed without confirming that recording started",
        command: context.argv.join(" "),
        help: ["playwright-cli-axi video-start --help"],
      }),
    };
  }

  const nextState = mutateStateAfterSuccess(
    command,
    validation.options,
    state,
    parsed,
    context.now(),
  );
  await context.store.save(nextState);
  return {
    exitCode: 0,
    stdout: toToon(
      videoSuccessModel(command, validation.options, nextState, parsed),
    ),
  };
}

export type VideoOptions = {
  positionals: string[];
  flags: Record<string, string>;
};

type Validation =
  | { ok: true; options: VideoOptions }
  | { ok: false; message: string; help: string[] };

export function validateVideoCommand(
  command: VideoCommandName,
  args: string[],
): Validation {
  const parsed = parseArgs(args);
  if (!parsed.ok)
    return {
      ok: false,
      message: parsed.message,
      help: [`playwright-cli-axi ${command} --help`],
    };
  const { positionals, flags } = parsed.options;

  switch (command) {
    case "video-start": {
      const unknown = unknownFlags(flags, ["size"]);
      if (unknown)
        return usage(`${unknown} is not supported by video-start`, command);
      if (positionals.length > 1)
        return usage("video-start accepts at most one filename", command);
      if (flags.size !== undefined && !/^\d+x\d+$/.test(flags.size))
        return usage(
          "--size must use <width>x<height>, for example 800x600",
          command,
        );
      return { ok: true, options: { positionals, flags } };
    }
    case "video-stop": {
      const unknown = unknownFlags(flags, []);
      if (unknown)
        return usage(`${unknown} is not supported by video-stop`, command);
      if (positionals.length > 0)
        return usage(
          "video-stop does not accept positional arguments",
          command,
        );
      return { ok: true, options: { positionals, flags } };
    }
    case "video-chapter": {
      const unknown = unknownFlags(flags, ["description", "duration"]);
      if (unknown)
        return usage(`${unknown} is not supported by video-chapter`, command);
      if (positionals.length === 0)
        return usage("video-chapter requires <title>", command);
      if (positionals.length > 1)
        return usage(
          "video-chapter accepts one title; quote multi-word titles",
          command,
        );
      if (flags.duration !== undefined && !isNonNegativeInteger(flags.duration))
        return usage(
          "--duration must be a non-negative integer number of milliseconds",
          command,
        );
      return { ok: true, options: { positionals, flags } };
    }
    case "video-show-actions": {
      const unknown = unknownFlags(flags, ["duration", "position", "cursor"]);
      if (unknown)
        return usage(
          `${unknown} is not supported by video-show-actions`,
          command,
        );
      if (positionals.length > 0)
        return usage(
          "video-show-actions does not accept positional arguments",
          command,
        );
      if (flags.duration !== undefined && !isNonNegativeInteger(flags.duration))
        return usage(
          "--duration must be a non-negative integer number of milliseconds",
          command,
        );
      if (
        flags.position !== undefined &&
        !POSITIONS.includes(flags.position as (typeof POSITIONS)[number])
      ) {
        return usage(
          "position must be one of top-left, top, top-right, bottom-left, bottom, bottom-right",
          command,
        );
      }
      if (
        flags.cursor !== undefined &&
        !CURSORS.includes(flags.cursor as (typeof CURSORS)[number])
      ) {
        return usage("cursor must be one of pointer, none", command);
      }
      return { ok: true, options: { positionals, flags } };
    }
    case "video-hide-actions": {
      const unknown = unknownFlags(flags, []);
      if (unknown)
        return usage(
          `${unknown} is not supported by video-hide-actions`,
          command,
        );
      if (positionals.length > 0)
        return usage(
          "video-hide-actions does not accept positional arguments",
          command,
        );
      return { ok: true, options: { positionals, flags } };
    }
  }
}

function mutateStateAfterSuccess(
  command: VideoCommandName,
  options: VideoOptions,
  state: VideoSidecarState,
  parsed: ReturnType<typeof parseUpstreamOutput>,
  now: Date,
): VideoSidecarState {
  const at = now.toISOString();
  const next: VideoSidecarState = structuredClone(state);
  next.lastError = undefined;
  next.lastResult = successText(parsed);
  switch (command) {
    case "video-start":
      next.recording = {
        status: "active",
        requestedFile: options.positionals[0],
        requestedSize: options.flags.size,
        startedAt: at,
      };
      next.lastFiles = [];
      return next;
    case "video-stop": {
      const artifacts = extractVideoArtifacts(parsed);
      next.recording = { ...next.recording, status: "inactive", stoppedAt: at };
      next.lastFiles = artifacts.all;
      return next;
    }
    case "video-chapter":
      next.chapters.push({
        title: options.positionals[0]!,
        ...(options.flags.description
          ? { description: options.flags.description }
          : {}),
        ...(options.flags.duration
          ? { duration: Number(options.flags.duration) }
          : {}),
        createdAt: at,
      });
      return next;
    case "video-show-actions":
      next.actionsOverlay = { status: "enabled", updatedAt: at };
      return next;
    case "video-hide-actions":
      next.actionsOverlay = { status: "disabled", updatedAt: at };
      return next;
  }
}

function videoSuccessModel(
  command: VideoCommandName,
  options: VideoOptions,
  state: VideoSidecarState,
  parsed: ReturnType<typeof parseUpstreamOutput>,
): ToonValue {
  if (command === "video-stop") {
    const artifacts = extractVideoArtifacts(parsed);
    return {
      command,
      status: "ok",
      recording: {
        status: state.recording.status,
        stoppedAt: state.recording.stoppedAt ?? "",
      },
      files: {
        count: artifacts.all.length,
        ...(artifacts.all.length === 0
          ? {
              empty: noVideosRecorded(parsed)
                ? "upstream reported no videos were recorded"
                : "no video files reported by upstream",
            }
          : {}),
      },
      videos: {
        count: artifacts.videos.length,
        ...(artifacts.videos.length === 0
          ? { empty: "no WebM video artifacts reported by upstream" }
          : {}),
      },
      ...(artifacts.videos.length > 0 ? { video_files: artifacts.videos } : {}),
      other_artifacts: {
        count: artifacts.otherArtifacts.length,
        ...(artifacts.otherArtifacts.length === 0
          ? { empty: "no non-video artifacts reported by upstream" }
          : {}),
      },
      ...(artifacts.otherArtifacts.length > 0
        ? { other_artifact_files: artifacts.otherArtifacts }
        : {}),
      ...(artifacts.all.length > 0 ? { last_files: artifacts.all } : {}),
    };
  }
  if (command === "video-chapter") {
    const chapter = state.chapters[state.chapters.length - 1]!;
    return {
      command,
      status: "ok",
      chapter: {
        title: chapter.title,
        description: chapter.description ?? "",
        duration: chapter.duration ?? "",
      },
    };
  }
  if (command === "video-show-actions" || command === "video-hide-actions") {
    return { command, status: "ok", actions: state.actionsOverlay.status };
  }
  return {
    command,
    status: "ok",
    recording: {
      status: state.recording.status,
      ...(options.positionals[0]
        ? { requestedFile: options.positionals[0] }
        : {}),
      ...(options.flags.size ? { requestedSize: options.flags.size } : {}),
      source: "sidecar",
    },
  };
}

export interface VideoArtifacts {
  videos: string[];
  otherArtifacts: string[];
  all: string[];
}

export function extractVideoLinks(
  parsed: ReturnType<typeof parseUpstreamOutput>,
): string[] {
  return extractVideoArtifacts(parsed).all;
}

export function extractVideoArtifacts(
  parsed: ReturnType<typeof parseUpstreamOutput>,
): VideoArtifacts {
  const text = successText(parsed);
  const markdown = [...text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)]
    .map((match) => ({ label: match[1] ?? "", path: match[2] ?? "" }))
    .filter((entry) => entry.path.length > 0);
  if (markdown.length > 0) return classifyLabeledArtifacts(markdown);
  if (parsed.kind === "json" && isObject(parsed.value)) {
    const videos = stringArray(parsed.value.videos);
    if (videos.length > 0) {
      const otherArtifacts = [
        ...stringArray(parsed.value.files),
        ...stringArray(parsed.value.lastFiles),
      ].filter((path) => !videos.includes(path));
      return { videos, otherArtifacts, all: [...videos, ...otherArtifacts] };
    }
    for (const key of ["files", "lastFiles"]) {
      const value = stringArray(parsed.value[key]);
      if (value.length > 0) return classifyVideoArtifacts(value);
    }
  }
  return { videos: [], otherArtifacts: [], all: [] };
}

function classifyLabeledArtifacts(
  entries: { label: string; path: string }[],
): VideoArtifacts {
  const videos: string[] = [];
  const otherArtifacts: string[] = [];
  for (const entry of entries) {
    if (isVideoArtifact(entry.path) || /video/i.test(entry.label))
      videos.push(entry.path);
    else otherArtifacts.push(entry.path);
  }
  return { videos, otherArtifacts, all: [...videos, ...otherArtifacts] };
}

function classifyVideoArtifacts(paths: string[]): VideoArtifacts {
  const videos = paths.filter(isVideoArtifact);
  const otherArtifacts = paths.filter((path) => !isVideoArtifact(path));
  return { videos, otherArtifacts, all: [...videos, ...otherArtifacts] };
}

function isVideoArtifact(path: string): boolean {
  return path.toLowerCase().split("?")[0]?.endsWith(".webm") === true;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function noVideosRecorded(
  parsed: ReturnType<typeof parseUpstreamOutput>,
): boolean {
  return /no videos were recorded/i.test(successText(parsed));
}

function videoStartConfirmed(
  parsed: ReturnType<typeof parseUpstreamOutput>,
): boolean {
  const text = successText(parsed);
  return (
    text === "Video recording started." ||
    text.startsWith("Video recording started.")
  );
}

function successText(parsed: ReturnType<typeof parseUpstreamOutput>): string {
  if (parsed.kind === "text") return parsed.text;
  if (isObject(parsed.value)) {
    for (const key of ["message", "result", "output"]) {
      const value = parsed.value[key];
      if (typeof value === "string") return value;
    }
  }
  return "";
}

function parseArgs(
  args: string[],
): { ok: true; options: VideoOptions } | { ok: false; message: string } {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }
    if (!arg.startsWith("--"))
      return { ok: false, message: `${arg} is not a supported short flag` };
    const [rawName, inlineValue] = arg
      .slice(2)
      .split(/=(.*)/s)
      .filter((part) => part !== undefined);
    const name = rawName ?? "";
    if (!name) return { ok: false, message: `${arg} is not a valid flag` };
    const value = inlineValue !== undefined ? inlineValue : args[index + 1];
    if (value === undefined || value.startsWith("--"))
      return { ok: false, message: `--${name} requires a value` };
    flags[name] = value;
    if (inlineValue === undefined) index += 1;
  }
  return { ok: true, options: { positionals, flags } };
}

function unknownFlags(
  flags: Record<string, string>,
  allowed: string[],
): string | undefined {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(flags).find((flag) => !allowedSet.has(flag));
  return unknown ? `--${unknown}` : undefined;
}

function isNonNegativeInteger(value: string): boolean {
  return /^\d+$/.test(value);
}

function usage(message: string, command: VideoCommandName): Validation {
  return { ok: false, message, help: [`playwright-cli-axi ${command} --help`] };
}
