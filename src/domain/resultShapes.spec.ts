import { describe, expect, it } from "vitest";
import {
  isUrlLike,
  parseConsoleMessages,
  parseTabList,
  stripAnsi,
} from "./resultShapes.js";

describe("stripAnsi", () => {
  it("removes CSI escape sequences", () => {
    // D-6: raw upstream embeds \u001b[2m / \u001b[22m dim codes in call logs.
    const raw =
      "Error: Not a checkbox\u001b[2m - waiting for locator('e4')\u001b[22m done";
    expect(stripAnsi(raw)).toBe(
      "Error: Not a checkbox - waiting for locator('e4') done",
    );
  });

  it("leaves plain text unchanged", () => {
    expect(stripAnsi("no escapes here")).toBe("no escapes here");
  });

  it("strips multi-parameter sequences", () => {
    expect(stripAnsi("\u001b[1;31mred\u001b[0m")).toBe("red");
  });
});

describe("isUrlLike", () => {
  it("recognizes http/https/ftp/mailto", () => {
    expect(isUrlLike("https://example.com/a")).toBe(true);
    expect(isUrlLike("http://localhost:3000")).toBe(true);
    expect(isUrlLike("mailto:a@b.com")).toBe(true);
  });

  // D-4: tab-list markdown targets are real URLs that must NOT be joined to the
  // artifact base (which mangled them into /cache/https:/example.com).
  it("rejects filesystem and relative paths", () => {
    expect(isUrlLike("/abs/path")).toBe(false);
    expect(isUrlLike("./rel.png")).toBe(false);
    expect(isUrlLike("shot.png")).toBe(false);
    expect(isUrlLike("https:/example.com")).toBe(false); // single-slash mangling
  });
});

describe("parseTabList", () => {
  it("parses the upstream ordinal, current flag, title and url per row", () => {
    // The ordinal is what `tab-select <n>` accepts, so it is preserved as the
    // index the agent acts on.
    const md =
      "- 0: (current) [The Internet](https://the-internet.herokuapp.com/windows)\n" +
      "- 1: [New Window](https://the-internet.herokuapp.com/windows/new)";
    expect(parseTabList(md)).toEqual([
      {
        index: 0,
        current: true,
        title: "The Internet",
        url: "https://the-internet.herokuapp.com/windows",
      },
      {
        index: 1,
        current: false,
        title: "New Window",
        url: "https://the-internet.herokuapp.com/windows/new",
      },
    ]);
  });

  it("returns an empty array for non-markdown payloads", () => {
    expect(parseTabList("")).toEqual([]);
    expect(parseTabList("not a tab list")).toEqual([]);
    expect(parseTabList("{}")).toEqual([]);
  });
});

describe("parseConsoleMessages", () => {
  it("parses totals and per-message severity/text/location", () => {
    const raw =
      "Total messages: 4 (Errors: 1, Warnings: 1)\n\n" +
      "[LOG] a log line @ :0\n" +
      "[WARNING] a warning @ :0\n" +
      "[ERROR] an error @ :0\n" +
      "[LOG] second log @ :0";
    expect(parseConsoleMessages(raw)).toEqual({
      totals: { messages: 4, errors: 1, warnings: 1 },
      messages: [
        { severity: "log", text: "a log line", location: ":0" },
        { severity: "warning", text: "a warning", location: ":0" },
        { severity: "error", text: "an error", location: ":0" },
        { severity: "log", text: "second log", location: ":0" },
      ],
    });
  });

  it("parses a single error with a multi-line stack", () => {
    const raw =
      "Total messages: 1 (Errors: 1, Warnings: 0)\n\n" +
      "TypeError: Cannot read properties of undefined (reading 'xyz')\n" +
      "    at loadError (https://example.com:7:52)\n" +
      "    at onload (https://example.com:11:30)";
    const parsed = parseConsoleMessages(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.totals).toEqual({ messages: 1, errors: 1, warnings: 0 });
    expect(parsed!.messages).toHaveLength(1);
    expect(parsed!.messages[0]!.severity).toBe("error");
    expect(parsed!.messages[0]!.text).toContain("TypeError");
    expect(parsed!.messages[0]!.text).toContain("at loadError");
  });

  it("returns null when the upstream header is absent", () => {
    expect(parseConsoleMessages("")).toBeNull();
    expect(parseConsoleMessages("not a console payload")).toBeNull();
  });
});
