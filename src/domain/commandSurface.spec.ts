import { describe, expect, it } from 'vitest';
import { argsAfterCommand, commandName, sessionFromArgv, shouldInjectJson, stripJsonFlags } from './commandSurface.js';

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

  it('should exclude global flags from video command validation args without dropping upstream argv', () => {
    // Act / Assert
    expect(argsAfterCommand(['video-start', '--session', 'demo', './out.webm', '--size', '320x240'])).toEqual(['./out.webm', '--size', '320x240']);
    expect(argsAfterCommand(['video-show-actions', '-s=demo', '--raw', '--duration', '100'])).toEqual(['--duration', '100']);
  });
});
