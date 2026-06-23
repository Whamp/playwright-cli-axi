import { CATALOG } from '../content/catalog.js';
import type { SessionSummary } from '../domain/sessions.js';
import type { VideoSidecarState } from '../domain/videoState.js';
import { table, type ToonValue } from './toon.js';

export interface HomeInput {
  executablePath: string;
  cwd: string;
  upstreamVersion: string;
  sessions: SessionSummary;
  video: VideoSidecarState;
}

export function homeModel(input: HomeInput): ToonValue {
  return {
    bin: collapseHome(input.executablePath),
    description: CATALOG.description,
    cwd: input.cwd,
    upstream: { package: '@playwright/cli', version: input.upstreamVersion },
    browsers: {
      count: input.sessions.browsers.count,
      ...(input.sessions.browsers.empty ? { empty: input.sessions.browsers.empty } : {})
    },
    ...(input.sessions.browsers.rows.length > 0
      ? { browser_rows: table(['id', 'name', 'status'], input.sessions.browsers.rows) }
      : {}),
    video: {
      status: input.video.recording.status,
      source: 'sidecar',
      recording: input.video.recording.status === 'active',
      files: input.video.lastFiles.length,
      chapters: input.video.chapters.length,
      actions: input.video.actionsOverlay.status,
      ...(input.video.warnings.length > 0 ? { warnings: input.video.warnings.slice(-3) } : {})
    },
    next: [...CATALOG.next]
  };
}

function collapseHome(path: string): string {
  const home = process.env.HOME;
  if (home && path === home) return '~';
  if (home && path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  return path;
}
