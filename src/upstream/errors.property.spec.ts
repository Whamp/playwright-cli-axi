import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { propertyOptions, safeLineArb } from "../test/arbitraries.js";
import { normalizeUpstreamError } from "./errors.js";
import { parseUpstreamOutput } from "./parse.js";
import type { UpstreamRun } from "./runner.js";

function failedRun(stderr: string): UpstreamRun {
  return { argv: ["open"], exitCode: 1, stdout: "", stderr, usedJson: false };
}

describe("normalizeUpstreamError missing_browser enrichment (F-2)", () => {
  it("names the override env var + detected browser when browsers were detected", () => {
    const stderr =
      "Executable does not exist at /tmp/chrome-for-testing\nPlease run: playwright-cli install-browser chrome-for-testing";
    const parsed = parseUpstreamOutput("", stderr, 1);
    const run: UpstreamRun = {
      argv: ["open"],
      exitCode: 1,
      stdout: "",
      stderr,
      usedJson: false,
      detectedBrowsers: [{ path: "/usr/bin/chromium", channel: "chromium" }],
    };
    const result = normalizeUpstreamError(["open"], run, parsed);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("kind: missing_browser");
    expect(result.stdout).toContain(
      "PLAYWRIGHT_MCP_EXECUTABLE_PATH=/usr/bin/chromium",
    );
  });

  it("falls back to install-browser suggestion when no browser was detected", () => {
    const stderr =
      "Executable does not exist\nPlease run: playwright-cli install-browser chrome-for-testing";
    const parsed = parseUpstreamOutput("", stderr, 1);
    const result = normalizeUpstreamError(["open"], failedRun(stderr), parsed);
    expect(result.stdout).toContain(
      "playwright-cli-axi install-browser chrome-for-testing",
    );
    expect(result.stdout).toContain(
      "PLAYWRIGHT_MCP_EXECUTABLE_PATH=<path-to-chrome-or-chromium>",
    );
  });
});

describe("normalizeUpstreamError screenshot usage hint (P-3)", () => {
  it("names --filename inline for a screenshot unknown-option error", () => {
    const stderr = "unknown option: --path";
    const parsed = parseUpstreamOutput("", stderr, 2);
    const result = normalizeUpstreamError(
      ["screenshot", "--path", "./x.png"],
      {
        argv: ["screenshot"],
        exitCode: 2,
        stdout: "",
        stderr,
        usedJson: false,
      },
      parsed,
    );
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("--filename <path>");
    expect(result.stdout).toContain("positional is an element target");
  });
});

describe("normalizeUpstreamError properties", () => {
  it("classifies generated browser-not-open messages as browser_not_open", () => {
    fc.assert(
      fc.property(safeLineArb, safeLineArb, (prefix, suffix) => {
        const stderr = `${prefix}\nThe browser 'default' is not open, please run open first\n${suffix}`;
        const parsed = parseUpstreamOutput("", stderr, 1);

        const result = normalizeUpstreamError(
          ["request", "1"],
          failedRun(stderr),
          parsed,
        );

        expect(result.exitCode).toBe(1);
        expect(result.stdout).toContain("kind: browser_not_open");
        expect(result.stdout).toContain("playwright-cli-axi open [url]");
      }),
      propertyOptions,
    );
  });

  it("classifies generated missing-browser messages and rewrites install help to the wrapper", () => {
    fc.assert(
      fc.property(safeLineArb, safeLineArb, (prefix, suffix) => {
        const stderr = `${prefix}\nExecutable does not exist at /tmp/chrome-for-testing\nPlease run: playwright-cli install-browser chrome-for-testing\n${suffix}`;
        const parsed = parseUpstreamOutput("", stderr, 1);

        const result = normalizeUpstreamError(
          ["open"],
          failedRun(stderr),
          parsed,
        );

        expect(result.exitCode).toBe(1);
        expect(result.stdout).toContain("kind: missing_browser");
        expect(result.stdout).toContain(
          "playwright-cli-axi install-browser chrome-for-testing",
        );
        expect(result.stdout).not.toContain("playwright-cli install-browser");
      }),
      propertyOptions,
    );
  });

  it("classifies generated usage failures as exit-code 2 usage errors", () => {
    fc.assert(
      fc.property(safeLineArb, safeLineArb, (prefix, suffix) => {
        const stderr = `${prefix}\nunknown option --bad\n${suffix}`;
        const parsed = parseUpstreamOutput("", stderr, 1);

        const result = normalizeUpstreamError(
          ["goto"],
          failedRun(stderr),
          parsed,
        );

        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain("kind: usage");
        expect(result.stdout).toContain("playwright-cli-axi goto --help");
      }),
      propertyOptions,
    );
  });

  it("uses the parsed command name for usage help when global flags precede the command", () => {
    fc.assert(
      fc.property(safeLineArb, (session) => {
        const stderr = "unknown option --bad";
        const parsed = parseUpstreamOutput("", stderr, 1);

        const result = normalizeUpstreamError(
          ["--session", session, "goto", "--bad"],
          failedRun(stderr),
          parsed,
        );

        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain("kind: usage");
        expect(result.stdout).toContain("playwright-cli-axi goto --help");
        expect(result.stdout).not.toContain(
          "playwright-cli-axi --session --help",
        );
      }),
      propertyOptions,
    );
  });

  it("classifies unknown commands as usage errors with root help", () => {
    fc.assert(
      fc.property(safeLineArb, (command) => {
        const stderr = `Unknown command: ${command}`;
        const parsed = parseUpstreamOutput(
          "playwright-cli [command]",
          stderr,
          1,
        );

        const result = normalizeUpstreamError(
          [command],
          failedRun(stderr),
          parsed,
        );

        expect(result.exitCode).toBe(2);
        expect(result.stdout).toContain("kind: usage");
        expect(result.stdout).toContain("playwright-cli-axi --help");
      }),
      propertyOptions,
    );
  });
});
