import type { CliResult } from "../cli/main.js";
import { commandName } from "../domain/commandSurface.js";
import { OVERRIDE_ENV_VAR, type DiscoveredBrowser } from "../domain/browserDiscovery.js";
import { errorToStdout } from "../presenter/errors.js";
import type { ParsedUpstream } from "./parse.js";
import { sanitizeDependencyText } from "./parse.js";
import type { UpstreamRun } from "./runner.js";

export function normalizeUpstreamError(
  argv: string[],
  run: UpstreamRun,
  parsed: ParsedUpstream,
): CliResult {
  const primaryRaw =
    parsed.error ??
    (parsed.kind === "text" ? parsed.text : undefined) ??
    run.stderr ??
    run.stdout;
  const diagnosticRaw = [primaryRaw, run.stderr, run.stdout]
    .filter(Boolean)
    .join("\n");
  const clean = sanitizeMessage(primaryRaw);
  const diagnostic = sanitizeMessage(diagnosticRaw);
  const command = argv.join(" ");
  const helpCommand = commandName(argv);
  if (
    /browser .* is not open|browser '.*' is not open|please run open first/i.test(
      diagnostic,
    )
  ) {
    return {
      exitCode: 1,
      stdout: errorToStdout({
        kind: "browser_not_open",
        message: clean,
        command,
        help: ["playwright-cli-axi open [url]"],
      }),
    };
  }
  if (
    /chrome-for-testing|executable does not exist|install-browser|chromium distribution .*not found|chrome.*not found|npx playwright install chrome/i.test(
      diagnosticRaw,
    )
  ) {
    return {
      exitCode: 1,
      stdout: errorToStdout({
        kind: "missing_browser",
        message: "required browser executable is missing",
        command,
        help: missingBrowserHelp(run.detectedBrowsers),
      }),
    };
  }
  if (/unknown command:/i.test(diagnostic)) {
    return {
      exitCode: 2,
      stdout: errorToStdout({
        kind: "usage",
        message: clean || "upstream rejected the command usage",
        command,
        help: ["playwright-cli-axi --help"],
      }),
    };
  }
  if (
    /unknown option|invalid option|missing required|usage:/i.test(diagnostic)
  ) {
    return {
      exitCode: 2,
      stdout: errorToStdout({
        kind: "usage",
        message: clean || "upstream rejected the command usage",
        command,
        help: commandSpecificUsageHelp(helpCommand),
      }),
    };
  }
  return {
    exitCode: 1,
    stdout: errorToStdout({
      kind: "upstream_error",
      message: clean || "upstream command failed",
      command,
      help: ["playwright-cli-axi --help"],
    }),
  };
}

function sanitizeMessage(raw: string): string {
  return sanitizeDependencyText(raw)
    .replace(
      /playwright-cli install-browser/g,
      "playwright-cli-axi install-browser",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build actionable `help[]` entries for a missing_browser error (F-2).
 *
 * Always names the override env var. If the wrapper detected usable system
 * browsers, says so (they should have been auto-used, so their presence here
 * usually means the daemon was already running with a stale config — restart
 * it). Falls back to the install-browser suggestion when nothing was detected.
 */
function missingBrowserHelp(detected: DiscoveredBrowser[] | undefined): string[] {
  const help: string[] = [];
  if (detected && detected.length > 0) {
    const first = detected[0]!.path;
    help.push(`${OVERRIDE_ENV_VAR}=${first}`);
  } else {
    help.push(`${OVERRIDE_ENV_VAR}=<path-to-chrome-or-chromium>`);
    help.push("playwright-cli-axi install-browser chrome-for-testing");
  }
  return help;
}

/**
 * P-3: name the correct flags inline for commands whose argument shape is
 * commonly mis-guessed, so the agent learns the usage from the error itself
 * rather than failing twice. Falls back to the command's `--help`.
 */
function commandSpecificUsageHelp(command: string | undefined): string[] {
  const base = `playwright-cli-axi ${command ? `${command} ` : ""}--help`;
  if (command === "screenshot" || command === "pdf") {
    return [
      `playwright-cli-axi ${command} --filename <path>   # positional is an element target, not a file`,
      base,
    ];
  }
  if (command === "snapshot") {
    return [
      `playwright-cli-axi snapshot [ref]   # use --filename to save to a file`,
      base,
    ];
  }
  return [base];
}
