import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export type RecordingStatus = 'active' | 'inactive' | 'unknown' | 'stale' | 'abandoned';

export interface VideoSidecarState {
  schemaVersion: 1;
  scope: { cwd: string; key: string; session: string };
  recording: {
    status: RecordingStatus;
    requestedFile?: string;
    requestedSize?: string;
    startedAt?: string;
    stoppedAt?: string;
  };
  actionsOverlay: { status: 'enabled' | 'disabled' | 'unknown'; updatedAt?: string };
  chapters: { title: string; description?: string; duration?: number; createdAt: string }[];
  lastFiles: string[];
  lastResult?: string;
  lastError?: string;
  warnings: string[];
}

export interface VideoStateRecord {
  path: string;
  state: VideoSidecarState;
}

export interface VideoStore {
  load(): Promise<VideoSidecarState>;
  loadAllForCwd(): Promise<VideoStateRecord[]>;
  save(state: VideoSidecarState): Promise<void>;
  path: string;
}

export interface VideoStoreOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  now: () => Date;
  session?: string;
}

export function createVideoStore(options: VideoStoreOptions): VideoStore {
  const session = options.session ?? 'default';
  const key = createScopeKey(options.cwd, session);
  const directory = join(stateHome(options.env), 'playwright-cli-axi');
  const path = statePath(directory, key);

  return {
    path,
    async load() {
      try {
        const text = await readFile(path, 'utf8');
        return mergeState(JSON.parse(text) as Partial<VideoSidecarState>, options.cwd, key, session);
      } catch {
        return defaultVideoState(options.cwd, key, session);
      }
    },
    async loadAllForCwd() {
      let entries: string[];
      try {
        entries = await readdir(directory);
      } catch {
        return [];
      }

      const records: VideoStateRecord[] = [];
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        const fileKey = entry.slice(0, -'.json'.length);
        if (!/^[a-f0-9]{16}$/.test(fileKey)) continue;
        const recordPath = join(directory, entry);
        try {
          const raw = JSON.parse(await readFile(recordPath, 'utf8')) as Partial<VideoSidecarState>;
          const scope = isScope(raw.scope) ? raw.scope : undefined;
          if (!scope || scope.cwd !== options.cwd) continue;
          records.push({ path: recordPath, state: mergeState(raw, options.cwd, fileKey, scope.session) });
        } catch {
          // Ignore corrupt or concurrently replaced sidecars; the current command should still preserve upstream behavior.
        }
      }
      return records;
    },
    async save(state) {
      const targetPath = statePath(directory, state.scope.key || key);
      await writeState(targetPath, state);
    }
  };
}

export function defaultVideoState(cwd: string, key: string, session: string): VideoSidecarState {
  return {
    schemaVersion: 1,
    scope: { cwd, key, session },
    recording: { status: 'inactive' },
    actionsOverlay: { status: 'unknown' },
    chapters: [],
    lastFiles: [],
    warnings: []
  };
}

export function reconcileVideoState(state: VideoSidecarState, live: { browserCount: number }): VideoSidecarState {
  if (state.recording.status !== 'active' || live.browserCount > 0) return state;
  const warning = 'active recording sidecar has no live browser in list --all; state may be stale';
  return {
    ...state,
    recording: { ...state.recording, status: 'stale' },
    warnings: state.warnings.includes(warning) ? state.warnings : [...state.warnings, warning]
  };
}

function mergeState(state: Partial<VideoSidecarState>, cwd: string, key: string, session: string): VideoSidecarState {
  return {
    ...defaultVideoState(cwd, key, session),
    ...state,
    schemaVersion: 1,
    scope: { cwd, key, session },
    recording: { status: 'inactive', ...state.recording },
    actionsOverlay: { status: 'unknown', ...state.actionsOverlay },
    chapters: Array.isArray(state.chapters) ? state.chapters : [],
    lastFiles: Array.isArray(state.lastFiles) ? state.lastFiles : [],
    warnings: Array.isArray(state.warnings) ? state.warnings : []
  };
}

function createScopeKey(cwd: string, session: string): string {
  return createHash('sha256').update(`${cwd}\0${session}`).digest('hex').slice(0, 16);
}

function stateHome(env: Record<string, string | undefined>): string {
  return env.XDG_STATE_HOME && env.XDG_STATE_HOME.length > 0 ? env.XDG_STATE_HOME : join(homedir(), '.local', 'state');
}

function statePath(directory: string, key: string): string {
  return join(directory, `${key}.json`);
}

async function writeState(path: string, state: VideoSidecarState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(tempPath, path);
}

function isScope(value: unknown): value is VideoSidecarState['scope'] {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { cwd?: unknown }).cwd === 'string'
    && typeof (value as { key?: unknown }).key === 'string'
    && typeof (value as { session?: unknown }).session === 'string';
}
