# playwright-cli-axi

`playwright-cli-axi` is a thin AXI wrapper around upstream `@playwright/cli`.
It preserves the upstream command surface, injects upstream JSON where supported,
and reformats stdout as compact TOON for agent use.

Primary goal: make the full upstream Playwright CLI surface reliable from an
agent shell without leaking progress chatter, stack traces, or ambiguous empty
output into stdout. Video remains first-class, but storage, network, tabs,
artifacts, DevTools, install, and session-admin commands also get command-aware
AXI presentation.

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
upstream:
  package: @playwright/cli
  version: 0.1.14
browsers:
  count: 0
  empty: no open browsers
servers:
  count: 0
  empty: no attachable browser servers
channel_sessions:
  count: 0
  empty: no channel sessions
video:
  status: inactive
  source: sidecar
  recording: false
  files: 0
  chapters: 0
  actions: unknown
next[5]:
  - "playwright-cli-axi open https://example.com"
  - playwright-cli-axi list --all
```

## Common commands

The wrapper forwards all upstream `@playwright/cli` commands. Key commands:

- `playwright-cli-axi` — Show home view with browser and video state
- `playwright-cli-axi list [--all]` — List open browsers, attachable servers, and channel sessions with TOON formatting
- `playwright-cli-axi open <url>` — Open a browser session
- `playwright-cli-axi close` — Close the current browser and report close status
- `playwright-cli-axi close-all` — Close all browsers
- `playwright-cli-axi kill-all` — Kill all browser daemon processes
- `playwright-cli-axi delete-data` — Delete browser data
- `playwright-cli-axi install-browser chrome-for-testing` — Install the Chrome browser
- `playwright-cli-axi --help` — Show help for the wrapper
- `playwright-cli-axi <command> --help` — Show help for specific commands

The wrapper injects `--json` into upstream commands and reformats output as TOON,
except for commands like `install-browser` that reject JSON mode.

Example `list --all` output with browser, server, and channel-session inventory:

```toon
command: list
status: ok
family:
  id: session
  title: Browser sessions
browsers:
  count: 1
browser_rows[1]{id,name,status}:
  default,chromium,open
servers:
  count: 1
server_rows[1]{title,browser,version,dataDir,workspace}:
  debug-server,chromium,1.48.0,/tmp/data,/workspace
channel_sessions:
  count: 1
channel_session_rows[1]{channel,dataDir,extension,endpoint}:
  chrome,/tmp/chrome,yes,yes
```

Example `close` output preserves upstream single-session close status:

```toon
command: close
status: ok
family:
  id: session
  title: Browser sessions
session: default
close:
  status: closed
```

## Thin-wrapper design

The wrapper keeps internal data as JSON and routes stdout rendering through
presenter modules, which ultimately encode via `src/presenter/toon.ts`.
Unknown commands are forwarded to `@playwright/cli` rather than reimplemented.
Known command families get AXI-specific metadata, counts, artifact summaries,
and stable empty states while preserving upstream result data.

Dedicated presenters cover:

- no-args home view
- root `--help`, upstream help previews, and video command help
- whole-surface command matrix generated from `src/domain/upstreamCommands.ts`
- `list --all` browser/server/channel-session inventory
- `close`, `close-all`, `detach`, `delete-data`, and `kill-all` session-admin results
- storage, network, tabs, artifacts, DevTools, install/config, page, keyboard, mouse, and navigation command families
- upstream JSON errors such as browser-not-open and unknown-command/unknown-option usage errors
- stderr-only failures such as missing Chrome installations
- video commands, typed video artifacts, and sidecar state

## Command matrix

Run `playwright-cli-axi --help` for the live TOON command matrix. Coverage is
also checked against upstream `help.json` so newly added upstream commands fail
tests until they are assigned to a wrapper command family.

| Family                 | Commands                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser sessions       | `open`, `attach`, `close`, `detach`, `delete-data`, `list`, `close-all`, `kill-all`                                                                                           |
| Page interaction       | `goto`, `type`, `click`, `dblclick`, `fill`, `drag`, `drop`, `hover`, `select`, `upload`, `check`, `uncheck`, `snapshot`, `eval`, `dialog-accept`, `dialog-dismiss`, `resize` |
| Navigation             | `go-back`, `go-forward`, `reload`                                                                                                                                             |
| Keyboard               | `press`, `keydown`, `keyup`                                                                                                                                                   |
| Mouse                  | `mousemove`, `mousedown`, `mouseup`, `mousewheel`                                                                                                                             |
| Artifacts              | `screenshot`, `pdf`, `request-headers`, `request-body`, `response-headers`, `response-body`, `tracing-start`, `tracing-stop`                                                  |
| Tabs                   | `tab-list`, `tab-new`, `tab-close`, `tab-select`                                                                                                                              |
| Storage                | `state-load`, `state-save`, `cookie-list`, `cookie-get`, `cookie-set`, `cookie-delete`, `cookie-clear`, `localstorage-list`, `localstorage-get`, `localstorage-set`, `localstorage-delete`, `localstorage-clear`, `sessionstorage-list`, `sessionstorage-get`, `sessionstorage-set`, `sessionstorage-delete`, `sessionstorage-clear` |
| Network                | `requests`, `request`, `route`, `route-list`, `unroute`, `network-state-set`                                                                                                  |
| DevTools and diagnostics | `console`, `run-code`, `show`, `pause-at`, `resume`, `step-over`, `generate-locator`, `highlight`, `tray`                                                                     |
| Install and config     | `install`, `install-browser`, `config-print`                                                                                                                                  |
| Video                  | `video-start`, `video-stop`, `video-chapter`, `video-show-actions`, `video-hide-actions`                                                                                      |

## Video support

Supported video commands:

```sh
playwright-cli-axi video-start [filename] [--size <width>x<height>]
playwright-cli-axi video-show-actions [--duration <ms>] [--position top-left|top|top-right|bottom-left|bottom|bottom-right] [--cursor pointer|none]
playwright-cli-axi video-chapter <title> [--description <text>] [--duration <ms>]
playwright-cli-axi video-hide-actions
playwright-cli-axi video-stop
```

### Video command flags

- `video-start [filename]` — Start recording to an optional WebM file path
  - `--size <width>x<height>` — Video frame size (default: fit 800x800)
- `video-stop` — Stop recording and report typed `video_files` separately from other artifacts
- `video-chapter <title>` — Add a chapter marker to the recording timeline
  - `--description <text>` — Optional chapter card description
  - `--duration <ms>` — Milliseconds to show the chapter card (default: upstream default)
- `video-show-actions` — Overlay action names and target highlights on the page
  - `--duration <ms>` — Milliseconds each annotation remains visible (default: 500)
  - `--position top-left|top|top-right|bottom-left|bottom|bottom-right` — Where to place action titles (default: top-right)
  - `--cursor pointer|none` — Cursor decoration (default: pointer)
- `video-hide-actions` — Stop overlaying action callouts on the page

Example `video-stop` output reports WebM files separately from other artifacts:

```toon
command: video-stop
status: ok
recording:
  status: inactive
  stoppedAt: "2026-06-23T20:00:00.000Z"
files:
  count: 3
videos:
  count: 1
video_files[1]:
  - ./recording.webm
other_artifacts:
  count: 2
other_artifact_files[2]:
  - ./trace.zip
  - ./network.har
last_files[3]:
  - ./recording.webm
  - ./trace.zip
  - ./network.har
```

The wrapper validates video arguments before calling upstream. It updates sidecar
state only after observed upstream success.

### Session scoping

Video state is scoped to the current working directory and optional session name.
Use the `--session <name>` or `-s <name>` flag to isolate recordings for different
workflows within the same directory:

```sh
playwright-cli-axi video-start --session demo ./demo.webm
playwright-cli-axi video-stop --session demo
```

Each session has its own sidecar file under `${XDG_STATE_HOME:-~/.local/state}/playwright-cli-axi/`.

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
browser is present it marks the state `stale`. Successful session-terminating
commands while a sidecar recording is active emit a warning and mark the
recording `abandoned` because closing without `video-stop` may lose the file.
The abandonment scope is derived from a single close-like command registry:

- `close`, `detach`, `delete-data` abandon only the resolved session's sidecar
- `close-all` abandons every sidecar in the current working directory
- `kill-all` abandons every sidecar across the whole state directory, because
  upstream `kill-all` SIGKILLs daemon processes regardless of working directory

The home view includes recent sidecar details such as requested
file/size, timestamps, and recent reported files when they exist.

## Error handling

All errors print structured TOON to stdout with actionable help suggestions:

- `usage` — Invalid command usage or flags (exit code 2)
- `browser_not_open` — Browser must be opened first (exit code 1)
- `missing_browser` — Chrome installation is missing (exit code 1)
- `upstream_error` — Upstream command failed (exit code 1)
- `already_recording` — Video recording is already active (exit code 2)

Example error output:

```toon
error:
  kind: browser_not_open
  message: "The browser 'default' is not open, please run open first"
help[1]:
  playwright-cli-axi open [url]
```

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
npm run typecheck
npm test
npm run test:prop
npm run build
npm run generate:skill && npm run check:skill
```

The test suite combines example-based Vitest specs with fast-check property/model
specs for parsing, argv handling, TOON rendering, whole-surface command drift,
session/list/close normalization, command-family presentation, video sidecar
state, video command state transitions, and error/help/home presenters.

### Property-based testing

Property-based tests use the fast-check framework to generate hundreds of random
inputs and verify invariants that must hold for all valid inputs. This complements
example-based tests by finding edge cases that manual test examples miss.

Property tests are identified by the word "properties" in their describe block name
(e.g., `describe("session normalization properties", () => {`), which allows them
to be run via `npm run test:prop` using the `-t properties` filter.

The project uses custom arbitraries in `src/test/arbitraries.ts` to generate:

- Safe strings for keys, args, and lines (length-limited alphanumerics)
- JSON values for upstream parsing tests
- TOON values and tables for rendering invariants
- Shared video recording status, overlay status, and size generators used by video-state and video-command model tests

Run only property-based tests with `npm run test:prop`. This is a fast loop for
`describe(...properties...)` specs; run `npm test` before handoff because the
whole-surface help drift and generated-skill sync guards are example-based specs.
If fast-check reports a failure, copy the printed `seed` and `path` into the
failing `fc.assert` options (for example `{ ...propertyOptions, seed: 123, path:
"4:2" }`) to replay the minimal counterexample locally.

When adding new features, consider writing property tests for:

- **Parsing/formatting roundtrips** — data survives encode/decode cycles
- **State invariants** — counts match arrays, enums stay valid
- **Idempotency** — running twice produces the same result
- **State machine consistency** — valid transitions maintain invariants

Prefer example-based tests for user-visible flows and property-based tests for
internal invariants and data transformations.

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

## Environment variables

- `XDG_STATE_HOME` — Override the base directory for sidecar state files (default: `~/.local/state`)
- `PLAYWRIGHT_MCP_EXECUTABLE_PATH` — Path to a system Chromium browser for testing (e.g., `/usr/bin/chromium`)
- `NO_COLOR` — Set to `1` to disable colored output from upstream (always set by the wrapper)

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

For internal modules with clear invariants (parsers, normalizers, state machines),
add property-based tests in parallel with example-based tests to verify behavior
across generated inputs.

Before shipping, also run the local `no-mistakes` gate with remote-facing steps
skipped if needed.
