import { CATALOG } from "../content/catalog.js";
import type { SessionSummary } from "../domain/sessions.js";
import { CHANNEL_TABLE_FIELDS } from "../domain/sessions.js";
import { chapterManifest, type VideoSidecarState } from "../domain/videoState.js";
import { table, type ToonValue } from "./toon.js";

export interface HomeInput {
  executablePath: string;
  cwd: string;
  upstreamVersion: string;
  sessions: SessionSummary;
  video: VideoSidecarState;
  home?: string;
}

export function homeModel(input: HomeInput): ToonValue {
  return {
    bin: collapseHome(input.executablePath, input.home),
    description: CATALOG.description,
    cwd: input.cwd,
    upstream: { package: "@playwright/cli", version: input.upstreamVersion },
    browsers: {
      count: input.sessions.browsers.count,
      ...(input.sessions.browsers.empty
        ? { empty: input.sessions.browsers.empty }
        : {}),
    },
    ...(input.sessions.browsers.rows.length > 0
      ? {
          browser_rows: table(
            ["id", "name", "status"],
            input.sessions.browsers.rows,
          ),
        }
      : {}),
    servers: {
      count: input.sessions.servers.count,
      ...(input.sessions.servers.empty
        ? { empty: input.sessions.servers.empty }
        : {}),
    },
    ...(input.sessions.servers.rows.length > 0
      ? {
          server_rows: table(
            ["title", "browser", "version", "dataDir", "workspace"],
            input.sessions.servers.rows,
          ),
        }
      : {}),
    channel_sessions: {
      count: input.sessions.channelSessions.count,
      ...(input.sessions.channelSessions.empty
        ? { empty: input.sessions.channelSessions.empty }
        : {}),
    },
    ...(input.sessions.channelSessions.rows.length > 0
      ? {
          channel_session_rows: table(
            CHANNEL_TABLE_FIELDS,
            input.sessions.channelSessions.rows,
          ),
        }
      : {}),
    video: {
      status: input.video.recording.status,
      source: "sidecar",
      recording: input.video.recording.status === "active",
      files: input.video.lastFiles.length,
      chapters: input.video.chapters.length,
      actions: input.video.actionsOverlay.status,
      ...(input.video.recording.requestedFile
        ? { requestedFile: input.video.recording.requestedFile }
        : {}),
      ...(input.video.recording.requestedSize
        ? { requestedSize: input.video.recording.requestedSize }
        : {}),
      ...(input.video.recording.startedAt
        ? { startedAt: input.video.recording.startedAt }
        : {}),
      ...(input.video.recording.stoppedAt
        ? { stoppedAt: input.video.recording.stoppedAt }
        : {}),
      ...(input.video.chapters.length > 0
        ? { chapter_rows: chapterManifest(input.video) }
        : {}),
      ...(input.video.lastFiles.length > 0
        ? { lastFiles: input.video.lastFiles.slice(-3) }
        : {}),
      ...(input.video.warnings.length > 0
        ? { warnings: input.video.warnings.slice(-3) }
        : {}),
    },
    next: [...CATALOG.next],
  };
}

function collapseHome(path: string, home: string | undefined): string {
  if (home && path === home) return "~";
  if (home && path.startsWith(`${home}/`))
    return `~/${path.slice(home.length + 1)}`;
  return path;
}
