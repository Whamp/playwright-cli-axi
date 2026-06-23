import { CATALOG } from "../content/catalog.js";
import { type ToonValue, table, toToon } from "./toon.js";

interface HelpDefinition {
	command: string;
	summary: string;
	usage: string;
	args: { name: string; required: boolean; description: string }[];
	flags: {
		name: string;
		value: string;
		default: string;
		description: string;
	}[];
	examples: string[];
}

const VIDEO_HELP: Record<string, HelpDefinition> = {
	"video-start": {
		command: "video-start",
		summary: CATALOG.videoCommands["video-start"],
		usage:
			"playwright-cli-axi video-start [filename] [--size <width>x<height>]",
		args: [
			{
				name: "filename",
				required: false,
				description: "WebM path requested from upstream",
			},
		],
		flags: [
			{
				name: "--size",
				value: "<width>x<height>",
				default: "fit 800x800",
				description: "video frame size such as 800x600",
			},
		],
		examples: [
			"playwright-cli-axi video-start ./recording.webm --size 800x600",
			"playwright-cli-axi video-stop",
		],
	},
	"video-stop": {
		command: "video-stop",
		summary: CATALOG.videoCommands["video-stop"],
		usage: "playwright-cli-axi video-stop",
		args: [],
		flags: [],
		examples: ["playwright-cli-axi video-stop", "playwright-cli-axi"],
	},
	"video-chapter": {
		command: "video-chapter",
		summary: CATALOG.videoCommands["video-chapter"],
		usage:
			"playwright-cli-axi video-chapter <title> [--description <text>] [--duration <ms>]",
		args: [
			{
				name: "title",
				required: true,
				description: "chapter title; quote multi-word titles",
			},
		],
		flags: [
			{
				name: "--description",
				value: "<text>",
				default: "",
				description: "optional chapter card description",
			},
			{
				name: "--duration",
				value: "<ms>",
				default: "upstream default",
				description: "milliseconds to show the chapter card",
			},
		],
		examples: [
			'playwright-cli-axi video-chapter Smoke --description "AXI smoke" --duration 500',
			"playwright-cli-axi video-stop",
		],
	},
	"video-show-actions": {
		command: "video-show-actions",
		summary: CATALOG.videoCommands["video-show-actions"],
		usage:
			"playwright-cli-axi video-show-actions [--duration <ms>] [--position <enum>] [--cursor <enum>]",
		args: [],
		flags: [
			{
				name: "--duration",
				value: "<ms>",
				default: "500",
				description: "milliseconds each action annotation remains visible",
			},
			{
				name: "--position",
				value: "top-left|top|top-right|bottom-left|bottom|bottom-right",
				default: "top-right",
				description: "where to place the action title",
			},
			{
				name: "--cursor",
				value: "pointer|none",
				default: "pointer",
				description: "cursor decoration",
			},
		],
		examples: [
			"playwright-cli-axi video-show-actions --duration 100 --position top-right --cursor pointer",
			"playwright-cli-axi video-hide-actions",
		],
	},
	"video-hide-actions": {
		command: "video-hide-actions",
		summary: CATALOG.videoCommands["video-hide-actions"],
		usage: "playwright-cli-axi video-hide-actions",
		args: [],
		flags: [],
		examples: [
			"playwright-cli-axi video-hide-actions",
			"playwright-cli-axi video-stop",
		],
	},
};

export function helpToStdout(command?: string): string {
	if (command && VIDEO_HELP[command])
		return toToon(helpModel(VIDEO_HELP[command]));
	return toToon({
		command: CATALOG.binary,
		summary: CATALOG.description,
		usage: "playwright-cli-axi [command] [args]",
		video_commands: Object.entries(CATALOG.videoCommands).map(
			([name, summary]) => `${name}: ${summary}`,
		),
		examples: CATALOG.next,
	});
}

export function upstreamHelpPreviewToStdout(
	command: string,
	text: string,
): string {
	return toToon(upstreamHelpPreviewModel(command, text));
}

function upstreamHelpPreviewModel(command: string, text: string): ToonValue {
	const lines = text
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0);
	const preview = lines.slice(0, 40);
	return {
		command,
		help: {
			source: "@playwright/cli",
			bytes: text.length,
			lines: preview.length,
			truncated: lines.length > preview.length,
		},
		lines: preview,
	};
}

function helpModel(definition: HelpDefinition): ToonValue {
	return {
		command: definition.command,
		summary: definition.summary,
		usage: definition.usage,
		...(definition.args.length > 0
			? { args: table(["name", "required", "description"], definition.args) }
			: { args: { count: 0, empty: "no positional arguments" } }),
		...(definition.flags.length > 0
			? {
					flags: table(
						["name", "value", "default", "description"],
						definition.flags,
					),
				}
			: { flags: { count: 0, empty: "no flags" } }),
		examples: definition.examples,
	};
}
