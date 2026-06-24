import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DiscoveredBrowser,
  discoverSystemBrowser,
  OVERRIDE_ENV_VAR,
} from "../domain/browserDiscovery.js";
import {
  resolveRelativeFilePaths,
  shouldInjectJson,
  stripWrapperFlags,
} from "../domain/commandSurface.js";

export interface UpstreamRun {
  argv: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  usedJson: boolean;
  /** Browsers detected on this machine, used to enrich missing_browser errors. */
  detectedBrowsers?: DiscoveredBrowser[];
  /** F-3: the cwd upstream ran in, used to resolve returned relative paths. */
  artifactBase?: string;
}

export type UpstreamRunner = (argv: string[]) => Promise<UpstreamRun>;

export interface CreateUpstreamRunnerOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** F--3: cwd the upstream daemon runs in (auto-generated snapshots land here). */
  artifactDir?: string;
}

export const ARTIFACT_DIR_ENV_VAR = "PLAYWRIGHT_CLI_AXI_ARTIFACT_DIR";

/**
 * F-3: resolve the directory upstream runs in. Auto-generated snapshots
 * (`.playwright-cli/page-*.yml`) land here, keeping them out of the agent's
 * working directory by default. Named `--filename` outputs are absolutized
 * against the shell cwd so they still land where the agent expects.
 */
export function resolveArtifactDir(env: NodeJS.ProcessEnv): string {
  const override = env[ARTIFACT_DIR_ENV_VAR];
  if (override && override.length > 0) return override;
  const cacheHome = env.XDG_CACHE_HOME;
  const base =
    cacheHome && cacheHome.length > 0
      ? cacheHome
      : join(tmpdir(), "playwright-cli-axi-cache");
  return join(base, "playwright-cli-axi");
}

export function createUpstreamRunner(
  options: CreateUpstreamRunnerOptions,
): UpstreamRunner {
  return async (argv) => {
    const cleanArgv = stripWrapperFlags(argv);
    const usedJson = shouldInjectJson(cleanArgv);
    const upstreamArgv = usedJson ? ["--json", ...cleanArgv] : cleanArgv;
    const scriptPath = resolveUpstreamScript();

    /*
     * F-2: discover a usable system browser when the override env var is not
     * already set, so `open` works without asking the agent to install
     * chrome-for-testing. The discovery is cheap and pure; we attach the
     * detected list to the run so the missing_browser error can name them.
     */
    const discovery = discoverSystemBrowser({ env: options.env });
    const spawnEnv: NodeJS.ProcessEnv = { ...options.env, NO_COLOR: "1" };
    if (!spawnEnv[OVERRIDE_ENV_VAR] && discovery.browser) {
      spawnEnv[OVERRIDE_ENV_VAR] = discovery.browser.path;
    }

    /*
     * F-3: run upstream in the artifact dir so auto-generated snapshots do not
     * pollute the working directory, but resolve named file outputs against the
     * agent's shell cwd so screenshots/videos still land where expected.
     */
    const artifactDir = options.artifactDir ?? resolveArtifactDir(options.env);
    const forwardedArgv = resolveRelativeFilePaths(upstreamArgv, options.cwd);
    // Ensure the artifact dir exists: spawn refuses to run in a missing cwd.
    // If it cannot be created (e.g. read-only cache), fall back to the shell
    // cwd rather than failing the whole command.
    let spawnCwd = artifactDir;
    try {
      mkdirSync(artifactDir, { recursive: true });
    } catch {
      spawnCwd = options.cwd;
    }

    return await new Promise<UpstreamRun>((resolve) => {
      const child = spawn(process.execPath, [scriptPath, ...forwardedArgv], {
        cwd: spawnCwd,
        env: spawnEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        resolve({
          argv: cleanArgv,
          exitCode: 1,
          stdout: "",
          stderr: error.message,
          usedJson,
          detectedBrowsers: discovery.detected,
          artifactBase: spawnCwd,
        });
      });
      child.on("close", (code) => {
        resolve({
          argv: cleanArgv,
          exitCode: code ?? 1,
          stdout,
          stderr,
          usedJson,
          detectedBrowsers: discovery.detected,
          artifactBase: spawnCwd,
        });
      });
    });
  };
}

export function resolveUpstreamVersion(): string {
  const require = createRequire(import.meta.url);
  try {
    const packageJsonPath = require.resolve("@playwright/cli/package.json");
    const packageJson = require(packageJsonPath) as { version?: string };
    return packageJson.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Resolve the installed wrapper version.
 *
 * The build bundles every module into dist/bin/playwright-cli-axi.js, so
 * import.meta.url is always <package>/dist/bin/playwright-cli-axi.js and the
 * wrapper package.json lives exactly two levels up, whether the package is the
 * development project root or an installed node_modules entry.
 */
export function resolveWrapperVersion(): string {
  const require = createRequire(import.meta.url);
  try {
    const packageJsonPath = require.resolve("../../package.json");
    const packageJson = require(packageJsonPath) as { version?: string };
    return packageJson.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function resolveUpstreamScript(): string {
  const require = createRequire(import.meta.url);
  return require.resolve("@playwright/cli/playwright-cli.js");
}
