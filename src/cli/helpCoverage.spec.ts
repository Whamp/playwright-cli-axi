import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { UPSTREAM_COMMANDS } from "../domain/upstreamCommands.js";
import { VIDEO_COMMANDS } from "../domain/commandSurface.js";
import type { UpstreamRun } from "../upstream/runner.js";
import { runCli, type CliDependencies } from "./main.js";

describe("whole-surface help coverage", () => {
  it("returns structured wrapper help for every upstream command", async () => {
    const stateRoot = await mkdtemp(
      join(tmpdir(), "playwright-cli-axi-help-coverage-"),
    );
    const upstreamCalls: string[][] = [];
    const videoCommands = new Set<string>(VIDEO_COMMANDS);
    const deps: CliDependencies = {
      cwd: join(stateRoot, "workspace"),
      executablePath: "/tmp/playwright-cli-axi",
      env: { XDG_STATE_HOME: join(stateRoot, "state"), HOME: "/home/will" },
      now: () => new Date("2026-06-23T20:00:00.000Z"),
      upstreamVersion: "0.1.14",
      upstream: async (argv): Promise<UpstreamRun> => {
        upstreamCalls.push(argv);
        return {
          argv,
          exitCode: 0,
          stdout: `playwright-cli ${argv[0]} --help\n\nSynthetic upstream help for ${argv[0]}`,
          stderr: "",
          usedJson: false,
        };
      },
    };

    for (const command of UPSTREAM_COMMANDS) {
      const before = upstreamCalls.length;
      const result = await runCli([command, "--help"], deps);

      expect(result.exitCode, command).toBe(0);
      expect(result.stdout, command).toContain(`command: ${command}`);
      if (videoCommands.has(command)) {
        expect(upstreamCalls, command).toHaveLength(before);
      } else {
        expect(upstreamCalls.at(-1), command).toEqual([command, "--help"]);
      }
    }
  });
});
