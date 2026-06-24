import { existsSync } from "node:fs";
import { env as nodeEnv } from "node:process";

/**
 * Browser discovery for F-2.
 *
 * Upstream `@playwright/cli` launches a browser via the
 * `PLAYWRIGHT_MCP_EXECUTABLE_PATH` env var. When that var is unset, upstream
 * looks for its bundled chrome-for-testing and, if absent, fails with a
 * heavyweight "install-browser" suggestion — even when a perfectly usable
 * system Chromium/Chrome/Edge is installed.
 *
 * This module finds a usable system browser per-OS so the wrapper can inject
 * the override automatically, and so the `missing_browser` error can name the
 * override plus any browsers it did detect.
 *
 * The discovery is PURE: every side-effecting input (platform, env, existence
 * checks) is injectable, so per-OS behavior is unit-testable without running
 * each OS.
 */

export interface BrowserCandidate {
  channel: string;
  paths: readonly string[];
}

export interface DiscoveredBrowser {
  path: string;
  channel: string;
}

export interface BrowserDiscoveryDeps {
  platform?: string;
  env?: Record<string, string | undefined>;
  exists?: (path: string) => boolean;
}

export interface DiscoveryResult {
  /** First usable browser (or the explicit override), or null if none. */
  browser: DiscoveredBrowser | null;
  /** Every browser found on disk, in priority order. */
  detected: DiscoveredBrowser[];
}

export const OVERRIDE_ENV_VAR = "PLAYWRIGHT_MCP_EXECUTABLE_PATH";

/** Linux candidates — covers Arch/Omarchy, Ubuntu (apt + snap), Fedora, etc. */
export const LINUX_CANDIDATES: readonly BrowserCandidate[] = [
  {
    channel: "chromium",
    paths: ["/usr/bin/chromium", "/usr/bin/chromium-browser"],
  },
  {
    channel: "chrome",
    paths: [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome-beta",
      "/usr/bin/google-chrome-unstable",
    ],
  },
  {
    channel: "chrome-canary",
    paths: ["/usr/bin/google-chrome-canary"],
  },
  {
    channel: "msedge",
    paths: ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"],
  },
  {
    channel: "brave",
    paths: ["/usr/bin/brave", "/usr/bin/brave-browser"],
  },
  // Snap (common on Ubuntu)
  {
    channel: "chromium-snap",
    paths: ["/snap/bin/chromium"],
  },
];

export const DARWIN_CANDIDATES: readonly BrowserCandidate[] = [
  {
    channel: "chrome",
    paths: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    ],
  },
  {
    channel: "chromium",
    paths: ["/Applications/Chromium.app/Contents/MacOS/Chromium"],
  },
  {
    channel: "msedge",
    paths: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
  },
  {
    channel: "brave",
    paths: ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
  },
];

export const WIN32_CANDIDATES: readonly BrowserCandidate[] = [
  {
    channel: "chrome",
    paths: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      // LocalAppData install (per-user)
      "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe",
    ],
  },
  {
    channel: "msedge",
    paths: [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ],
  },
  {
    channel: "chromium",
    paths: [
      "C:\\Program Files\\Chromium\\Application\\chrome.exe",
      "%LOCALAPPDATA%\\Chromium\\Application\\chrome.exe",
    ],
  },
];

/** Candidate lists keyed by process.platform. */
export function candidatesForPlatform(
  platform: string,
): readonly BrowserCandidate[] {
  switch (platform) {
    case "darwin":
      return DARWIN_CANDIDATES;
    case "win32":
      return WIN32_CANDIDATES;
    default:
      return LINUX_CANDIDATES;
  }
}

/**
 * Channel-to-candidate mapping for the home view's `usable` derived field.
 * A channel session (e.g. `chrome`, `msedge-dev`) is usable when a browser
 * binary for that channel family exists on disk.
 */
const CHANNEL_FAMILY: Record<string, string[]> = {
  chrome: ["chrome", "chrome-canary", "chromium"],
  "chrome-beta": ["chrome"],
  "chrome-dev": ["chrome", "chrome-canary"],
  "chrome-canary": ["chrome-canary"],
  chromium: ["chromium", "chromium-snap"],
  msedge: ["msedge"],
  "msedge-dev": ["msedge"],
  "msedge-beta": ["msedge"],
  brave: ["brave"],
};

export function resolveDeps(
  deps: BrowserDiscoveryDeps = {},
): Required<BrowserDiscoveryDeps> {
  return {
    platform: deps.platform ?? process.platform,
    env: deps.env ?? nodeEnv,
    exists: deps.exists ?? existsSync,
  };
}

/**
 * Expand `%LOCALAPPDATA%` style Windows placeholders against the env so the
 * existence check works for per-user installs.
 */
function expandPath(
  path: string,
  env: Record<string, string | undefined>,
): string {
  if (!path.includes("%")) return path;
  let expanded = path;
  let hasUndefinedVar = false;
  expanded = path.replace(/%([^%]+)%/g, (_, name: string) => {
    const value = env[name];
    if (value === undefined) {
      hasUndefinedVar = true;
      return "";
    }
    return value;
  });
  if (hasUndefinedVar) {
    return "";
  }
  return expanded;
}

/**
 * Discover a usable system browser.
 *
 * 1. If `PLAYWRIGHT_MCP_EXECUTABLE_PATH` is set and points at an existing
 *    file, it wins (the user's explicit choice is respected).
 * 2. Otherwise, scan the per-OS candidate list and use the first that exists.
 */
export function discoverSystemBrowser(
  deps: BrowserDiscoveryDeps = {},
): DiscoveryResult {
  const { platform, env, exists } = resolveDeps(deps);

  const override = env[OVERRIDE_ENV_VAR];
  if (override && override.length > 0 && exists(override)) {
    return {
      browser: { path: override, channel: "override" },
      detected: [{ path: override, channel: "override" }],
    };
  }

  const detected: DiscoveredBrowser[] = [];
  for (const candidate of candidatesForPlatform(platform)) {
    for (const raw of candidate.paths) {
      const path = expandPath(raw, env);
      if (exists(path)) {
        detected.push({ path, channel: candidate.channel });
      }
    }
  }

  return { browser: detected[0] ?? null, detected };
}

/**
 * Whether a channel session row can actually be driven on this machine.
 * Returns "yes" when a browser for the channel's family is installed.
 */
export function channelUsable(
  channel: string,
  deps: BrowserDiscoveryDeps = {},
): "yes" | "no" {
  const resolved = resolveDeps(deps);
  const { browser } = discoverSystemBrowser(resolved);
  // Any discovered browser can drive a session via the override, so if a
  // browser exists at all the session is usable.
  if (browser) return "yes";
  // No global browser: a channel is still usable if its own family binary
  // exists on disk.
  const families = CHANNEL_FAMILY[channel] ?? [];
  if (families.length === 0) return "no";
  const candidates = candidatesForPlatform(resolved.platform);
  for (const family of families) {
    const candidate = candidates.find((c) => c.channel === family);
    if (
      candidate?.paths.some((p) => resolved.exists(expandPath(p, resolved.env)))
    ) {
      return "yes";
    }
  }
  return "no";
}
