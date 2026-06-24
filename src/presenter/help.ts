import { CATALOG } from "../content/catalog.js";
import { commandMatrixRows } from "../domain/upstreamCommands.js";
import { type ToonValue, table, toToon } from "./toon.js";

interface HelpDefinition {
  command: string;
  summary: string;
  usage: string;
  args: { name: string; required: boolean; description: string }[];
  flags: {
    name: string;
    value: string;
    default: string;
    description: string;
  }[];
  examples: string[];
}

const VIDEO_HELP: Record<string, HelpDefinition> = {
  "video-start": {
    command: "video-start",
    summary: CATALOG.videoCommands["video-start"],
    usage:
      "playwright-cli-axi video-start [filename] [--size <width>x<height>]",
    args: [
      {
        name: "filename",
        required: false,
        description: "WebM path requested from upstream",
      },
    ],
    flags: [
      {
        name: "--size",
        value: "<width>x<height>",
        default: "fit 800x800",
        description: "video frame size such as 800x600",
      },
    ],
    examples: [
      "playwright-cli-axi video-start ./recording.webm --size 800x600",
      "playwright-cli-axi video-stop",
    ],
  },
  "video-stop": {
    command: "video-stop",
    summary: CATALOG.videoCommands["video-stop"],
    usage: "playwright-cli-axi video-stop",
    args: [],
    flags: [],
    examples: ["playwright-cli-axi video-stop", "playwright-cli-axi"],
  },
  "video-chapter": {
    command: "video-chapter",
    summary: CATALOG.videoCommands["video-chapter"],
    usage:
      "playwright-cli-axi video-chapter <title> [--description <text>] [--duration <ms>]",
    args: [
      {
        name: "title",
        required: true,
        description: "chapter title; quote multi-word titles",
      },
    ],
    flags: [
      {
        name: "--description",
        value: "<text>",
        default: "",
        description: "optional chapter card description",
      },
      {
        name: "--duration",
        value: "<ms>",
        default: "upstream default",
        description: "milliseconds to show the chapter card",
      },
    ],
    examples: [
      'playwright-cli-axi video-chapter Smoke --description "AXI smoke" --duration 500',
      "playwright-cli-axi video-stop",
    ],
  },
  "video-show-actions": {
    command: "video-show-actions",
    summary: CATALOG.videoCommands["video-show-actions"],
    usage:
      "playwright-cli-axi video-show-actions [--duration <ms>] [--position <enum>] [--cursor <enum>]",
    args: [],
    flags: [
      {
        name: "--duration",
        value: "<ms>",
        default: "500",
        description: "milliseconds each action annotation remains visible",
      },
      {
        name: "--position",
        value: "top-left|top|top-right|bottom-left|bottom|bottom-right",
        default: "top-right",
        description: "where to place the action title",
      },
      {
        name: "--cursor",
        value: "pointer|none",
        default: "pointer",
        description: "cursor decoration",
      },
    ],
    examples: [
      "playwright-cli-axi video-show-actions --duration 100 --position top-right --cursor pointer",
      "playwright-cli-axi video-hide-actions",
    ],
  },
  "video-hide-actions": {
    command: "video-hide-actions",
    summary: CATALOG.videoCommands["video-hide-actions"],
    usage: "playwright-cli-axi video-hide-actions",
    args: [],
    flags: [],
    examples: [
      "playwright-cli-axi video-hide-actions",
      "playwright-cli-axi video-stop",
    ],
  },
  "video-chapters": {
    command: "video-chapters",
    summary:
      "Read the recorded chapter manifest with seek offsets relative to recording start.",
    usage: "playwright-cli-axi video-chapters",
    args: [],
    flags: [],
    examples: [
      "playwright-cli-axi video-chapters",
      "playwright-cli-axi video-status",
    ],
  },
  "video-status": {
    command: "video-status",
    summary:
      "Print the full recording summary: status, files, chapter manifest, actions, and warnings.",
    usage: "playwright-cli-axi video-status",
    args: [],
    flags: [],
    examples: ["playwright-cli-axi video-status"],
  },
};

const WRAPPER_HELP: Record<string, HelpDefinition> = {
  setup: {
    command: "setup",
    summary:
      "Install/repair the SessionStart hook for Claude Code and Codex so agent sessions start with live context.",
    usage: "playwright-cli-axi setup [--scope user|project]",
    args: [],
    flags: [
      {
        name: "--scope",
        value: "user|project",
        default: "user",
        description:
          "install into ~/.claude and ~/.codex (user) or .claude and .codex in cwd (project)",
      },
    ],
    examples: [
      "playwright-cli-axi setup",
      "playwright-cli-axi setup --scope project",
    ],
  },
  context: {
    command: "context",
    summary:
      "Print a token-budgeted session-start context slice (invoked by the SessionStart hook).",
    usage: "playwright-cli-axi context",
    args: [],
    flags: [],
    examples: ["playwright-cli-axi context"],
  },
  scroll: {
    command: "scroll",
    summary:
      "Scroll the page without hand-writing JS: to a snapshot ref, to top/bottom, or by pixels. Only one scroll action can be specified at a time.",
    usage:
      "playwright-cli-axi scroll [--to <ref> | --top | --bottom | --by <px>]",
    args: [],
    flags: [
      {
        name: "--to",
        value: "<ref>",
        default: "",
        description: "snapshot ref to scrollIntoView",
      },
      {
        name: "--top",
        value: "",
        default: "",
        description: "scroll to the top of the page",
      },
      {
        name: "--bottom",
        value: "",
        default: "",
        description: "scroll to the bottom of the page",
      },
      {
        name: "--by",
        value: "<px>",
        default: "",
        description: "scroll by a pixel delta (negative scrolls up)",
      },
    ],
    examples: [
      "playwright-cli-axi scroll --to e55",
      "playwright-cli-axi scroll --bottom",
      "playwright-cli-axi scroll --by 600",
    ],
  },
  wait: {
    command: "wait",
    summary:
      "Wait for a Playwright page load state so post-navigation state is trustworthy without manual sleep. When used via --wait on navigation commands, wait failures surface as a wait_warning field instead of masking the navigation result. For SPA navigations where networkidle is not enough, use --settle (load state + URL-stability poll).",
    usage:
      "playwright-cli-axi wait [--state load|domcontentloaded|networkidle] [--timeout <ms>]",
    args: [],
    flags: [
      {
        name: "--state",
        value: "load|domcontentloaded|networkidle",
        default: "networkidle",
        description: "Playwright load state to wait for",
      },
      {
        name: "--timeout",
        value: "<ms>",
        default: "5000",
        description: "maximum time to wait",
      },
    ],
    examples: [
      "playwright-cli-axi wait --state networkidle",
      "playwright-cli-axi click e5 --wait load",
    ],
  },
  find: {
    command: "find",
    summary:
      "Look up labelled page data from the current snapshot by text/name, pairing adjacent label/value nodes.",
    usage: 'playwright-cli-axi find "<label>"',
    args: [
      {
        name: "label",
        required: true,
        description:
          "text/accessible-name to find in the snapshot (case-insensitive)",
      },
    ],
    flags: [],
    examples: [
      'playwright-cli-axi find "Classrooms"',
      'playwright-cli-axi find "Start Free Trial"',
    ],
  },
};

export function helpToStdout(command?: string): string {
  if (command && VIDEO_HELP[command])
    return toToon(helpModel(VIDEO_HELP[command]));
  if (command && WRAPPER_HELP[command])
    return toToon(helpModel(WRAPPER_HELP[command]));
  return toToon({
    command: CATALOG.binary,
    summary: CATALOG.description,
    usage: "playwright-cli-axi [command] [args]",
    command_groups: table(
      ["group", "commands", "summary"],
      commandMatrixRows(),
    ),
    video_commands: Object.entries(CATALOG.videoCommands).map(
      ([name, summary]) => `${name}: ${summary}`,
    ),
    examples: CATALOG.next,
    help: [
      "Run 'playwright-cli-axi <command> --help' (or 'playwright-cli-axi help <command>') for command flags",
    ],
  });
}

export function upstreamHelpPreviewToStdout(
  command: string,
  text: string,
): string {
  return toToon(upstreamHelpPreviewModel(command, text));
}

function upstreamHelpPreviewModel(command: string, text: string): ToonValue {
  const lines = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const preview = lines.slice(0, 40);
  return {
    command,
    help: {
      source: "@playwright/cli",
      bytes: text.length,
      lines: preview.length,
      truncated: lines.length > preview.length,
    },
    lines: preview,
  };
}

function helpModel(definition: HelpDefinition): ToonValue {
  return {
    command: definition.command,
    summary: definition.summary,
    usage: definition.usage,
    ...(definition.args.length > 0
      ? { args: table(["name", "required", "description"], definition.args) }
      : { args: { count: 0, empty: "no positional arguments" } }),
    ...(definition.flags.length > 0
      ? {
          flags: table(
            ["name", "value", "default", "description"],
            definition.flags,
          ),
        }
      : { flags: { count: 0, empty: "no flags" } }),
    examples: definition.examples,
  };
}
