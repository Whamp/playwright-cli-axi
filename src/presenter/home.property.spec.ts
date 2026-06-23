import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { overlayStatusArb, propertyOptions, recordingStatusArb, safeArgArb } from "../test/arbitraries.js";
import type { BrowserRow, SessionSummary } from "../domain/sessions.js";
import { defaultVideoState } from "../domain/videoState.js";
import { homeModel } from "./home.js";
import type { ToonTable } from "./toon.js";

const browserRowArb = fc.record({
	id: safeArgArb,
	name: safeArgArb,
	status: safeArgArb,
});

describe("homeModel properties", () => {
	it("preserves generated browser and video summary invariants", () => {
		fc.assert(
			fc.property(
				fc.array(browserRowArb, { maxLength: 10 }),
				recordingStatusArb,
				overlayStatusArb,
				fc.array(safeArgArb, { maxLength: 10 }),
				fc.array(safeArgArb, { maxLength: 10 }),
				fc.array(safeArgArb, { maxLength: 10 }),
				(browsers, recordingStatus, overlayStatus, files, chapters, warnings) => {
					const sessions: SessionSummary = {
						browsers: {
							count: browsers.length,
							empty: browsers.length === 0 ? "no open browsers" : undefined,
							rows: browsers as BrowserRow[],
						},
					};
					const video = {
						...defaultVideoState("/repo", "key", "default"),
						recording: { status: recordingStatus },
						actionsOverlay: { status: overlayStatus },
						lastFiles: files,
						chapters: chapters.map((title) => ({ title, createdAt: "2026-06-23T20:00:00.000Z" })),
						warnings,
					};

					const model = homeModel({
						executablePath: "/usr/local/bin/playwright-cli-axi",
						cwd: "/repo",
						upstreamVersion: "0.1.14",
						sessions,
						video,
					}) as Record<string, unknown>;

					expect(model.browsers).toEqual({
						count: browsers.length,
						...(browsers.length === 0 ? { empty: "no open browsers" } : {}),
					});
					expect("browser_rows" in model).toBe(browsers.length > 0);
					if (browsers.length > 0) {
						const browserRows = model.browser_rows as ToonTable;
						expect(browserRows.rows).toHaveLength(browsers.length);
					}
					expect(model.video).toMatchObject({
						status: recordingStatus,
						source: "sidecar",
						recording: recordingStatus === "active",
						files: files.length,
						chapters: chapters.length,
						actions: overlayStatus,
					});
					if (warnings.length > 0) expect(model.video).toMatchObject({ warnings: warnings.slice(-3) });
				},
			),
			propertyOptions,
		);
	});
});
