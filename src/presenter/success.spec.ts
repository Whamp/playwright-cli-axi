import { describe, expect, it } from "vitest";

import { commandSuccessModel } from "./success.js";
import { toToon } from "./toon.js";

const json = (value: unknown) => ({
  kind: "json" as const,
  value,
  isError: false,
});

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
      "channel_session_rows[1]{channel,dataDir,extension,endpoint,usable}:",
    );
    // `usable` is a machine-dependent derived field; assert the stable prefix.
    expect(output).toContain("chrome,/tmp/chrome,yes,yes,");
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

  it("reports result_bytes as true UTF-8 bytes (not code units) (F4)", () => {
    const value = { text: "界".repeat(600) };
    const parsed = { kind: "json", value, isError: false } as const;
    const model = commandSuccessModel("config-print", parsed) as Record<
      string,
      unknown
    >;
    const expectedBytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    expect(model.result_bytes).toBe(expectedBytes);
    expect(model.result_truncated).toBe(true);
  });

  it("does not split a multibyte/surrogate code point at the byte boundary (F4)", () => {
    const value = { text: "😀".repeat(700) };
    const parsed = { kind: "json", value, isError: false } as const;
    const model = commandSuccessModel("config-print", parsed) as Record<
      string,
      unknown
    >;
    const preview = String(model.result);
    // The truncated preview must round-trip through UTF-8 without a replacement
    // char, proving no surrogate pair was split.
    const roundtripped = Buffer.from(preview, "utf8").toString("utf8");
    expect(roundtripped.includes("\uFFFD")).toBe(false);
    expect(model.result_truncated).toBe(true);
  });

  it("truncates just over the boundary but not exactly at it (F4)", () => {
    // JSON `{"x":"..."}` => 6 + n + 2 bytes for n ASCII chars.
    const atBoundary = { x: "a".repeat(1492) };
    const overBoundary = { x: "a".repeat(1493) };
    const p1 = { kind: "json", value: atBoundary, isError: false } as const;
    const p2 = { kind: "json", value: overBoundary, isError: false } as const;
    const m1 = commandSuccessModel("config-print", p1) as Record<
      string,
      unknown
    >;
    const m2 = commandSuccessModel("config-print", p2) as Record<
      string,
      unknown
    >;
    expect(m1.result_truncated).toBeUndefined();
    expect(m2.result_truncated).toBe(true);
    expect(m2.result_bytes).toBe(
      Buffer.byteLength(JSON.stringify(overBoundary), "utf8"),
    );
  });
});

describe("commandSuccessModel navigation flatten (P-1) and snapshot render (P-2)", () => {
  it("P-1: lifts the snapshot file to top level for open, dropping result.result nesting", () => {
    const parsed = {
      kind: "json" as const,
      value: {
        session: "default",
        pid: 42,
        result: { snapshot: { file: ".cache/page-x.yml" } },
      },
      isError: false,
    };
    const model = commandSuccessModel("open", parsed);
    expect(model.snapshot).toEqual({ file: ".cache/page-x.yml" });
    // session/pid preserved under result, redundant inner result dropped
    const result = model.result as Record<string, unknown>;
    expect(result.session).toBe("default");
    expect(result.pid).toBe(42);
    expect(result.result).toBeUndefined();
  });

  it("P-1: flattens goto/click results the same way", () => {
    const parsed = {
      kind: "json" as const,
      value: { result: { snapshot: { file: "p.yml" } } },
      isError: false,
    };
    expect(
      (commandSuccessModel("goto", parsed) as Record<string, unknown>).snapshot,
    ).toEqual({ file: "p.yml" });
    expect(
      (commandSuccessModel("click", parsed) as Record<string, unknown>)
        .snapshot,
    ).toEqual({ file: "p.yml" });
  });

  it("P-2: renders the snapshot a11y tree as readable bounded text, not JSON-string-of-YAML", () => {
    const tree = '- generic [ref=e5]:\n  - heading "Hi" [ref=e6]';
    const parsed = {
      kind: "json" as const,
      value: { snapshot: tree },
      isError: false,
    };
    const model = commandSuccessModel("snapshot", parsed);
    expect(model.snapshot).toBe(tree);
    expect(JSON.stringify(model)).not.toContain('"{\\"snapshot\\"');
    expect(model.snapshot_truncated).toBeUndefined();
  });

  it("P-2: truncates a large snapshot with a char count and --full escape hatch", () => {
    const tree = "x".repeat(2000);
    const parsed = {
      kind: "json" as const,
      value: { snapshot: tree },
      isError: false,
    };
    const truncated = commandSuccessModel("snapshot", parsed) as Record<
      string,
      unknown
    >;
    expect(truncated.snapshot_truncated).toBe(true);
    expect(truncated.snapshot_chars).toBe(2000);
    expect((truncated.help as string[])[0]).toContain("snapshot --full");
    const full = commandSuccessModel("snapshot", parsed, {
      full: true,
    }) as Record<string, unknown>;
    expect(full.snapshot).toBe(tree);
    expect(full.snapshot_truncated).toBeUndefined();
  });
});

describe("commandSuccessModel eval/run-code flatten (C-2)", () => {
  it("C-2: lifts a scalar eval return to a single top-level result (no double result.result)", () => {
    // upstream JSON-encodes the eval return value into { result: "<json>" }.
    const model = commandSuccessModel("eval", json({ result: "42" }));
    expect(model.result).toBe(42);
    expect(JSON.stringify(model)).not.toContain('"result":{"result"');
  });

  it("C-2: recovers a string eval return without triple-escaping", () => {
    const model = commandSuccessModel(
      "eval",
      json({ result: JSON.stringify("https://example.com/") }),
    );
    expect(model.result).toBe("https://example.com/");
    // not a JSON-escaped one-line string of a string
    expect(JSON.stringify(model)).not.toContain('\\"https');
  });

  it("C-2: recovers booleans/objects and leaves non-JSON strings intact", () => {
    expect(commandSuccessModel("eval", json({ result: "false" })).result).toBe(
      false,
    );
    expect(
      commandSuccessModel("eval", json({ result: '{"a":1}' })).result,
    ).toEqual({ a: 1 });
    // a bare non-JSON string survives unchanged (no throw)
    expect(
      commandSuccessModel("eval", json({ result: "not json" })).result,
    ).toBe("not json");
  });

  it("C-2: flattens run-code returns the same way", () => {
    expect(commandSuccessModel("run-code", json({ result: "42" })).result).toBe(
      42,
    );
  });

  it("C-2: falls back to a plain result when the payload has no result key", () => {
    const model = commandSuccessModel("eval", json({ ok: true }));
    expect(model.result).toEqual({ ok: true });
  });
});

describe("commandSuccessModel family flatten (H3-2)", () => {
  // H3-2: upstream wraps storage/network/screenshot payloads as
  // `{ result: <value> }`; family read commands must lift the inner value to
  // the top level instead of double-nesting as `result: result: <value>`.
  it("H3-2: flattens a single-result storage payload (cookie-get)", () => {
    const model = commandSuccessModel(
      "cookie-get",
      json({ result: "test_cookie=hello (domain: example.com)" }),
    );
    expect(model.result).toBe("test_cookie=hello (domain: example.com)");
  });

  it("H3-2: flattens a single-result network payload (requests)", () => {
    const model = commandSuccessModel(
      "requests",
      json({ result: "1. [GET] https://example.com/ => [200]" }),
    );
    expect(model.result).toBe("1. [GET] https://example.com/ => [200]");
  });

  it("H3-2: does NOT JSON-parse the lifted display string (unlike eval)", () => {
    // Storage values are literal display strings, so a numeric-looking value
    // stays a string rather than being JSON.parsed back to a number.
    const model = commandSuccessModel(
      "localstorage-get",
      json({ result: "k=42" }),
    );
    expect(model.result).toBe("k=42");
    expect(model.result).not.toBe(42);
  });

  it("H3-2: leaves a multi-key payload nested (artifact enrichment preserved)", () => {
    const model = commandSuccessModel(
      "config-print",
      json({ configFile: "./playwright.config.json" }),
    );
    expect(model.result).toEqual({ configFile: "./playwright.config.json" });
  });
});

describe("commandSuccessModel artifact path absolutization (H3-3)", () => {
  it("H3-3: resolves a relative screenshot link against the artifact base", () => {
    const model = commandSuccessModel(
      "screenshot",
      json({ result: "- [Screenshot of viewport](shot.png)" }),
      { artifactBase: "/cache/playwright-cli-axi" },
    );
    expect(model.result).toBe(
      "- [Screenshot of viewport](/cache/playwright-cli-axi/shot.png)",
    );
  });

  it("H3-3: canonicalizes parent-segment relative paths (../../)", () => {
    const model = commandSuccessModel(
      "state-save",
      json({ result: "- [Storage state](../../repo/state.json)" }),
      { artifactBase: "/cache/playwright-cli-axi" },
    );
    expect(model.result).toBe("- [Storage state](/repo/state.json)");
  });

  it("H3-3: leaves an already-absolute link target untouched", () => {
    const model = commandSuccessModel(
      "screenshot",
      json({ result: "- [Screenshot](/abs/shot.png)" }),
      { artifactBase: "/cache" },
    );
    expect(model.result).toBe("- [Screenshot](/abs/shot.png)");
  });

  it("H3-3: leaves a non-link network string untouched", () => {
    const model = commandSuccessModel(
      "requests",
      json({ result: "1. [GET] https://example.com/ => [200]" }),
      { artifactBase: "/cache" },
    );
    expect(model.result).toBe("1. [GET] https://example.com/ => [200]");
  });

  it("H3-3: resolves a link target whose path contains parentheses", () => {
    const model = commandSuccessModel(
      "screenshot",
      json({ result: "- [Screenshot](my (report).png)" }),
      { artifactBase: "/cwd" },
    );
    expect(model.result).toBe("- [Screenshot](/cwd/my (report).png)");
  });
});

describe("commandSuccessModel storage empty states (H3-4)", () => {
  it("H3-4: attaches found:false to an empty localstorage-list", () => {
    const model = commandSuccessModel(
      "localstorage-list",
      json({ result: "No localStorage items found" }),
    );
    expect(model.found).toBe(false);
  });

  it("H3-4: attaches found:false to an empty cookie-list", () => {
    const model = commandSuccessModel(
      "cookie-list",
      json({ result: "No cookies found" }),
    );
    expect(model.found).toBe(false);
  });

  it("H3-4: attaches found:false to a missing cookie-get", () => {
    const model = commandSuccessModel(
      "cookie-get",
      json({ result: "Cookie 'nope' not found" }),
    );
    expect(model.found).toBe(false);
  });

  it("H3-4: attaches found:false to a missing localstorage-get", () => {
    const model = commandSuccessModel(
      "localstorage-get",
      json({ result: "localStorage key 'nope' not found" }),
    );
    expect(model.found).toBe(false);
  });

  it("H3-4: does not attach found:false when storage has items", () => {
    const model = commandSuccessModel(
      "cookie-list",
      json({ result: "a=1 (domain: example.com)" }),
    );
    expect(model.found).toBeUndefined();
  });

  it("H3-4: does not attach found:false to non-storage commands", () => {
    const model = commandSuccessModel(
      "requests",
      json({ result: "No requests captured" }),
    );
    expect(model.found).toBeUndefined();
  });

  // ---- D-2..D-8: dogfooding fixes ----

  it("D-2: snapshot writes inline text to a file and returns { file }", () => {
    let written: { path: string; contents: string } | undefined;
    const model = commandSuccessModel(
      "snapshot",
      json({ snapshot: "- generic [ref=e1]: hi" }),
      {
        writeFile: (path, contents) => {
          written = { path, contents };
        },
        snapshotDir: "/cache",
        snapshotName: "page-x",
      },
    );
    expect(written?.contents).toBe("- generic [ref=e1]: hi");
    expect(written?.path).toBe("/cache/.playwright-cli/page-x.yml");
    expect(model.snapshot).toEqual({ file: "/cache/.playwright-cli/page-x.yml" });
  });

  it("D-2: snapshot falls back to inline text when no writer is injected", () => {
    const model = commandSuccessModel(
      "snapshot",
      json({ snapshot: "- generic [ref=e1]: hi" }),
    );
    expect(model.snapshot).toBe("- generic [ref=e1]: hi");
  });

  it("D-3: tab-list returns one structured tab_rows table (no markdown)", () => {
    const model = commandSuccessModel(
      "tab-list",
      json({
        result:
          "- 0: (current) [The Internet](https://the-internet.herokuapp.com/windows)\n" +
          "- 1: [New Window](https://the-internet.herokuapp.com/windows/new)",
      }),
    );
    expect(toToon(model)).not.toContain("result: result:");
    expect(toToon(model)).toContain("tabs:");
    expect(toToon(model)).toContain("tab_rows[2]");
    // D-4: the real URL survives, unmangled.
    expect(toToon(model)).toContain(
      "https://the-internet.herokuapp.com/windows/new",
    );
    expect(toToon(model)).not.toContain("https:/the-internet");
  });

  it("D-3: tab-select is not double-nested (no result.result)", () => {
    const model = commandSuccessModel(
      "tab-select",
      json({
        result: "- 0: [A](https://a/)\n- 1: (current) [B](https://b/)",
      }),
    );
    expect(toToon(model)).toContain("tab_rows[2]");
    expect(toToon(model)).not.toContain("result: result:");
  });

  it("D-7: console returns structured totals + messages table, not a display string", () => {
    const model = commandSuccessModel(
      "console",
      json({
        result:
          "Total messages: 2 (Errors: 1, Warnings: 1)\n\n" +
          "[ERROR] boom @ :0\n[WARNING] careful @ :0",
      }),
    );
    const out = toToon(model);
    expect(out).toContain("totals:");
    expect(out).toContain("errors: 1");
    expect(out).toContain("messages[2]");
    expect(out).toContain("boom");
    expect(out).not.toContain("Total messages:");
  });

  it("D-7: pdf lifts the file link into a structured `file` field", () => {
    const model = commandSuccessModel(
      "pdf",
      json({ result: "- [Page as pdf](./out/page.pdf)" }),
      { artifactBase: "/cwd" },
    );
    expect(model.file).toBe("/cwd/out/page.pdf");
  });

  it("D-5: check reports the target ref's checked state + a snapshot file", () => {
    let written: string | undefined;
    const model = commandSuccessModel("check", json({}), {
      writeFile: (_path, contents) => {
        written = contents;
      },
      postSnapshot: {
        text: '- checkbox [checked] [ref=e10]\n- checkbox [ref=e11]',
        dir: "/cache",
        name: "after",
      },
      targetRef: "e10",
    });
    expect(written).toContain("[checked]");
    expect(model.checked).toBe(true);
    expect(model.snapshot).toEqual({ file: "/cache/.playwright-cli/after.yml" });
  });

  it("D-5: uncheck reports checked:false when the ref is unchecked", () => {
    const model = commandSuccessModel("uncheck", json({}), {
      postSnapshot: {
        text: '- checkbox [ref=e10]\n- checkbox [checked] [ref=e11]',
        dir: "/cache",
        name: "after",
      },
      targetRef: "e10",
    });
    expect(model.checked).toBe(false);
  });

  it("D-1: standalone dialog-accept surfaces handled:true (not a silent {})", () => {
    const model = commandSuccessModel("dialog-accept", json({}));
    expect(model.handled).toBe(true);
    expect(model.action).toBe("accept");
  });

  it("D-1: standalone dialog-dismiss surfaces handled:true", () => {
    const model = commandSuccessModel("dialog-dismiss", json({}));
    expect(model.handled).toBe(true);
    expect(model.action).toBe("dismiss");
  });
});
