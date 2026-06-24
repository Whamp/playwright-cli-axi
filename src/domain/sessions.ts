import type { ToonValue } from "../presenter/toon.js";
import { isObject } from "../upstream/parse.js";
import { channelUsable, type BrowserDiscoveryDeps } from "./browserDiscovery.js";

export interface SessionSummary {
  browsers: { count: number; empty?: string; rows: BrowserRow[] };
  servers: { count: number; empty?: string; rows: ServerRow[] };
  channelSessions: { count: number; empty?: string; rows: ChannelSessionRow[] };
}

export interface BrowserRow extends Record<string, ToonValue> {
  id: string;
  name: string;
  status: string;
}

export interface ServerRow extends Record<string, ToonValue> {
  title: string;
  browser: string;
  version: string;
  dataDir: string;
  workspace: string;
}

export interface ChannelSessionRow extends Record<string, ToonValue> {
  channel: string;
  dataDir: string;
  extension: string;
  endpoint: string;
  /** F-2: whether a browser for this channel is installed and drivable. */
  usable: string;
}

/** Default (minimal) table schemas for list output. */
export const BROWSER_TABLE_FIELDS = [
  "id",
  "name",
  "status",
] as const;
/** Every browser column the wrapper can capture from upstream. */
export const BROWSER_TABLE_FIELDS_ALL = [
  "id",
  "name",
  "status",
  "browserType",
  "version",
  "compatible",
  "attached",
  "userDataDir",
  "headed",
];
export const SERVER_TABLE_FIELDS = [
  "title",
  "browser",
  "version",
  "dataDir",
  "workspace",
];
export const CHANNEL_TABLE_FIELDS = [
  "channel",
  "dataDir",
  "extension",
  "endpoint",
  "usable",
];

/**
 * Resolve the table columns for a `--fields` request.
 *
 * With no request (or only unknown fields), return the minimal default schema
 * (AXI principle 2). With a request, return the requested known fields in the
 * caller's order, so agents can both trim and extend the default columns.
 */
export function resolveTableFields(
  requested: string[] | undefined,
  defaults: readonly string[],
  available: readonly string[],
): string[] {
  if (!requested || requested.length === 0) return [...defaults];
  const availableSet = new Set(available);
  const resolved = requested
    .map((field) => field.trim())
    .filter((field) => availableSet.has(field));
  return resolved.length > 0 ? resolved : [...defaults];
}

export interface CloseStatus {
  session: string;
  status: string;
}

export interface NormalizeSessionsOptions {
  /** Injectable discovery deps so `usable` is deterministic in tests. */
  discovery?: BrowserDiscoveryDeps;
}

export function normalizeSessions(
  value: unknown,
  options: NormalizeSessionsOptions = {},
): SessionSummary {
  if (!isObject(value)) return emptySessions();
  const browsers = Array.isArray(value.browsers) ? value.browsers : [];
  const servers = Array.isArray(value.servers) ? value.servers : [];
  const channelSessions = Array.isArray(value.channelSessions)
    ? value.channelSessions
    : [];

  return {
    browsers: rowsSummary(browsers.map(normalizeBrowser), "no open browsers"),
    servers: rowsSummary(
      servers.map(normalizeServer),
      "no attachable browser servers",
    ),
    channelSessions: rowsSummary(
      channelSessions.map((session, index) =>
        normalizeChannelSession(session, index, options.discovery),
      ),
      "no channel sessions",
    ),
  };
}

export function normalizeClosed(value: unknown): {
  count: number;
  empty?: string;
  rows: { id: string; status: string }[];
} {
  if (!isObject(value) || !Array.isArray(value.closed))
    return { count: 0, empty: "no browsers were closed", rows: [] };
  const rows = value.closed.map((entry, index) => ({
    id: isObject(entry)
      ? stringField(entry, ["id", "name"], String(index + 1))
      : scalarString(entry, String(index + 1)),
    status: "closed",
  }));
  return {
    count: rows.length,
    empty: rows.length === 0 ? "no browsers were closed" : undefined,
    rows,
  };
}

export function normalizeCloseStatus(value: unknown): CloseStatus {
  if (!isObject(value)) return { session: "default", status: "unknown" };
  return {
    session: stringField(value, ["session", "name", "id"], "default"),
    status: stringField(value, ["status"], "unknown"),
  };
}

function emptySessions(): SessionSummary {
  return {
    browsers: { count: 0, empty: "no open browsers", rows: [] },
    servers: { count: 0, empty: "no attachable browser servers", rows: [] },
    channelSessions: { count: 0, empty: "no channel sessions", rows: [] },
  };
}

function normalizeBrowser(browser: unknown, index: number): BrowserRow {
  if (!isObject(browser))
  return { id: String(index + 1), name: "browser", status: "open" };
  return {
    id: stringField(browser, ["id", "browserId", "name"], String(index + 1)),
    name: stringField(browser, ["name", "browserName", "type"], "browser"),
    status: stringField(browser, ["status", "state"], "open"),
    browserType: stringField(browser, ["browserType", "type"], ""),
    version: stringField(browser, ["version"], ""),
    compatible: booleanField(browser, ["compatible"]),
    attached: booleanField(browser, ["attached"]),
    userDataDir:
      browser.userDataDir === null || browser.userDataDir === undefined
        ? "<in-memory>"
        : stringField(browser, ["userDataDir", "dataDir"], "<in-memory>"),
    headed: browser.headed === undefined ? "" : booleanField(browser, ["headed"]),
  };
}

function normalizeServer(server: unknown, index: number): ServerRow {
  if (!isObject(server))
    return {
      title: String(index + 1),
      browser: "browser",
      version: "",
      dataDir: "",
      workspace: "",
    };
  const browser = isObject(server.browser) ? server.browser : undefined;
  return {
    title: stringField(server, ["title", "name", "id"], String(index + 1)),
    browser: browser
      ? stringField(browser, ["browserName", "name"], "browser")
      : stringField(server, ["browser"], "browser"),
    version: stringField(server, ["playwrightVersion", "version"], ""),
    dataDir: browser
      ? stringField(browser, ["userDataDir", "dataDir"], "<in-memory>")
      : stringField(server, ["userDataDir", "dataDir"], ""),
    workspace: stringField(server, ["workspaceDir", "cwd"], ""),
  };
}

function normalizeChannelSession(
  session: unknown,
  index: number,
  discovery?: BrowserDiscoveryDeps,
): ChannelSessionRow {
  if (!isObject(session))
    return {
      channel: String(index + 1),
      dataDir: "",
      extension: "unknown",
      endpoint: "no",
      usable: "no",
    };
  const channel = stringField(session, ["channel", "name", "id"], String(index + 1));
  return {
    channel,
    dataDir: stringField(session, ["userDataDir", "dataDir"], ""),
    extension: booleanField(session, ["extensionInstalled"]),
    endpoint: truthyField(session, ["endpoint"]),
    usable: channelUsable(channel, discovery),
  };
}

function rowsSummary<Row extends Record<string, ToonValue>>(
  rows: Row[],
  empty: string,
): { count: number; empty?: string; rows: Row[] } {
  return {
    count: rows.length,
    empty: rows.length === 0 ? empty : undefined,
    rows,
  };
}

function stringField(
  object: Record<string, unknown>,
  keys: string[],
  fallback: string,
): string {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return fallback;
}

function booleanField(object: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "boolean") return value ? "yes" : "no";
  }
  return "unknown";
}

function truthyField(object: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = object[key];
    if (value !== undefined && value !== null && value !== "") return "yes";
  }
  return "no";
}

function scalarString(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return fallback;
}
