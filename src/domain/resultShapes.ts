/**
 * D-2..D-7: pure helpers that re-shape upstream family-command results into
 * structured TOON fields. Each function is side-effect free and tolerant of
 * non-matching input (returns a safe empty/null result) so a malformed upstream
 * payload never fails a command.
 */

/**
 * D-6: strip ANSI CSI escape sequences (colour/dim/reset codes) from an
 * upstream string. Playwright emits e.g. `\u001b[2m…\u001b[22m` to dim call-log
 * lines even when `NO_COLOR=1` is set, so these leak into structured error
 * messages. Stripping keeps TOON `message` fields clean plain text.
 */
export function stripAnsi(value: string): string {
  // ponytail: a single CSI regex covers the colour/dim codes Playwright emits;
  // OSC and other rare sequences are out of scope until seen in the wild.
  return value.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

/**
 * D-4: true when `path` is a URL scheme (http/https/ftp/mailto/etc.) that must
 * pass through path resolution untouched. The wrapper joins relative artifact
 * paths against the daemon's cwd; without this guard, a markdown link target
 * like `](https://example.com/x)` was joined into a bogus
 * `/cache/https:/example.com/x`. A single-slash `https:/` is NOT matched, so a
 * value that was already half-mangled is not mistaken for a real URL.
 */
export function isUrlLike(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(path) || /^mailto:/i.test(path);
}

export interface ParsedTab {
  index: number;
  current: boolean;
  title: string;
  url: string;
}

const TAB_LINE = /^-\s+(\d+):\s*(\(current\)\s*)?\[([^\]]*)\]\(([^)]*)\)\s*$/;

/**
 * D-3: parse upstream's tab markdown (`- 0: (current) [Title](url)`) into a
 * structured `tabs[]` shape. The ordinal is the index `tab-select <n>` accepts.
 * Returns an empty array when the payload is not a tab list, so callers can
 * fall back to the raw value without a try/catch.
 */
export function parseTabList(markdown: string): ParsedTab[] {
  if (typeof markdown !== "string" || markdown.length === 0) return [];
  const tabs: ParsedTab[] = [];
  for (const line of markdown.split("\n")) {
    const m = line.match(TAB_LINE);
    if (!m) continue;
    tabs.push({
      index: Number(m[1]),
      current: m[2] !== undefined,
      title: m[3] ?? "",
      url: m[4] ?? "",
    });
  }
  return tabs;
}

export interface ParsedConsole {
  totals: { messages: number; errors: number; warnings: number };
  messages: { severity: string; text: string; location: string }[];
}

const CONSOLE_HEADER =
  /Total messages:\s*(\d+)\s*\(Errors:\s*(\d+),\s*Warnings:\s*(\d+)\)/;
const CONSOLE_LINE = /^\[(\w+)\]\s+(.*)$/;

/**
 * D-7: parse upstream's console display string into structured totals + a
 * per-message list. The upstream format is:
 *   `Total messages: N (Errors: E, Warnings: W)\n\n[SEVERITY] text @ location`
 * where messages without a severity tag (e.g. a raw stack trace) are kept as a
 * single error block. Returns null when the header is absent so the caller can
 * pass the raw string through unchanged.
 */
export function parseConsoleMessages(raw: string): ParsedConsole | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const header = raw.match(CONSOLE_HEADER);
  if (!header) return null;
  const totals = {
    messages: Number(header[1]),
    errors: Number(header[2]),
    warnings: Number(header[3]),
  };
  const body = raw.slice(header.index! + header[0].length).trim();
  const messages: ParsedConsole["messages"] = [];
  if (body.length > 0) {
    // Tagged lines group under one entry; untagged continuation lines (stack
    // frames) fold into the preceding entry's text so a stack stays intact.
    for (const line of body.split("\n")) {
      const m = line.match(CONSOLE_LINE);
      if (m) {
        const rest = m[2] ?? "";
        const at = rest.lastIndexOf(" @ ");
        const text = at === -1 ? rest : rest.slice(0, at);
        const location = at === -1 ? "" : rest.slice(at + 3);
        messages.push({ severity: (m[1] ?? "").toLowerCase(), text, location });
      } else if (messages.length > 0) {
        const last = messages[messages.length - 1]!;
        last.text = `${last.text}\n${line}`;
      } else {
        // No preceding tagged line: treat the whole body as one error block.
        messages.push({ severity: "error", text: body, location: "" });
        break;
      }
    }
  }
  return { totals, messages };
}
