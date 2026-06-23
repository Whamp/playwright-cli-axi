import { describe, expect, it } from "vitest";

import { upstreamHelpPreviewToStdout } from "./help.js";

describe("upstreamHelpPreviewToStdout", () => {
	it("should render a compact trimmed preview and mark truncation", () => {
		// Arrange
		const text = Array.from(
			{ length: 42 },
			(_, index) => `line ${index + 1}`,
		).join("\n\n");

		// Act
		const output = upstreamHelpPreviewToStdout("install-browser", text);

		// Assert
		expect(output).toContain("command: install-browser");
		expect(output).toContain("source: @playwright/cli");
		expect(output).toContain(`bytes: ${text.length}`);
		expect(output).toContain("lines: 40");
		expect(output).toContain("truncated: true");
		expect(output).toContain("lines[40]:");
		expect(output).toContain("- line 1");
		expect(output).not.toContain("line 41");
	});

	it("should keep an exact 40-line preview untruncated", () => {
		// Arrange
		const text = Array.from(
			{ length: 40 },
			(_, index) => `line ${index + 1}`,
		).join("\n");

		// Act
		const output = upstreamHelpPreviewToStdout("install-browser", text);

		// Assert
		expect(output).toContain(`bytes: ${text.length}`);
		expect(output).toContain("lines: 40");
		expect(output).toContain("truncated: false");
		expect(output).toContain("lines[40]:");
		expect(output).toContain("- line 40");
	});

	it("should keep short previews untruncated", () => {
		// Arrange
		const text = "playwright-cli install-browser [browser]\n\nInstall browser";

		// Act
		const output = upstreamHelpPreviewToStdout("install-browser", text);

		// Assert
		expect(output).toContain(`bytes: ${text.length}`);
		expect(output).toContain("lines: 2");
		expect(output).toContain("truncated: false");
		expect(output).toContain('- "playwright-cli install-browser [browser]"');
		expect(output).toContain("- Install browser");
	});
});
