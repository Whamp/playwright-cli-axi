import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

import { shouldInjectJson, stripJsonFlags } from '../domain/commandSurface.js';

export interface UpstreamRun {
  argv: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  usedJson: boolean;
}

export type UpstreamRunner = (argv: string[]) => Promise<UpstreamRun>;

export interface CreateUpstreamRunnerOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export function createUpstreamRunner(options: CreateUpstreamRunnerOptions): UpstreamRunner {
  return async (argv) => {
    const cleanArgv = stripJsonFlags(argv);
    const usedJson = shouldInjectJson(cleanArgv);
    const upstreamArgv = usedJson ? ['--json', ...cleanArgv] : cleanArgv;
    const scriptPath = resolveUpstreamScript();

    return await new Promise<UpstreamRun>((resolve) => {
      const child = spawn(process.execPath, [scriptPath, ...upstreamArgv], {
        cwd: options.cwd,
        env: {
          ...options.env,
          CI: options.env.CI ?? '1',
          NO_COLOR: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        resolve({ argv: cleanArgv, exitCode: 1, stdout: '', stderr: error.message, usedJson });
      });
      child.on('close', (code) => {
        resolve({ argv: cleanArgv, exitCode: code ?? 1, stdout, stderr, usedJson });
      });
    });
  };
}

export function resolveUpstreamVersion(): string {
  const require = createRequire(import.meta.url);
  try {
    const packageJsonPath = require.resolve('@playwright/cli/package.json');
    const packageJson = require(packageJsonPath) as { version?: string };
    return packageJson.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function resolveUpstreamScript(): string {
  const require = createRequire(import.meta.url);
  return require.resolve('@playwright/cli/playwright-cli.js');
}
