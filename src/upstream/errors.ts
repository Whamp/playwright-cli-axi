import type { CliResult } from "../cli/main.js";
import { commandName } from "../domain/commandSurface.js";
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
        help: ["playwright-cli-axi install-browser chrome-for-testing"],
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
        help: [
          `playwright-cli-axi ${helpCommand ? `${helpCommand} ` : ""}--help`,
        ],
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
