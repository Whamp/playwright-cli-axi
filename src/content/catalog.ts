import { COMMAND_GROUPS } from "../domain/upstreamCommands.js";

export const CATALOG = {
	binary: "playwright-cli-axi",
	description:
		"AXI-friendly Playwright browser control with TOON output and video state",
	npxBinary: "npx -y playwright-cli-axi",
	next: [
		"playwright-cli-axi open https://example.com",
		"playwright-cli-axi list --all",
		"playwright-cli-axi video-start ./recording.webm --size 800x600",
		"playwright-cli-axi video-stop",
		"playwright-cli-axi --help",
	] as string[],
	videoCommands: {
		"video-start":
			"Start recording the current browser session to an optional WebM file.",
		"video-stop":
			"Stop recording and report typed video artifacts returned by upstream.",
		"video-chapter": "Add a title card marker to the recording timeline.",
		"video-chapters":
			"Read the recorded chapter manifest with seek offsets (no sidecar parsing).",
		"video-status":
			"Print the full recording summary: status, files, chapters, actions, warnings.",
		"video-show-actions":
			"Overlay subsequent action names and target highlights on the page.",
		"video-hide-actions": "Stop overlaying action callouts on the page.",
	},
	commandGroups: COMMAND_GROUPS,
	wrapperCommands: {
		setup:
			"Install/repair the SessionStart hook so agent sessions start with live browser and video context.",
		context:
			"Print the token-budgeted session-start context slice (invoked by the hook).",
		scroll:
			"Scroll the page: --to <ref> (scrollIntoView), --top, --bottom, or --by <px> (only one action at a time).",
		wait: "Wait for a page load state (load|domcontentloaded|networkidle) without manual sleep. When used via the --wait flag on navigation commands, a wait failure surfaces as a wait_warning field on the successful result instead of masking the navigation.",
		find: "Look up labelled page data from the current snapshot by text/name (e.g. find Classrooms -> {value, ref}), pairing adjacent label/value nodes so KPIs and stats read as structured values instead of grepping a flat tree.",
	} as Record<string, string>,
};

/** C-2/C-4/C-1 doc sections for the generated skill. Kept as a plain
 * double-quoted multi-line string so the backticks need no template-literal
 * escaping; this is the single source of truth for these skill sections. */
const skillDocSections = [
  "### Navigation flags",
  "",
  "Navigation commands (`open`, `goto`, `click`, `dblclick`, etc.) support two optional flags for deterministic post-action state:",
  "",
  "- `--wait <state>` — Wait for a Playwright load state (`load|domcontentloaded|networkidle`) after the action. If the wait fails after a successful navigation, the primary result is returned with a `wait_warning` field instead of masking the success. Network-only waits may race SPA route mounting.",
  "- `--settle [state]` — Wait for the load state **and** poll `page.url()` until it stops changing (deterministic SPA settle). Default state is `networkidle`. Use this for SPA navigations where `--wait networkidle` does not settle the client-side route.",
  "",
  "### HTML5 validation probing",
  "",
  "After a submit-triggering `click` or `dblclick`, the wrapper probes HTML5 constraint validation and surfaces `validation: { ok: false, invalid_fields: [...] }` when the browser appears to have blocked the submit (focused an invalid field). HTML5 validation bubbles are not in the accessibility tree, so without this probing, a submit blocked by an invalid field looks identical to a successful submit. The primary click result and exit code are preserved either way.",
  "",
  "### Output improvements",
  "",
  "The wrapper enhances upstream output for agent usability:",
  "",
  "- **Flattened navigation results**: Commands like `open`, `goto`, and `click` return snapshot artifacts at the top level instead of buried under `result.result.snapshot`, making file paths immediately accessible.",
  "- **Readable snapshot rendering**: Snapshot content renders as readable single-layer text rather than double-escaped JSON-string-of-YAML, improving parseability.",
  "- **Enhanced error hints**: Usage errors for commands like `screenshot`, `pdf`, and `snapshot` include inline suggestions (e.g., `--filename <path>`) to reduce trial-and-error.",
  "- **Absolute snapshot paths**: Auto-generated snapshot file paths are returned as absolute paths so they're reliably findable regardless of the upstream artifact directory.",
  "- **Flattened eval results**: `eval` and `run-code` commands flatten their single return value to a top-level `result` and undo upstream's JSON encoding, so `eval` of `location.href` returns the URL directly instead of a double-nested, JSON-escaped string. Note: `eval` runs in the **browser DOM context** (no `page`); `run-code` runs in the **node context** and receives `page` (use an `async (page) => { ... }` arrow expression).",
].join("\n");

export function renderSkillMarkdown(): string {
	const commandLines = Object.entries(CATALOG.videoCommands)
		.map(([name, summary]) => `- \`${CATALOG.npxBinary} ${name}\` — ${summary}`)
		.join("\n");
	const wrapperLines = Object.entries(CATALOG.wrapperCommands)
		.map(([name, summary]) => `- \`${CATALOG.npxBinary} ${name}\` — ${summary}`)
		.join("\n");
	const commandMatrix = CATALOG.commandGroups
		.map(
			(group) =>
				`- **${group.title}**: ${group.commands.map((command) => `\`${command}\``).join(", ")} — ${group.summary}`,
		)
		.join("\n");
	const examples = [
		`${CATALOG.npxBinary}`,
		`${CATALOG.npxBinary} list --all`,
		`${CATALOG.npxBinary} video-start ./recording.webm --size 800x600`,
		`${CATALOG.npxBinary} video-show-actions --duration 100 --position top-right --cursor pointer`,
		`${CATALOG.npxBinary} video-chapter Smoke --description "AXI smoke" --duration 50`,
		`${CATALOG.npxBinary} video-hide-actions`,
		`${CATALOG.npxBinary} video-stop`,
	]
		.map((example) => `- \`${example}\``)
		.join("\n");

	return `---
name: playwright-cli-axi
description: Use playwright-cli-axi when controlling Playwright from an agent shell and when video recording, TOON output, or AXI-friendly browser automation matters.
---

# playwright-cli-axi

${CATALOG.description}.

Use this skill when an agent needs to drive Playwright from a shell, inspect browser/session state, capture video, or consume stdout without parsing noisy upstream text.

## AXI contract

- Run \`${CATALOG.npxBinary}\` with no arguments for the content-first home view.
- Stdout is TOON: data, help, and errors are structured on stdout; stderr is only diagnostic noise.
- The wrapper preserves the upstream \`@playwright/cli\` command surface and keeps a command-matrix drift test against upstream help metadata.
- User-supplied \`--json\` is ignored because wrapper stdout remains TOON.
- Browser-not-open and missing-browser failures become actionable structured errors.
- \`--version\` prints a clean TOON version; \`--full\` bypasses result truncation; \`--fields\` selects additional list columns.
- A usable system browser (Chromium/Chrome/Edge) is auto-detected per OS (Linux incl. Arch/Ubuntu, macOS, Windows); set \`PLAYWRIGHT_MCP_EXECUTABLE_PATH\` to override. Channel sessions show a derived \`usable\` field.
- Auto-generated page snapshots land in an OS cache dir (overridable via \`PLAYWRIGHT_CLI_AXI_ARTIFACT_DIR\`), so they do not pollute the working directory; named screenshots/videos still resolve to the current directory.
- Get help with \`${CATALOG.npxBinary} <command> --help\` or the \`help <command>\` alias.

## Ambient context (two ways)

You can get live browser and video context at session start in two complementary ways. You only need one:

1. **Session hook (recommended)**: run \`${CATALOG.npxBinary} setup\` to install a SessionStart hook for Claude Code and Codex. It is idempotent, repairs stale paths, composes with other hooks (e.g. mainline), and emits a token-budgeted directory-scoped context slice.
2. **This skill**: loads on demand with no per-session cost.

## Upstream command matrix

${commandMatrix}

## Wrapper commands

${wrapperLines}

${skillDocSections}



## Video workflow

${commandLines}

Video state is wrapper-managed sidecar state under \`\${XDG_STATE_HOME:-~/.local/state}/playwright-cli-axi/\`, scoped to the current workspace. Treat it as last-known wrapper state, not authoritative upstream state. The home view reconciles it against \`list --all\` and marks stale/abandoned states explicitly.

## Examples

${examples}

## Real video smoke

After installing a browser, run:

\`\`\`sh
${CATALOG.npxBinary} install-browser chrome-for-testing
npm run smoke:video
\`\`\`

If a system Chromium exists, you can instead set \`PLAYWRIGHT_MCP_EXECUTABLE_PATH=/usr/bin/chromium\` before the smoke script.
`;
}
