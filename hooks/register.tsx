import type { Register } from 'claude-code'

import { registerFold } from './fold'
import { registerResults } from './results'
import { brokenReason, COMMAND, clearBroken, fallBack, isEnabled, load, NAME, setEnabled } from './switch'

// The mod's entry: the /compact-view switch, the one-line results (results.tsx) and the fold (fold.tsx).

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await load($, true)
    await $.command.register({
      name: COMMAND,
      description: 'Switch edit diffs to one summary line, or back',
      argumentHint: '[on|off]',
    })
    return next(e)
  }).catch(($, e, next) => fallBack($, 'starting up', e, next))

  on('command.run', { command: COMMAND }, async ($, e) => {
    await load($)
    const arg = typeof e.args === 'string' ? e.args.trim().toLowerCase() : ''
    if (arg !== '' && arg !== 'on' && arg !== 'off') return { text: `Usage: /${COMMAND} [on|off]` }
    const broken = brokenReason()
    // A bare /compact-view after an error reports it and changes nothing.
    if (arg === '' && broken !== undefined) {
      return { text: `${NAME} is off for this session after an error: ${broken}\n/${COMMAND} on tries again.` }
    }
    const turnOn = arg === '' ? !isEnabled() : arg === 'on'
    if (turnOn) clearBroken()
    const note = (await setEnabled($, turnOn)) ? '' : ' (not saved, this session only)'
    // Folded runs follow the switch at once; one-line results keep how they were first drawn.
    $.ui.invalidate('ui.render')
    const what = turnOn ? 'edits show one summary line, runs fold' : 'the normal Claude Code view'
    return { text: `${NAME} ${turnOn ? 'on' : 'off'}: ${what}${note}` }
  }).catch((_$, _e, next) => ({
    text: `${NAME}: the command failed (${next.error.message ?? next.error.kind})`,
  }))

  registerResults(on, options)
  registerFold(on, options)
}
