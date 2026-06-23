import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { runCli } from './main.js';

import type { CliDependencies } from './main.js';
import type { UpstreamRun } from '../upstream/runner.js';

describe('runCli', () => {
  it('should print a content-first home view when invoked without arguments', async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: '{"browsers":[]}' }
    ]);

    // Act
    const result = await harness.run([]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns).toEqual([['list', '--all']]);
    expect(result.stdout).toContain('description: AXI-friendly Playwright browser control with TOON output and video state');
    expect(result.stdout).toContain(`cwd: ${harness.cwd}`);
    expect(result.stdout).toContain('version: 0.1.14');
    expect(result.stdout).toContain('browsers:\n  count: 0\n  empty: no open browsers');
    expect(result.stdout).toContain('video:\n  status: inactive\n  source: sidecar');
    expect(result.stdout).toContain('next[5]:');
    expect(result.stdout).not.toMatch(/Usage:/);
  });

  it('should format upstream list JSON as compact TOON with full list --all inventory', async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: '{"browsers":[],"servers":[{"title":"debug","browser":{"browserName":"chromium","userDataDir":"/tmp/profile"},"playwrightVersion":"1.2.3","workspaceDir":"/repo"}],"channelSessions":[{"channel":"chrome","userDataDir":"/tmp/chrome","extensionInstalled":false,"endpoint":"http://127.0.0.1:9222"}]}' }
    ]);

    // Act
    const result = await harness.run(['list', '--all', '--json']);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns).toEqual([['list', '--all']]);
    expect(result.stdout).toContain('command: list');
    expect(result.stdout).toContain('browsers:\n  count: 0\n  empty: no open browsers');
    expect(result.stdout).toContain('servers:\n  count: 1');
    expect(result.stdout).toContain('server_rows[1]{title,browser,version,dataDir,workspace}:');
    expect(result.stdout).toContain('debug,chromium,1.2.3,/tmp/profile,/repo');
    expect(result.stdout).toContain('channel_sessions:\n  count: 1');
    expect(result.stdout).toContain('chrome,/tmp/chrome,no,yes');
    expect(result.stdout).not.toContain('{"browsers"');
  });

  it('should preserve upstream close session status', async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: '{"session":"default","status":"not-open"}' }
    ]);

    // Act
    const result = await harness.run(['close']);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('command: close');
    expect(result.stdout).toContain('session: default');
    expect(result.stdout).toContain('close:\n  status: not-open');
    expect(result.stdout).not.toContain('no browsers were closed');
  });

  it('should format upstream close-all JSON as compact TOON with explicit empty state', async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: '{"closed":[]}' }
    ]);

    // Act
    const result = await harness.run(['close-all']);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('command: close-all');
    expect(result.stdout).toContain('closed:\n  count: 0\n  empty: no browsers were closed');
  });

  it('should turn upstream JSON browser-not-open errors into structured stdout help', async () => {
    // Arrange
    const harness = await createHarness([
      { exitCode: 1, stdout: '{"isError":true,"error":"The browser \'default\' is not open, please run open first"}', stderr: 'ignored dependency detail' }
    ]);

    // Act
    const result = await harness.run(['video-start']);

    // Assert
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('error:\n  kind: browser_not_open');
    expect(result.stdout).toContain('message: "The browser \'default\' is not open, please run open first"');
    expect(result.stdout).toContain('playwright-cli-axi open [url]');
    expect(result.stdout).not.toContain('ignored dependency detail');
  });

  it('should sanitize stderr-only missing-browser failures and suggest install-browser', async () => {
    // Arrange
    const harness = await createHarness([
      { exitCode: 1, stdout: '', stderr: 'Error: browserType.launch: Executable does not exist at /tmp/chrome-for-testing\n    at open (/dep/file.js:1:1)\nPlease run: playwright-cli install-browser chrome-for-testing' }
    ]);

    // Act
    const result = await harness.run(['open', '--browser=chromium']);

    // Assert
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('kind: missing_browser');
    expect(result.stdout).toContain('playwright-cli-axi install-browser chrome-for-testing');
    expect(result.stdout).not.toContain('at open');
    expect(result.stdout).not.toContain('playwright-cli install-browser');
  });

  it('should sanitize observed daemon Chrome-missing failures without stack snippets', async () => {
    // Arrange
    const harness = await createHarness([
      { exitCode: 1, stdout: '{"isError":true,"error":"/repo/node_modules/playwright-core/lib/tools/cli-client/session.js:165 const rejectWithPid = (reject, message) => reject(Object.assign(new Error(`Daemon pid=1: ${message}`), { daemonPid: child.pid })); ^ Error: Daemon pid=1: Daemon process exited with code 1 [PlaywrightError: Chromium distribution \'chrome\' is not found at /opt/google/chrome/chrome Run \\"npx playwright install chrome\\"]"}' }
    ]);

    // Act
    const result = await harness.run(['open', 'about:blank']);

    // Assert
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('kind: missing_browser');
    expect(result.stdout).toContain('playwright-cli-axi install-browser chrome-for-testing');
    expect(result.stdout).not.toContain('session.js');
    expect(result.stdout).not.toContain('Daemon pid');
    expect(result.stdout).not.toContain('npx playwright install chrome');
  });

  it('should validate video-start arguments before upstream and leave state unchanged on usage errors', async () => {
    // Arrange
    const harness = await createHarness([]);

    // Act
    const result = await harness.run(['video-start', 'a.webm', 'b.webm', '--size', 'wide']);

    // Assert
    expect(result.exitCode).toBe(2);
    expect(harness.upstreamRuns).toEqual([]);
    expect(result.stdout).toContain('kind: usage');
    expect(result.stdout).toContain('video-start accepts at most one filename');
  });

  it('should mark recording active after upstream video-start success', async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: 'Video recording started.' }
    ]);

    // Act
    const result = await harness.run(['video-start', './out.webm', '--size', '320x240']);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('command: video-start');
    expect(result.stdout).toContain('status: ok');
    expect(result.stdout).toContain('recording:\n  status: active\n  requestedFile: ./out.webm\n  requestedSize: 320x240');

    const state = await harness.readState();
    expect(state.recording.status).toBe('active');
    expect(state.recording.requestedFile).toBe('./out.webm');
    expect(state.recording.requestedSize).toBe('320x240');
  });

  it('should preserve session flags for video-start while excluding them from validation', async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: 'Video recording started.' }
    ]);

    // Act
    const result = await harness.run(['video-start', '--session', 'demo', './out.webm', '--size', '320x240']);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns).toEqual([['video-start', '--session', 'demo', './out.webm', '--size', '320x240']]);
    const state = await harness.readState();
    expect(state.scope.session).toBe('demo');
    expect(state.recording.requestedFile).toBe('./out.webm');
  });

  it('should not mark recording active unless video-start confirms recording started', async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: 'Command completed.' }
    ]);

    // Act
    const result = await harness.run(['video-start', './ambiguous.webm']);

    // Assert
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('video-start completed without confirming that recording started');
    expect(await harness.stateFiles()).toEqual([]);
  });

  it('should reject duplicate video-start without mutating the active recording state', async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: 'Video recording started.' }
    ]);
    await harness.run(['video-start', './first.webm']);

    // Act
    const result = await harness.run(['video-start', './second.webm']);

    // Assert
    expect(result.exitCode).toBe(2);
    expect(harness.upstreamRuns).toEqual([['video-start', './first.webm']]);
    expect(result.stdout).toContain('kind: already_recording');
    expect(result.stdout).toContain('video recording is already active; run video-stop first');
    const state = await harness.readState();
    expect(state.recording.status).toBe('active');
    expect(state.recording.requestedFile).toBe('./first.webm');
  });

  it('should record video files and set inactive after video-stop links', async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: 'Video recording started.' },
      { stdout: '- [Video](./out.webm)\n- [Trace](./trace.zip)' }
    ]);
    await harness.run(['video-start', './out.webm']);

    // Act
    const result = await harness.run(['video-stop']);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('command: video-stop');
    expect(result.stdout).toContain('files:\n  count: 2');
    expect(result.stdout).toContain('videos:\n  count: 1');
    expect(result.stdout).toContain('video_files[1]:\n  - ./out.webm');
    expect(result.stdout).toContain('other_artifacts:\n  count: 1');
    expect(result.stdout).toContain('other_artifact_files[1]:\n  - ./trace.zip');

    const state = await harness.readState();
    expect(state.recording.status).toBe('inactive');
    expect(state.lastFiles).toEqual(['./out.webm', './trace.zip']);
  });

  it('should record an explicit no-files state when video-stop reports no recordings', async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: 'Video recording started.' },
      { stdout: 'No videos were recorded.' }
    ]);
    await harness.run(['video-start', './empty.webm']);

    // Act
    const result = await harness.run(['video-stop']);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('empty: upstream reported no videos were recorded');
    const state = await harness.readState();
    expect(state.recording.status).toBe('inactive');
    expect(state.lastFiles).toEqual([]);
  });

  it('should show and persist stale video state on home when sidecar is active but no live browser exists', async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: 'Video recording started.' },
      { stdout: '{"browsers":[]}' }
    ]);
    await harness.run(['video-start', './live.webm']);

    // Act
    const result = await harness.run([]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('video:\n  status: stale');
    expect(result.stdout).toContain('active recording sidecar has no live browser in list --all');
    const state = await harness.readState();
    expect(state.recording.status).toBe('stale');
  });

  it('should update chapter and action overlay state only after successful video commands', async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: 'Actions shown.' },
      { stdout: 'Chapter added.' },
      { stdout: 'Actions hidden.' }
    ]);

    // Act
    const shown = await harness.run(['video-show-actions', '--duration', '100', '--position', 'top-right', '--cursor', 'pointer']);
    const chapter = await harness.run(['video-chapter', 'Smoke', '--description', 'AXI smoke', '--duration', '50']);
    const hidden = await harness.run(['video-hide-actions']);

    // Assert
    expect(shown.exitCode).toBe(0);
    expect(chapter.exitCode).toBe(0);
    expect(hidden.exitCode).toBe(0);
    const state = await harness.readState();
    expect(state.actionsOverlay.status).toBe('disabled');
    expect(state.chapters).toMatchObject([{ title: 'Smoke', description: 'AXI smoke', duration: 50 }]);
  });

  it('should reject invalid video-show-actions enums before upstream', async () => {
    // Arrange
    const harness = await createHarness([]);

    // Act
    const result = await harness.run(['video-show-actions', '--position', 'left-ish', '--cursor', 'hand']);

    // Assert
    expect(result.exitCode).toBe(2);
    expect(harness.upstreamRuns).toEqual([]);
    expect(result.stdout).toContain('position must be one of top-left, top, top-right, bottom-left, bottom, bottom-right');
  });

  it('should warn and mark recording abandoned after successful close while recording', async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: 'Video recording started.' },
      { stdout: '{"closed":[]}' }
    ]);
    await harness.run(['video-start', './lost.webm']);

    // Act
    const result = await harness.run(['close-all']);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('warnings[1]:\n  - Recording was active before close-all; video may be lost because video-stop was not run');
    const state = await harness.readState();
    expect(state.recording.status).toBe('abandoned');
  });

  it('should have close-all warn and abandon active recordings from named session sidecars', async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: 'Video recording started.' },
      { stdout: '{"closed":[]}' }
    ]);
    await harness.run(['video-start', '--session', 'demo', './lost.webm']);

    // Act
    const result = await harness.run(['close-all']);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Recording was active for session demo before close-all; video may be lost because video-stop was not run');
    const state = await harness.readState();
    expect(state.scope.session).toBe('demo');
    expect(state.recording.status).toBe('abandoned');
  });

  it('should render root help with a whole-surface command matrix', async () => {
    // Arrange
    const harness = await createHarness([]);

    // Act
    const result = await harness.run(['--help']);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('command_groups[');
    expect(result.stdout).toContain('Storage');
    expect(result.stdout).toContain('cookie-list');
    expect(result.stdout).toContain('Network');
    expect(result.stdout).toContain('route-list');
    expect(result.stdout).toContain('Video');
    expect(result.stdout).toContain('video-start');
  });

  it('should render concise structured help for video commands', async () => {
    // Arrange
    const harness = await createHarness([]);

    // Act
    const result = await harness.run(['video-show-actions', '--help']);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('command: video-show-actions');
    expect(result.stdout).toContain('flags[3]{name,value,default,description}:');
    expect(result.stdout).toContain('--position,top-left|top|top-right|bottom-left|bottom|bottom-right,top-right');
    expect(result.stdout).toContain('--cursor,pointer|none,pointer');
    expect(result.stdout).toContain('examples[2]:');
  });

  it('should forward unknown subcommand help to upstream and structure the text preview', async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: 'playwright-cli install-browser [browser]\n\nInstall browser\n\nArguments:\n  [browser] chrome-for-testing' }
    ]);

    // Act
    const result = await harness.run(['install-browser', '--help']);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns).toEqual([['install-browser', '--help']]);
    expect(result.stdout).toContain('command: install-browser');
    expect(result.stdout).toContain('source: @playwright/cli');
    expect(result.stdout).toContain('lines[4]:');
    expect(result.stdout).toContain('playwright-cli install-browser [browser]');
    expect(result.stdout).not.toContain('video_commands');
  });
});

interface FakeRun {
  exitCode?: number;
  stdout: string;
  stderr?: string;
}

async function createHarness(fakeRuns: FakeRun[]) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'playwright-cli-axi-test-'));
  const cwd = join(stateRoot, 'workspace');
  const upstreamRuns: string[][] = [];
  const deps: CliDependencies = {
    cwd,
    executablePath: '/home/will/.local/bin/playwright-cli-axi',
    env: { XDG_STATE_HOME: join(stateRoot, 'state'), HOME: '/home/will' },
    now: () => new Date('2026-06-22T12:00:00.000Z'),
    upstreamVersion: '0.1.14',
    upstream: async (argv): Promise<UpstreamRun> => {
      upstreamRuns.push(argv);
      const next = fakeRuns.shift();
      if (!next) throw new Error(`unexpected upstream call: ${argv.join(' ')}`);
      return {
        argv,
        exitCode: next.exitCode ?? 0,
        stdout: next.stdout,
        stderr: next.stderr ?? '',
        usedJson: true
      };
    }
  };

  return {
    cwd,
    upstreamRuns,
    run: (argv: string[]) => runCli(argv, deps),
    async stateFiles() {
      try {
        return await readdir(join(stateRoot, 'state', 'playwright-cli-axi'));
      } catch {
        return [];
      }
    },
    async readState() {
      const files = await this.stateFiles();
      const statePath = join(stateRoot, 'state', 'playwright-cli-axi', files[0]!);
      return JSON.parse(await readFile(statePath, 'utf8'));
    }
  };
}
