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

	it("should format non-empty browser rows for list results", () => {
		// Arrange
		const parsed = {
			kind: "json",
			value: {
				browsers: [{ id: "browser-1", name: "Chromium", status: "open" }],
			},
			isError: false,
		} as const;

		// Act
		const output = toToon(commandSuccessModel("list", parsed));

		// Assert
		expect(output).toContain("browsers:\n  count: 1");
		expect(output).toContain("browser_rows[1]{id,name,status}:");
		expect(output).toContain("browser-1,Chromium,open");
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
