import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { VIDEO_COMMANDS } from "./commandSurface.js";
import {
  CLOSE_LIKE_COMMAND_SCOPES,
  CLOSE_LIKE_COMMANDS,
  COMMAND_GROUPS,
  CWD_WIDE_CLOSE_LIKE_COMMANDS,
  closeScopeFor,
  commandGroupFor,
  GLOBAL_CLOSE_LIKE_COMMANDS,
  isCloseLikeCommand,
  UPSTREAM_COMMANDS,
} from "./upstreamCommands.js";

describe("upstream command coverage", () => {
  it("covers every command in upstream help.json exactly once", () => {
    const upstream = JSON.parse(
      readFileSync(
        "node_modules/playwright-core/lib/tools/cli-client/help.json",
        "utf8",
      ),
    ) as {
      commands: Record<string, unknown>;
    };
    const upstreamCommands = Object.keys(upstream.commands).sort();
    const wrapperCommands = [...UPSTREAM_COMMANDS].sort();

    expect(wrapperCommands).toEqual(upstreamCommands);
    expect(new Set(UPSTREAM_COMMANDS).size).toBe(UPSTREAM_COMMANDS.length);
  });

  it("does not expose stale wrapper-only command coverage such as standalone kill", () => {
    expect(UPSTREAM_COMMANDS).not.toContain("kill");
    expect(commandGroupFor("kill")).toBeUndefined();
  });

  it("assigns every covered command to a non-empty command group", () => {
    for (const group of COMMAND_GROUPS) {
      expect(group.id).not.toBe("");
      expect(group.title).not.toBe("");
      expect(group.summary).not.toBe("");
      expect(group.commands.length).toBeGreaterThan(0);
      for (const command of group.commands) {
        expect(commandGroupFor(command)).toBe(group);
      }
    }
  });

  it("keeps video command routing and command-matrix metadata in sync", () => {
    const videoGroup = COMMAND_GROUPS.find((group) => group.id === "video");

    // Every upstream video command is routed by the wrapper, and the wrapper
    // additionally owns two read-only commands (video-chapters, video-status)
    // that project sidecar state and are intentionally NOT in the upstream matrix.
    const upstreamVideo = videoGroup?.commands ?? [];
    for (const command of upstreamVideo) {
      expect(VIDEO_COMMANDS).toContain(command);
    }
    expect(VIDEO_COMMANDS).toContain("video-chapters");
    expect(VIDEO_COMMANDS).toContain("video-status");
    expect([...new Set(VIDEO_COMMANDS)]).toEqual([...VIDEO_COMMANDS]);
  });

  it("keeps close-like routing inside the upstream session group", () => {
    const sessionGroup = COMMAND_GROUPS.find((group) => group.id === "session");
    const sessionCommands = [...(sessionGroup?.commands ?? [])];

    for (const command of CLOSE_LIKE_COMMANDS) {
      expect(sessionCommands.includes(command)).toBe(true);
      expect(isCloseLikeCommand(command)).toBe(true);
    }
  });

  it("derives close-like scopes from a single source of truth", () => {
    expect([...CLOSE_LIKE_COMMANDS].sort()).toEqual([
      "close",
      "close-all",
      "delete-data",
      "detach",
      "kill-all",
    ]);
    // CWD-wide is exactly close-all; global is exactly kill-all.
    expect([...CWD_WIDE_CLOSE_LIKE_COMMANDS]).toEqual(["close-all"]);
    expect([...GLOBAL_CLOSE_LIKE_COMMANDS]).toEqual(["kill-all"]);
    for (const command of CWD_WIDE_CLOSE_LIKE_COMMANDS)
      expect(CLOSE_LIKE_COMMANDS.includes(command)).toBe(true);
    for (const command of GLOBAL_CLOSE_LIKE_COMMANDS)
      expect(CLOSE_LIKE_COMMANDS.includes(command)).toBe(true);

    expect(closeScopeFor("close")).toBe("session");
    expect(closeScopeFor("detach")).toBe("session");
    expect(closeScopeFor("delete-data")).toBe("session");
    expect(closeScopeFor("close-all")).toBe("cwd");
    expect(closeScopeFor("kill-all")).toBe("global");

    // detach terminates the owning session, so it is close-like but session-scoped.
    expect(isCloseLikeCommand("detach")).toBe(true);
    expect(isCloseLikeCommand("open")).toBe(false);
    expect(closeScopeFor("open")).toBeUndefined();
    expect(closeScopeFor(undefined)).toBeUndefined();

    // every declared scope is represented by at least one command
    const usedScopes = new Set(Object.values(CLOSE_LIKE_COMMAND_SCOPES));
    expect(usedScopes.has("session")).toBe(true);
    expect(usedScopes.has("cwd")).toBe(true);
    expect(usedScopes.has("global")).toBe(true);
  });
});
