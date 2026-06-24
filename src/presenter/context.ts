import { CATALOG } from "../content/catalog.js";
import type { SessionSummary } from "../domain/sessions.js";
import type { VideoSidecarState } from "../domain/videoState.js";
import type { ToonValue } from "./toon.js";

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
 */
export function contextModel(input: ContextInput): ToonValue {
  const recordingActive = input.video.recording.status === "active";
  return {
    bin: collapseHome(input.executablePath, input.home),
    tool: CATALOG.binary,
    cwd: input.cwd,
    browsers: input.sessions.browsers.count,
    video: input.video.recording.status,
    next: pickNextSteps(recordingActive),
  };
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
