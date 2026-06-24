export interface CommandGroup {
  id: string;
  title: string;
  summary: string;
  commands: readonly string[];
}

export const COMMAND_GROUPS = [
  {
    id: "session",
    title: "Browser sessions",
    summary:
      "Open, attach, close, detach, inspect, and clean browser sessions.",
    commands: [
      "open",
      "attach",
      "close",
      "detach",
      "delete-data",
      "list",
      "close-all",
      "kill-all",
    ],
  },
  {
    id: "page",
    title: "Page interaction",
    summary:
      "Navigate pages, interact with elements, inspect snapshots, and run page evals.",
    commands: [
      "goto",
      "type",
      "click",
      "dblclick",
      "fill",
      "drag",
      "drop",
      "hover",
      "select",
      "upload",
      "check",
      "uncheck",
      "snapshot",
      "eval",
      "dialog-accept",
      "dialog-dismiss",
      "resize",
    ],
  },
  {
    id: "navigation",
    title: "Navigation",
    summary: "Control browser history and reload state.",
    commands: ["go-back", "go-forward", "reload"],
  },
  {
    id: "keyboard",
    title: "Keyboard",
    summary: "Send keyboard input and key state transitions.",
    commands: ["press", "keydown", "keyup"],
  },
  {
    id: "mouse",
    title: "Mouse",
    summary: "Send pointer movement, button, and wheel events.",
    commands: ["mousemove", "mousedown", "mouseup", "mousewheel"],
  },
  {
    id: "artifacts",
    title: "Artifacts",
    summary:
      "Create or retrieve screenshots, PDFs, response/request payload files, and traces.",
    commands: [
      "screenshot",
      "pdf",
      "request-headers",
      "request-body",
      "response-headers",
      "response-body",
      "tracing-start",
      "tracing-stop",
    ],
  },
  {
    id: "tabs",
    title: "Tabs",
    summary: "List, create, close, and select browser tabs.",
    commands: ["tab-list", "tab-new", "tab-close", "tab-select"],
  },
  {
    id: "storage",
    title: "Storage",
    summary:
      "Save/load browser state and manage cookies, localStorage, and sessionStorage.",
    commands: [
      "state-load",
      "state-save",
      "cookie-list",
      "cookie-get",
      "cookie-set",
      "cookie-delete",
      "cookie-clear",
      "localstorage-list",
      "localstorage-get",
      "localstorage-set",
      "localstorage-delete",
      "localstorage-clear",
      "sessionstorage-list",
      "sessionstorage-get",
      "sessionstorage-set",
      "sessionstorage-delete",
      "sessionstorage-clear",
    ],
  },
  {
    id: "network",
    title: "Network",
    summary: "Inspect requests, mock routes, and toggle online/offline state.",
    commands: [
      "requests",
      "request",
      "route",
      "route-list",
      "unroute",
      "network-state-set",
    ],
  },
  {
    id: "devtools",
    title: "DevTools and diagnostics",
    summary:
      "Inspect console output, run Playwright code, show dashboards, debug, and highlight elements.",
    commands: [
      "console",
      "run-code",
      "show",
      "pause-at",
      "resume",
      "step-over",
      "generate-locator",
      "highlight",
      "tray",
    ],
  },
  {
    id: "install",
    title: "Install and config",
    summary: "Install browsers/skills and inspect effective configuration.",
    commands: ["install", "install-browser", "config-print"],
  },
  {
    id: "video",
    title: "Video",
    summary: "Record WebM videos and annotate action/chapter overlays.",
    commands: [
      "video-start",
      "video-stop",
      "video-chapter",
      "video-show-actions",
      "video-hide-actions",
    ],
  },
] as const satisfies readonly CommandGroup[];

export const UPSTREAM_COMMANDS: readonly string[] = COMMAND_GROUPS.flatMap(
  (group) => group.commands,
);

export type CloseScope = "session" | "cwd" | "global";

/**
 * Single source of truth for close-like commands and the scope at which each
 * one abandons active recordings. CLOSE_LIKE_COMMANDS, the cwd/global subsets,
 * the predicates, and the CLI router all derive from this map; do not
 * duplicate these commands in parallel arrays elsewhere.
 *
 * - "session" abandons only the sidecar for the resolved session (close,
 *   detach, delete-data)
 * - "cwd" abandons every sidecar in the current working directory (close-all)
 * - "global" abandons every sidecar across the whole state directory, because
 *   upstream kill-all SIGKILLs daemon processes regardless of cwd (kill-all)
 */
export const CLOSE_LIKE_COMMAND_SCOPES = {
  close: "session",
  detach: "session",
  "delete-data": "session",
  "close-all": "cwd",
  "kill-all": "global",
} as const satisfies Readonly<Record<string, CloseScope>>;

export type CloseLikeCommand = keyof typeof CLOSE_LIKE_COMMAND_SCOPES;

export const CLOSE_LIKE_COMMANDS: readonly CloseLikeCommand[] = Object.keys(
  CLOSE_LIKE_COMMAND_SCOPES,
) as CloseLikeCommand[];

export const CWD_WIDE_CLOSE_LIKE_COMMANDS: readonly CloseLikeCommand[] =
  CLOSE_LIKE_COMMANDS.filter(
    (command) => CLOSE_LIKE_COMMAND_SCOPES[command] === "cwd",
  );

export const GLOBAL_CLOSE_LIKE_COMMANDS: readonly CloseLikeCommand[] =
  CLOSE_LIKE_COMMANDS.filter(
    (command) => CLOSE_LIKE_COMMAND_SCOPES[command] === "global",
  );

export function isCloseLikeCommand(
  command: string | undefined,
): command is CloseLikeCommand {
  return (
    command !== undefined &&
    Object.prototype.hasOwnProperty.call(CLOSE_LIKE_COMMAND_SCOPES, command)
  );
}

export function closeScopeFor(
  command: string | undefined,
): CloseScope | undefined {
  if (!isCloseLikeCommand(command)) return undefined;
  return CLOSE_LIKE_COMMAND_SCOPES[command];
}

export function commandGroupFor(command: string): CommandGroup | undefined {
  return COMMAND_GROUPS.find((group) =>
    (group.commands as readonly string[]).includes(command),
  );
}

export function isKnownUpstreamCommand(command: string): boolean {
  return commandGroupFor(command) !== undefined;
}

export function commandMatrixRows(): {
  group: string;
  commands: string;
  summary: string;
}[] {
  return COMMAND_GROUPS.map((group) => ({
    group: group.title,
    commands: group.commands.join(" "),
    summary: group.summary,
  }));
}
