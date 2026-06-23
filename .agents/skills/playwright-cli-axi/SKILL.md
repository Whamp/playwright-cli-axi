---
name: playwright-cli-axi
description: Use playwright-cli-axi when controlling Playwright from an agent shell and when video recording, TOON output, or AXI-friendly browser automation matters.
---

# playwright-cli-axi

AXI-friendly Playwright browser control with TOON output and video state.

Use this skill when an agent needs to drive Playwright from a shell, inspect browser/session state, capture video, or consume stdout without parsing noisy upstream text.

## AXI contract

- Run `npx -y playwright-cli-axi` with no arguments for the content-first home view.
- Stdout is TOON: data, help, and errors are structured on stdout; stderr is only diagnostic noise.
- The wrapper preserves the upstream `@playwright/cli` command surface and forwards unknown commands.
- User-supplied `--json` is ignored because wrapper stdout remains TOON.
- Browser-not-open and missing-browser failures become actionable structured errors.

## Video workflow

- `npx -y playwright-cli-axi video-start` — Start recording the current browser session to an optional WebM file.
- `npx -y playwright-cli-axi video-stop` — Stop recording and report any video files returned by upstream.
- `npx -y playwright-cli-axi video-chapter` — Add a title card marker to the recording timeline.
- `npx -y playwright-cli-axi video-show-actions` — Overlay subsequent action names and target highlights on the page.
- `npx -y playwright-cli-axi video-hide-actions` — Stop overlaying action callouts on the page.

Video state is wrapper-managed sidecar state under `${XDG_STATE_HOME:-~/.local/state}/playwright-cli-axi/`, scoped to the current workspace. Treat it as last-known wrapper state, not authoritative upstream state. The home view reconciles it against `list --all` and marks stale/abandoned states explicitly.

## Examples

- `npx -y playwright-cli-axi`
- `npx -y playwright-cli-axi list --all`
- `npx -y playwright-cli-axi video-start ./recording.webm --size 800x600`
- `npx -y playwright-cli-axi video-show-actions --duration 100 --position top-right --cursor pointer`
- `npx -y playwright-cli-axi video-chapter Smoke --description "AXI smoke" --duration 50`
- `npx -y playwright-cli-axi video-hide-actions`
- `npx -y playwright-cli-axi video-stop`

## Real video smoke

After installing a browser, run:

```sh
npx -y playwright-cli-axi install-browser chrome-for-testing
npm run smoke:video
```

If a system Chromium exists, you can instead set `PLAYWRIGHT_MCP_EXECUTABLE_PATH=/usr/bin/chromium` before the smoke script.
