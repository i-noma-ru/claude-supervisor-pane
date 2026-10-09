export type SupervisorStatus = 'running' | 'done' | 'error'

/** One pane row = one tracked call (the same subagent running twice in parallel makes two rows). */
export type SupervisorRow = {
  /** tool_use_id of the tool.call */
  id: string
  /** The subagent_type as given, or the matched command substring for Bash */
  name: string
  status: SupervisorStatus
  /** Milliseconds ($.clock.now) */
  startedAt: number
  /** Set when the row finishes; absent while running */
  endedAt?: number
  /** Id of a background Agent; its end is read from $.agent.list() */
  agentId?: string
}

declare module 'claude-code' {
  interface PluginState {
    'supervisor-pane': { rows: SupervisorRow[] }
  }
}
