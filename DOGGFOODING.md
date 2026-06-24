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
- Why it hurts: the home view _advertises_ the channel sessions it discovered,
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
  Correct form is `screenshot --filename ./x.png` (positional is the _element target_).
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
   - channel sessions in the `missing_browser` error. _(unblocks every session)_
2. **F-3**: default snapshot/video artifacts to a temp or gitignored dir;
   document the state-dir override. _(prevents repo pollution)_
3. **F-4**: add a `video-chapters` read command + include chapters in
   `video-stop`. _(closes the biggest abstraction leak)_
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

---

## Friction Hunt #2 (2026-06-24, branch `feature/dogfooding-fixes`)

A genuine end-to-end friction hunt driving classroom-connect.app as a real task
("open → Director demo → Classrooms page → verify"), logging every stumble in
real time. The prior "re-dogfood" only proved each of the 9 fixes in isolation;
this pass found **9 NEW findings**, including two critical regressions that mean
the branch is **not safe to ship as-is**.

Recorded as the "N-" (new) series. Severity: 🔴 critical / 🟠 high / 🟡 medium / 🟢 low.

### 🔴 N-9 — Relative video file paths are orphaned in the cache dir (REGRESSION)

- **what-tried:** `video-start ./friction-hunt.webm --size 1280x720` (relative path, as an agent naturally writes), then `video-stop`.
- **what-happened:** `video-stop` reported `status: ok` and `files: count: 1` (upstream DID record), but `./friction-hunt.webm` never appeared in the shell cwd. The file was silently written to `/tmp/playwright-cli-axi-cache/playwright-cli-axi/hunt.webm` (the daemon's spawn cwd). The entire friction-hunt recording was lost this way.
- **why-it-hurts:** The agent requests a video, is told it succeeded, and the file is unreachable. This is the single most damaging failure mode for a video-first tool. Absolute paths work; relative paths are orphaned.
- **root cause:** The F-3 fix moved the upstream spawn cwd to a cache dir so auto-snapshots stop polluting the repo — but `video-start`'s positional filename is NOT absolutized against the shell cwd (only `--filename`/`--path` are, via `resolveRelativeFilePaths`). So `./out.webm` resolves daemon-side to the cache dir.
- **AXI-principle-violated:** Principle 1 (content-first: the agent must be able to trust the returned path) + Principle 5 (definitive empty/success states — `files: count 1` is a false positive).
- **suggested-fix:** Absolutize the `video-start` positional filename against the shell cwd (extend `resolveRelativeFilePaths` or the video argv preprocessor to cover it), exactly as `--filename` already is. Add a regression test asserting `video-start ./rel.webm` produces a file findable from the shell cwd.

### 🔴 N-1 — The `wait` command and `--wait` flag are completely broken

- **what-tried:** `wait load`, `wait networkidle`, `click e31 --wait networkidle`.
- **what-happened:** Every invocation throws `error: kind upstream_error, message "SyntaxError: Unexpected identifier 'page'"`. The entire P-5 feature has been non-functional since it was added.
- **why-it-hurts:** Agents rely on `--wait`/`wait` to make post-navigation state deterministic instead of `sleep`+re-poll. With it broken, there is no deterministic settle mechanism.
- **root cause:** `runWaitCommand`/`runPageWait` emit `await page.waitForLoadState(...)` as a bare statement, but upstream `run-code` wraps the snippet in a **non-async** function body, so `await` is a syntax error. Proven fix: emit an async arrow function expression instead — `async (page) => { await page.waitForLoadState(...) }` returns `status: ok`.
- **AXI-principle-violated:** Principle 5 (a command that always errors is the opposite of a definitive state) + Principle 10 (the advertised contract is a lie).
- **why tests missed it:** Every unit test injects a mock upstream that never validates the generated code string against upstream's real eval contract.
- **suggested-fix:** Change both code generators to the `async (page) => { ... }` form; add a live-upstream (or contract-regex) test asserting the emitted code is an async function expression.

### 🟠 N-2 — `--wait` reports failure after a successful navigation (false negative)

- **what-tried:** `click e121 --wait networkidle` (Director role).
- **what-happened:** The click itself navigated successfully to `/school-year/dashboard`, but the subsequent `--wait` threw the N-1 SyntaxError, so the overall result was an error. An agent reading the output would conclude the click failed when it actually succeeded.
- **why-it-hurts:** False negatives on the exact action the agent cares about. Combined with N-1, `--wait` is worse than absent — it actively misleads.
- **root cause:** `runGenericCommand` issues the click, then calls `runPageWait`, and on any wait error returns the error result, discarding the click success.
- **AXI-principle-violated:** Principle 5.
- **suggested-fix:** Once N-1 is fixed the error goes away; defensively, a wait failure after a successful command should be a warning, not a hard failure that masks the primary result.

### 🟠 N-8 — `video-start` before a page is open silently records nothing

- **what-tried:** `video-start ./out.webm` (before any `open`), then `open`, then `video-stop`.
- **what-happened:** `video-stop` reported `files: count: 0, empty: upstream reported no videos were recorded`. No error at start time.
- **why-it-hurts:** An agent that starts recording before navigating (a natural sequence) captures nothing and is never warned.
- **root cause:** Upstream recording attaches to a page context; with no page open there is nothing to capture, and the wrapper surfaces no pre-check.
- **AXI-principle-violated:** Principle 5 (definitive empty state — here the empty state arrives too late, at stop, with no start-time guard).
- **suggested-fix:** On `video-start`, warn (or exit 2 with guidance) when no browser page is currently open; document the open-first ordering.

### 🟡 N-4 — `open` returns `status: ok` before the SPA has rendered

- **what-tried:** `open https://classroom-connect.app`, then immediately `snapshot`.
- **what-happened:** `open` returned `status: ok`, but the snapshot showed only `generic [ref=e4]: Loading...`. The page was not actually ready.
- **why-it-hurts:** Agents act on the post-`open` state assuming it's settled. The intended remedy (`--wait`/`wait`) is broken (N-1), so the only workaround is a blind `sleep`.
- **AXI-principle-violated:** Principle 5.
- **suggested-fix:** Make `open`/`goto` default to a `networkidle` (or `load`) settle, or at least offer `--wait` once N-1 is fixed; until then, document that SPAs need an explicit settle.

### 🟡 N-5 — `eval` output is double-nested

- **what-tried:** `eval 42`, `eval window.location.href`.
- **what-happened:** Result renders as `result: result: "42"` (two levels of `result`). `eval` is not in `NAVIGATION_COMMANDS`, so it falls through to `familyResultModel` which nests.
- **why-it-hurts:** Same class of burying-the-value friction as the original P-1, newly observed for `eval`. Agents must dig through `result.result`.
- **AXI-principle-violated:** Principle 1 (content-first).
- **suggested-fix:** Add `eval` (and other single-value `page interaction` commands) to a flat-result path so the value is top-level.

### 🟡 N-6 — Element refs require text-mining from the snapshot

- **what-tried:** To click "View Demo", had to `snapshot | grep -oE 'ref=e[0-9]+'`.
- **what-happened:** Refs are embedded in snapshot text; there is no structured "give me the ref for the element matching label/role X" lookup.
- **why-it-hurts:** Targeting an element is fragile string parsing, not a query.
- **AXI-principle-violated:** Principle 1.
- **suggested-fix:** Add a ref-lookup command (e.g., `find "View Demo"` → `{ ref: "e31" }`) or return a structured element table from `snapshot`.

### 🟡 N-7 — No auto-snapshot after navigation; refs go stale silently

- **what-tried:** Click a navigation link, then `click <old-ref>`.
- **what-happened:** `error: Ref e16 not found in the current page snapshot. Try capturing new snapshot.` Every navigation invalidates all prior refs.
- **why-it-hurts:** Agents must manually re-`snapshot` after every nav-producing action or hit stale-ref errors.
- **AXI-principle-violated:** Principle 5.
- **suggested-fix:** Auto-include a fresh (bounded) snapshot in the result of navigation-producing commands, so the next ref is always available without an extra round-trip.

### 🟢 N-3 — Error/command field is mislabeled when `--wait` is used

- **what-tried:** `click e121 --wait networkidle`.
- **what-happened:** The error's `command:` field read `--wait networkidle` instead of `click`.
- **why-it-hurts:** Logs/diagnostics misattribute the failing command.
- **root cause:** The wait-error label is built from `["--wait", state]` rather than the originating command.
- **suggested-fix:** Label wait-aftermath errors with the originating command name.

### Re-confirmed positives

- ✅ Browser auto-discovery works with NO env var (`open` succeeded on Arch/Omarchy with Chromium at `/usr/bin/chromium`).
- ✅ No CWD pollution (auto-snapshots go to cache dir).
- ✅ Named **screenshots** land in the shell cwd (`--filename`).
- ✅ `scroll` genuinely scrolls (verified `window.scrollY` 0 → 1000 on a scrollable page; the Classrooms page simply fit the viewport).
- ✅ `video-chapters` returns a readable manifest via the CLI.
- ✅ `snapshot` renders the a11y tree as readable single-layer text.

### Verdict

The 9 original findings are genuinely closed, but this hunt found **2 critical**
(N-1 broken wait, N-9 orphaned relative video paths — N-9 being a direct
regression of the F-3 fix) and **2 high** (N-2 false-negative wait, N-8 silent
no-record) issues. **The branch must not ship until at least N-1 and N-9 are
fixed**, because N-9 breaks the project's #1 priority (reliable video file
output) and N-1 ships an advertised feature that always errors.

---

## Friction Hunt #2 — Resolution (2026-06-24, branch `feature/dogfooding-fixes`)

The 4 ship-blocker/high findings from Friction Hunt #2 are closed and re-verified against a live browser:

- **N-1** ✓ `wait`/`--wait` fixed. Root cause was emitting a bare `await page.waitForLoadState(...)` statement, which upstream `run-code` rejects (`SyntaxError: Unexpected identifier 'page'`) because it wraps the snippet in a non-async body invoked with `page`. Both generators now emit an `async (page) => { ... }` arrow expression (shared `waitForLoadStateCode` seam). Live: `wait load`, `wait networkidle`, and `click <ref> --wait load` all return `status: ok`. A contract test pins the emitted shape and proves it parses as a function expression.
- **N-2** ✓ A `--wait` failure after a successful navigation command no longer masks the success. `runGenericCommand` now surfaces wait-aftermath failures as a bounded `wait_warning` field on the exit-0 result instead of overwriting it with an error. Unit test proves exit 0 + primary result + `wait_warning` when the wait errors.
- **N-8** ✓ `video-start` with no open browser page now exits 2 with guidance (`open <url>` / `list`) instead of silently starting a recording that captures nothing. The guard queries upstream `list` (fail-open on an inconclusive check). Live: `video-start` before `open` → exit 2 with the guidance message; after `open` → records normally.
- **N-9** ✓ Relative `video-start` filenames now land in the shell cwd. Root cause was the F-3 artifact-dir change moving the daemon spawn cwd to a cache dir without absolutizing the video-start positional (only `--filename`/`--path` were). `resolveRelativeFilePaths` now absolutizes the video-start positional against the shell cwd. Live: `video-start ./rel.webm` (after `open`) followed by `video-stop` produces a non-empty WebM findable from the shell cwd, with NO cache-dir orphan.

Remaining open friction-hunt #2 findings (noted but not in this fix's scope): N-3 (mislabeled `command:` field — moot once N-1 fixed the underlying error), N-4 (SPA `open` settle), N-5 (`eval` double-nesting), N-6 (ref text-mining), N-7 (no auto-snapshot after navigation).

---

## Dogfood #2 — Option C: Signup / lead-capture flow test (2026-06-24, branch `feature/dogfooding-fixes`)

**Task:** Drive the `classroom-connect.app` trial-signup + onboarding flow end-to-end
as a real agent would — open → fill the registration form → submit → assert the
success state — exercising the form-interaction surface (`fill`, validation,
assertion, structured extraction) that Option A never touched. **Real purpose:**
dogfood the wrapper and log friction. Findings are the **C-** series.

**Head:** `32bfc5e` (post-friction-hunt-#2 fixes, validated). **Site:** real
production `classroom-connect.app`. No env vars set (browser auto-discovered).

### Conversion path proven (end-to-end)

1. `open` → landing; `snapshot` found CTAs (`Start Free Trial` `e16` → `/register`).
2. `click e16 --wait networkidle` → `/register` form (Name/Email/Password).
3. `fill` all three fields → `ok`.
4. (validation probe) bad email submit → **blocked silently** (see C-1).
5. re-`fill` valid email/password → `click Create Account` → redirect to `/onboarding`.
6. `fill` school name → `click Create School` → redirect to `/school-year/dashboard`.
7. **Asserted success:** dashboard shows logged-in user `Will Test`, the created
   school, and fresh-school KPIs (`0/0 Classrooms`, `2 blockers`, `Next Step: Create classrooms`).
8. `School Settings` confirmed persisted school name `PCA Test Preschool`, invite
   code `K5ZGWA`, `Trial Active — 89 days remaining`.

**Verdict:** the wrapper **completed** a real, non-trivial authenticated flow
(signup → school creation → dashboard) and the form commands (`fill`) worked
cleanly. But the hunt surfaced **6 findings**, including one **critical** silent
failure on the single most common form-testing action (submit-with-invalid-input).

### 🔴 C-1 — HTML5 form validation is invisible to the snapshot (double false-positive)

- **what-tried:** `fill` an invalid email (`not-an-email`) + short password, then `click Create Account`.
- **what-happened:** `click` returned `status: ok`. The post-submit `snapshot`
  showed the form **unchanged with no error** — the only signal was `[active]`
  focus moved to the email field. Confirmed via `eval document.querySelector('input[type=email]').checkValidity()` → `false`: the browser's HTML5 `type=email`
  constraint validation blocked the submit and focused the field, but the
  validation bubble is **not in the accessibility tree**.
- **why-it-hurts:** the most dangerous failure mode for form testing — the
  wrapper reports `ok` for the click AND the snapshot shows no error, so an agent
  concludes the form submitted successfully when in reality nothing was sent.
  There is no wrapper-level signal that submit was blocked by validation.
- **AXI-principle-violated:** **5 (definitive states)** — a silent non-success
  masquerading as success; the opposite of a definitive empty/success state.
- **suggested-fix:** on submit commands, detect a no-navigation outcome (URL
  unchanged after click) and/or surface `eval`-style `checkValidity()` /
  `:invalid` element state in the result, e.g. a `validation: { ok: false,
invalid_fields: [...] }` block when a click doesn't navigate. At minimum,
  document that HTML5 validation bubbles are snapshot-invisible and the agent
  must assert via URL-change or `:invalid` selectors.

### 🟠 C-2 — `eval` is triple-nested AND context-confused (extends N-5)

- **what-tried:** `eval "location.href"`; earlier `eval "async (page) => page.url()"`.
- **what-happened:** `eval "location.href"` → `result: result: "\"https://classroom-connect.app/onboarding\""`
  — the value is **triple-escaped** (a stringified JSON string, two `result:`
  wrappers, plus inner quotes). And `eval "async (page) => page.url()"` **fails**
  with `TypeError: Cannot read properties of undefined (reading 'url')`.
- **why-it-hurts:** (a) recovering the actual URL requires un-escaping three
  layers; (b) the wrapper exposes **two different eval surfaces** — `eval`
  (browser-DOM context, **no `page`**) vs `run-code` (node context, **has `page`**) —
  with different function signatures. The `async (page) => {...}` form that is
  CORRECT for `wait`/`run-code` is WRONG for `eval`. An agent must know which
  surface they're on, and the wrapper doesn't tell them.
- **AXI-principle-violated:** **1 (content-first)** — the value is buried, not
  top-level; **10 (clean contract)** — two eval commands with silently different
  calling conventions.
- **suggested-fix:** flatten `eval`'s single return value to a top-level `result`
  (or a typed `value`) instead of `result.result`; and document/align the eval
  vs run-code calling conventions (ideally make `eval` accept the same
  `async (page)=>{}` form, or clearly label contexts in their `--help`).

### 🟠 C-3 — Structured page data (KPIs, pricing, stats) requires text-mining the a11y tree (extends N-6)

- **what-tried:** read the dashboard's KPIs ("how many classrooms? how many
  blockers?") and compare the pricing plans ($30/$50/$100 + features).
- **what-happened:** the dashboard's pre-computed aggregates are in the DOM as
  sibling text nodes: `generic "0/0"` (`e253`) next to `generic "Classrooms"`
  (`e254`), `generic "2 blockers"` (`e247`), etc. The pricing cards similarly
  scatter name/price/features across list items. The wrapper returns a flat a11y
  tree; recovering the numbers/tables the page **already computed** requires
  fragile sibling-node parsing (`grep`/`eval querySelectorAll`).
- **why-it-hurts:** the page has done the aggregation work; the wrapper hands
  back a flat tree and makes the agent redo it with string parsing. Extracting
  "the 3 plans and their prices" is a multi-step mine, not a query.
- **AXI-principle-violated:** **4 (pre-computed aggregates)** — the page
  pre-computed them, but the wrapper doesn't surface a table/derived structure.
- **suggested-fix:** a command-aware extractor (e.g. `extract` / a `--table` mode
  on `snapshot`) that returns labeled rows for repeated card/stat patterns, or a
  `find "Classrooms"` → `{value:"0/0"}` lookup that pairs sibling label/value nodes.

### 🟡 C-4 — `--wait` returning ok doesn't guarantee the next read sees settled state (extends N-4)

- **what-tried:** `click Create School e150 --wait networkidle`, then immediately `eval location.href`.
- **what-happened:** the `click --wait` returned `ok`, but the next `eval
location.href` came back **empty** (mid-transition). A second `wait networkidle`
  was required before the URL read as `/school-year/dashboard`.
- **why-it-hurts:** `--wait networkidle`'s `ok` is not a reliable "the page is
  settled for the next command" signal for SPA client-side routing; follow-up
  reads can race the transition. Agents must add defensive re-waits.
- **AXI-principle-violated:** **5 (definitive states)** — `ok` overpromises settle.
- **suggested-fix:** make `--wait` (or a new `--settle`) gate on a stable
  post-action URL/DOM, or document that `--wait networkidle` settles network only
  and SPA route mounting may lag.

### 🟡 C-5 — `help <cmd>` and the real command surface disagree about existence

- **what-tried:** `help get-url` (guessing a URL-read command).
- **what-happened:** `help get-url` returned help metadata (`source: @playwright/cli`,
  `bytes: 6423`, `lines: 40`) — looking like a real command. But `get-url` itself
  returns `error: kind: usage / Unknown command: get-url`. The `help <X>` alias
  (→ `<X> --help`) and the actual command router disagree on whether `X` exists.
- **why-it-hurts:** an agent using `help <X>` to validate a command's existence
  is misled — it can report a command as real that the router rejects.
- **AXI-principle-violated:** **9/10 (discoverability / clean contract)**.
- **suggested-fix:** make `help <X>` route through the same command-existence
  check as the router, returning `Unknown command` consistently when `X` isn't real.

### 🟢 C-6 — `select` / `check` / `upload` form commands remain un-dogfooded

- **what-tried:** looked for dropdowns/checkboxes on the registration + School
  Settings forms to exercise `select`/`check`/`upload` live.
- **what-happened:** both real forms used **only textboxes + buttons** (the
  timezone field is a textbox, not a `<select>`). No opportunity to drive the
  dropdown/checkbox/upload paths against the real site.
- **why-it-hurts:** these form commands are still only unit-tested (the exact gap
  that hid the N-1 `wait` breakage). They may harbour context/signature bugs that
  only surface against a real `<select>`/`<input type=file>`.
- **suggested-fix:** (dogfood-coverage gap, not a bug) find a real flow with a
  `<select>`/checkbox/upload (e.g. a settings page with role/timezone dropdowns,
  or a file-upload form) and drive it; or add a live-upstream contract test for
  each form command's emitted selector/code string.

### ✅ What worked well (reinforce these)

- **GOOD-C1** `fill` is clean and reliable — all fields filled, persisted across
  navigation (school name read back verbatim on the settings page).
- **GOOD-C2** Navigation CTA → form → submit → redirect worked at every step;
  `click --wait networkidle` drove the SPA transitions (N-1 fix holding).
- **GOOD-C3** Readable single-layer a11y snapshot (P-2 fix holding) — refs and
  field labels were legible, not double-escaped JSON.
- **GOOD-C4** Browser auto-discovered with **no env var** (F-2 fix holding); no
  CWD pollution (F-3 fix holding); snapshot paths absolutized and findable.
- **GOOD-C5** The full authenticated conversion path (signup → school → dashboard)
  completed and was assertable end-to-end — a genuinely useful real task.

### Note on teardown

The trial account + school (`PCA Test Preschool`, invite code `K5ZGWA`) were
really created on production `classroom-connect.app`. They were **not** torn down
(no delete-account flow was driven); the user can delete the trial from the
dashboard/account settings. The billing "Manage Billing" button (→ Stripe) was
intentionally not clicked.

---

## Dogfood #2 — Option C Resolution (2026-06-24, branch `feature/dogfooding-fixes`)

All 6 Option-C findings (C-1..C-6) are fixed, re-verified against a live
`classroom-connect.app`, and covered by new unit/property tests.

- **C-1** ✓ HTML5 validation is now surfaced. After a submit-triggering
  `click`/`dblclick`, the wrapper runs a bounded `run-code` probe (a shared
  `validationProbeCode` seam, contract-tested) that reports `:invalid` form
  fields and whether the browser focused an invalid field (the blocked-submit
  signal). When a submit appears blocked, the result gains
  `validation: { ok: false, invalid_fields: [...] }` — the primary click result
  and exit code are preserved. A bug found during live re-dogfood (run-code wraps
  its return in `{ result: "<json>" }`, which the probe initially did not
  unwrap) was fixed. Live: invalid-email submit on `/register` →
  `validation: ok: false` with the email field (id `email`, label `EMAIL`);
  valid submit → navigates to `/onboarding` with no validation block.
- **C-2** ✓ `eval`/`run-code` flatten their single return value to a top-level
  `result` and undo upstream's JSON encoding (`recoverScalarValue`). Live:
  `eval "location.href"` returns the URL directly, not `result: result: "\"…\""`.
  README documents the two contexts: `eval` runs in the browser DOM (no `page`),
  `run-code` in node (has `page`, use `async (page) => {}`). The working N-1
  run-code async-arrow contract is unchanged.
- **C-3** ✓ New `find <label>` wrapper command parses the a11y snapshot
  (`snapshotFind.ts`, pure + unit-tested) and returns structured matches with
  refs, pairing adjacent label/value nodes. Live on the Director dashboard:
  `find "Classrooms"` → `e154, generic, value: 0/0`; `find "Students"` → 4
  matches. Default `snapshot` output is unchanged (new capability only).
- **C-4** ✓ New `--settle [state]` flag (default `networkidle`) waits for the
  load state AND polls `page.url()` to stability (uses `page.waitForTimeout`,
  not the absent node `setTimeout`). Live: the read after `click Create School
--settle` returned the dashboard URL without a second manual wait (the empty
  mid-transition read that originally found C-4 is gone). `--wait` is documented
  as network-only.
- **C-5** ✓ `help <X>`/`<X> --help` now route through the same `isKnownCommand`
  check as the run router, returning `Unknown command: X` (exit 2) for
  non-commands instead of upstream's permissive help metadata. Live:
  `help get-url` → `Unknown command: get-url` (exit 2); `help click` still
  returns upstream help.
- **C-6** ✓ The `select`/`check`/`upload` coverage gap (the class of gap that
  hid N-1) is closed two ways: passthrough-integrity unit tests prove the
  wrapper forwards each command's argv with wrapper flags stripped, AND a live
  dogfood against a real form (injected into a blank page) proved all three:
  `select e5 green` → `color=green`; `check e8` → `agree=true`;
  `click <upload-button>` then `upload /abs/file.png` → `files=avatar.png`
  (upload requires the file-chooser modal state from clicking the input first).

Verification (final head): typecheck clean; 240 tests (+36 new: C-1 probe + CLI
blocked/navigating/probe-failure, C-2 eval flatten, C-3 snapshotFind parser +
find CLI, C-4 settle contract + CLI, C-5 help consistency, C-6 passthrough x3);
property tests stable across 2 runs; build; generated skill/check; 0 production
vulnerabilities; Chromium smoke video; live re-dogfood proving C-1..C-5 on
classroom-connect.app and C-6 on a real form.

No regressions: prior N-1/N-2/N-8/N-9 and P-1/P-2 fixes and whole-surface/
AXI-alignment behavior remain green and were re-confirmed during the live
re-dogfood (wait/--wait succeed, video-start guards, snapshot readable).

---

# Dogfood #3 — High-severity gaps (Storage, Network, Setup/Context)

Driven live against a real Chromium browser (`PLAYWRIGHT_MCP_EXECUTABLE_PATH`)
on example.com from an isolated temp cwd. Every command in the three never-run
high-severity groups was exercised with its actual output observed.

## Storage group (17 commands) — all driven live

Exercised: `cookie-set/get/delete/clear/list`, `localstorage-set/get/delete/
clear/list`, `sessionstorage-set/get/delete/clear/list`, `state-save`,
`state-load`. Functionally the round-trips work (set→get→delete→empty all
behave), but two ship-blockers surfaced.

## Network group (6 commands) — all driven live

Exercised: `requests` (+`--static`, `--filter`), `request <i>`, `route`
(+`--status/--body/--content-type`), `route-list`, `unroute`,
`network-state-set offline|online`. Functionally sound: a mocked route was
served (`fetch('/api/users')` returned the mocked body) and offline mode
broke `fetch` with `TypeError: Failed to fetch`. Shares the H3-2 nesting
finding below.

## Setup/Context session hook (AXI principle 7) — driven live

Exercised in an isolated temp HOME (no real config clobbered): `setup`
(user + project scope), `context`, hook firing, idempotency (3 consecutive
runs), and merge-with-existing-hooks (pre-seeded mainline hook + user
permissions/theme/model). **No findings.** The hook installs into both Claude
Code (`settings.json`) and Codex (`hooks.json` + `config.toml`), fires the
token-budgeted context slice, is idempotent (`action: noop`, still 1 entry
after 3 runs), and merges without clobbering pre-existing hooks or user
config. This principle-7 surface is solid.

## Findings

### H3-1 🔴 CRITICAL — `state-save`/`state-load` relative filename orphaned in daemon cache cwd

- **what-tried:** `state-save ./state.json` then `state-load ./state.json`
  from the shell cwd.
- **what-happened:** `state-save ./state.json` returned `result: "- [Storage
state](./state.json)"` (success) but NO file appeared in the shell cwd; it
  was written to `/tmp/playwright-cli-axi-cache/playwright-cli-axi/state.json`
  (the daemon spawn cwd). `state-load ./state.json` then failed with
  `ENOENT ... '/tmp/playwright-cli-axi-cache/playwright-cli-axi/state.json'`
  and the error message leaks the internal cache path. Absolute paths work
  correctly.
- **why-it-hurts:** Identical bug class to N-9 (video-start positional
  filename). The single most damaging failure mode for a state-reuse flow:
  an agent saves session state, is told it succeeded, and the file is
  unreachable on reload. Storage-state reuse across close/open is impossible
  with relative paths.
- **AXI-principle-violated:** Definitive findability / no silent failure.
- **suggested-fix:** Absolutize the `state-save`/`state-load` positional
  filename against the shell cwd at the `resolveRelativeFilePaths` runner
  chokepoint (same mechanism as N-9's `COMMAND_FILE_POSITIONALS`).

### H3-2 🔴 HIGH — double-nested `result: result: "…"` across all family read commands

- **what-tried:** `cookie-get`, `cookie-list`, `localstorage-get/list`,
  `sessionstorage-get/list`, `state-save`, `state-load`, `requests`,
  `request <i>`, `route`, `route-list`, `unroute`, `network-state-set`,
  `screenshot`, `pdf`.
- **what-happened:** Every one returns `result:\n  result: "<value>"`
  (double-nested). e.g. `cookie-get test_cookie` →
  `result: result: "test_cookie=hello123 (…)"`; `requests` →
  `result: result: "1. [GET] …"`.
- **why-it-hurts:** Identical bug class to C-2 (eval), but C-2's
  `flatResultModel` only covers `eval`/`run-code`. All other family commands
  route through `familyResultModel`, which nests the whole upstream
  `{ result: X }` payload under a second `result`. An agent must dig two
  levels deep to read any storage/network value.
- **AXI-principle-violated:** Content-first / shallow result depth.
- **suggested-fix:** In `familyResultModel`, lift a single-`result`-key
  upstream payload to the top level (generalize the C-2 flatten to all family
  read commands), WITHOUT JSON-parsing (storage/network values are literal
  display strings, not JSON-encoded like eval).

### H3-3 🟠 HIGH — artifact/storage file paths displayed relative to daemon cache cwd (un-findable)

- **what-tried:** `screenshot --filename ./shot.png`, `screenshot` (auto),
  `pdf --filename ./out.pdf`, `state-save <abs>.json`.
- **what-happened:** Returned paths are relative to the daemon spawn cwd, not
  the shell cwd or absolute: `--filename ./shot.png` →
  `../../tmp…/shot.png`; auto `screenshot` →
  `.playwright-cli/page-2026…png` (which lives in the cache dir, invisible
  from the shell cwd). Navigation snapshots ARE absolutized via
  `resolveSnapshot`, but screenshot/pdf/state-save go through
  `familyResultModel` and get no path resolution.
- **why-it-hurts:** An agent cannot locate the artifact it just created
  without knowing the cache dir layout — the auto-screenshot path
  `.playwright-cli/page-*.png` resolves nowhere from the shell cwd.
  Contradicts the documented "Absolute snapshot paths" improvement.
- **AXI-principle-violated:** Definitive findability / pre-computed paths.
- **suggested-fix:** Absolutize relative paths inside flattened artifact/
  storage result strings against the known artifact base (daemon cwd), reusing
  the existing `artifactBase` plumbing.

### H3-4 🟡 LOW — storage empty/not-found states are display strings, not definitive empty states

- **what-tried:** `localstorage-list` after delete; `cookie-get` after delete.
- **what-happened:** Returns `result: "No localStorage items found"` /
  `result: "Cookie 'x' not found"` — a human string, not a machine-readable
  empty state (no `count: 0` / `items: []`).
- **why-it-hurts:** An agent must string-match "No … found" to detect empty;
  cannot reliably assert emptiness.
- **AXI-principle-violated:** Principle 5 (definitive empty states).
- **suggested-fix:** Add a definitive `count: 0` / `items: []` (or `found:
false`) structure for the empty/not-found storage read paths.

### H3-5 ℹ️ INFO (known) — `--raw` flag has no user-visible effect

- **what-tried:** `--raw cookie-list`.
- **what-happened:** Produced identical TOON output to the non-`--raw` run.
  `--raw` is forwarded to upstream but the wrapper still re-parses upstream
  output into TOON.
- **why-it-hurts:** Previously documented open gap; resurfaces during storage
  dogfood. Low severity but misleading flag.
- **suggested-fix:** Either strip `--raw` (declare TOON the only output) or
  genuinely honor it (pass through raw upstream output). Out of scope unless
  escalated.

## Positives

- **GOOD-H3-1:** Every storage round-trip is functionally correct
  (set→get→delete→empty→clear) once paths are absolute.
- **GOOD-H3-2:** Network mocking and offline toggling work end-to-end
  against a real page (verified via `eval fetch`).
- **GOOD-H3-3:** The setup/context session hook (principle 7) is solid —
  installs, fires, idempotent, and merges safely with pre-existing hooks
  including mainline. No findings.
- **GOOD-H3-4:** `state-save`/`state-load` with absolute paths correctly
  persists and restores cookies + localStorage across the round-trip.

## Dogfood #3 — Resolution

All high-severity-gap findings resolved at the root cause and verified live
against a real Chromium browser on example.com from an isolated temp cwd.

- **H3-1** ✓ `state-save`/`state-load` relative filenames now absolutize against
  the shell cwd via `COMMAND_FILE_POSITIONALS` (same mechanism as N-9).
  `state-save ./state.json` writes to `<shellcwd>/state.json` and round-trips
  through `state-load ./state.json` (cookies + localStorage restored). No more
  cache-dir orphaning or leaked cache path in the error.
- **H3-2** ✓ `familyResultModel` now lifts a single-`result`-key upstream
  payload to the top level (generalizes C-2 to all family read commands without
  JSON-parsing). `cookie-get/list`, `localstorage-*`, `sessionstorage-*`,
  `requests`, `request`, `route`, `route-list`, `unroute`, `network-state-set`,
  `screenshot`, `pdf`, `state-save`, `state-load` all return a single-level
  `result` — no more `result: result: <value>`.
- **H3-3** ✓ Relative paths inside flattened result strings (markdown-link
  targets) are resolved and canonicalized against the artifact base.
  `screenshot --filename ./shot.png` → absolute `/cwd/shot.png`; auto
  `screenshot` → findable absolute cache path. A new `canonicalizePath` helper
  collapses `.`/`..` so paths are clean.
- **H3-4** ✓ Storage read commands attach a definitive `found: false` for the
  known empty/not-found patterns (`No … found`, `Cookie 'x' not found`,
  `… key 'x' not found`), so emptiness is machine-readable.
- **H3-5** ℹ️ `--raw` remains a known low-severity open gap (forwarded but
  wrapper re-parses to TOON); out of scope for this pass, documented above.

**Coverage added:** 21 new tests across `commandSurface.spec.ts`
(`canonicalizePath`, `state-save`/`state-load` absolutization) and
`success.spec.ts` (H3-2 family flatten, H3-3 path absolutization, H3-4 empty
states). Existing N-9 video-start tests updated to the now-canonical paths.

**No regressions:** N-1/N-2/N-8/N-9, P-1/P-2, C-1..C-6, whole-surface and
AXI-alignment behavior remain green; eval still flattens (C-2), navigation
snapshots stay absolute (P-1), video-start still guards/absolutizes (N-8/N-9).

**Live verification (re-driven after fixes):**

- `state-save ./state.json` → file in shell cwd; `state-load ./state.json`
  restores `cookie-get sc` → `sc=hello` and `localstorage-get ls` → `ls=hello`.
- `cookie-list`/`localstorage-get`/`requests`/`route-list`/`network-state-set`
  → single-level `result`.
- `screenshot --filename ./shot.png` → `- [Screenshot](/cwd/shot.png)`.
- `localstorage-list`/`cookie-list`/`cookie-get nope` empty → `found: false`.
