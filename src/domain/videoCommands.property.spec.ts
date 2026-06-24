import fc, { type Arbitrary } from "fast-check";
import { describe, expect, it } from "vitest";

import {
	asyncPropertyOptions,
	parsedJson,
	parsedText,
	propertyOptions,
	safeArgArb,
	videoSizeArb,
} from "../test/arbitraries.js";
import type { UpstreamRun } from "../upstream/runner.js";
import type { VideoCommandName } from "./commandSurface.js";
import {
	extractVideoArtifacts,
	extractVideoLinks,
	handleVideoCommand,
	validateVideoCommand,
	videoStartConflictMessage,
	videoStartConflicts,
} from "./videoCommands.js";
import {
	defaultVideoState,
	type VideoSidecarState,
	type VideoStore,
} from "./videoState.js";

const durationArb = fc.integer({ min: 0, max: 10_000 }).map(String);
const positionArb = fc.constantFrom(
	"top-left",
	"top",
	"top-right",
	"bottom-left",
	"bottom",
	"bottom-right",
);
const cursorArb = fc.constantFrom("pointer", "none");
const videoCommandArb = fc.constantFrom<VideoCommandName>(
	"video-start",
	"video-stop",
	"video-chapter",
	"video-show-actions",
	"video-hide-actions",
);

class MemoryVideoStore implements VideoStore {
	path = "/memory/video-state.json";
	#state: VideoSidecarState;

	constructor(state = defaultVideoState("/repo", "key", "default")) {
		this.#state = structuredClone(state);
	}

	async load(): Promise<VideoSidecarState> {
		return structuredClone(this.#state);
	}

	async loadAllForCwd() {
		return [{ path: this.path, state: await this.load() }];
	}

	async loadAll() {
		return [{ path: this.path, state: await this.load() }];
	}

	async save(state: VideoSidecarState): Promise<void> {
		this.#state = structuredClone(state);
	}
}

type ValidCase = { command: VideoCommandName; args: readonly string[] };

const validCaseArb: Arbitrary<ValidCase> = fc.oneof(
	fc
		.record({
			file: fc.option(safeArgArb, { nil: undefined }),
			size: fc.option(videoSizeArb, { nil: undefined }),
		})
		.map(({ file, size }) => ({
			command: "video-start" as const,
			args: [...(file ? [file] : []), ...(size ? ["--size", size] : [])],
		})),
	fc.constant({ command: "video-stop", args: [] }),
	fc
		.record({
			title: safeArgArb,
			description: fc.option(safeArgArb, { nil: undefined }),
			duration: fc.option(durationArb, { nil: undefined }),
		})
		.map(({ title, description, duration }) => ({
			command: "video-chapter" as const,
			args: [
				title,
				...(description ? ["--description", description] : []),
				...(duration ? ["--duration", duration] : []),
			],
		})),
	fc
		.record({
			duration: fc.option(durationArb, { nil: undefined }),
			position: fc.option(positionArb, { nil: undefined }),
			cursor: fc.option(cursorArb, { nil: undefined }),
		})
		.map(({ duration, position, cursor }) => ({
			command: "video-show-actions" as const,
			args: [
				...(duration ? ["--duration", duration] : []),
				...(position ? ["--position", position] : []),
				...(cursor ? ["--cursor", cursor] : []),
			],
		})),
	fc.constant({ command: "video-hide-actions", args: [] }),
);

describe("videoCommands properties", () => {
	it("accepts generated valid argv shapes for every video command", () => {
		fc.assert(
			fc.property(validCaseArb, ({ command, args }) => {
				expect(validateVideoCommand(command, [...args]).ok).toBe(true);
			}),
			propertyOptions,
		);
	});

	it("rejects unknown flags for every video command", () => {
		fc.assert(
			fc.property(videoCommandArb, (command) => {
				expect(
					validateVideoCommand(command, ["--unknown-pbt-flag", "value"]).ok,
				).toBe(false);
			}),
			propertyOptions,
		);
	});

	it("rejects generated invalid enum and duration perturbations", () => {
		fc.assert(
			fc.property(
				fc.constantFrom("", "-1", "1.5", "abc", "1ms"),
				(badDuration) => {
					expect(
						validateVideoCommand("video-chapter", [
							"Title",
							"--duration",
							badDuration,
						]).ok,
					).toBe(false);
					expect(
						validateVideoCommand("video-show-actions", [
							"--duration",
							badDuration,
						]).ok,
					).toBe(false);
					expect(
						validateVideoCommand("video-show-actions", [
							"--position",
							"left-ish",
						]).ok,
					).toBe(false);
					expect(
						validateVideoCommand("video-show-actions", ["--cursor", "hand"]).ok,
					).toBe(false);
				},
			),
			propertyOptions,
		);
	});

	it("extracts markdown video links in order before falling back to JSON arrays", () => {
		fc.assert(
			fc.property(
				fc.array(fc.tuple(safeArgArb, safeArgArb), { maxLength: 10 }),
				fc.constantFrom("files", "videos", "lastFiles"),
				fc.array(fc.oneof(safeArgArb, fc.integer(), fc.boolean()), {
					maxLength: 10,
				}),
				(links, key, jsonEntries) => {
					const markdown = links
						.map(([label, href]) => `[${label}](${href})`)
						.join("\n");
					expect(extractVideoLinks(parsedText(markdown))).toEqual(
						links.map(([, href]) => href),
					);

					const expectedJsonLinks = jsonEntries.filter(
						(entry): entry is string => typeof entry === "string",
					);
					expect(extractVideoLinks(parsedJson({ [key]: jsonEntries }))).toEqual(
						expectedJsonLinks,
					);
				},
			),
			propertyOptions,
		);
	});

	it("types video artifacts separately from related non-video artifacts", () => {
		fc.assert(
			fc.property(
				fc.array(
					safeArgArb.map((path) => `${path}.webm`),
					{ maxLength: 10 },
				),
				fc.array(
					safeArgArb.map((path) => `${path}.zip`),
					{ maxLength: 10 },
				),
				(videos, traces) => {
					const markdown = [
						...videos.map((path) => `[Video](${path})`),
						...traces.map((path) => `[Trace](${path})`),
					].join("\n");
					const artifacts = extractVideoArtifacts(parsedText(markdown));

					expect(artifacts.videos).toEqual(videos);
					expect(artifacts.otherArtifacts).toEqual(traces);
					expect(artifacts.all).toEqual([...videos, ...traces]);
				},
			),
			propertyOptions,
		);
	});

	it("keeps video labels and WebM extensions in the video artifact bucket", () => {
		const artifacts = extractVideoArtifacts(
			parsedText("[Video](./trace.zip)\n[Trace](./movie.webm)"),
		);

		expect(artifacts.videos).toEqual(["./trace.zip", "./movie.webm"]);
		expect(artifacts.otherArtifacts).toEqual([]);
		expect(artifacts.all).toEqual(["./trace.zip", "./movie.webm"]);
	});

	it("keeps generated successful command sequences consistent with a simple video-state model", async () => {
		type Step =
			| { kind: "start"; file: string; size?: string }
			| { kind: "stop" }
			| { kind: "chapter"; title: string }
			| { kind: "show" }
			| { kind: "hide" };

		const stepArb: Arbitrary<Step> = fc.oneof(
			fc.record({
				kind: fc.constant("start"),
				file: safeArgArb,
				size: fc.option(videoSizeArb, { nil: undefined }),
			}),
			fc.constant({ kind: "stop" }),
			fc.record({ kind: fc.constant("chapter"), title: safeArgArb }),
			fc.constant({ kind: "show" }),
			fc.constant({ kind: "hide" }),
		);

		await fc.assert(
			fc.asyncProperty(fc.array(stepArb, { maxLength: 20 }), async (steps) => {
				const store = new MemoryVideoStore();
				const model = defaultVideoState("/repo", "key", "default");
				const upstreamCalls: string[][] = [];
				const upstream = async (argv: string[]): Promise<UpstreamRun> => {
					upstreamCalls.push(argv);
					const command = argv[0];
					return {
						argv,
						exitCode: 0,
						stdout:
							command === "video-start"
								? "Video recording started."
								: command === "video-stop"
									? "- [Video](./out.webm)"
									: "ok",
						stderr: "",
						usedJson: false,
					};
				};

				for (const step of steps) {
					const beforeCalls = upstreamCalls.length;
					const argv = argvForStep(step);
					const result = await handleVideoCommand({
						argv,
						upstream,
						store,
						now: () => new Date("2026-06-23T20:00:00.000Z"),
						pageOpenChecker: async () => "open",
					});

					if (step.kind === "start" && model.recording.status === "active") {
						// New video-start contract (AXI principle 6): while active, a
						// request for the SAME target (file AND size) is an idempotent
						// exit-0 no-op, while a DIFFERENT file or size is an exit-2
						// conflict. Neither calls upstream nor mutates state.
						const sameFile = step.file === model.recording.requestedFile;
						const sameSize =
							step.size === undefined ||
							step.size === model.recording.requestedSize;
						const sameTarget = sameFile && sameSize;
						expect(result.exitCode).toBe(sameTarget ? 0 : 2);
						expect(upstreamCalls).toHaveLength(beforeCalls);
					} else {
						expect(result.exitCode).toBe(0);
						expect(upstreamCalls).toHaveLength(beforeCalls + 1);
						applyStep(model, step);
					}

					if (step.kind === "start" && model.recording.status !== "active") {
						model.recording.requestedSize = step.size;
					}
					const actual = await store.load();
					expect(actual.recording.status).toBe(model.recording.status);
					expect(actual.recording.requestedFile).toBe(
						model.recording.requestedFile,
					);
					expect(actual.lastFiles).toEqual(model.lastFiles);
					expect(actual.actionsOverlay.status).toBe(
						model.actionsOverlay.status,
					);
					expect(actual.chapters.map((chapter) => chapter.title)).toEqual(
						model.chapters.map((chapter) => chapter.title),
					);
				}
			}),
			asyncPropertyOptions,
		);
	});
});

function argvForStep(step: {
	kind: string;
	file?: string;
	size?: string;
	title?: string;
}): string[] {
	switch (step.kind) {
		case "start":
			return [
				"video-start",
				step.file ?? "out.webm",
				...(step.size ? ["--size", step.size] : []),
			];
		case "stop":
			return ["video-stop"];
		case "chapter":
			return ["video-chapter", step.title ?? "Chapter"];
		case "show":
			return ["video-show-actions"];
		case "hide":
			return ["video-hide-actions"];
		default:
			throw new Error(`unknown step ${step.kind}`);
	}
}

function applyStep(
	state: VideoSidecarState,
	step: { kind: string; file?: string; size?: string; title?: string },
): void {
	switch (step.kind) {
		case "start":
			state.recording = {
				status: "active",
				requestedFile: step.file,
				...(step.size ? { requestedSize: step.size } : {}),
			};
			state.lastFiles = [];
			break;
		case "stop":
			state.recording = { ...state.recording, status: "inactive" };
			state.lastFiles = ["./out.webm"];
			break;
		case "chapter":
			state.chapters.push({
				title: step.title ?? "Chapter",
				createdAt: "2026-06-23T20:00:00.000Z",
			});
			break;
		case "show":
			state.actionsOverlay = {
				status: "enabled",
				updatedAt: "2026-06-23T20:00:00.000Z",
			};
			break;
		case "hide":
			state.actionsOverlay = {
				status: "disabled",
				updatedAt: "2026-06-23T20:00:00.000Z",
			};
			break;
	}
}

describe("properties: video-start while active (AXI idempotency)", () => {
	it("a request never conflicts when it specifies no new target", () => {
		const state = defaultVideoState("/repo", "key", "default");
		state.recording = {
			status: "active",
			requestedFile: "./rec.webm",
			requestedSize: "320x240",
		};
		expect(videoStartConflicts(state, { positionals: [], flags: {} })).toBe(
			false,
		);
	});

	it("classifies same-target requests as no-conflict and differing targets as conflict", () => {
		const activeFile = "./active.webm";
		const activeSize = "320x240";
		const state = defaultVideoState("/repo", "key", "default");
		state.recording = {
			status: "active",
			requestedFile: activeFile,
			requestedSize: activeSize,
		};
		fc.assert(
			fc.property(
				fc.option(safeArgArb, { nil: undefined }),
				fc.option(videoSizeArb, { nil: undefined }),
				(file, size) => {
					const flags: Record<string, string> =
						size === undefined ? {} : { size };
					const conflicts = videoStartConflicts(state, {
						positionals: file === undefined ? [] : [file],
						flags,
					});
					const fileDiffers = file !== undefined && file !== activeFile;
					const sizeDiffers = size !== undefined && size !== activeSize;
					expect(conflicts).toBe(fileDiffers || sizeDiffers);
				},
			),
			propertyOptions,
		);
	});

	it("always suggests video-stop in a conflict message naming the active target", () => {
		const state = defaultVideoState("/repo", "key", "default");
		state.recording = {
			status: "active",
			requestedFile: "./active.webm",
			requestedSize: "320x240",
		};
		fc.assert(
			fc.property(safeArgArb, (file) => {
				const message = videoStartConflictMessage(state, {
					positionals: [file],
					flags: {},
				});
				expect(message).toContain("already active");
				expect(message).toContain("./active.webm");
				expect(message).toContain("video-stop");
				expect(message).toContain(`file ${file}`);
			}),
			propertyOptions,
		);
	});
});
