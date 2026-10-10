// Pure doc-sync matching for dev-law: a repo-relative source path in, the feature
// docs it owes an update to out. Reads the same map the (never-firing) Stop hook
// read - scripts/docs/feature-doc-map.json - so the two cannot disagree on ownership.
// Skip patterns mirror scripts/docs/check-doc-sync.mjs SKIP_PATTERNS.

const SKIP = [
  /\.test\.[tj]sx?$/,
  /\.spec\.[tj]sx?$/,
  /__tests__\//,
  /\/bindings\//,
  /\/generated\//,
  /\.generated\.(ts|tsx|mjs|js|cjs)$/,
  /^src\/i18n\//,
  /^docs\//,
  /^scripts\/templates\//,
  /^scripts\/connectors\//,
  /^src-tauri\/db\/src\/migrations\//,
]

// `**/` is any directories (or none), a trailing `**` anything, `*` one path segment.
export function globToRe(glob) {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?')
    .replace(/\u0001/g, '.*')
  return new RegExp(`^${re}$`)
}

export const isSkipped = rel => SKIP.some(re => re.test(rel))

/** Repo-relative, forward-slash path, or null when the file is outside the repo. */
export function relativeTo(cwd, file) {
  const norm = p => p.replace(/\\/g, '/').replace(/^\/([a-zA-Z])\//, (_, d) => `${d.toUpperCase()}:/`)
  const root = norm(cwd).replace(/\/$/, '')
  const f = norm(file)
  if (f.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return f.slice(root.length + 1)
  return /^[A-Za-z]:\/|^\//.test(f) ? null : f
}

/**
 * @param {string} rel repo-relative path of an edited file
 * @param {{ doc: string, sourceGlobs?: string[], onboardingFlows?: string[], marketingModule?: string }[]} entries
 * @returns {{ doc: string, onboardingFlows: string[], marketingModule: string | null }[]}
 */
export function owedDocs(rel, entries) {
  if (isSkipped(rel)) return []
  const hit = []
  for (const e of entries) {
    if ((e.sourceGlobs ?? []).some(g => globToRe(g).test(rel))) {
      hit.push({ doc: e.doc, onboardingFlows: e.onboardingFlows ?? [], marketingModule: e.marketingModule ?? null })
    }
  }
  return hit
}

/** One line for the operator and the model; names each stale doc once. */
export function nudge(owed) {
  const parts = owed.map(o => {
    const extra = [...(o.onboardingFlows.length ? [`tour ${o.onboardingFlows.join('/')}`] : []), ...(o.marketingModule ? [`marketing ${o.marketingModule}`] : [])]
    return extra.length ? `${o.doc} (+ ${extra.join(', ')})` : o.doc
  })
  return `doc-sync: this session edited source owned by ${parts.join('; ')} and has not touched the doc. Update it in the same change, or say why the edit is internal-only.`
}
