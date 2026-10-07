import { expect, test } from 'claude-code/testing'

import { globToRe, nudge, owedDocs, relativeTo } from '../hooks/docsync.mjs'

const ENTRIES = [
  { doc: 'docs/features/personas/README.md', sourceGlobs: ['src/features/personas/**', 'src-tauri/src/commands/core/personas.rs'], onboardingFlows: ['persona-creation'], marketingModule: 'agents' },
  { doc: 'docs/features/vault/README.md', sourceGlobs: ['src/features/vault/**/*.tsx'] },
]

test('a source edit names the doc that owns it, with its tour and marketing surfaces', () => {
  const owed = owedDocs('src/features/personas/sub_x/Foo.tsx', ENTRIES)
  expect(owed.map(o => o.doc)).toEqual(['docs/features/personas/README.md'])
  expect(nudge(owed)).toContain('tour persona-creation')
  expect(nudge(owed)).toContain('marketing agents')
})

test('tests, generated bindings, i18n and docs themselves owe nothing', () => {
  for (const rel of ['src/features/personas/Foo.test.tsx', 'src/lib/bindings/Persona.ts', 'src/i18n/locales/en.json', 'docs/features/personas/README.md']) {
    expect(owedDocs(rel, ENTRIES)).toEqual([])
  }
})

test('globs: ** spans directories, * stays inside one', () => {
  expect(globToRe('src/features/vault/**/*.tsx').test('src/features/vault/a/b/C.tsx')).toBe(true)
  expect(globToRe('src/features/vault/**/*.tsx').test('src/features/vault/C.tsx')).toBe(true)
  expect(globToRe('src/a/*.ts').test('src/a/b/c.ts')).toBe(false)
})

test('paths resolve against the checkout in either drive spelling', () => {
  expect(relativeTo('C:/Users/me/personas', 'C:\\Users\\me\\personas\\src\\a.ts')).toBe('src/a.ts')
  expect(relativeTo('C:/Users/me/personas', '/c/Users/me/personas/src/a.ts')).toBe('src/a.ts')
  expect(relativeTo('C:/Users/me/personas', 'C:/elsewhere/a.ts')).toBeNull()
})
