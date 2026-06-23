import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { jsonValueArb, propertyOptions } from "../test/arbitraries.js";
import { parseUpstreamOutput, sanitizeDependencyText } from "./parse.js";

describe("parseUpstreamOutput properties", () => {
	it("roundtrips any JSON-safe stdout value and derives JSON error metadata", () => {
		fc.assert(
			fc.property(jsonValueArb, fc.string(), fc.integer(), (value, stderr, exitCode) => {
				const stdout = JSON.stringify(value);
				const expectedValue = JSON.parse(stdout) as unknown;
				const parsed = parseUpstreamOutput(stdout, stderr, exitCode);

				expect(parsed.kind).toBe("json");
				if (parsed.kind !== "json") return;
				expect(parsed.value).toEqual(expectedValue);
				const expectedIsError =
					typeof expectedValue === "object" &&
					expectedValue !== null &&
					!Array.isArray(expectedValue) &&
					(expectedValue as { isError?: unknown }).isError === true;
				expect(parsed.isError).toBe(expectedIsError);
				const expectedError =
					expectedIsError && typeof (expectedValue as { error?: unknown }).error === "string"
						? (expectedValue as { error: string }).error
						: undefined;
				expect(parsed.error).toBe(expectedError);
			}),
			propertyOptions,
		);
	});

	it("treats non-empty non-JSON stdout as authoritative over stderr", () => {
		fc.assert(
			fc.property(fc.string(), fc.integer(), (suffix, exitCode) => {
				const stdout = `not-json:${suffix}`;
				const parsed = parseUpstreamOutput(stdout, "Error: hidden stderr", exitCode);

				expect(parsed.kind).toBe("text");
				if (parsed.kind !== "text") return;
				expect(parsed.text).toBe(stdout.trim());
				expect(parsed.text).not.toContain("hidden stderr");
				expect(parsed.isError).toBe(exitCode !== 0);
				expect(parsed.error).toBe(exitCode !== 0 ? stdout.trim() : undefined);
			}),
			propertyOptions,
		);
	});

	it("sanitizes dependency text idempotently with bounded non-stack output", () => {
		fc.assert(
			fc.property(fc.string(), (text) => {
				const sanitized = sanitizeDependencyText(text);

				expect(sanitizeDependencyText(sanitized)).toBe(sanitized);
				const lines = sanitized.length === 0 ? [] : sanitized.split("\n");
				expect(lines.length).toBeLessThanOrEqual(8);
				for (const line of lines) {
					expect(line.trim().length).toBeGreaterThan(0);
					expect(/^\s*at\s/.test(line)).toBe(false);
					expect(/^Error:\s*$/.test(line.trim())).toBe(false);
					expect(/node:internal\//.test(line)).toBe(false);
				}
			}),
			propertyOptions,
		);
	});
});
