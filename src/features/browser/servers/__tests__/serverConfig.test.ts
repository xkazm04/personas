import { describe, expect, it } from 'vitest';

import { checkServerConfig, commandProblem, parsePort, SERVER_COMMAND_MAX } from '../serverConfig';

describe('commandProblem', () => {
  it.each(['npm run dev', 'npm run dev -- --port {port}', 'bun run dev', 'python -m http.server {port}', 'pnpm dev --host 127.0.0.1'])(
    'accepts %s',
    (command) => {
      expect(commandProblem(command)).toBeNull();
    },
  );

  it('accepts a blank command, which clears it', () => {
    expect(commandProblem('   ')).toBeNull();
  });

  it.each(['npm run dev && rm -rf /', 'a | b', 'a; b', 'a < f', 'a > f', 'echo `id`', 'echo $HOME', 'echo $(id)', 'echo %PATH%', 'npm run dev -- --port 50%','npm run dev\nnpm test', 'npm run dev\r'])(
    'refuses the metacharacters in %j',
    (command) => {
      expect(commandProblem(command)).toBe('forbidden');
    },
  );

  it('refuses a command over the length cap', () => {
    expect(commandProblem('x'.repeat(SERVER_COMMAND_MAX))).toBeNull();
    expect(commandProblem('x'.repeat(SERVER_COMMAND_MAX + 1))).toBe('too_long');
  });

  it('allows only the {port} placeholder', () => {
    expect(commandProblem('vite --port {port} --strictPort')).toBeNull();
    expect(commandProblem('vite --host {host}')).toBe('placeholder');
    expect(commandProblem('vite --port {}')).toBe('placeholder');
  });
});

describe('parsePort', () => {
  it.each([
    ['3000', 3000],
    [' 1 ', 1],
    ['65535', 65535],
  ])('parses %j', (raw, port) => {
    expect(parsePort(raw)).toBe(port);
  });

  it.each(['', '0', '65536', '-1', '3000.5', '3e3', 'abc', '30 00', '123456'])('refuses %j', (raw) => {
    expect(parsePort(raw)).toBeNull();
  });
});

describe('checkServerConfig', () => {
  it('maps a blank command to null and a valid port to its number', () => {
    expect(checkServerConfig('  ', '4321')).toEqual({ command: null, port: null, devCommand: null, devPort: 4321 });
  });

  it('trims the command it would send', () => {
    expect(checkServerConfig('  npm run dev  ', '3000').devCommand).toBe('npm run dev');
  });

  it('reports both problems at once', () => {
    const check = checkServerConfig('a && b', '99999');
    expect(check.command).toBe('forbidden');
    expect(check.port).toBe('invalid');
    expect(check.devPort).toBeNull();
  });
});
