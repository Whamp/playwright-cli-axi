import { describe, expect, it } from 'vitest';
import { table, toToon } from './toon.js';

describe('toToon', () => {
  it('should emit LF-only output with counts and no trailing whitespace or newline', () => {
    // Arrange
    const value = {
      command: 'list',
      rows: table(['id', 'title'], [{ id: '1', title: 'Hello, world' }]),
      help: ['playwright-cli-axi list']
    };

    // Act
    const output = toToon(value);

    // Assert
    expect(output).toContain('rows[1]{id,title}:\n  "1","Hello, world"');
    expect(output).toContain('help[1]:');
    expect(output).not.toContain('\r');
    expect(output.endsWith('\n')).toBe(false);
    expect(output.split('\n').some((line) => /\s$/.test(line))).toBe(false);
  });
});
