import type { PluginOptions } from 'claude-code'

import type { SupervisorRow } from '../types'

export const PANE_ID = 'supervisor'
export const PANE_TITLE = 'Supervisors'
export const DEFAULT_MAX_ROWS = 30

/** The plugin's userConfig, normalized once per activation */
export type Settings = {
  /** subagent_type values that get a row; empty = every subagent */
  agents: readonly string[]
  /** substrings; a Bash command containing one gets a row named after it; empty = no Bash rows */
  commands: readonly string[]
  maxRows: number
}

/** A `multiple` string field arrives as an array; accept a lone string too */
function stringList(value: unknown): readonly string[] {
  if (value === undefined || value === null) return []
  return ([] as unknown[]).concat(value).filter((one): one is string => typeof one === 'string')
}

export function settingsFrom(options: PluginOptions): Settings {
  const max = options.max_rows
  return {
    agents: stringList(options.agents),
    commands: stringList(options.commands),
    maxRows: typeof max === 'number' && Number.isFinite(max) ? max : DEFAULT_MAX_ROWS,
  }
}

/**
 * The row's name. Agent passes subagent_type, Bash passes the command, as `detail`.
 * undefined = no row.
 */
export function rowNameFor(tool: string, detail: unknown, settings: Settings): string | undefined {
  if (typeof detail !== 'string') return undefined
  if (tool === 'Agent') {
    return settings.agents.length === 0 || settings.agents.includes(detail) ? detail : undefined
  }
  if (tool === 'Bash') return settings.commands.find(part => detail.includes(part))
  return undefined
}

/** The part of next(e)'s result that decides where the row goes */
export type RanShape = {
  deny?: string
  isError?: boolean
  text?: string
  result?: unknown
}

export type Outcome = { status: 'done' | 'error' } | { status: 'running'; agentId: string }

// "exit code 0" is not a failure, so the first digit is limited to 1-9
const NONZERO_EXIT = /exit code[:\s]*[1-9]\d*/i

/** done / error / running (background Agent) from next(e)'s result */
export function outcomeOf(ran: RanShape): Outcome {
  if (ran.deny !== undefined || ran.isError === true) return { status: 'error' }
  const result = ran.result
  const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : {}
  // A background Agent answers at launch (status: async_launched); its end is read from agent.list.
  // A record with agentId but no status has not finished either, so it is treated the same.
  if (typeof record.agentId === 'string' && record.status !== 'completed') {
    return { status: 'running', agentId: record.agentId }
  }
  const text = [ran.text, record.stdout, record.stderr]
    .filter((part): part is string => typeof part === 'string')
    .join('\n')
  return { status: NONZERO_EXIT.test(text) ? 'error' : 'done' }
}

/** Keep at most `max` rows: drop the oldest done/error first; if all are running, drop the oldest */
export function prune(rows: SupervisorRow[], max = DEFAULT_MAX_ROWS): SupervisorRow[] {
  if (rows.length <= max) return rows
  const kept = [...rows]
  while (kept.length > max) {
    const index = kept.findIndex(row => row.status !== 'running')
    kept.splice(index < 0 ? 0 : index, 1)
  }
  return kept
}

export function hasRunning(rows: readonly SupervisorRow[]): boolean {
  return rows.some(row => row.status === 'running')
}

type AgentLike = { id: string; status: string }

/** Copy background Agents' end state onto rows: completed -> done, failed/killed -> error */
export function settleByAgents(
  rows: SupervisorRow[],
  agents: readonly AgentLike[],
  now: number,
): { rows: SupervisorRow[]; changed: boolean } {
  let changed = false
  const settled = rows.map(row => {
    if (row.status !== 'running' || row.agentId === undefined) return row
    const agent = agents.find(one => one.id === row.agentId)
    if (agent === undefined) return row
    if (agent.status === 'completed') {
      changed = true
      return { ...row, status: 'done' as const, endedAt: now }
    }
    if (agent.status === 'failed' || agent.status === 'killed') {
      changed = true
      return { ...row, status: 'error' as const, endedAt: now }
    }
    return row
  })
  return { rows: changed ? settled : rows, changed }
}

const MARK = { running: '…', done: '✓', error: '✗' } as const

export function elapsedSeconds(row: SupervisorRow, now: number): number {
  return Math.max(0, Math.floor(((row.endedAt ?? now) - row.startedAt) / 1000))
}

export const EMPTY_LINE = 'No supervisors have run yet.'

/** Pane lines: one per row as "<mark> <name> <seconds>s", then "done n / m" (n counts done and error) */
export function renderLines(rows: readonly SupervisorRow[], now: number): string[] {
  const lines = rows.map(row => `${MARK[row.status]} ${row.name} ${elapsedSeconds(row, now)}s`)
  if (lines.length === 0) lines.push(EMPTY_LINE)
  const finished = rows.filter(row => row.status !== 'running').length
  lines.push(`done ${finished} / ${rows.length}`)
  return lines
}
