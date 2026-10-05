// Client-side mirror of `dev_server_configure`'s validation (contract WP0,
// "Command validation"). Rust stays the one that decides; this only keeps the
// operator from sending a command Rust is certain to refuse, and says WHICH
// rule it broke.

/** Longest command Rust accepts. */
export const SERVER_COMMAND_MAX = 200;

/**
 * Shell metacharacters and line breaks: a command is one program invocation.
 * `%` too, because cmd.exe would expand %VAR% from the app's own environment.
 */
const FORBIDDEN = /[&|;<>`$()%\r\n]/;
/** Any `{name}` placeholder. Only `{port}` is substituted. */
const PLACEHOLDER = /\{([^{}]*)\}/g;

export type CommandProblem = 'forbidden' | 'too_long' | 'placeholder';
export type PortProblem = 'invalid';

export interface ServerConfigCheck {
  /** null when the command is acceptable (blank counts: it clears the command). */
  command: CommandProblem | null;
  port: PortProblem | null;
  /** What `configureDevServer` should receive: the trimmed command, or null when blank. */
  devCommand: string | null;
  /** The parsed port, or null when invalid. */
  devPort: number | null;
}

export function commandProblem(raw: string): CommandProblem | null {
  const command = raw.trim();
  if (command === '') return null;
  if (FORBIDDEN.test(raw)) return 'forbidden';
  if (command.length > SERVER_COMMAND_MAX) return 'too_long';
  for (const m of command.matchAll(PLACEHOLDER)) {
    if (m[1] !== 'port') return 'placeholder';
  }
  return null;
}

/** A whole number from 1 to 65535, written as digits only. */
export function parsePort(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}

export function checkServerConfig(commandRaw: string, portRaw: string): ServerConfigCheck {
  const command = commandProblem(commandRaw);
  const devPort = parsePort(portRaw);
  const trimmed = commandRaw.trim();
  return {
    command,
    port: devPort === null ? 'invalid' : null,
    devCommand: trimmed === '' ? null : trimmed,
    devPort,
  };
}
