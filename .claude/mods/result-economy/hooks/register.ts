import type { Register } from 'claude-code'

import { economize } from './trim.mjs'

// The model asked for these bytes exactly (a file window it will Edit against), so neither
// truncation nor redaction may alter them.
const EXACT = new Set(['Read', 'Edit', 'Write', 'NotebookEdit'])

export const register: Register = on => {
  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    if (e.origin.kind === 'tool' && EXACT.has(String(e.origin.tool))) return next(e)

    let changed = false
    let dropped = 0
    const content = e.message.content.map(block => {
      if (block.type !== 'tool_result') return block
      // tool_result content is a string or text blocks; anything else (images) passes through.
      if (typeof block.content === 'string') {
        const r = economize(block.content)
        if (!r.changed) return block
        changed = true
        dropped += r.dropped
        return { ...block, content: r.text }
      }
      if (!Array.isArray(block.content)) return block
      const inner = block.content.map(part => {
        if (part.type !== 'text') return part
        const r = economize(part.text)
        if (!r.changed) return part
        changed = true
        dropped += r.dropped
        return { ...part, text: r.text }
      })
      return { ...block, content: inner }
    })
    if (!changed) return next(e)

    if (dropped > 0) $.ui.status(`result-economy: trimmed ${dropped} lines`)
    return next({ ...e, message: { ...e.message, content } })
    // Fail open: a bug here must hand the model the original result, never lose one.
  }).catch(($, e, next) => next(e))
}
