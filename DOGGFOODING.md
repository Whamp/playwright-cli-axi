# Dogfooding log: playwright-cli-axi on classroom-connect.app

**Task:** Record a polished demo walkthrough (Option A) of `classroom-connect.app` — marketing → features → research journey, with video chapters.

**Real purpose:** Dogfood the wrapper on a real task and document every **friction point**, **pain point**, and **AXI-style departure** I hit, so the tool improves from actual use rather than adversarial review alone.

**Date:** 2026-06-24
**Tool head:** `cbb0bae` (origin/main, freshly shipped)
**Environment:** Arch Linux, Chromium 148 at `/usr/bin/chromium`

---

## How to read this log

Findings are grouped by severity. Each entry records:
- **What I tried** (the exact command / intent)
- **What happened** (actual output/behavior)
- **Why it hurts** (the concrete agent cost)
- **AXI principle violated** (mapped to the 10 principles in the skill), if any
- **Suggested fix**

### Severity key
- 🔴 **Friction** — actively blocked or had to drop to raw tooling / guesswork
- 🟡 **Pain** — extra round-trip or cognitive load, but recoverable
- 🔵 **Departure** — works, but deviates from an AXI principle (ergonomic debt)

---

## Session timeline

### 0. Orientation

Ran `playwright-cli-axi --help` to learn the surface. Clean TOON command matrix,
12 groups, all 87 commands listed.

### 1. Starting the recording

#### 🔴 F-1: `help <command>` is an unknown command (CORRECTED — narrower than first thought)
- Tried: `playwright-cli-axi help goto` and `help navigate`
- Got: `error: kind: usage / message: "Unknown command: help"`
- Correction: subcommand `--help` **does** work — `screenshot --help` returns the
  upstream help (sourced from `@playwright/cli`, with byte count + line count).
- What's still wrong: (a) the `help <command>` alias form is rejected, and
  (b) the root `--help` command matrix doesn't advertise that `<command> --help`
  exists, so I only discovered it by trial. Discovery cost was 1 wasted call.
- AXI principle: **10 + 9** — help is available but not discoverable from the home.
- Suggested fix: add a `help[]` line to root `--help` like
  `Run 'playwright-cli-axi <command> --help' for command flags`, and/or accept
  the `help <command>` alias.

#### 🔴 F-2: `open` can't see the system browser; home view's channel hints are useless here
- Tried: `playwright-cli-axi open https://classroom-connect.app`
- Got: `error: kind: missing_browser / message: required browser executable is
  missing / help: install-browser chrome-for-testing`
- Reality: Chromium 148 is at `/usr/bin/chromium` (home view even lists 4
  channel sessions). It works only with `PLAYWRIGHT_MCP_EXECUTABLE_PATH` set.
- Why it hurts: the home view *advertises* the channel sessions it discovered,
  implying the tool can use them, but `open` ignores them entirely. The error's
  only suggested fix (`install-browser chrome-for-testing`) is a heavyweight
  network install when a local browser already exists.
- AXI principle: **6 (structured errors)** — the suggestion doesn't match the
  real fix; **4 (pre-computed aggregates)** — the home view shows channel
  sessions but no derived "usable browser?" field that would prevent the
  dead-end.
- Suggested fix: (a) detect a system Chromium/Chrome and auto-use it, or
  (b) when `missing_browser` fires, surface the env-var override and any
  detected system browsers in the error's `help[]`, and (c) on the home view,
  mark channel sessions with a `usable: yes/no` derived field.

#### 🟡 P-1: `open` nests the snapshot under `result.result.snapshot.file`
- Got: `result: { session, pid, result: { snapshot: { file: ... } } }`
- Why it hurts: the snapshot file path — the thing I need next — is buried two
  levels deep under a redundant `result.result` envelope. An agent has to know
  to dig; a flatter shape (`snapshot: {file}` at top level) would be cheaper.
- AXI principle: **2 (minimal default schemas)** — redundant nesting.

#### 🔴 F-3: snapshot artifacts are written into the CWD as `.playwright-cli/*`
- Got: `.playwright-cli/page-2026-06-24T14-35-50-844Z.yml` created in the repo
- Why it hurts: every navigation pollutes the working directory with timestamped
  files. In a git repo these get accidentally committed (this exact artifact bit
  us during the earlier whole-surface review). An agent can't tell the wrapper
  "put these somewhere I won't trip over" without env config.
- AXI principle: none directly, but it's a real friction source for agent-driven
  workflows in version-controlled dirs.
- Suggested fix: default snapshot/video artifacts to an OS temp dir or a
  `.gitignore`'d cache, and document the override. At minimum, the wrapper
  should auto-append `.playwright-cli/` to `.gitignore` on first use.

### 1. Starting the recording

Moved into a dedicated artifacts dir (`/tmp/pca-demo`) to avoid polluting the
repo. `video-start ./demo.webm --size 1280x720` returned a clean `recording:
status: active` block. (See F-2/F-3 above for the setup friction that
preceded this.)

### 2. Navigating the landing page

#### ✅ GOOD-1: bounded result + `--full` escape hatch works as designed
- `snapshot` returned `result_truncated: true`, `result_bytes: 4759`, and a
  `help[1]: playwright-cli-axi snapshot --full` hint. AXI principle 3 done right.

#### 🟡 P-2: snapshot content is a JSON-string-of-YAML, not structured TOON
- The `result` field contains `"{\"snapshot\":\"- generic [ref=e5]:\\n  - navigation...`"
  — a JSON string wrapping a YAML tree, double-escaped inside TOON.
- Why it hurts: to read the page structure I mentally un-escape two layers. The
  generic-result path treats the snapshot as opaque text; a command-aware
  presenter for `snapshot` would emit the accessibility tree as real nested
  TOON (or at least an indented block) so refs like `[ref=e20]` are first-class.
- AXI principle: **1 (token-efficient output)** — escaping overhead; the data is
  already hierarchical but flattened into a string.

#### 🟡 P-3: `screenshot` argument shape is discovered by error
- Tried `screenshot --path ./x.png` → `Unknown option: --path`; then
  `screenshot ./x.png` → treated the path as a CSS selector and failed upstream.
  Correct form is `screenshot --filename ./x.png` (positional is the *element target*).
- Why it hurts: upstream's `[target]` vs `--filename` split is reasonable, but
  the wrapper surfaces it only via two failed calls. The structured error helpfully
  points to `screenshot --help`, which is where I should have started.
- AXI principle: **6** — error is well-formed, but the friction is upstream's
  arg design leaking through.
- Suggested fix: the wrapper's `screenshot --help` (which already works) could be
  the single advertised discovery path; ensure every command's `--help` exists.

#### 🔵 D-1: image artifacts aren't consumable by a text-only agent model
- Screenshots save fine (533KB PNG) but my current model can't view them, so their
  value is limited to "captured". The snapshot text is what I actually navigate by.
- Not an AXI departure (it's a model/env limit), but worth noting: the wrapper's
  strongest agent-navigation artifact is the text snapshot, not the screenshot.

### 3. Walking features
<>

### 4. Walking research / resources
<>

### 5. Finalizing the video
<>

---

## Findings (deduplicated, sorted by severity)

### 🔴 Friction (blocked or forced a workaround)
- **F-2** `open` can't see the system browser; error suggests a heavyweight
  `install-browser` instead of the `PLAYWRIGHT_MCP_EXECUTABLE_PATH` override or
  detected channel sessions that the home view already advertises. → principles 4, 6.
- **F-3** snapshot/page artifacts are written into the CWD as `.playwright-cli/*`,
  risking accidental commits. No documented state-dir override; screenshots
  (`--filename`) honor CWD but snapshots pin to the session's original CWD
  (click wrote to `../../home/will/projects/playwright-cli-axi/.playwright-cli/`).
- **F-4** chapters are write-only — home view counts them but no command reads
  titles/timestamps; had to parse the sidecar JSON directly. → principles 8, 9.
- **F-1** (narrower) `help <command>` alias rejected; root `--help` doesn't
  advertise that `<command> --help` exists (which does work). → principles 9, 10.

### 🟡 Pain (extra round-trips, recoverable)
- **P-1** `open` nests the snapshot under `result.result.snapshot.file`.
- **P-2** truncated `snapshot` is a JSON-string-of-YAML (double-escaped), not
  structured TOON; the `--full` path is cleaner (object form).
- **P-3** `screenshot` arg shape (`--filename`, positional = element target)
  learned via two failed calls.
- **P-4** no first-class scroll-to-ref/section; reached for `eval` JS every time.
- **P-5** SPA navigations need manual `sleep` + re-poll; no auto-wait on click/goto.

### 🔵 Departure (works, but ergonomic/AXI debt)
- **D-1** image screenshots aren't consumable by a text-only model; the text
  snapshot is the real navigation artifact. (env limit, not strictly AXI.)

### ✅ What worked well (reinforce these)
- **GOOD-1** bounded result + `--full` escape hatch with `result_truncated` /
  `result_bytes` / `help[]` — principle 3 done right.
- **GOOD-2** `video-stop` typed artifacts + definitive `other_artifacts: empty`
  state — principles 4, 5.
- **GOOD-3** video sidecar survives across commands; home view aggregates
  `files/chapters/requestedFile/requestedSize` accurately — principles 4, 8.
- Whole-surface command matrix on `--help` is genuinely useful for discovery.

---

## Deliverables produced

- **`/tmp/pca-demo/demo.webm`** — 18 MB, VP8 1280×720, 4min15s demo walkthrough.
- **6 screenshots** (`01-hero.png` … `06-classrooms.png`) at each chapter point.
- **Chapter manifest** (offsets from recording start):
  - `01:05` Landing & Hero
  - `02:35` Why schools love — Features
  - `02:47` Research & Resources
  - `03:27` Demo: choose role
  - `03:58` Director dashboard (Demo Mode)
  - `04:05` Classrooms management
- **This log** (`DOGGFOODING.md`).

---

## Summary of dogfooding verdict

The wrapper successfully completed a real, non-trivial task end-to-end: it
drove a live production site, recorded a chaptered demo, and produced clean
structured output at every step. The **video sidecar and typed artifact flow
(GOOD-1/2/3) are the strongest part** — exactly the anchor capability the
project set out to build, and they held up under real use.

The friction clusters in two areas:
1. **Browser/session setup (F-2, F-3)** — the "just open a page" path still
   requires an undocumented env var and pollutes the CWD. This is the highest
   impact fix because it's the very first thing every agent hits.
2. **Read-back of recorded state (F-4)** — chapters are counted but not
   readable, forcing a sidecar escape hatch that defeats the abstraction.

No principle was egregiously violated; the departures are ergonomic gaps where
upstream arg shapes leak through (P-2, P-3) or where a convenience command is
missing (P-4, P-5, F-4). All findings are fixable without architectural change.

### Suggested next iteration (prioritized)
1. **F-2**: detect system Chromium / surface `PLAYWRIGHT_MCP_EXECUTABLE_PATH`
   + channel sessions in the `missing_browser` error. *(unblocks every session)*
2. **F-3**: default snapshot/video artifacts to a temp or gitignored dir;
   document the state-dir override. *(prevents repo pollution)*
3. **F-4**: add a `video-chapters` read command + include chapters in
   `video-stop`. *(closes the biggest abstraction leak)*
4. **F-1**: advertise `<command> --help` from root `--help`; accept `help <cmd>`.
5. **P-5**: auto-wait on SPA navigation for `click`/`goto`.

---

## Resolution (2026-06-24, branch `feature/dogfooding-fixes`)

All 9 findings closed and re-verified against a live `classroom-connect.app` walkthrough:

- **F-2** ✓ `open` now works WITHOUT `PLAYWRIGHT_MCP_EXECUTABLE_PATH`: per-OS browser discovery (Arch/Omarchy, Ubuntu snap/apt, macOS, Windows) auto-injects a system Chromium/Chrome/Edge; the `missing_browser` error names the override + detected browsers; home channel rows gained a `usable` field.
- **F-3** ✓ Auto-generated snapshots land in an OS cache dir (`PLAYWRIGHT_CLI_AXI_ARTIFACT_DIR`), not the repo; named screenshots/videos still resolve to the shell cwd; returned snapshot paths are absolutized so they're findable. Re-walk: no `.playwright-cli/` pollution in the workdir.
- **F-4** ✓ New `video-chapters` / `video-status` read commands return the manifest with `mm:ss` offsets; chapters also appear in `video-stop` and the home video block. No sidecar parsing needed.
- **F-1** ✓ `help <command>` alias works; root `--help` advertises `<command> --help`.
- **P-1** ✓ `open`/`goto`/`click` results lift `snapshot` to the top level (no more `result.result.snapshot`).
- **P-2** ✓ `snapshot` renders the a11y tree as readable single-layer text with `--full` truncation (no double-escaped JSON-string-of-YAML).
- **P-3** ✓ `screenshot`/`pdf`/`snapshot` usage errors name `--filename` inline.
- **P-4** ✓ New `scroll` command (`--to <ref>`, `--top`, `--bottom`, `--by <px>`).
- **P-5** ✓ New `wait` command + `--wait <state>` flag on navigation commands (bounded Playwright `waitForLoadState`), removing manual `sleep`+re-poll.

Verification: typecheck clean; 189 tests (+41 new); 52 property tests stable across 2 runs; build; skill gen/check; 0 production vulnerabilities; Chromium smoke video (VP8 320×240); live re-dogfood.
