import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Turn } from '../types'
import { ACCENT, doneWord, orb, spinnerWord, summary } from './voice.mjs'

const last = atom({ plugin: 'athena-skin', key: 'last' } as const, null)
const working = atom({ plugin: 'athena-skin', key: 'working' } as const, false)

export const register: Register = on => {
  let tools = 0
  let startedAt = 0

  on('session.start', ($, e, next) => {
    $.ui.status('athena')
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    tools = 0
    startedAt = await $.clock.now()
    await update($, working, () => true)
    return next(e)
  })

  on('tool.call', ($, e, next) => {
    tools += 1
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const seconds = Math.round(((await $.clock.now()) - startedAt) / 1000)
    const turn: Turn = { seconds, tools }
    await update($, last, () => turn)
    await update($, working, () => false)
    return next(e)
  })

  // Her words, not the engine's: a rewrite of the props, so the line keeps its own layout and timing.
  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    if (e.props.message !== null) return next(e)
    return next({ ...e, props: { ...e.props, word: spinnerWord(e.props.mode, e.requestId) } })
  })

  on('ui.render', { component: 'TurnDuration' }, ($, e, next) =>
    next({ ...e, props: { ...e.props, word: doneWord(e.requestId) } }),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const isWorking = await read($, working)
    const turn = await read($, last)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text color={ACCENT} bold={isWorking}>
          {orb(isWorking, now)}{' '}
        </Text>
        <Text color={ACCENT}>Athena</Text>
        <Text dimColor>{`  ${isWorking ? 'with you' : summary(turn)}`}</Text>
      </Box>
    )
  })
}
