import { describe, expect, it } from "vitest";

import { contextModel, MAX_CONTEXT_BYTES } from "./context.js";
import { toToon } from "./toon.js";
import type { SessionSummary } from "../domain/sessions.js";
import type { VideoSidecarState } from "../domain/videoState.js";

function emptySessions(): SessionSummary {
  return {
    browsers: { count: 0, rows: [] },
    servers: { count: 0, rows: [] },
    channelSessions: { count: 0, rows: [] },
  };
}

function idleVideo(): VideoSidecarState {
  return {
    scope: { cwd: "/repo", session: "default" },
    recording: { status: "inactive" },
    warnings: [],
  } as unknown as VideoSidecarState;
}

function activeVideo(cwd = "/repo"): VideoSidecarState {
  return {
    scope: { cwd, session: "default" },
    recording: { status: "active", file: "./out.webm" },
    warnings: [],
  } as unknown as VideoSidecarState;
}

describe("contextModel (session-start slice)", () => {
  it("emits a compact, directory-scoped slice", () => {
    const model = contextModel({
      executablePath: "/usr/local/bin/playwright-cli-axi",
      home: "/home/user",
      cwd: "/home/user/repo",
      sessions: { ...emptySessions(), browsers: { count: 2, rows: [] } },
      video: idleVideo(),
    }) as Record<string, unknown>;
    expect(model).toMatchObject({
      tool: "playwright-cli-axi",
      cwd: "/home/user/repo",
      browsers: 2,
      video: "inactive",
    });
    // The slice reflects the CURRENT cwd (directory-scoped), not a global dump.
    expect(model.cwd).toBe("/home/user/repo");
    // No full command matrix, server rows, or channel rows leak into context.
    expect(JSON.stringify(model)).not.toContain("command_groups");
    expect(JSON.stringify(model)).not.toContain("servers");
  });

  it("stays under the byte budget even with very long paths (O8)", () => {
    const huge = "/home/user/" + "a".repeat(2000);
    for (const cwd of [huge, "", "x".repeat(500), "/正常/路径/".repeat(40)]) {
      const model = contextModel({
        executablePath: huge,
        home: "/home/user",
        cwd,
        sessions: emptySessions(),
        video: activeVideo(cwd),
      });
      const serialized = toToon(model);
      const bytes = Buffer.byteLength(serialized, "utf8");
      expect(bytes, `cwd=${cwd.slice(0, 20)}…`).toBeLessThanOrEqual(MAX_CONTEXT_BYTES);
    }
  });

  it("switches next steps based on the current cwd's recording state (scoping)", () => {
    // Recording active in THIS cwd -> next step points at video-stop.
    const active = contextModel({
      executablePath: "/opt/pca",
      cwd: "/repo",
      sessions: emptySessions(),
      video: activeVideo("/repo"),
    }) as Record<string, string[]>;
    expect((active.next as string[]).some((s) => s.includes("video-stop"))).toBe(true);

    // A different cwd's recording does not change THIS slice's next steps,
    // because the slice only reflects the cwd it was rendered for.
    const otherCwd = contextModel({
      executablePath: "/opt/pca",
      cwd: "/this-repo",
      sessions: emptySessions(),
      video: idleVideo(),
    }) as Record<string, string[]>;
    expect((otherCwd!.next as string[]).some((s) => s.includes("video-stop"))).toBe(false);
  });
});
