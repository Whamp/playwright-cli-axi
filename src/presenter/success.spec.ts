import { describe, expect, it } from 'vitest';

import { commandSuccessModel } from './success.js';
import { toToon } from './toon.js';

describe('commandSuccessModel', () => {
  it('should format list results with explicit empty state', () => {
    // Arrange
    const parsed = { kind: 'json', value: { browsers: [] }, isError: false } as const;

    // Act
    const output = toToon(commandSuccessModel('list', parsed));

    // Assert
    expect(output).toContain('command: list');
    expect(output).toContain('browsers:\n  count: 0\n  empty: no open browsers');
  });

  it('should prune transport-only JSON fields from generic command results', () => {
    // Arrange
    const parsed = {
      kind: 'json',
      value: {
        isError: false,
        request: { id: 7, method: 'GET' },
        headers: [{ name: 'accept', value: '*/*' }]
      },
      isError: false
    } as const;

    // Act
    const output = toToon(commandSuccessModel('request', parsed));

    // Assert
    expect(output).toContain('command: request');
    expect(output).toContain('result:');
    expect(output).toContain('request:');
    expect(output).toContain('id: 7');
    expect(output).toContain('method: GET');
    expect(output).toContain('headers[1]:');
    expect(output).not.toContain('isError');
  });

  it('should truncate long text output for generic commands', () => {
    // Arrange
    const parsed = { kind: 'text', text: 'x'.repeat(1305), isError: false } as const;

    // Act
    const output = toToon(commandSuccessModel('snapshot', parsed));

    // Assert
    expect(output).toContain('command: snapshot');
    expect(output).toContain('1305 chars total');
  });
});
