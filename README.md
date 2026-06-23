# playwright-cli-axi

`playwright-cli-axi` is a thin AXI wrapper around upstream `@playwright/cli`.
It preserves the upstream command surface, injects upstream JSON where supported,
and reformats stdout as compact TOON for agent use.

Primary goal: make Playwright browser control and video recording reliable from an
agent shell without leaking progress chatter, stack traces, or ambiguous empty
output into stdout.

## Install and build

```sh
npm install
npm run build
node dist/bin/playwright-cli-axi.js
```

The package bin is `playwright-cli-axi` when installed globally or through `npx`.

## AXI stdout contract

- Running with no arguments prints a content-first home view, not a manual.
- All wrapper stdout is TOON: normal data, help, and errors are structured.
- Stderr is reserved for diagnostics from the wrapper or child process plumbing.
- Exit codes: `0` success/no-op, `1` runtime failure, `2` wrapper/upstream usage error.
- User `--json` flags are stripped because wrapper output remains TOON.
- Commands that reject upstream `--json`, such as `install-browser`, are forwarded without JSON injection.

Example no-args shape:

```toon
bin: ~/.local/bin/playwright-cli-axi
description: AXI-friendly Playwright browser control with TOON output and video state
cwd: /workspace/project
browsers:
  count: 0
  empty: no open browsers
video:
  status: inactive
  source: sidecar
next[5]:
  - "playwright-cli-axi open https://example.com"
  - playwright-cli-axi list --all
```

## Thin-wrapper design

The wrapper keeps internal data as JSON and uses `src/presenter/toon.ts` as the
only stdout boundary. Unknown commands are forwarded to `@playwright/cli` rather
than reimplemented. Known high-value cases get AXI-specific formatting:

- no-args home view
- `--help` and video command help
- `list`, `close`, and `close-all` empty states
- upstream JSON errors such as browser-not-open
- stderr-only failures such as missing Chrome installations
- video commands and sidecar state

## Video support

Supported video commands:

```sh
playwright-cli-axi video-start [filename] [--size <width>x<height>]
playwright-cli-axi video-show-actions [--duration <ms>] [--position top-left|top|top-right|bottom-left|bottom|bottom-right] [--cursor pointer|none]
playwright-cli-axi video-chapter <title> [--description <text>] [--duration <ms>]
playwright-cli-axi video-hide-actions
playwright-cli-axi video-stop
```

The wrapper validates video arguments before calling upstream. It updates sidecar
state only after observed upstream success.

### Sidecar state

Video state is stored under:

```text
${XDG_STATE_HOME:-~/.local/state}/playwright-cli-axi/<cwd-session-hash>.json
```

Sidecar facts include:

- recording status: `active`, `inactive`, `unknown`, `stale`, or `abandoned`
- requested file and size
- start/stop timestamps
- action overlay status
- chapters
- last reported files
- last result/error and warnings

The sidecar is last-known wrapper state, not authoritative upstream state. The
home view reconciles active sidecar recordings against `list --all`; if no live
browser is present it marks the state `stale`. Successful `close`, `close-all`,
`kill`, or `delete-data` while sidecar recording is active emits a warning and
marks the recording `abandoned` because closing without `video-stop` may lose the
file.

## Browser prerequisite

If Chrome is missing, install the upstream browser:

```sh
node dist/bin/playwright-cli-axi.js install-browser chrome-for-testing
```

If a system Chromium exists, you can also run smoke tests with:

```sh
PLAYWRIGHT_MCP_EXECUTABLE_PATH=/usr/bin/chromium npm run smoke:video
```

## Verification

```sh
npm run build
npm test
npm run check:skill
```

Manual AXI smoke without a browser:

```sh
node dist/bin/playwright-cli-axi.js
node dist/bin/playwright-cli-axi.js list
node dist/bin/playwright-cli-axi.js close-all
node dist/bin/playwright-cli-axi.js video-start
```

Real video smoke when a browser is available:

```sh
npm run smoke:video
```

The smoke script opens a temporary browser/session, starts WebM recording, shows
action overlays, navigates, adds a chapter, hides overlays, stops recording,
closes the browser, checks that the WebM exists and is non-empty, and uses
`ffprobe` for container/duration details when available.

## Generated skill

The installable skill is generated from the same catalog used by home/help text:

```sh
npm run generate:skill
npm run check:skill
```

Committed output lives at `.agents/skills/playwright-cli-axi/SKILL.md`. The
check script fails when the generated skill drifts from `src/content/catalog.ts`.

## Development workflow

Use TDD vertical slices:

1. add/adjust one behavior test through `runCli` or the public presenter API
2. watch it fail
3. implement the smallest deep-module change
4. rerun the focused test
5. rerun `npm test`, `npm run build`, and `npm run check:skill`

Do not commit or push from this task; leave the working tree ready for review.
