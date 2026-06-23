import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { COMMAND_GROUPS, UPSTREAM_COMMANDS, commandGroupFor } from './upstreamCommands.js';

describe('upstream command coverage', () => {
  it('covers every command in upstream help.json exactly once', () => {
    const upstream = JSON.parse(readFileSync('node_modules/playwright-core/lib/tools/cli-client/help.json', 'utf8')) as {
      commands: Record<string, unknown>;
    };
    const upstreamCommands = Object.keys(upstream.commands).sort();
    const wrapperCommands = [...UPSTREAM_COMMANDS].sort();

    expect(wrapperCommands).toEqual(upstreamCommands);
    expect(new Set(UPSTREAM_COMMANDS).size).toBe(UPSTREAM_COMMANDS.length);
  });

  it('does not expose stale wrapper-only command coverage such as standalone kill', () => {
    expect(UPSTREAM_COMMANDS).not.toContain('kill');
    expect(commandGroupFor('kill')).toBeUndefined();
  });

  it('assigns every covered command to a non-empty command group', () => {
    for (const group of COMMAND_GROUPS) {
      expect(group.id).not.toBe('');
      expect(group.title).not.toBe('');
      expect(group.summary).not.toBe('');
      expect(group.commands.length).toBeGreaterThan(0);
      for (const command of group.commands) {
        expect(commandGroupFor(command)).toBe(group);
      }
    }
  });
});
