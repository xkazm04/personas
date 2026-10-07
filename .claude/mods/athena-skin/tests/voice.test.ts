import { expect, test } from 'claude-code/testing'

import { doneWord, orb, spinnerWord, summary } from '../hooks/voice.mjs'

test('the same row always gets the same word', () => {
  expect(spinnerWord('thinking', 'msg_1')).toBe(spinnerWord('thinking', 'msg_1'))
  expect(doneWord('msg_2')).toBe(doneWord('msg_2'))
})

test('every mode the engine reports has a word, and an unknown mode falls back to thinking', () => {
  for (const mode of ['requesting', 'responding', 'thinking', 'tool-input', 'tool-use', 'something-new']) {
    expect(spinnerWord(mode, 'x').length).toBeGreaterThan(0)
  }
})

test('the orb turns while she works and rests as a ring', () => {
  expect(orb(false, 12345)).toBe('◌')
  expect(orb(true, 0)).toBe('◐')
  expect(orb(true, 400)).toBe('◓')
})

test('the summary reads in plain words', () => {
  expect(summary(null)).toBe('ready')
  expect(summary({ seconds: 42, tools: 1 })).toBe('last turn 42s, 1 tool call')
  expect(summary({ seconds: 125, tools: 7 })).toBe('last turn 2m 5s, 7 tool calls')
})
