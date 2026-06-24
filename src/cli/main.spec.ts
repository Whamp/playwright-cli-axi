import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  CLOSE_LIKE_COMMANDS,
  COMMAND_GROUPS,
  commandMatrixRows,
} from "../domain/upstreamCommands.js";

import {
  createVideoStore,
  type VideoSidecarState,
} from "../domain/videoState.js";
import type { UpstreamRun } from "../upstream/runner.js";
import type { CliDependencies } from "./main.js";
import { runCli } from "./main.js";

describe("runCli", () => {
  it("should print a content-first home view when invoked without arguments", async () => {
    // Arrange
    const harness = await createHarness([{ stdout: '{"browsers":[]}' }]);

    // Act
    const result = await harness.run([]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns).toEqual([["list", "--all"]]);
    expect(result.stdout).toContain(
      "description: AXI-friendly Playwright browser control with TOON output and video state",
    );
    expect(result.stdout).toContain(`cwd: ${harness.cwd}`);
    expect(result.stdout).toContain("version: 0.1.14");
    expect(result.stdout).toContain(
      "browsers:\n  count: 0\n  empty: no open browsers",
    );
    expect(result.stdout).toContain(
      "video:\n  status: inactive\n  source: sidecar",
    );
    expect(result.stdout).toContain("next[5]:");
    expect(result.stdout).not.toMatch(/Usage:/);
  });

  it("should print a clean structured version for --version and -v without calling upstream", async () => {
    // Arrange
    const harness = await createHarness([]);

    // Act
    const longResult = await harness.run(["--version"]);
    const shortResult = await harness.run(["-v"]);

    // Assert
    expect(longResult.exitCode).toBe(0);
    expect(shortResult.exitCode).toBe(0);
    expect(harness.upstreamRuns).toEqual([]);
    for (const result of [longResult, shortResult]) {
      expect(result.stdout).toContain("command: playwright-cli-axi");
      expect(result.stdout).toContain("version: 0.1.0");
      expect(result.stdout).toContain("upstream:");
      expect(result.stdout).toContain("package: @playwright/cli");
      expect(result.stdout).toContain("version: 0.1.14");
      // must NOT be the old awkward generic-command wrap
      expect(result.stdout).not.toContain("command: --version");
      expect(result.stdout).not.toContain("output: 0.1.14");
    }
  });

  it("should pass --version through to upstream when a command resolves", async () => {
    // Arrange
    const harness = await createHarness([{ stdout: "ok" }]);

    // Act
    const result = await harness.run(["list", "--version"]);

    // Assert: not intercepted; forwarded to upstream unchanged
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns).toEqual([["list", "--version"]]);
  });

  it("should format upstream list JSON as compact TOON with full list --all inventory", async () => {
    // Arrange
    const harness = await createHarness([
      {
        stdout:
          '{"browsers":[],"servers":[{"title":"debug","browser":{"browserName":"chromium","userDataDir":"/tmp/profile"},"playwrightVersion":"1.2.3","workspaceDir":"/repo"}],"channelSessions":[{"channel":"chrome","userDataDir":"/tmp/chrome","extensionInstalled":false,"endpoint":"http://127.0.0.1:9222"}]}',
      },
    ]);

    // Act
    const result = await harness.run(["list", "--all", "--json"]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns).toEqual([["list", "--all"]]);
    expect(result.stdout).toContain("command: list");
    expect(result.stdout).toContain(
      "browsers:\n  count: 0\n  empty: no open browsers",
    );
    expect(result.stdout).toContain("servers:\n  count: 1");
    expect(result.stdout).toContain(
      "server_rows[1]{title,browser,version,dataDir,workspace}:",
    );
    expect(result.stdout).toContain("debug,chromium,1.2.3,/tmp/profile,/repo");
    expect(result.stdout).toContain("channel_sessions:\n  count: 1");
    expect(result.stdout).toContain("chrome,/tmp/chrome,no,yes");
    expect(result.stdout).not.toContain('{"browsers"');
  });

  it("should preserve upstream close session status", async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: '{"session":"default","status":"not-open"}' },
    ]);

    // Act
    const result = await harness.run(["close"]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("command: close");
    expect(result.stdout).toContain("session: default");
    expect(result.stdout).toContain("close:\n  status: not-open");
    expect(result.stdout).not.toContain("no browsers were closed");
  });

  it("should format upstream close-all JSON as compact TOON with explicit empty state", async () => {
    // Arrange
    const harness = await createHarness([{ stdout: '{"closed":[]}' }]);

    // Act
    const result = await harness.run(["close-all"]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("command: close-all");
    expect(result.stdout).toContain(
      "closed:\n  count: 0\n  empty: no browsers were closed",
    );
  });

  it("should turn upstream JSON browser-not-open errors into structured stdout help", async () => {
    // Arrange
    const harness = await createHarness([
      {
        exitCode: 1,
        stdout:
          '{"isError":true,"error":"The browser \'default\' is not open, please run open first"}',
        stderr: "ignored dependency detail",
      },
    ]);

    // Act
    const result = await harness.run(["video-start"]);

    // Assert
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("error:\n  kind: browser_not_open");
    expect(result.stdout).toContain(
      "message: \"The browser 'default' is not open, please run open first\"",
    );
    expect(result.stdout).toContain("playwright-cli-axi open [url]");
    expect(result.stdout).not.toContain("ignored dependency detail");
  });

  it("should sanitize stderr-only missing-browser failures and suggest install-browser", async () => {
    // Arrange
    const harness = await createHarness([
      {
        exitCode: 1,
        stdout: "",
        stderr:
          "Error: browserType.launch: Executable does not exist at /tmp/chrome-for-testing\n    at open (/dep/file.js:1:1)\nPlease run: playwright-cli install-browser chrome-for-testing",
      },
    ]);

    // Act
    const result = await harness.run(["open", "--browser=chromium"]);

    // Assert
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("kind: missing_browser");
    expect(result.stdout).toContain(
      "playwright-cli-axi install-browser chrome-for-testing",
    );
    expect(result.stdout).not.toContain("at open");
    expect(result.stdout).not.toContain("playwright-cli install-browser");
  });

  it("should sanitize observed daemon Chrome-missing failures without stack snippets", async () => {
    // Arrange
    const harness = await createHarness([
      {
        exitCode: 1,
        stdout:
          '{"isError":true,"error":"/repo/node_modules/playwright-core/lib/tools/cli-client/session.js:165 const rejectWithPid = (reject, message) => reject(Object.assign(new Error(`Daemon pid=1: ${message}`), { daemonPid: child.pid })); ^ Error: Daemon pid=1: Daemon process exited with code 1 [PlaywrightError: Chromium distribution \'chrome\' is not found at /opt/google/chrome/chrome Run \\"npx playwright install chrome\\"]"}',
      },
    ]);

    // Act
    const result = await harness.run(["open", "about:blank"]);

    // Assert
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("kind: missing_browser");
    expect(result.stdout).toContain(
      "playwright-cli-axi install-browser chrome-for-testing",
    );
    expect(result.stdout).not.toContain("session.js");
    expect(result.stdout).not.toContain("Daemon pid");
    expect(result.stdout).not.toContain("npx playwright install chrome");
  });

  it("should validate video-start arguments before upstream and leave state unchanged on usage errors", async () => {
    // Arrange
    const harness = await createHarness([]);

    // Act
    const result = await harness.run([
      "video-start",
      "a.webm",
      "b.webm",
      "--size",
      "wide",
    ]);

    // Assert
    expect(result.exitCode).toBe(2);
    expect(harness.upstreamRuns).toEqual([]);
    expect(result.stdout).toContain("kind: usage");
    expect(result.stdout).toContain("video-start accepts at most one filename");
  });

  it("should mark recording active after upstream video-start success", async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: "Video recording started." },
    ]);

    // Act
    const result = await harness.run([
      "video-start",
      "./out.webm",
      "--size",
      "320x240",
    ]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("command: video-start");
    expect(result.stdout).toContain("status: ok");
    expect(result.stdout).toContain(
      "recording:\n  status: active\n  requestedFile: ./out.webm\n  requestedSize: 320x240",
    );

    const state = await harness.readState();
    expect(state.recording.status).toBe("active");
    expect(state.recording.requestedFile).toBe("./out.webm");
    expect(state.recording.requestedSize).toBe("320x240");
  });

  it("strips wrapper-only flags before forwarding video commands to upstream (F2)", async () => {
    const harness = await createHarness([
      { stdout: "Video recording started." },
    ]);
    const result = await harness.run([
      "video-start",
      "--full",
      "--fields",
      "id",
      "./out.webm",
    ]);
    expect(result.exitCode).toBe(0);
    // Wrapper-only flags never reach the (injected) upstream runner from video.
    expect(harness.upstreamRuns[0]).toEqual(["video-start", "./out.webm"]);
  });

  it("routes `context` to a compact session-start slice via list --all (O9)", async () => {
    const harness = await createHarness([
      { stdout: '{"browsers":[{"id":1}]}' },
    ]);
    const result = await harness.run(["context"]);
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns).toEqual([["list", "--all"]]);
    expect(result.stdout).toContain("tool: playwright-cli-axi");
    expect(result.stdout).toContain("browsers: 1");
    // Context is a minimal slice, not the full home command matrix.
    expect(result.stdout).not.toContain("command_groups");
  });

  it("strips --full/--fields before forwarding generic commands and bounds results (O9)", async () => {
    const big = { snapshot: "x".repeat(3000) };
    const harness = await createHarness([{ stdout: JSON.stringify(big) }]);
    const result = await harness.run([
      "config-print",
      "--full",
      "--fields",
      "id",
    ]);
    expect(result.exitCode).toBe(0);
    // Wrapper flags stripped before the upstream spawn.
    expect(harness.upstreamRuns[0]).toEqual(["config-print"]);
    // --full bypasses truncation: the full snapshot is present, no truncation marker.
    expect(result.stdout).toContain("snapshot:");
    expect(result.stdout).not.toContain("result_truncated");
  });

  it("routes `setup` with injected deps and does not touch the real home (O9)", async () => {
    const stateRoot = await mkdtemp(
      join(tmpdir(), "playwright-cli-axi-setup-"),
    );
    const files = new Map<string, string>();
    const result = await runCli(["setup", "--scope", "project"], {
      cwd: join(stateRoot, "repo"),
      executablePath: "/opt/pca",
      env: { XDG_STATE_HOME: join(stateRoot, "state"), HOME: stateRoot },
      wrapperVersion: "0.1.0",
      upstreamVersion: "0.1.14",
      setupDeps: {
        which: () => undefined,
        readFile: (p) => files.get(p),
        writeFile: (p, c) => {
          files.set(p, c);
        },
        exists: (p) => files.has(p),
        realpath: (p) => p,
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("command: setup");
    expect(result.stdout).toContain("status: ok");
    // Wrote into the injected map, not the real ~/.claude.
    expect(Array.from(files.keys()).some((p) => p.includes(".claude"))).toBe(
      true,
    );
  });

  it("should preserve session flags for video-start while excluding them from validation", async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: "Video recording started." },
    ]);

    // Act
    const result = await harness.run([
      "video-start",
      "--session",
      "demo",
      "./out.webm",
      "--size",
      "320x240",
    ]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns).toEqual([
      ["video-start", "--session", "demo", "./out.webm", "--size", "320x240"],
    ]);
    const state = await harness.readState();
    expect(state.scope.session).toBe("demo");
    expect(state.recording.requestedFile).toBe("./out.webm");
  });

  it("should not mark recording active unless video-start confirms recording started", async () => {
    // Arrange
    const harness = await createHarness([{ stdout: "Command completed." }]);

    // Act
    const result = await harness.run(["video-start", "./ambiguous.webm"]);

    // Assert
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "video-start completed without confirming that recording started",
    );
    expect(await harness.stateFiles()).toEqual([]);
  });

  it("should treat duplicate video-start with the same target as an idempotent exit-0 no-op", async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: "Video recording started." },
    ]);
    await harness.run(["video-start", "./first.webm"]);

    // Act: same target (file present, matches active)
    const result = await harness.run(["video-start", "./first.webm"]);

    // Assert: exit 0, no upstream call, active recording preserved and echoed
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns).toEqual([["video-start", "./first.webm"]]);
    expect(result.stdout).toContain("status: ok");
    expect(result.stdout).toContain("note: recording already active; no-op");
    expect(result.stdout).toContain("requestedFile: ./first.webm");
    const state = await harness.readState();
    expect(state.recording.status).toBe("active");
    expect(state.recording.requestedFile).toBe("./first.webm");
  });

  it("should treat duplicate video-start with no target as an idempotent exit-0 no-op", async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: "Video recording started." },
    ]);
    await harness.run(["video-start", "./rec.webm", "--size", "320x240"]);

    // Act: no positional/size -> not requesting a change -> idempotent
    const result = await harness.run(["video-start"]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns).toEqual([
      ["video-start", "./rec.webm", "--size", "320x240"],
    ]);
    expect(result.stdout).toContain("note: recording already active; no-op");
    const state = await harness.readState();
    expect(state.recording.status).toBe("active");
    expect(state.recording.requestedFile).toBe("./rec.webm");
  });

  it("should reject video-start with a conflicting target as an exit-2 already_recording error", async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: "Video recording started." },
    ]);
    await harness.run(["video-start", "./first.webm"]);

    // Act: different file -> genuine conflict
    const result = await harness.run(["video-start", "./second.webm"]);

    // Assert
    expect(result.exitCode).toBe(2);
    expect(harness.upstreamRuns).toEqual([["video-start", "./first.webm"]]);
    expect(result.stdout).toContain("kind: already_recording");
    expect(result.stdout).toContain(
      "recording is already active (file ./first.webm); run video-stop before starting a recording to file ./second.webm",
    );
    const state = await harness.readState();
    expect(state.recording.status).toBe("active");
    expect(state.recording.requestedFile).toBe("./first.webm");
  });

  it("should record video files and set inactive after video-stop links", async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: "Video recording started." },
      { stdout: "- [Video](./out.webm)\n- [Trace](./trace.zip)" },
    ]);
    await harness.run(["video-start", "./out.webm"]);

    // Act
    const result = await harness.run(["video-stop"]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("command: video-stop");
    expect(result.stdout).toContain("files:\n  count: 2");
    expect(result.stdout).toContain("videos:\n  count: 1");
    expect(result.stdout).toContain("video_files[1]:\n  - ./out.webm");
    expect(result.stdout).toContain("other_artifacts:\n  count: 1");
    expect(result.stdout).toContain(
      "other_artifact_files[1]:\n  - ./trace.zip",
    );

    const state = await harness.readState();
    expect(state.recording.status).toBe("inactive");
    expect(state.lastFiles).toEqual(["./out.webm", "./trace.zip"]);
  });

  it("should preserve labeled video artifact classification after video-stop", async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: "Video recording started." },
      { stdout: "- [Video](./archive.zip)\n- [Trace](./movie.webm)" },
    ]);
    await harness.run(["video-start", "./movie.webm"]);

    // Act
    const result = await harness.run(["video-stop"]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("videos:\n  count: 2");
    expect(result.stdout).toContain(
      "video_files[2]:\n  - ./archive.zip\n  - ./movie.webm",
    );
    expect(result.stdout).toContain("other_artifacts:\n  count: 0");
    const state = await harness.readState();
    expect(state.lastFiles).toEqual(["./archive.zip", "./movie.webm"]);
  });

  it("should record an explicit no-files state when video-stop reports no recordings", async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: "Video recording started." },
      { stdout: "No videos were recorded." },
    ]);
    await harness.run(["video-start", "./empty.webm"]);

    // Act
    const result = await harness.run(["video-stop"]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "empty: upstream reported no videos were recorded",
    );
    const state = await harness.readState();
    expect(state.recording.status).toBe("inactive");
    expect(state.lastFiles).toEqual([]);
  });

  it("should show and persist stale video state on home when sidecar is active but no live browser exists", async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: "Video recording started." },
      { stdout: '{"browsers":[]}' },
    ]);
    await harness.run(["video-start", "./live.webm"]);

    // Act
    const result = await harness.run([]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("video:\n  status: stale");
    expect(result.stdout).toContain(
      "active recording sidecar has no live browser in list --all",
    );
    const state = await harness.readState();
    expect(state.recording.status).toBe("stale");
  });

  it("should update chapter and action overlay state only after successful video commands", async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: "Actions shown." },
      { stdout: "Chapter added." },
      { stdout: "Actions hidden." },
    ]);

    // Act
    const shown = await harness.run([
      "video-show-actions",
      "--duration",
      "100",
      "--position",
      "top-right",
      "--cursor",
      "pointer",
    ]);
    const chapter = await harness.run([
      "video-chapter",
      "Smoke",
      "--description",
      "AXI smoke",
      "--duration",
      "50",
    ]);
    const hidden = await harness.run(["video-hide-actions"]);

    // Assert
    expect(shown.exitCode).toBe(0);
    expect(chapter.exitCode).toBe(0);
    expect(hidden.exitCode).toBe(0);
    const state = await harness.readState();
    expect(state.actionsOverlay.status).toBe("disabled");
    expect(state.chapters).toMatchObject([
      { title: "Smoke", description: "AXI smoke", duration: 50 },
    ]);
  });

  it("should reject invalid video-show-actions enums before upstream", async () => {
    // Arrange
    const harness = await createHarness([]);

    // Act
    const result = await harness.run([
      "video-show-actions",
      "--position",
      "left-ish",
      "--cursor",
      "hand",
    ]);

    // Assert
    expect(result.exitCode).toBe(2);
    expect(harness.upstreamRuns).toEqual([]);
    expect(result.stdout).toContain(
      "position must be one of top-left, top, top-right, bottom-left, bottom, bottom-right",
    );
  });

  for (const command of CLOSE_LIKE_COMMANDS) {
    it(`should warn and mark recording abandoned after successful ${command} while recording`, async () => {
      // Arrange
      const upstreamOutput = {
        close: '{"session":"default","status":"closed"}',
        detach: '{"session":"default","status":"detached"}',
        "close-all": '{"closed":[]}',
        "kill-all": '{"killed":0,"pids":[]}',
        "delete-data": '{"session":"default","deleted":true}',
      }[command];
      const harness = await createHarness([
        { stdout: "Video recording started." },
        { stdout: upstreamOutput },
      ]);
      await harness.run(["video-start", "./lost.webm"]);

      // Act
      const result = await harness.run([command]);

      // Assert
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        `warnings[1]:\n  - Recording was active before ${command}; video may be lost because video-stop was not run`,
      );
      const state = await harness.readState();
      expect(state.recording.status).toBe("abandoned");
    });
  }

  it("should have close-all warn and abandon active recordings from named session sidecars", async () => {
    // Arrange
    const harness = await createHarness([
      { stdout: "Video recording started." },
      { stdout: '{"closed":[]}' },
    ]);
    await harness.run(["video-start", "--session", "demo", "./lost.webm"]);

    // Act
    const result = await harness.run(["close-all"]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Recording was active for session demo before close-all; video may be lost because video-stop was not run",
    );
    const state = await harness.readState();
    expect(state.scope.session).toBe("demo");
    expect(state.recording.status).toBe("abandoned");
  });

  for (const command of ["close", "delete-data"]) {
    it(`should not abandon recordings in other sessions after session-scoped ${command}`, async () => {
      // Arrange: a recording active in the "other" session; run the
      // session-scoped command against the default session.
      const upstreamOutput =
        command === "close"
          ? '{"session":"default","status":"closed"}'
          : '{"session":"default","deleted":true}';
      const harness = await createHarness([
        { stdout: "Video recording started." },
        { stdout: upstreamOutput },
      ]);
      await harness.run(["video-start", "--session", "other", "./lost.webm"]);

      // Act
      const result = await harness.run([command]);

      // Assert
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("warnings[");
      const states = await harness.readStates();
      const other = states.find((state) => state.scope.session === "other");
      expect(other?.recording.status).toBe("active");
    });
  }

  it("should abandon active recordings across every working directory after kill-all", async () => {
    // Arrange: a recording active in a different working directory that shares
    // the wrapper state directory. kill-all is global because upstream
    // killAllDaemons() SIGKILLs daemon processes regardless of cwd.
    const harness = await createHarness([{ stdout: '{"killed":0,"pids":[]}' }]);
    const stateRoot = dirname(harness.cwd);
    const otherStore = createVideoStore({
      cwd: join(stateRoot, "other-workspace"),
      env: {
        XDG_STATE_HOME: join(stateRoot, "state"),
        HOME: "/home/will",
      },
      now: () => new Date("2026-06-22T12:00:00.000Z"),
      session: "remote",
    });
    const base = await otherStore.load();
    await otherStore.save({
      ...base,
      recording: {
        ...base.recording,
        status: "active",
        requestedFile: "./other.webm",
      },
    });

    // Act
    const result = await harness.run(["kill-all"]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Recording was active for session remote before kill-all; video may be lost because video-stop was not run",
    );
    const after = await otherStore.load();
    expect(after.recording.status).toBe("abandoned");
  });

  it("should render root help with a whole-surface command matrix", async () => {
    // Arrange
    const harness = await createHarness([]);

    // Act
    const result = await harness.run(["--help"]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "command_groups[12]{group,commands,summary}:",
    );
    for (const row of commandMatrixRows()) {
      expect(result.stdout).toContain(row.group);
      expect(result.stdout).toContain(row.commands);
      expect(result.stdout).toContain(row.summary);
    }
    // every command in every group is rendered in the joined-commands cell
    for (const group of COMMAND_GROUPS) {
      for (const command of group.commands) {
        expect(result.stdout).toContain(command);
      }
    }
  });

  it("should render concise structured help for video commands", async () => {
    // Arrange
    const harness = await createHarness([]);

    // Act
    const result = await harness.run(["video-show-actions", "--help"]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("command: video-show-actions");
    expect(result.stdout).toContain(
      "flags[3]{name,value,default,description}:",
    );
    expect(result.stdout).toContain(
      "--position,top-left|top|top-right|bottom-left|bottom|bottom-right,top-right",
    );
    expect(result.stdout).toContain("--cursor,pointer|none,pointer");
    expect(result.stdout).toContain("examples[2]:");
  });

  it("should forward unknown subcommand help to upstream and structure the text preview", async () => {
    // Arrange
    const harness = await createHarness([
      {
        stdout:
          "playwright-cli install-browser [browser]\n\nInstall browser\n\nArguments:\n  [browser] chrome-for-testing",
      },
    ]);

    // Act
    const result = await harness.run(["install-browser", "--help"]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns).toEqual([["install-browser", "--help"]]);
    expect(result.stdout).toContain("command: install-browser");
    expect(result.stdout).toContain("source: @playwright/cli");
    expect(result.stdout).toContain("lines[4]:");
    expect(result.stdout).toContain("playwright-cli install-browser [browser]");
    expect(result.stdout).not.toContain("video_commands");
  });

  it("F-1: 'help <command>' is an alias for <command> --help", async () => {
    const harness = await createHarness([
      {
        stdout:
          "playwright-cli screenshot [target]\n\nscreenshot of the current page or element\n\nOptions:\n  --filename",
      },
    ]);
    const result = await harness.run(["help", "screenshot"]);
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns).toEqual([["screenshot", "--help"]]);
    expect(result.stdout).toContain("command: screenshot");
  });

  it("F-1: root --help advertises the per-command --help path", async () => {
    const harness = await createHarness([]);
    const result = await harness.run(["--help"]);
    expect(result.stdout).toContain("<command> --help");
    expect(result.stdout).toContain("help <command>");
  });

  it("P-4: scroll --to <ref> forwards a scrollIntoView eval", async () => {
    const harness = await createHarness([{ stdout: "" }]);
    const result = await harness.run(["scroll", "--to", "e55"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("command: scroll");
    expect(result.stdout).toContain("scrolled ref e55 into view");
    expect(harness.upstreamRuns[0]?.[0]).toBe("eval");
    expect(harness.upstreamRuns[0]?.[1]).toContain("scrollIntoView");
    expect(harness.upstreamRuns[0]).toContain("e55");
  });

  it("P-4: scroll --by <px> rejects non-integers with exit 2", async () => {
    const harness = await createHarness([]);
    const result = await harness.run(["scroll", "--by", "abc"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("kind: usage");
  });

  it("P-4: scroll with no target is a usage error", async () => {
    const harness = await createHarness([]);
    const result = await harness.run(["scroll"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("--to");
    expect(result.stdout).toContain("--bottom");
  });

  it("P-5: wait forwards a waitForLoadState run-code", async () => {
    const harness = await createHarness([{ stdout: "" }]);
    const result = await harness.run(["wait", "--state", "networkidle"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("command: wait");
    expect(result.stdout).toContain("state: networkidle");
    expect(harness.upstreamRuns[0]?.[0]).toBe("run-code");
    expect(harness.upstreamRuns[0]?.[1]).toContain(
      "waitForLoadState('networkidle'",
    );
    // N-1: the snippet MUST be an async arrow function expression (upstream
    // run-code wraps it in a non-async body, so a bare `await` is a SyntaxError).
    expect(harness.upstreamRuns[0]?.[1]?.startsWith("async (page) =>")).toBe(
      true,
    );
  });

  it("P-5: --wait on a generic command issues a post-action wait", async () => {
    const harness = await createHarness([
      { stdout: "clicked" },
      { stdout: "" },
    ]);
    const result = await harness.run(["click", "e5", "--wait", "load"]);
    expect(result.exitCode).toBe(0);
    // wrapper-only --wait is stripped from the forwarded click argv
    expect(harness.upstreamRuns[0]).toEqual(["click", "e5"]);
    expect(harness.upstreamRuns[1]?.[0]).toBe("run-code");
    // N-1: the post-action wait snippet must be the async arrow form too.
    expect(harness.upstreamRuns[1]?.[1]?.startsWith("async (page) =>")).toBe(
      true,
    );
    expect(result.stdout).toContain("command: click");
  });

  it("N-2: a --wait failure after a successful command does not mask the success", async () => {
    const harness = await createHarness([
      { stdout: "clicked" },
      { stdout: "", exitCode: 1, stderr: "wait blew up" },
    ]);
    const result = await harness.run(["click", "e5", "--wait", "load"]);
    // The click itself succeeded, so the result must stay exit 0 with the
    // primary result intact and a visible wait_warning (not a hard error).
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("command: click");
    expect(result.stdout).toContain("wait_warning:");
    expect(result.stdout).toContain("post-action wait for 'load' failed");
    expect(result.stdout).not.toContain("kind: upstream_error");
  });

  it("N-8: video-start with no open browser page warns with guidance (exit 2)", async () => {
    const harness = await createHarness([], { pageOpen: "closed" });
    const result = await harness.run(["video-start", "./out.webm"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("requires an open browser page");
    expect(result.stdout).toContain("playwright-cli-axi open <url>");
    // No recording was started, so no upstream video-start call was forwarded.
    expect(harness.upstreamRuns).toEqual([]);
  });

  it("N-8: video-start proceeds when a browser page is open", async () => {
    const harness = await createHarness([
      { stdout: "Video recording started." },
    ]);
    const result = await harness.run(["video-start", "./out.webm"]);
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns[0]).toEqual(["video-start", "./out.webm"]);
  });

  it("P-4: scroll --to without value is a usage error", async () => {
    const harness = await createHarness([]);
    const result = await harness.run(["scroll", "--to"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("kind: usage");
    expect(result.stdout).toContain("--to requires a reference value");
  });

  it("P-4: scroll --by without value is a usage error", async () => {
    const harness = await createHarness([]);
    const result = await harness.run(["scroll", "--by"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("kind: usage");
    expect(result.stdout).toContain("--by requires a pixel value");
  });

  it("P-5: wait --timeout zero is a usage error", async () => {
    const harness = await createHarness([]);
    const result = await harness.run(["wait", "--timeout", "0"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("kind: usage");
    expect(result.stdout).toContain("timeout must be a positive integer");
  });

  it("F-4: video-chapters reads the chapter manifest with offsets", async () => {
    const harness = await createHarness([
      { stdout: "Video recording started." },
      { stdout: "Action annotations enabled." },
    ]);
    await harness.run(["video-start", "./rec.webm", "--size", "320x240"]);
    await harness.run(["video-chapter", "Intro"]);
    const result = await harness.run(["video-chapters"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("command: video-chapters");
    expect(result.stdout).toContain("offset:");
    expect(result.stdout).toContain("Intro");
  });

  it("F-4: video-status reports recording summary and chapters", async () => {
    const harness = await createHarness([
      { stdout: "Video recording started." },
      { stdout: "Action annotations enabled." },
    ]);
    await harness.run(["video-start", "./rec.webm"]);
    await harness.run(["video-chapter", "A"]);
    const result = await harness.run(["video-status"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("command: video-status");
    expect(result.stdout).toContain("requestedFile: ./rec.webm");
    expect(result.stdout).toContain("chapter_rows");
  });

  it("C-5: help <unknown> returns Unknown command consistent with the router (exit 2)", async () => {
    const harness = await createHarness([]);
    const result = await harness.run(["help", "get-url"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("kind: usage");
    expect(result.stdout).toContain("Unknown command: get-url");
    // no upstream call was made (consistent existence check, no permissive help)
    expect(harness.upstreamRuns).toEqual([]);
  });

  it("C-5: <unknown> --help also returns Unknown command", async () => {
    const harness = await createHarness([]);
    const result = await harness.run(["bogus-command", "--help"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("Unknown command: bogus-command");
  });

  it("C-5: help <known-upstream> still forwards to upstream help", async () => {
    const harness = await createHarness([
      { stdout: "Usage: playwright-cli click [options]\n  click an element" },
    ]);
    const result = await harness.run(["help", "click"]);
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns[0]).toContain("click");
    expect(result.stdout).toContain("source: @playwright/cli");
  });

  it("C-4: --settle issues a deterministic settle run-code after a click", async () => {
    const harness = await createHarness([
      { stdout: "clicked" },
      { stdout: "" },
    ]);
    const result = await harness.run(["click", "e5", "--settle"]);
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns[0]).toEqual(["click", "e5"]);
    expect(harness.upstreamRuns[1]?.[0]).toBe("run-code");
    const settleCode = harness.upstreamRuns[1]?.[1] ?? "";
    // the emitted settle snippet is the async-arrow URL-stability form
    expect(settleCode.startsWith("async (page) =>")).toBe(true);
    expect(settleCode).toContain("page.url()");
    expect(result.stdout).not.toContain("wait_warning");
  });

  it("C-1: a click that blocks on an invalid field surfaces validation (exit stays 0)", async () => {
    const harness = await createHarness([{ stdout: "clicked" }], {
      validation: {
        activeIsInvalid: true,
        fields: [
          {
            tag: "input",
            type: "email",
            name: "email",
            id: "",
            placeholder: "you@school.com",
            label: "Email",
            message: "Please include an '@' in the email address.",
          },
        ],
      },
    });
    const result = await harness.run(["click", "e131"]);
    // the primary click result is intact and the command still exits 0
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("command: click");
    expect(result.stdout).toContain("validation:");
    expect(result.stdout).toContain("ok: false");
    expect(result.stdout).toContain("Email");
    expect(result.stdout).toContain("'@' in the email address");
  });

  it("C-1: a navigating/valid click adds no validation block", async () => {
    const harness = await createHarness([{ stdout: "clicked" }]);
    const result = await harness.run(["click", "e5"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("validation:");
  });

  it("C-1: a validation probe failure never breaks the click", async () => {
    // no validation option -> harness returns activeIsInvalid:false; the probe
    // is swallowed and the click succeeds with no validation block.
    const harness = await createHarness([{ stdout: "clicked" }]);
    const result = await harness.run(["click", "e5"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("command: click");
  });

  it("C-3: find returns structured matches with refs from the snapshot", async () => {
    const harness = await createHarness([
      {
        stdout:
          '{"result":{"snapshot":"- generic [ref=e253]: 0/0\\n- generic [ref=e254]: Classrooms"}}',
      },
    ]);
    const result = await harness.run(["find", "Classrooms"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("command: find");
    expect(result.stdout).toContain("matches: 1");
    expect(result.stdout).toContain("e254");
    expect(result.stdout).toContain("0/0");
  });

  it("C-3: find with no query is a usage error", async () => {
    const harness = await createHarness([]);
    const result = await harness.run(["find"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("find needs a label");
  });

  it("C-3: find reports a definitive empty state when nothing matches", async () => {
    const harness = await createHarness([
      { stdout: '{"result":{"snapshot":"- heading \\"Basic\\" [ref=e1]"}}' },
    ]);
    const result = await harness.run(["find", "Nonexistent"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("matches: 0");
    expect(result.stdout).toContain("empty:");
  });

  it("C-6: select forwards target+value with wrapper flags stripped", async () => {
    const harness = await createHarness([{ stdout: "{}" }]);
    const result = await harness.run(["select", "e5", "green", "--full"]);
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns[0]).toEqual(["select", "e5", "green"]);
  });

  it("C-6: check forwards the target with wrapper flags stripped", async () => {
    const harness = await createHarness([{ stdout: "{}" }]);
    const result = await harness.run(["check", "e8", "--fields", "x"]);
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns[0]).toEqual(["check", "e8"]);
  });

  it("C-6: upload forwards the file path (no ref) with wrapper flags stripped", async () => {
    const harness = await createHarness([{ stdout: "{}" }]);
    const result = await harness.run(["upload", "/abs/file.png", "--full"]);
    expect(result.exitCode).toBe(0);
    expect(harness.upstreamRuns[0]).toEqual(["upload", "/abs/file.png"]);
  });
});

interface FakeRun {
  exitCode?: number;
  stdout: string;
  stderr?: string;
}

async function createHarness(
  fakeRuns: FakeRun[],
  options: {
    pageOpen?: "open" | "closed";
    validation?: { activeIsInvalid: boolean; fields?: unknown[] };
  } = {},
) {
  const stateRoot = await mkdtemp(join(tmpdir(), "playwright-cli-axi-test-"));
  const cwd = join(stateRoot, "workspace");
  const upstreamRuns: string[][] = [];
  const pageOpen = options.pageOpen ?? "open";
  const validation = options.validation;
  const deps: CliDependencies = {
    cwd,
    executablePath: "/home/will/.local/bin/playwright-cli-axi",
    env: { XDG_STATE_HOME: join(stateRoot, "state"), HOME: "/home/will" },
    now: () => new Date("2026-06-22T12:00:00.000Z"),
    upstreamVersion: "0.1.14",
    wrapperVersion: "0.1.0",
    upstream: async (argv): Promise<UpstreamRun> => {
      // N-8: video-start's page-open guard probes `list --json` before starting
      // a recording. Answer it with an open browser WITHOUT consuming the
      // command-under-test response queue or recording it in upstreamRuns
      // (the probe is an internal guard, not the command under test). The
      // closed-page guard path is covered directly in videoCommands.spec.ts.
      if (argv[0] === "list" && argv[1] === "--json") {
        return {
          argv,
          exitCode: 0,
          stdout:
            pageOpen === "open"
              ? '{"browsers":[{"id":"1","name":"browser"}]}'
              : '{"browsers":[]}',
          stderr: "",
          usedJson: true,
        };
      }
      // C-1: the validation probe runs after a submit-triggering click. Answer
      // it without consuming the command-under-test queue (it is an internal
      // probe, not the command under test); the closed-page guard path is
      // covered directly in main.spec.ts via the `validation` option.
      if (
        argv[0] === "run-code" &&
        typeof argv[1] === "string" &&
        argv[1].includes("pca-validation-probe")
      ) {
        // run-code wraps its return value in { result: "<json>" }, matching the
        // real upstream contract the probe unwraps.
        return {
          argv,
          exitCode: 0,
          stdout: JSON.stringify({
            result: JSON.stringify(
              validation ?? { activeIsInvalid: false, fields: [] },
            ),
          }),
          stderr: "",
          usedJson: true,
        };
      }
      upstreamRuns.push(argv);
      const next = fakeRuns.shift();
      if (!next) throw new Error(`unexpected upstream call: ${argv.join(" ")}`);
      return {
        argv,
        exitCode: next.exitCode ?? 0,
        stdout: next.stdout,
        stderr: next.stderr ?? "",
        usedJson: true,
      };
    },
  };

  return {
    cwd,
    upstreamRuns,
    run: (argv: string[]) => runCli(argv, deps),
    async stateFiles() {
      try {
        return await readdir(join(stateRoot, "state", "playwright-cli-axi"));
      } catch {
        return [];
      }
    },
    async readState() {
      const files = await this.stateFiles();
      const statePath = join(
        stateRoot,
        "state",
        "playwright-cli-axi",
        files[0]!,
      );
      return JSON.parse(await readFile(statePath, "utf8"));
    },
    async readStates(): Promise<VideoSidecarState[]> {
      const files = await this.stateFiles();
      const states: VideoSidecarState[] = [];
      for (const file of files) {
        const statePath = join(stateRoot, "state", "playwright-cli-axi", file);
        states.push(JSON.parse(await readFile(statePath, "utf8")));
      }
      return states;
    },
  };
}
