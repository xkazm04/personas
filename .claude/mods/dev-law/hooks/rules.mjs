// Pure rules for dev-law (adopted from the user-level fleet-guard, 2026-10-07): one shell command in, a denial or null out.
// Every rule is a failure this machine already paid for, named after the
// memory file that records it, so a denial says where its reason lives.
// No engine access here: the hooks module and the replay both import this.

/**
 * @typedef {{
 *   primaryCheckout: boolean,
 *   windows: boolean,
 *   helpAware?: ReadonlySet<string>,
 * }} GuardContext
 * @typedef {{ rule: string, reason: string }} GuardDenial
 */

// Heredoc bodies and quoted strings are data, not commands: a commit message
// that says "git checkout -b" must not read as one. Quotes keep their marks.
export function scrub(command) {
  let out = command.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, '<<HEREDOC')
  out = out.replace(/'[^'\n]*'/g, "''").replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  return out
}

const SEGMENT = /\s*(?:&&|\|\||;|\n|\|)\s*/
const words = segment => segment.trim().split(/\s+/).filter(Boolean)

function gitArgs(segment) {
  const w = words(segment)
  if (w[0] !== 'git') return null
  // `git -C <dir>` points elsewhere; the shared-checkout rules cannot resolve it.
  if (w[1] === '-C') return { args: w.slice(3), elsewhere: true }
  return { args: w.slice(1), elsewhere: false }
}

// Arguments after the subcommand that are neither flags nor the flag values git takes.
const paths = args => {
  const at = args.indexOf('--')
  if (at >= 0) return args.slice(at + 1)
  return args.filter(a => !a.startsWith('-'))
}

// MSYS spells C:/x as /c/x; the engine's fs reads the Windows spelling.
const native = dir => dir.replace(/^\/([a-zA-Z])\//, (_, d) => `${d.toUpperCase()}:/`)

/**
 * Registry scripts a command asks for --help, for the caller to read before
 * judging: `script` as the command names it, `path` resolved through any
 * `cd <dir>` ahead of it (relative to the session's cwd when there is none).
 * @returns {{ script: string, path: string }[]}
 */
export function helpTargets(command) {
  const found = []
  let dir = ''
  for (const seg of scrub(command).split(SEGMENT)) {
    const cd = seg.match(/^\s*cd\s+(\S+)/)
    if (cd) { dir = native(cd[1]); continue }
    const m = seg.match(/\bnode\s+((?:\S*\/)?scripts\/[\w.-]+\.mjs)\b.*\s(?:--help|-h)\b/)
    if (m) found.push({ script: m[1], path: dir ? `${dir}/${m[1]}` : m[1] })
  }
  return found
}

const RULES = [
  {
    rule: 'stage-by-name',
    memory: 'pathspec-from-git-status-sweeps-siblings',
    test: (seg, ctx) => {
      if (!ctx.primaryCheckout) return false
      const g = gitArgs(seg)
      if (!g || g.elsewhere || g.args[0] !== 'add') return false
      const rest = g.args.slice(1)
      const sweeping = rest.some(a => a === '-A' || a === '--all' || a === '-u' || a === '--update')
      const named = paths(rest)
      // `git add -A -- app/x` is scoped by its pathspec; a bare sweep or `.` is not.
      return named.includes('.') || (sweeping && named.length === 0)
    },
    reason: 'git add -A/./-u with no pathspec stages sibling sessions\' WIP in a shared checkout; stage your own files by name (git add -A -- <dir> is fine)',
  },
  {
    rule: 'no-branch-switch',
    memory: 'librarian-shared-checkout-pr-flow',
    test: (seg, ctx) => {
      if (!ctx.primaryCheckout) return false
      const g = gitArgs(seg)
      if (!g || g.elsewhere) return false
      const [sub, ...rest] = g.args
      if (sub === 'switch') return !rest.includes('--help')
      if (sub !== 'checkout') return false
      // A path restore, or a merge side taken for a path, is not a switch.
      if (rest.includes('--') || rest.includes('--theirs') || rest.includes('--ours') || rest.includes('-p')) return false
      if (rest.some(f => f === '-b' || f === '-B' || f === '--orphan' || f === '--detach')) return true
      // Without `--` git decides between a branch and a path; both are unsafe here.
      // `git checkout .` is the discard rule's, below.
      const named = rest.filter(a => !a.startsWith('-'))
      return named.length >= 1 && !named.includes('.')
    },
    reason: 'switching the branch moves every sibling session\'s working tree; take a short-path worktree instead (git worktree add C:/t/<id> -b <branch>). To restore a file, spell it git checkout -- <path>',
  },
  {
    rule: 'no-shared-discard',
    memory: 'librarian-shared-checkout-pr-flow',
    test: (seg, ctx) => {
      if (!ctx.primaryCheckout) return false
      const g = gitArgs(seg)
      if (!g || g.elsewhere) return false
      const [sub, ...rest] = g.args
      if (sub === 'stash') {
        if (['list', 'show'].includes(rest[0])) return false
        // A stash scoped to your own paths leaves the siblings' alone.
        return !(rest[0] === 'push' && rest.includes('--') && paths(rest).length > 0)
      }
      if (sub === 'reset') return rest.includes('--hard')
      if (sub === 'checkout' || sub === 'restore') return paths(rest).includes('.') && !rest.includes('--staged')
      if (sub === 'clean') return rest.some(a => /^-[a-zA-Z]*f/.test(a))
      return false
    },
    reason: 'stash, reset --hard, checkout ., restore . and clean -f act on every session\'s uncommitted work in this checkout, not only yours (git stash push -- <your paths> is fine)',
  },
  {
    rule: 'no-help-on-registry-script',
    memory: 'librarian-shared-checkout-pr-flow',
    test: (seg, ctx) => {
      const m = seg.match(/\bnode\s+((?:\S*\/)?scripts\/[\w.-]+\.mjs)\b.*\s(?:--help|-h)\b/)
      // A script whose source handles --help prints usage; only the others execute.
      return m !== null && !(ctx.helpAware?.has(m[1]) ?? false)
    },
    reason: 'this registry script does not handle --help and EXECUTES instead; grep the script\'s argv handling to learn its flags',
  },
  {
    rule: 'no-bare-cargo-test',
    memory: 'cargo-test-comctl32-manifest',
    test: (seg, ctx) => {
      if (!ctx.windows) return false
      const w = words(seg)
      return w[0] === 'cargo' && w[1] === 'test' && !w.includes('--no-run')
    },
    reason: 'bare cargo test dies in the Windows loader (exit 127, no output); use npm run test:rust, or npm run test:rust -- export_bindings for bindings',
  },
  {
    rule: 'no-whole-vitest',
    memory: 'vitest-whole-run-never-terminates',
    test: seg => {
      const w = words(seg)
      const i = w.findIndex(a => a === 'vitest' || (a === 'test' && w[0] === 'npm'))
      if (i < 0 || (w[0] !== 'npx' && w[0] !== 'npm' && w[0] !== 'vitest')) return false
      const rest = w.slice(i + 1).filter(a => a !== 'run' && a !== '--')
      if (rest.some(a => a.startsWith('--shard') || a === '-t' || a === '--changed')) return false
      // A named file or directory scopes the run; flags alone do not.
      return !rest.some(a => !a.startsWith('-'))
    },
    reason: 'an unscoped vitest run never terminates here (one test kills its worker); name a file or shard it: npx vitest run --reporter=dot --shard=1/4',
  },
  {
    rule: 'no-blind-node-kill',
    memory: 'feedback_no_blind_process_kill',
    test: seg => /(?:taskkill\b.*\/im\s+node|pkill\s+(?:-\w+\s+)?node|killall\s+node|stop-process\s+-name\s+node)/i.test(seg),
    reason: 'killing every node process takes down sibling sessions, the gate daemon and the dev server; find the PID of YOUR process (netstat -ano | findstr :<port>) and kill that one',
  },
  {
    rule: 'grep-i-multi-e',
    memory: 'bash-grep-multiple-e-returns-zero',
    test: (seg, ctx) => {
      if (!ctx.windows) return false
      const w = words(seg)
      if (w[0] !== 'grep') return false
      const hasI = w.some(a => /^-[a-zA-Z]*i[a-zA-Z]*$/.test(a) && a !== '-e')
      return hasI && w.filter(a => a === '-e').length >= 2
    },
    reason: 'MSYS grep with -i and two or more -e can abort (exit 134) and read as zero matches; use one pattern: grep -iE \'a|b\'',
  },
  {
    rule: 'no-ln-s-on-windows',
    memory: 'bash-ln-s-copies-on-windows',
    test: (seg, ctx) => ctx.windows && /^ln\s+-\w*s\w*\b/.test(seg.trim()),
    reason: 'MSYS ln -s COPIES the target (a node_modules copy is gigabytes); use cmd //c mklink /J <link> <target> or scripts/link-registry.mjs',
  },
  {
    rule: 'no-backticks-in-double-quotes',
    memory: 'bash-backticks-substituted-in-py-c',
    raw: true,
    // An escaped \` is literal and safe; only a bare pair inside "..." substitutes.
    test: cmd => /(?:^|[;&|]\s*)(?:git\s+commit\b|node\s+-e\b|py(?:thon)?3?\s+-c\b)/.test(cmd.trim()) && /\s(?:-m|-e|-c)\s+"(?:[^"\\`]|\\.)*(?<!\\)`[^"`]*(?<!\\)`(?:[^"\\]|\\.)*"/.test(cmd),
    reason: 'backticks inside a double-quoted argument are command substitution; a Markdown code span becomes an empty string. Put the text in a file (git commit -F <file>)',
  },
  {
    rule: 'pipe-masks-check',
    memory: 'pipe-masks-check-exit-code',
    whole: true,
    test: cmd => /--check\b[^|;&\n]*\|(?!\|)[^;&\n]*\|\|/.test(cmd),
    reason: '`cmd --check | tail || fallback` never runs the fallback (the pipe returns tail\'s status); drop the pipe or use set -o pipefail',
  },
]

/**
 * @param {string} command
 * @param {GuardContext} ctx
 * @returns {GuardDenial | null}
 */
export function verdict(command, ctx) {
  const clean = scrub(command)
  for (const r of RULES) {
    const deny = { rule: r.rule, reason: `${r.reason} [memory: ${r.memory}]` }
    if (r.raw) { if (r.test(command, ctx)) return deny; continue }
    if (r.whole) { if (r.test(clean, ctx)) return deny; continue }
    let here = ctx
    for (const seg of clean.split(SEGMENT)) {
      // `cd elsewhere && git ...` leaves this checkout: the shared-checkout rules stand down.
      if (/^\s*cd\s/.test(seg)) { here = { ...here, primaryCheckout: false }; continue }
      if (seg && r.test(seg, here)) return deny
    }
  }
  return null
}

export const ruleNames = RULES.map(r => r.rule)
