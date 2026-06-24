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
  } as Record<string, string>,
};

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

## Ambient context (two ways)

You can get live browser and video context at session start in two complementary ways. You only need one:

1. **Session hook (recommended)**: run \`${CATALOG.npxBinary} setup\` to install a SessionStart hook for Claude Code and Codex. It is idempotent, repairs stale paths, composes with other hooks (e.g. mainline), and emits a token-budgeted directory-scoped context slice.
2. **This skill**: loads on demand with no per-session cost.

## Upstream command matrix

${commandMatrix}

## Wrapper commands

${wrapperLines}

## Video workflow

${commandLines}

Video state is wrapper-managed sidecar state under \`${"${XDG_STATE_HOME:-~/.local/state}"}/playwright-cli-axi/\`, scoped to the current workspace. Treat it as last-known wrapper state, not authoritative upstream state. The home view reconciles it against \`list --all\` and marks stale/abandoned states explicitly.

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
