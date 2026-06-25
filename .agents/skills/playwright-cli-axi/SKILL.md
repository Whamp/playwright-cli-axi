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
- The wrapper preserves the upstream `@playwright/cli` command surface and keeps a command-matrix drift test against upstream help metadata.
- User-supplied `--json` is ignored because wrapper stdout remains TOON.
- Browser-not-open and missing-browser failures become actionable structured errors.
- `--version` prints a clean TOON version; `--full` bypasses result truncation; `--fields` selects additional list columns.
- A usable system browser (Chromium/Chrome/Edge) is auto-detected per OS (Linux incl. Arch/Ubuntu, macOS, Windows); set `PLAYWRIGHT_MCP_EXECUTABLE_PATH` to override. Channel sessions show a derived `usable` field.
- Auto-generated page snapshots land in an OS cache dir (overridable via `PLAYWRIGHT_CLI_AXI_ARTIFACT_DIR`), so they do not pollute the working directory; named screenshots/videos still resolve to the current directory.
- Get help with `npx -y playwright-cli-axi <command> --help` or the `help <command>` alias.

## Ambient context (two ways)

You can get live browser and video context at session start in two complementary ways. You only need one:

1. **Session hook (recommended)**: run `npx -y playwright-cli-axi setup` to install a SessionStart hook for Claude Code and Codex. It is idempotent, repairs stale paths, composes with other hooks (e.g. mainline), and emits a token-budgeted directory-scoped context slice.
2. **This skill**: loads on demand with no per-session cost.

## Upstream command matrix

- **Browser sessions**: `open`, `attach`, `close`, `detach`, `delete-data`, `list`, `close-all`, `kill-all` — Open, attach, close, detach, inspect, and clean browser sessions.
- **Page interaction**: `goto`, `type`, `click`, `dblclick`, `fill`, `drag`, `drop`, `hover`, `select`, `upload`, `check`, `uncheck`, `snapshot`, `eval`, `dialog-accept`, `dialog-dismiss`, `resize` — Navigate pages, interact with elements, inspect snapshots, and run page evals.
- **Navigation**: `go-back`, `go-forward`, `reload` — Control browser history and reload state.
- **Keyboard**: `press`, `keydown`, `keyup` — Send keyboard input and key state transitions.
- **Mouse**: `mousemove`, `mousedown`, `mouseup`, `mousewheel` — Send pointer movement, button, and wheel events.
- **Artifacts**: `screenshot`, `pdf`, `request-headers`, `request-body`, `response-headers`, `response-body`, `tracing-start`, `tracing-stop` — Create or retrieve screenshots, PDFs, response/request payload files, and traces.
- **Tabs**: `tab-list`, `tab-new`, `tab-close`, `tab-select` — List, create, close, and select browser tabs.
- **Storage**: `state-load`, `state-save`, `cookie-list`, `cookie-get`, `cookie-set`, `cookie-delete`, `cookie-clear`, `localstorage-list`, `localstorage-get`, `localstorage-set`, `localstorage-delete`, `localstorage-clear`, `sessionstorage-list`, `sessionstorage-get`, `sessionstorage-set`, `sessionstorage-delete`, `sessionstorage-clear` — Save/load browser state and manage cookies, localStorage, and sessionStorage.
- **Network**: `requests`, `request`, `route`, `route-list`, `unroute`, `network-state-set` — Inspect requests, mock routes, and toggle online/offline state.
- **DevTools and diagnostics**: `console`, `run-code`, `show`, `pause-at`, `resume`, `step-over`, `generate-locator`, `highlight`, `tray` — Inspect console output, run Playwright code, show dashboards, debug, and highlight elements.
- **Install and config**: `install`, `install-browser`, `config-print` — Install browsers/skills and inspect effective configuration.
- **Video**: `video-start`, `video-stop`, `video-chapter`, `video-show-actions`, `video-hide-actions` — Record WebM videos and annotate action/chapter overlays.

## Wrapper commands

- `npx -y playwright-cli-axi setup` — Install/repair the SessionStart hook so agent sessions start with live browser and video context.
- `npx -y playwright-cli-axi context` — Print the token-budgeted session-start context slice (invoked by the hook).
- `npx -y playwright-cli-axi scroll` — Scroll the page: --to <ref> (scrollIntoView), --top, --bottom, or --by <px> (only one action at a time).
- `npx -y playwright-cli-axi wait` — Wait for a page load state (load|domcontentloaded|networkidle) without manual sleep. When used via the --wait flag on navigation commands, a wait failure surfaces as a wait_warning field on the successful result instead of masking the navigation.
- `npx -y playwright-cli-axi find` — Look up labelled page data from the current snapshot by text/name (e.g. find Classrooms -> {value, ref}), pairing adjacent label/value nodes so KPIs and stats read as structured values instead of grepping a flat tree.

### Navigation flags

Navigation commands (`open`, `goto`, `click`, `dblclick`, etc.) support two optional flags for deterministic post-action state:

- `--wait <state>` — Wait for a Playwright load state (`load|domcontentloaded|networkidle`) after the action. If the wait fails after a successful navigation, the primary result is returned with a `wait_warning` field instead of masking the success. Network-only waits may race SPA route mounting.
- `--settle [state]` — Wait for the load state **and** poll `page.url()` until it stops changing (deterministic SPA settle). Default state is `networkidle`. Use this for SPA navigations where `--wait networkidle` does not settle the client-side route.

### HTML5 validation probing

After a submit-triggering `click` or `dblclick`, the wrapper probes HTML5 constraint validation and surfaces `validation: { ok: false, invalid_fields: [...] }` when the browser appears to have blocked the submit (focused an invalid field). HTML5 validation bubbles are not in the accessibility tree, so without this probing, a submit blocked by an invalid field looks identical to a successful submit. The primary click result and exit code are preserved either way.

### Native dialog handling (alert/confirm/prompt)

A click that opens a JS dialog leaves the modal pending in upstream, which wedges every later command with an opaque `does not handle the modal state` error. The wrapper handles this in two ways:

- `click`/`dblclick --dialog accept:<text>|accept|dismiss` — handle the dialog atomically in the same call. Use `accept:<text>` for a `window.prompt` that must submit text. The result surfaces `dialog: { handled: true, action, text }` and the page stays usable (no `close`+`open` recovery needed).
- A plain click that leaves a dialog pending surfaces `dialog: { pending: true }`, and any command that hits the wedged state returns a `modal_pending` error pointing at `dialog-accept`/`dialog-dismiss` instead of a dead-end.

### Interaction post-state and spawned tabs

- `check`/`uncheck` report the target ref's `checked` boolean and attach a post-action snapshot; `fill`/`press`/`hover` attach a snapshot too, so the effect is visible without a separate read.
- When a `click`/`dblclick` spawns a new tab or window, the result surfaces `new_tabs[]` (piggy-backed on the validation probe, so it adds no extra round-trip).

### Structured tab, console, and artifact results

- Tab commands (`tab-list`, `tab-new`, `tab-select`, `tab-close`) return one structured `tab_rows` table (`index`, `current`, `title`, `url`) with the real URL, instead of escaped markdown or a double-nested `result.result`.
- `console` returns `totals` (`messages`/`errors`/`warnings`) plus a per-message `messages` table, instead of a flattened display string.
- `screenshot`/`pdf`/`state-save` lift their file link into a structured `file` field (absolute path) alongside the existing result.
- The standalone `snapshot` command writes its tree to a cache file and returns `snapshot: { file }`, matching navigation results (no more double-escaped inline text).
- Upstream error messages are stripped of ANSI colour/dim escapes, so TOON `message` fields stay clean plain text.

### Output improvements

The wrapper enhances upstream output for agent usability:

- **Flattened navigation results**: Commands like `open`, `goto`, and `click` return snapshot artifacts at the top level instead of buried under `result.result.snapshot`, making file paths immediately accessible.
- **Readable snapshot rendering**: Snapshot content renders as readable single-layer text rather than double-escaped JSON-string-of-YAML, improving parseability.
- **Enhanced error hints**: Usage errors for commands like `screenshot`, `pdf`, and `snapshot` include inline suggestions (e.g., `--filename <path>`) to reduce trial-and-error.
- **Absolute snapshot paths**: Auto-generated snapshot file paths are returned as absolute paths so they're reliably findable regardless of the upstream artifact directory. Screenshot, PDF, and `state-save` file paths in results are likewise canonicalized to absolute paths.
- **Flattened eval results**: `eval` and `run-code` commands flatten their single return value to a top-level `result` and undo upstream's JSON encoding, so `eval` of `location.href` returns the URL directly instead of a double-nested, JSON-escaped string. Note: `eval` runs in the **browser DOM context** (no `page`); `run-code` runs in the **node context** and receives `page` (use an `async (page) => { ... }` arrow expression).
- **Flattened storage/network results**: storage read commands (`cookie-get/list`, `localstorage-*`, `sessionstorage-*`), network commands (`requests`, `request`, `route`, `route-list`, `unroute`, `network-state-set`), and `screenshot`/`pdf`/`state-save`/`state-load` lift their single return value to a top-level `result` instead of double-nesting as `result: result: <value>`.
- **Definitive storage empty states**: storage read commands attach `found: false` when nothing matches, so emptiness is machine-readable instead of requiring display-string matching.
- **Findable storage files**: `state-save`/`state-load` relative filenames are resolved against your shell cwd (not the daemon's artifact directory), so saved session state round-trips reliably across a close/open.

## Video workflow

- `npx -y playwright-cli-axi video-start` — Start recording the current browser session to an optional WebM file.
- `npx -y playwright-cli-axi video-stop` — Stop recording and report typed video artifacts returned by upstream.
- `npx -y playwright-cli-axi video-chapter` — Add a title card marker to the recording timeline.
- `npx -y playwright-cli-axi video-chapters` — Read the recorded chapter manifest with seek offsets (no sidecar parsing).
- `npx -y playwright-cli-axi video-status` — Print the full recording summary: status, files, chapters, actions, warnings.
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
