import { describe, expect, it } from 'vitest';
import { argsAfterCommand, commandName, hasVersionFlag, parseFieldsFlag, sessionFromArgv, shouldInjectJson, stripJsonFlags, stripWrapperFlags } from './commandSurface.js';

describe('commandSurface', () => {
  it('should strip user --json while injecting JSON only for supported upstream commands', () => {
    // Arrange
    const listArgv = stripJsonFlags(['list', '--json']);
    const installArgv = stripJsonFlags(['install-browser', 'chrome-for-testing', '--json']);

    // Act / Assert
    expect(listArgv).toEqual(['list']);
    expect(shouldInjectJson(listArgv)).toBe(true);
    expect(installArgv).toEqual(['install-browser', 'chrome-for-testing']);
    expect(shouldInjectJson(installArgv)).toBe(false);
    expect(shouldInjectJson(['video-start', '--help'])).toBe(false);
    expect(sessionFromArgv(['-s=demo', 'video-start'])).toBe('demo');
    expect(sessionFromArgv(['--session', 'named', 'video-stop'])).toBe('named');
  });

  it('should identify commands after session flags with separate values', () => {
    // Act / Assert
    expect(commandName(['--session', 'demo', 'list'])).toBe('list');
    expect(commandName(['-s', 'demo', 'video-start'])).toBe('video-start');
    expect(commandName(['--json', '--session=demo', 'close-all'])).toBe('close-all');
    expect(sessionFromArgv(['video-start', '-s', 'demo'])).toBe('demo');
  });

  it('should detect top-level version requests without intercepting a command own flags', () => {
    // Act / Assert
    expect(hasVersionFlag(['--version'])).toBe(true);
    expect(hasVersionFlag(['-v'])).toBe(true);
    expect(hasVersionFlag(['--json', '--version'])).toBe(true);
    // A command resolves -> version not requested (passthrough preserved)
    expect(hasVersionFlag(['list', '--version'])).toBe(false);
    expect(hasVersionFlag(['list', '-v'])).toBe(false);
    expect(hasVersionFlag(['video-start', './out.webm'])).toBe(false);
    expect(hasVersionFlag([])).toBe(false);
    // O2: a flag after the `--` separator must NOT be intercepted (forwards upstream).
    expect(hasVersionFlag(['--', '--version'])).toBe(false);
    expect(hasVersionFlag(['--', '-v'])).toBe(false);
    // `--version` before `--` with no command still counts.
    expect(hasVersionFlag(['--version', '--'])).toBe(true);
  });

  it('strips --fields in both space and equals forms from video validation and upstream args (F3)', () => {
    // Validation args exclude the wrapper flag (both forms) so video-start does
    // not reject it as unsupported.
    expect(argsAfterCommand(['video-start', '--fields', 'id', './out.webm'])).toEqual(['./out.webm']);
    expect(argsAfterCommand(['video-start', '--fields=id', './out.webm'])).toEqual(['./out.webm']);
    // The command still resolves correctly with the inline equals form.
    expect(commandName(['--fields=name', 'list'])).toBe('list');
    // stripWrapperFlags removes both forms (and the value token) before upstream.
    expect(stripWrapperFlags(['video-start', '--fields', 'id', './out.webm'])).toEqual(['video-start', './out.webm']);
    expect(stripWrapperFlags(['video-start', '--fields=id', './out.webm'])).toEqual(['video-start', './out.webm']);
    // parseFieldsFlag reads both forms identically.
    expect(parseFieldsFlag(['--fields=id,name'])).toEqual(['id', 'name']);
    expect(parseFieldsFlag(['--fields', 'id,name'])).toEqual(['id', 'name']);
    expect(parseFieldsFlag(['list'])).toBeUndefined();
  });

  it('should exclude global flags from video command validation args without dropping upstream argv', () => {
    // Act / Assert
    expect(argsAfterCommand(['video-start', '--session', 'demo', './out.webm', '--size', '320x240'])).toEqual(['./out.webm', '--size', '320x240']);
    expect(argsAfterCommand(['video-show-actions', '-s=demo', '--raw', '--duration', '100'])).toEqual(['--duration', '100']);
  });
});
