import { expect, test } from 'claude-code/testing'

import { economize, redact, trim } from '../hooks/trim.mjs'

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n')

test('a short result is returned untouched', () => {
  const r = economize(lines(50))
  expect(r.changed).toBe(false)
  expect(r.text).toBe(lines(50))
})

test('a long result keeps its head and tail and says what it dropped', () => {
  const t = trim(lines(1000))
  expect(t.dropped).toBe(1000 - 80 - 120)
  expect(t.text).toContain('line 1\n')
  expect(t.text).toContain('line 80\n')
  expect(t.text).toContain('line 1000')
  expect(t.text).toContain('omitted from the middle')
  expect(t.text).not.toContain('line 500\n')
})

test('one enormous line is capped in place', () => {
  const t = trim('x'.repeat(50000))
  expect(t.text.length).toBeLessThan(2100)
  expect(t.text).toContain('chars]')
})

test('distinctive secrets are redacted, ordinary hex and prose are not', () => {
  const key = 'sk-ant-' + 'a1b2c3d4e5f6g7h8i9j0k1l2'
  const r = redact(`token ${key} and a hash 3f35c804aa11bb22cc33dd44ee55ff66 and x-personas-local-token: 7330355323cd4f7697e0aceac474b4e4`)
  expect(r.text).toContain('[redacted:anthropic-key]')
  expect(r.text).toContain('x-personas-local-token: [redacted:personas-local-token]')
  expect(r.text).toContain('3f35c804aa11bb22cc33dd44ee55ff66')
  expect(r.redacted.length).toBe(2)
})

test('a secret inside the dropped middle is gone, one at the tail is redacted', () => {
  const body = lines(600).replace('line 600', 'ghp_' + 'A'.repeat(36))
  const r = economize(body)
  expect(r.text).toContain('[redacted:github-token]')
  expect(r.text).not.toContain('ghp_')
})
