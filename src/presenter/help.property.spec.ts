import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { propertyOptions, safeLineArb } from "../test/arbitraries.js";
import { upstreamHelpPreviewToStdout } from "./help.js";

describe("upstreamHelpPreviewToStdout properties", () => {
	it("reports generated help-preview byte, line, and truncation invariants", () => {
		fc.assert(
			fc.property(fc.array(safeLineArb, { maxLength: 80 }), (rawLines) => {
				const text = rawLines.join("\n\n");
				const normalizedLines = text
					.split("\n")
					.map((line) => line.trimEnd())
					.filter((line) => line.length > 0);
				const preview = normalizedLines.slice(0, 40);

				const output = upstreamHelpPreviewToStdout("install-browser", text);

				expect(output).toContain("command: install-browser");
				expect(output).toContain(`bytes: ${text.length}`);
				expect(output).toContain(`lines: ${preview.length}`);
				expect(output).toContain(`truncated: ${normalizedLines.length > preview.length}`);
				expect(output).toContain(`lines[${preview.length}]:`);
				expect(output).not.toContain("\r");
				expect(output.endsWith("\n")).toBe(false);
			}),
			propertyOptions,
		);
	});
});
