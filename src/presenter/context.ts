import { CATALOG } from "../content/catalog.js";
import type { SessionSummary } from "../domain/sessions.js";
import type { VideoSidecarState } from "../domain/videoState.js";
import type { ToonValue } from "./toon.js";

/** Hard cap on the rendered context slice (token-budgeted; AXI principle 7). */
export const MAX_CONTEXT_BYTES = 512;
/** Per-field cap for path-like fields so a hostile/long path can't blow the budget. */
const MAX_FIELD_CHARS = 96;

export interface ContextInput {
  executablePath: string;
  home?: string;
  cwd: string;
  sessions: SessionSummary;
  video: VideoSidecarState;
}

/**
 * Token-budgeted session-start context slice (AXI principle 7).
 *
 * This is what the installed SessionStart hook emits on every conversation
 * start. It is ruthlessly minimized: it keeps only the live state an agent needs
 * to orient (how many browsers, recording status) plus two next steps. It strips
 * the full command matrix, server/channel rows, and deep video details that only
 * an explicit invocation of the no-args home view can show.
 *
 * Budget is enforced deterministically: path-like fields are capped so the whole
 * slice stays under MAX_CONTEXT_BYTES regardless of input path lengths.
 */
export function contextModel(input: ContextInput): ToonValue {
  const recordingActive = input.video.recording.status === "active";
  return {
    bin: capField(collapseHome(input.executablePath, input.home)),
    tool: CATALOG.binary,
    cwd: capField(input.cwd),
    browsers: input.sessions.browsers.count,
    video: input.video.recording.status,
    next: pickNextSteps(recordingActive),
  };
}

/** Truncate a field to MAX_FIELD_CHARS with an ellipsis marker when too long. */
function capField(value: string): string {
  if (value.length <= MAX_FIELD_CHARS) return value;
  return `${value.slice(0, MAX_FIELD_CHARS - 1)}…`;
}

function pickNextSteps(recordingActive: boolean): string[] {
  // Contextual: if recording, point at stop; otherwise offer the common start.
  return recordingActive
    ? ["playwright-cli-axi video-stop", "playwright-cli-axi list --all"]
    : [
        "playwright-cli-axi open https://example.com",
        "playwright-cli-axi video-start ./recording.webm --size 800x600",
      ];
}

function collapseHome(path: string, home: string | undefined): string {
  if (home && path === home) return "~";
  if (home && path.startsWith(`${home}/`))
    return `~/${path.slice(home.length + 1)}`;
  return path;
}
