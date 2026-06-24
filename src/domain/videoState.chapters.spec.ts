import { describe, expect, it } from "vitest";
import { chapterManifest, defaultVideoState } from "./videoState.js";

describe("chapterManifest (F-4)", () => {
  it("returns an empty manifest with no chapters", () => {
    const state = defaultVideoState("/repo", "k", "default");
    expect(chapterManifest(state)).toEqual([]);
  });

  it("computes mm:ss offsets relative to recording start", () => {
    const state = defaultVideoState("/repo", "k", "default");
    state.recording = {
      status: "active",
      startedAt: "2026-06-24T14:37:00.000Z",
    };
    state.chapters = [
      { title: "Intro", createdAt: "2026-06-24T14:38:05.000Z" }, // +65s -> 01:05
      { title: "Demo", createdAt: "2026-06-24T14:41:10.000Z" }, // +250s -> 04:10
      {
        title: "Notes",
        description: "details",
        duration: 500,
        createdAt: "2026-06-24T14:42:00.000Z",
      },
    ];
    const manifest = chapterManifest(state);
    expect(manifest.map((m) => `${m.index}:${m.offset}:${m.title}`)).toEqual([
      "1:01:05:Intro",
      "2:04:10:Demo",
      "3:05:00:Notes",
    ]);
    expect(manifest[2]?.description).toBe("details");
    expect(manifest[2]?.duration_ms).toBe(500);
  });

  it("offsets clamp to 00:00 when a chapter predates the recording start", () => {
    const state = defaultVideoState("/repo", "k", "default");
    state.recording = {
      status: "active",
      startedAt: "2026-06-24T14:37:00.000Z",
    };
    state.chapters = [
      { title: "Early", createdAt: "2026-06-24T14:36:00.000Z" },
    ];
    expect(chapterManifest(state)[0]?.offset).toBe("00:00");
  });

  it("offsets are 00:00 when startedAt is missing", () => {
    const state = defaultVideoState("/repo", "k", "default");
    state.chapters = [{ title: "X", createdAt: "2026-06-24T14:37:00.000Z" }];
    expect(chapterManifest(state)[0]?.offset).toBe("00:00");
  });
});
