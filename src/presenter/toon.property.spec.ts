import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { propertyOptions, safeToonValueArb, toonTableArb } from "../test/arbitraries.js";
import { toToon } from "./toon.js";

describe("toToon properties", () => {
	it("renders generated safe TOON values without violating output invariants", () => {
		fc.assert(
			fc.property(safeToonValueArb, (value) => {
				const output = toToon(value);

				expect(output).not.toContain("\r");
				expect(output.endsWith("\n")).toBe(false);
				expect(output.split("\n").some((line) => /\s$/.test(line))).toBe(false);
				expect(output).not.toContain("undefined");
			}),
			propertyOptions,
		);
	});

	it("renders generated tables with row counts that match their data", () => {
		fc.assert(
			fc.property(toonTableArb, (rows) => {
				const output = toToon({ rows });

				expect(output).toContain(`rows[${rows.rows.length}]{${rows.fields.join(",")}}:`);
				expect(output).not.toContain("\r");
				expect(output.endsWith("\n")).toBe(false);
			}),
			propertyOptions,
		);
	});

	it("canonicalizes non-finite numeric scalars and negative zero", () => {
		expect(toToon(Number.NaN)).toBe("null");
		expect(toToon(Number.POSITIVE_INFINITY)).toBe("null");
		expect(toToon(Number.NEGATIVE_INFINITY)).toBe("null");
		expect(toToon(-0)).toBe("0");
	});

	it("treats malformed table sentinels as plain objects rather than crashing", () => {
		fc.assert(
			fc.property(safeToonValueArb, (value) => {
				const malformed = { __toon: "table", value } as const;

				const output = toToon(malformed);

				expect(output).toContain("__toon: table");
				expect(output).not.toContain("\r");
			}),
			propertyOptions,
		);
	});
});
