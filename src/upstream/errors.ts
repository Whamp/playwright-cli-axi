import type { CliResult } from '../cli/main.js';
import { errorToStdout } from '../presenter/errors.js';
import type { ParsedUpstream } from './parse.js';
import { sanitizeDependencyText } from './parse.js';
import type { UpstreamRun } from './runner.js';

export function normalizeUpstreamError(argv: string[], run: UpstreamRun, parsed: ParsedUpstream): CliResult {
  const raw = parsed.error ?? (parsed.kind === 'text' ? parsed.text : undefined) ?? run.stderr ?? run.stdout;
  const clean = sanitizeMessage(raw);
  const command = argv.join(' ');
  if (/browser .* is not open|browser '.*' is not open|please run open first/i.test(clean)) {
    return {
      exitCode: 1,
      stdout: errorToStdout({ kind: 'browser_not_open', message: clean, command, help: ['playwright-cli-axi open [url]'] })
    };
  }
  if (/chrome-for-testing|executable does not exist|install-browser|chromium distribution .*not found|chrome.*not found|npx playwright install chrome/i.test(raw)) {
    return {
      exitCode: 1,
      stdout: errorToStdout({
        kind: 'missing_browser',
        message: 'required browser executable is missing',
        command,
        help: ['playwright-cli-axi install-browser chrome-for-testing']
      })
    };
  }
  if (/unknown option|invalid option|missing required|usage:/i.test(clean)) {
    return {
      exitCode: 2,
      stdout: errorToStdout({ kind: 'usage', message: clean || 'upstream rejected the command usage', command, help: [`playwright-cli-axi ${argv[0] ?? ''} --help`.trim()] })
    };
  }
  return {
    exitCode: 1,
    stdout: errorToStdout({ kind: 'upstream_error', message: clean || 'upstream command failed', command, help: ['playwright-cli-axi --help'] })
  };
}

function sanitizeMessage(raw: string): string {
  return sanitizeDependencyText(raw)
    .replace(/playwright-cli install-browser/g, 'playwright-cli-axi install-browser')
    .replace(/\s+/g, ' ')
    .trim();
}
