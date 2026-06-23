import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { propertyOptions, safeLineArb } from "../test/arbitraries.js";
import { parseUpstreamOutput } from "./parse.js";
import type { UpstreamRun } from "./runner.js";
import { normalizeUpstreamError } from "./errors.js";

function failedRun(stderr: string): UpstreamRun {
	return { argv: ["open"], exitCode: 1, stdout: "", stderr, usedJson: false };
}

describe("normalizeUpstreamError properties", () => {
	it("classifies generated browser-not-open messages as browser_not_open", () => {
		fc.assert(
			fc.property(safeLineArb, safeLineArb, (prefix, suffix) => {
				const stderr = `${prefix}\nThe browser 'default' is not open, please run open first\n${suffix}`;
				const parsed = parseUpstreamOutput("", stderr, 1);

				const result = normalizeUpstreamError(["request", "1"], failedRun(stderr), parsed);

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

				const result = normalizeUpstreamError(["open"], failedRun(stderr), parsed);

				expect(result.exitCode).toBe(1);
				expect(result.stdout).toContain("kind: missing_browser");
				expect(result.stdout).toContain("playwright-cli-axi install-browser chrome-for-testing");
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

				const result = normalizeUpstreamError(["goto"], failedRun(stderr), parsed);

				expect(result.exitCode).toBe(2);
				expect(result.stdout).toContain("kind: usage");
				expect(result.stdout).toContain("playwright-cli-axi goto --help");
			}),
			propertyOptions,
		);
	});
});
