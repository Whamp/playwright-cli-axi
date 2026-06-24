import { describe, expect, it } from "vitest";

import { commandSuccessModel } from "./success.js";
import { toToon } from "./toon.js";

describe("commandSuccessModel", () => {
  it("should format list results with explicit empty state", () => {
    // Arrange
    const parsed = {
      kind: "json",
      value: { browsers: [] },
      isError: false,
    } as const;

    // Act
    const output = toToon(commandSuccessModel("list", parsed));

    // Assert
    expect(output).toContain("command: list");
    expect(output).toContain(
      "browsers:\n  count: 0\n  empty: no open browsers",
    );
  });

  it("should format non-empty browser, server, and channel rows for list --all results", () => {
    // Arrange
    const parsed = {
      kind: "json",
      value: {
        browsers: [{ id: "browser-1", name: "Chromium", status: "open" }],
        servers: [
          {
            title: "debug",
            browser: { browserName: "chromium", userDataDir: "/tmp/profile" },
            playwrightVersion: "1.2.3",
            workspaceDir: "/repo",
          },
        ],
        channelSessions: [
          {
            channel: "chrome",
            userDataDir: "/tmp/chrome",
            extensionInstalled: true,
            endpoint: "http://127.0.0.1:9222",
          },
        ],
      },
      isError: false,
    } as const;

    // Act
    const output = toToon(commandSuccessModel("list", parsed));

    // Assert
    expect(output).toContain("browsers:\n  count: 1");
    expect(output).toContain("browser_rows[1]{id,name,status}:");
    expect(output).toContain("browser-1,Chromium,open");
    expect(output).toContain("servers:\n  count: 1");
    expect(output).toContain(
      "server_rows[1]{title,browser,version,dataDir,workspace}:",
    );
    expect(output).toContain("debug,chromium,1.2.3,/tmp/profile,/repo");
    expect(output).toContain("channel_sessions:\n  count: 1");
    expect(output).toContain(
      "channel_session_rows[1]{channel,dataDir,extension,endpoint}:",
    );
    expect(output).toContain("chrome,/tmp/chrome,yes,yes");
  });

  it("should preserve single close session status instead of treating it as close-all", () => {
    // Arrange
    const parsed = {
      kind: "json",
      value: { session: "default", status: "not-open" },
      isError: false,
    } as const;

    // Act
    const output = toToon(commandSuccessModel("close", parsed));

    // Assert
    expect(output).toContain("command: close");
    expect(output).toContain("session: default");
    expect(output).toContain("close:\n  status: not-open");
    expect(output).not.toContain("no browsers were closed");
  });

  it("should format non-empty closed rows for close-like results", () => {
    // Arrange
    const parsed = {
      kind: "json",
      value: { closed: [{ id: "browser-1" }, { name: "webkit" }] },
      isError: false,
    } as const;

    // Act
    const output = toToon(commandSuccessModel("close-all", parsed));

    // Assert
    expect(output).toContain("closed:\n  count: 2");
    expect(output).toContain("closed_rows[2]{id,status}:");
    expect(output).toContain("browser-1,closed");
    expect(output).toContain("webkit,closed");
  });

  it("should add command-family and artifact summaries for non-video command results", () => {
    // Arrange
    const parsed = {
      kind: "json",
      value: {
        file: "./page.png",
        attachments: ["./trace.zip", "./data.json"],
      },
      isError: false,
    } as const;

    // Act
    const output = toToon(commandSuccessModel("screenshot", parsed));

    // Assert
    expect(output).toContain("family:\n  id: artifacts");
    expect(output).toContain("artifacts[3]{path,type,source}:");
    expect(output).toContain("./page.png,image,result.file");
    expect(output).toContain('./trace.zip,trace,"result.attachments[0]"');
    expect(output).toContain("result:");
  });

  it("should not add artifact summaries for non-artifact command families", () => {
    // Arrange
    const parsed = {
      kind: "json",
      value: { configFile: "./playwright.config.json" },
      isError: false,
    } as const;

    // Act
    const output = toToon(commandSuccessModel("config-print", parsed));

    // Assert
    expect(output).toContain("family:\n  id: install");
    expect(output).not.toContain("artifacts[");
    expect(output).toContain("configFile: ./playwright.config.json");
  });

  it("should prune transport-only JSON fields from generic command results", () => {
    // Arrange
    const parsed = {
      kind: "json",
      value: {
        isError: false,
        request: { id: 7, method: "GET" },
        headers: [{ name: "accept", value: "*/*" }],
      },
      isError: false,
    } as const;

    // Act
    const output = toToon(commandSuccessModel("request", parsed));

    // Assert
    expect(output).toContain("command: request");
    expect(output).toContain("result:");
    expect(output).toContain("request:");
    expect(output).toContain("id: 7");
    expect(output).toContain("method: GET");
    expect(output).toContain("headers[1]:");
    expect(output).not.toContain("isError");
  });

  it("should quote hostile upstream JSON keys without throwing", () => {
    // Arrange
    const parsed = {
      kind: "json",
      value: { "bad\rkey": { "bad:key": true } },
      isError: false,
    } as const;

    // Act
    const output = toToon(commandSuccessModel("config-print", parsed));

    // Assert
    expect(output).toContain('"bad\\rkey":');
    expect(output).toContain('"bad:key": true');
    expect(output).not.toContain("\r");
  });

  it("should cap deeply nested generic JSON results", () => {
    // Arrange
    const value: Record<string, unknown> = {};
    let cursor = value;
    for (let index = 0; index < 60; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.child = next;
      cursor = next;
    }
    const parsed = { kind: "json", value, isError: false } as const;

    // Act
    const output = toToon(commandSuccessModel("request", parsed));

    // Assert
    expect(output).toContain("[max-depth]");
  });

  it("should stringify primitive JSON results for generic commands", () => {
    // Arrange
    const parsed = {
      kind: "json",
      value: 7,
      isError: false,
    } as const;

    // Act
    const output = toToon(commandSuccessModel("request", parsed));

    // Assert
    expect(output).toContain("command: request");
    expect(output).toContain('result: "7"');
  });

  it("should pass through short text output without truncation", () => {
    // Arrange
    const parsed = {
      kind: "text",
      text: "ok",
      isError: false,
    } as const;

    // Act
    const output = toToon(commandSuccessModel("snapshot", parsed));

    // Assert
    expect(output).toContain("command: snapshot");
    expect(output).toContain("output: ok");
    expect(output).not.toContain("chars total");
  });

  it("should truncate long text output for generic commands", () => {
    // Arrange
    const parsed = {
      kind: "text",
      text: "x".repeat(1305),
      isError: false,
    } as const;

    // Act
    const output = toToon(commandSuccessModel("snapshot", parsed));

    // Assert
    expect(output).toContain("command: snapshot");
    expect(output).toContain("1305 chars total");
  });
});

describe("commandSuccessModel --fields (AXI principle 2)", () => {
  it("defaults to the minimal id/name/status browser schema", () => {
    const parsed = {
      kind: "json",
      value: {
        browsers: [
          {
            id: "b1",
            name: "chromium",
            status: "open",
            browserType: "chromium",
            version: "1.2.3",
          },
        ],
      },
      isError: false,
    } as const;
    const output = toToon(commandSuccessModel("list", parsed));
    expect(output).toContain("browser_rows[1]{id,name,status}:");
  });

  it("extends browser columns when --fields requests additional fields", () => {
    const parsed = {
      kind: "json",
      value: {
        browsers: [
          {
            id: "b1",
            name: "chromium",
            status: "open",
            browserType: "chromium",
            version: "1.2.3",
            compatible: true,
            attached: false,
          },
        ],
      },
      isError: false,
    } as const;
    const output = toToon(
      commandSuccessModel("list", parsed, {
        fields: ["id", "browserType", "version", "compatible"],
      }),
    );
    expect(output).toContain(
      "browser_rows[1]{id,browserType,version,compatible}:",
    );
    expect(output).toContain("b1,chromium,1.2.3,yes");
  });

  it("falls back to the default schema when only unknown fields are requested", () => {
    const parsed = {
      kind: "json",
      value: { browsers: [{ id: "b1", name: "x", status: "open" }] },
      isError: false,
    } as const;
    const output = toToon(
      commandSuccessModel("list", parsed, { fields: ["nonsense"] }),
    );
    expect(output).toContain("browser_rows[1]{id,name,status}:");
  });
});

describe("commandSuccessModel --full (AXI principle 3)", () => {
  it("truncates large generic JSON results with a byte count and --full hint", () => {
    const big = { snapshot: "x".repeat(3000) };
    const parsed = {
      kind: "json",
      value: big,
      isError: false,
    } as const;
    const output = toToon(commandSuccessModel("config-print", parsed));
    expect(output).toContain("result_truncated: true");
    expect(output).toContain("result_bytes:");
    expect(output).toContain("help[1]:");
    expect(output).toContain("playwright-cli-axi config-print --full");
  });

  it("returns the full result when --full is set", () => {
    const big = { snapshot: "x".repeat(3000) };
    const parsed = {
      kind: "json",
      value: big,
      isError: false,
    } as const;
    const output = toToon(
      commandSuccessModel("config-print", parsed, { full: true }),
    );
    expect(output).not.toContain("result_truncated");
    expect(output).toContain("snapshot:");
  });

  it("does not truncate small generic JSON results", () => {
    const parsed = {
      kind: "json",
      value: { ok: true },
      isError: false,
    } as const;
    const output = toToon(commandSuccessModel("config-print", parsed));
    expect(output).not.toContain("result_truncated");
    expect(output).not.toContain("--full");
  });
});
