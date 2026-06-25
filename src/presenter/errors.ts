import { toToon } from './toon.js';

export type ErrorKind = 'usage' | 'browser_not_open' | 'missing_browser' | 'upstream_error' | 'already_recording' | 'modal_pending';

export interface StructuredErrorInput {
  kind: ErrorKind;
  message: string;
  command?: string;
  help?: string[];
  details?: string;
}

export function errorToStdout(input: StructuredErrorInput): string {
  return toToon({
    error: {
      kind: input.kind,
      message: input.message,
      ...(input.command ? { command: input.command } : {}),
      ...(input.details ? { details: input.details } : {})
    },
    ...(input.help && input.help.length > 0 ? { help: input.help } : {})
  });
}
