import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
	asyncPropertyOptions,
	overlayStatusArb,
	propertyOptions,
	recordingStatusArb,
	safeArgArb,
	videoSizeArb,
} from "../test/arbitraries.js";
import {
	createVideoStore,
	defaultVideoState,
	reconcileVideoState,
	type VideoSidecarState,
} from "./videoState.js";

const isoTextArb = fc.stringMatching(/^2026-06-23T20:[0-5][0-9]:[0-5][0-9].000Z$/);

const statePayloadArb = fc.record({
	recording: fc.record({
		status: recordingStatusArb,
		requestedFile: safeArgArb,
		requestedSize: videoSizeArb,
		startedAt: isoTextArb,
		stoppedAt: isoTextArb,
	}),
	actionsOverlay: fc.record({ status: overlayStatusArb, updatedAt: isoTextArb }),
	chapters: fc.array(
		fc.record({
			title: safeArgArb,
			description: safeArgArb,
			duration: fc.integer({ min: 0, max: 10_000 }),
			createdAt: isoTextArb,
		}),
		{ maxLength: 5 },
	),
	lastFiles: fc.array(safeArgArb, { maxLength: 5 }),
	lastResult: safeArgArb,
	lastError: safeArgArb,
	warnings: fc.array(safeArgArb, { maxLength: 5 }),
});

describe("videoState properties", () => {
	it("roundtrips generated sidecar states through save/load", async () => {
		await fc.assert(
			fc.asyncProperty(safeArgArb, statePayloadArb, async (session, payload) => {
				const stateHome = await mkdtemp(join(tmpdir(), "playwright-cli-axi-pbt-"));
				try {
					const store = createVideoStore({
						cwd: "/repo",
						env: { XDG_STATE_HOME: stateHome },
						now: () => new Date("2026-06-23T20:00:00.000Z"),
						session,
					});
					const base = await store.load();
					const state: VideoSidecarState = { ...base, ...payload };

					await store.save(state);

					expect(await store.load()).toEqual(state);
				} finally {
					await rm(stateHome, { recursive: true, force: true });
				}
			}),
			asyncPropertyOptions,
		);
	});

	it("loadAllForCwd only returns states scoped to the requested cwd", async () => {
		await fc.assert(
			fc.asyncProperty(safeArgArb, safeArgArb, async (leftSession, rightSession) => {
				const stateHome = await mkdtemp(join(tmpdir(), "playwright-cli-axi-pbt-"));
				try {
					const left = createVideoStore({ cwd: "/left", env: { XDG_STATE_HOME: stateHome }, now: () => new Date(), session: leftSession });
					const right = createVideoStore({ cwd: "/right", env: { XDG_STATE_HOME: stateHome }, now: () => new Date(), session: rightSession });
					await left.save({ ...(await left.load()), recording: { status: "active" } });
					await right.save({ ...(await right.load()), recording: { status: "active" } });
					await writeFile(join(stateHome, "playwright-cli-axi", "bad.json"), "not-json", "utf8");

					const records = await left.loadAllForCwd();

					expect(records).toHaveLength(1);
					expect(records[0]?.state.scope).toMatchObject({ cwd: "/left", session: leftSession });
					expect(records.some((record) => record.state.scope.cwd === "/right")).toBe(false);
				} finally {
					await rm(stateHome, { recursive: true, force: true });
				}
			}),
			asyncPropertyOptions,
		);
	});

	it("reconciles stale active recordings idempotently with one deduped warning", () => {
		fc.assert(
			fc.property(fc.array(safeArgArb, { maxLength: 5 }), (warnings) => {
				const state = {
					...defaultVideoState("/repo", "key", "default"),
					recording: { status: "active" as const },
					warnings,
				};

				const once = reconcileVideoState(state, { browserCount: 0 });
				const twice = reconcileVideoState(once, { browserCount: 0 });
				const warning = "active recording sidecar has no live browser in list --all; state may be stale";

				expect(twice).toEqual(once);
				expect(once.recording.status).toBe("stale");
				expect(once.warnings.filter((entry) => entry === warning)).toHaveLength(1);
			}),
			propertyOptions,
		);
	});

	it("does not alter inactive or live active states during reconciliation", () => {
		fc.assert(
			fc.property(recordingStatusArb, fc.integer({ min: 1, max: 20 }), (status, browserCount) => {
				const state = { ...defaultVideoState("/repo", "key", "default"), recording: { status } };

				expect(reconcileVideoState(state, { browserCount })).toEqual(state);
			}),
			propertyOptions,
		);
	});
});
