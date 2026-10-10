import type { EngineInterface, Register } from 'claude-code'

import { nudge, owedDocs, relativeTo } from './docsync.mjs'
import { helpTargets, verdict } from './rules.mjs'

type DocEntry = { doc: string; sourceGlobs?: string[]; onboardingFlows?: string[]; marketingModule?: string }

type SyncState = {
  owedBy: Map<string, ReturnType<typeof owedDocs>[number]> // doc -> its entry, source edited
  docTouched: Set<string>
  toasted: Set<string>
  told: Set<string>
  entries: DocEntry[] | null
}

// Module state is enough: a hot reload only forgets what was already toasted, and the owed set
// is rebuilt by the next edit.
async function note($: EngineInterface, state: SyncState, filePath: string | undefined) {
  if (!filePath) return
  const cwd = await $.session.cwd()
  const rel = relativeTo(cwd, filePath)
  if (rel === null) return
  if (rel.startsWith('docs/features/') || rel.startsWith('src/features/onboarding/')) state.docTouched.add(rel)
  if (state.entries === null) {
    const raw = await $.fs.read(`${cwd}/scripts/docs/feature-doc-map.json`).catch(() => '')
    try {
      // Parsed JSON at a data boundary: the map is this repo's own file; shape checked by use (entries array or empty).
      const parsed = JSON.parse(typeof raw === 'string' ? raw : '{}')
      state.entries = Array.isArray(parsed.entries) ? (parsed.entries as DocEntry[]) : []
    } catch {
      state.entries = []
    }
  }
  for (const o of owedDocs(rel, state.entries)) state.owedBy.set(o.doc, o)
}

const stillOwed = (state: SyncState) => [...state.owedBy.values()].filter(o => !state.docTouched.has(o.doc))

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const cwd = await $.session.cwd()
    // A primary checkout has a .git DIRECTORY; in a worktree .git is a file.
    const git = await $.fs.stat(`${cwd}/.git`).catch(() => null)
    // Read the target before judging it: a script that handles --help is safe to ask.
    const helpAware = new Set<string>()
    for (const { script, path } of helpTargets(e.command)) {
      const at = /^[A-Za-z]:[\\/]/.test(path) ? path : `${cwd}/${path}`
      const source = await $.fs.read(at).catch(() => '')
      if (typeof source === 'string' && source.includes('--help')) helpAware.add(script)
    }
    const denied = verdict(e.command, {
      primaryCheckout: git?.kind === 'dir',
      // The engine reports a Windows cwd with backslashes (C:\Users\...); the tests' forward slashes hid that.
      windows: /^[A-Za-z]:[\\/]/.test(cwd),
      helpAware,
    })
    if (denied === null) return next(e)

    $.ui.status(`dev-law: denied ${denied.rule}`)

    return { deny: `${$.plugin.name} (${denied.rule}): ${denied.reason}` }
    // Deliberately fail OPEN: a bug in a rule must not brick every shell call. The
    // permissions.deny list in .claude/settings.json is the hard floor beneath this.
  }).catch(($, e, next) => next(e))

  const state: SyncState = { owedBy: new Map(), docTouched: new Set(), toasted: new Set(), told: new Set(), entries: null }

  for (const tool of ['Edit', 'Write'] as const) {
    on('tool.call', { tool }, async ($, e, next) => {
      const result = await next(e)
      await note($, state, e.file_path)
      return result
    }).catch(($, e, next) => next(e))
  }

  // The operator hears it once per doc at the end of the turn that left it stale.
  on('turn.complete', async ($, e, next) => {
    const fresh = stillOwed(state).filter(o => !state.toasted.has(o.doc))
    if (fresh.length > 0) {
      for (const o of fresh) state.toasted.add(o.doc)
      $.ui.toast(nudge(fresh))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The model hears it in the Edit/Write result itself, once per doc, right after the edit that made the
  // doc stale. Measured 2026-10-07: a session.append row at turn end and a prompt.compose section never
  // reached the model; a rewritten tool result does (result-economy relies on the same door).
  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    if (e.origin.kind !== 'tool' || !['Edit', 'Write'].includes(String(e.origin.tool))) return next(e)
    const fresh = stillOwed(state).filter(o => !state.told.has(o.doc))
    if (fresh.length === 0) return next(e)
    for (const o of fresh) state.told.add(o.doc)
    const text = nudge(fresh)
    const content = e.message.content.map(block => {
      if (block.type !== 'tool_result') return block
      if (typeof block.content === 'string') return { ...block, content: `${block.content}\n\n${text}` }
      if (Array.isArray(block.content)) return { ...block, content: [...block.content, { type: 'text' as const, text }] }
      return block
    })
    return next({ ...e, message: { ...e.message, content } })
  }).catch(($, e, next) => next(e))
}
