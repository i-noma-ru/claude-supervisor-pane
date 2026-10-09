import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SupervisorRow } from '../types'
import {
  PANE_ID,
  PANE_TITLE,
  hasRunning,
  outcomeOf,
  prune,
  renderLines,
  rowNameFor,
  settingsFrom,
  settleByAgents,
} from './logic'
import type { RanShape } from './logic'

const rows = atom({ plugin: 'supervisor-pane', key: 'rows' } as const, [])

// Functions that take $ live at module level (passing $ into a function made inside a hook fails validate)

async function openPane($: EngineInterface): Promise<boolean> {
  try {
    const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
    return opened.isPlaced
  } catch {
    // No screen (claude -p): nothing to open
    return false
  }
}

async function beginRow($: EngineInterface, id: string, name: string, max: number): Promise<void> {
  const startedAt = await $.clock.now()
  const row: SupervisorRow = { id, name, status: 'running', startedAt }
  const before = await read($, rows)
  await update($, rows, list => prune([...list, row], max))
  // Open only for the first row; never reopen a pane the user closed
  if (before.length === 0) await openPane($)
}

async function finishRow($: EngineInterface, id: string, ran: RanShape): Promise<void> {
  const outcome = outcomeOf(ran)
  const endedAt = outcome.status === 'running' ? undefined : await $.clock.now()
  await update($, rows, list =>
    list.map(row => {
      if (row.id !== id) return row
      if (outcome.status === 'running') return { ...row, agentId: outcome.agentId }
      return { ...row, status: outcome.status, endedAt }
    }),
  )
}

async function failRow($: EngineInterface, id: string): Promise<void> {
  const endedAt = await $.clock.now()
  await update($, rows, list =>
    list.map(row => (row.id === id ? { ...row, status: 'error' as const, endedAt } : row)),
  )
}

/** Every 5 s: settle background Agents from agent.list and redraw elapsed seconds of running rows */
async function tick($: EngineInterface): Promise<void> {
  try {
    const list = await read($, rows)
    if (!hasRunning(list)) return
    if (list.some(row => row.status === 'running' && row.agentId !== undefined)) {
      const agents = await $.agent.list()
      const now = await $.clock.now()
      if (settleByAgents(list, agents, now).changed) {
        await update($, rows, current => settleByAgents(current, agents, now).rows)
      }
    }
    $.ui.invalidate('ui.render')
  } catch {
    // A failed list or redraw is retried on the next tick
  }
}

export const register: Register = (on, options) => {
  const settings = settingsFrom(options)

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'supervisor',
        description: 'Open or close the Supervisors pane (subagent runs and chosen shell commands)',
      })
    } catch {
      // A failed registration must not stop the session
    }
    $.clock.every(5000, () => {
      void tick($)
    })

    return next(e)
  })

  on('command.run', { command: 'supervisor' }, async $ => {
    const isUp = (await $.ui.panes()).some(pane => pane.id === PANE_ID)
    if (isUp) {
      await $.ui.close({ id: PANE_ID })
      return { text: 'Supervisors pane closed.' }
    }
    const placed = await openPane($)
    return {
      text: placed
        ? 'Supervisors pane opened.'
        : 'Supervisors pane opened, but it cannot be placed on this screen (terminal too narrow, or no screen).',
    }
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const name = rowNameFor('Agent', e.subagent_type, settings)
    if (name === undefined) return next(e)
    await beginRow($, e.tool_use_id, name, settings.maxRows)
    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } catch (error) {
      // If next rejects (interrupt), do not leave the row running
      await failRow($, e.tool_use_id).catch(() => undefined)
      throw error
    }
    await finishRow($, e.tool_use_id, ran)

    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const name = rowNameFor('Bash', e.command, settings)
    if (name === undefined) return next(e)
    await beginRow($, e.tool_use_id, name, settings.maxRows)
    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } catch (error) {
      await failRow($, e.tool_use_id).catch(() => undefined)
      throw error
    }
    await finishRow($, e.tool_use_id, ran)

    return ran
  })

  // The matcher is a literal (a constant makes validate read requestId=?)
  on('ui.render', { component: 'Pane', requestId: 'supervisor' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, rows)
    const now = await $.clock.now()

    return (
      <Box flexDirection="column">
        {renderLines(list, now).map((line, index) => (
          <Text key={`line${index}`} wrap="truncate-end">{line}</Text>
        ))}
      </Box>
    )
  })
}
