// Single CLI arg parser for the harness, preserving the two historical variants
// that were copy-pasted across the entrypoints:
//   - LAX (default): returns the token after `name` if present — even if that
//     token looks like another flag. Used by evaluate / judge-packet /
//     regather / watchgather.
//   - STRICT: additionally requires the next token NOT start with '--', so
//     `--foo --bar` yields the fallback for `--foo` rather than '--bar'. Used by
//     run / longitudinal / health-lint.
//
// Both read a snapshot of argv (defaulting to process.argv, which Node fully
// populates before any user module runs — identical to the old call-time reads)
// and a parametrized argv makes the parser unit-testable. See tests/cli/cli.test.mjs.

/** Build an arg reader over `argv`. `strict` rejects a following `--flag` token. */
export function makeArg(argv = process.argv, { strict = false } = {}) {
  return (name, fallback = null) => {
    const i = argv.indexOf(name);
    if (i < 0) return fallback;
    const next = argv[i + 1];
    if (!next) return fallback;
    if (strict && next.startsWith('--')) return fallback;
    return next;
  };
}

/** Lax reader bound to process.argv (the common case). */
export const arg = makeArg(process.argv, { strict: false });

/** Strict reader bound to process.argv (rejects a following --flag). */
export const argStrict = makeArg(process.argv, { strict: true });

/** Flag-presence check. */
export const has = (name, argv = process.argv) => argv.includes(name);
