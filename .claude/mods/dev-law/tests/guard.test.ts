import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The engine beneath the plugin: a primary checkout on Windows, and a Bash
// tool that reports it ran. A denial never reaches it.
function primaryCheckout(on: On, kind: 'dir' | 'file' = 'dir', cwd = 'C:/Users/me/kiro/ai-registry') {
  const ran: string[] = []
  on('ui.status', () => ({ value: undefined }) as never)
  on('session.cwd', () => ({ value: cwd }) as never)
  on('fs.stat', () => ({ value: { kind, size: 0, mtimeMs: 0, isLink: false } }) as never)
  // gate.mjs handles --help; run-board.mjs does not.
  on('fs.read', ($, e) => ({ value: String((e as { path: string }).path).endsWith('gate.mjs') ? 'if (argv.includes("--help"))' : 'run()' }) as never)
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    ran.push(e.command)
    return { result: { stdout: 'ok', stderr: '', interrupted: false } } as never
  })
  return ran
}

const DENY = [
  'cargo test --lib',
  'npx vitest run',
  'npm run test -- --run',
  'taskkill /F /IM node.exe',
  'git add -A',
  'git add . && git commit -m wip',
  'git checkout feature/x',
  'git switch main',
  'git checkout -b harvest/x',
  'git stash',
  'git reset --hard HEAD~1',
  'node scripts/run-board.mjs --help',
  'grep -i -e foo -e bar file.md',
  'ln -s ../skills/x .claude/skills/x',
  'git commit -m "use `run-board` here"',
  'node scripts/build-index.mjs --check | tail -2 || node scripts/build-index.mjs',
]

const ALLOW = [
  'npm run test:rust -- export_bindings',
  'npx vitest run --reporter=dot --shard=1/4',
  'npx vitest run src/lib/foo.test.ts',
  'cargo test --no-run',
  'git add scripts/a.mjs librarian/sources/x.md',
  'git checkout -- scripts/a.mjs',
  'git checkout 3f35c804 -- docs/x.md',
  'git stash list',
  'git -C C:/t/w-kp checkout -b direction/x',
  'cd C:/t/w-kp && git checkout -b direction/x',
  'node scripts/run-board.mjs list',
  'grep -iE "foo|bar" file.md',
  'grep -e foo -e bar file.md',
  'git commit -F msg.txt -- a.md',
  'git add -A -- app/features/gigs',
  'git stash push -q -- src/lib/x.ts',
  'git checkout --theirs docs/index.json',
  'node scripts/gate.mjs --help',
  'cd /c/Users/me/kiro/ai-registry && node scripts/gate.mjs --help',
  'node -e "console.log(\\`literal\\`)"',
  "cat >> LESSONS.md <<'EOF'\nnever run git checkout -b in the shared tree\nEOF",
  'git commit -m "never git add -A here"',
  'node scripts/build-index.mjs --check || node scripts/build-index.mjs',
]

test('denies every recorded hazard before the shell sees it', async ($, on) => {
  const ran = primaryCheckout(on)
  for (const command of DENY) {
    const result = await $.tool.call({ tool: 'Bash', command } as never)
    const said = result.deny ?? (result.isError ? result.text : undefined)
    expect(String(said)).toContain('dev-law')
  }
  expect(ran).toEqual([])
})

test('lets the safe spelling of each through untouched', async ($, on) => {
  const ran = primaryCheckout(on)
  for (const command of ALLOW) {
    const result = await $.tool.call({ tool: 'Bash', command } as never)
    expect(result.isError ?? false).toBe(false)
  }
  expect(ran).toEqual(ALLOW)
})

test('a backslash cwd (what the engine really reports on Windows) still arms the Windows rules', async ($, on) => {
  const ran = primaryCheckout(on, 'dir', 'C:\\Users\\me\\kiro\\personas')
  const result = await $.tool.call({ tool: 'Bash', command: 'cargo test --lib' } as never)
  expect(String(result.deny ?? result.text)).toContain('no-bare-cargo-test')
  expect(ran).toEqual([])
})

test('a worktree (.git is a file) may switch and stage freely', async ($, on) => {
  const ran = primaryCheckout(on, 'file')
  for (const command of ['git checkout -b direction/x', 'git add -A', 'git stash']) {
    await $.tool.call({ tool: 'Bash', command } as never)
  }
  expect(ran.length).toBe(3)
})
