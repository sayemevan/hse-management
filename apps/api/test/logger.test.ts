import { describe, expect, it } from 'vitest';

import { Logger, type LogLevel, type LogSink } from '../src/core/logging/logger';

function memorySink() {
  const lines: { level: LogLevel; entry: Record<string, unknown> }[] = [];
  const sink: LogSink = {
    write(level, line) {
      lines.push({ level, entry: JSON.parse(line) as Record<string, unknown> });
    },
  };
  return { sink, lines };
}

describe('Logger', () => {
  it('writes structured JSON with bindings', () => {
    const { sink, lines } = memorySink();
    new Logger('debug', { service: 'hse-api' }, sink).child({ requestId: 'r-1' }).info('hello', {
      status: 200,
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.entry).toMatchObject({
      level: 'info',
      message: 'hello',
      service: 'hse-api',
      requestId: 'r-1',
      status: 200,
    });
  });

  it('filters entries below the minimum level', () => {
    const { sink, lines } = memorySink();
    const logger = new Logger('warn', {}, sink);
    logger.debug('ignored');
    logger.info('ignored');
    logger.warn('kept');
    expect(lines.map((line) => line.level)).toEqual(['warn']);
  });

  it('redacts sensitive keys at any depth', () => {
    const { sink, lines } = memorySink();
    new Logger('info', {}, sink).info('login', {
      password: 'p',
      user: { email: 'a@b.c', accessToken: 't' },
      headers: { Authorization: 'Bearer x' },
    });

    const serialized = JSON.stringify(lines[0]?.entry);
    expect(serialized).not.toContain('"p"');
    expect(serialized).not.toContain('Bearer x');
    expect(lines[0]?.entry).toMatchObject({
      password: '[REDACTED]',
      user: { email: 'a@b.c', accessToken: '[REDACTED]' },
    });
  });

  it('serializes errors', () => {
    const { sink, lines } = memorySink();
    new Logger('info', {}, sink).error('failed', { error: new Error('boom') });
    expect(lines[0]?.entry).toMatchObject({ error: { name: 'Error', message: 'boom' } });
  });
});
