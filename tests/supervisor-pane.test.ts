import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { AgentInfo, On, PaneOpenArgs } from 'claude-code'

import type { SupervisorRow } from '../types'
import { EMPTY_LINE, outcomeOf, prune, renderLines, rowNameFor, settingsFrom, settleByAgents } from '../hooks/logic'

type Calls = {
  saved: SupervisorRow[]
  opened: PaneOpenArgs[]
  closed: string[]
  clock: MockClock
}

type Options = {
  agentDelay?: number
  agentError?: boolean
  agentAsync?: boolean
  bashText?: string
  agents?: AgentInfo[]
}

const RUN = { origin: { kind: 'composer' }, presentation: { layout: 'main', columns: 160, isFullscreen: false } } as const

// Only $.state sits beneath a test, so the engine the plugin talks to is mocked here
function engineBeneath(on: On, options: Options = {}): Calls {
  const calls: Calls = { saved: [], opened: [], closed: [], clock: mock.clock(on, { now: 1000 }) }

  on('state.set', { plugin: 'supervisor-pane' }, async (_$, e, next) => {
    const ran = await next(e)
    if (ran.value?.isSet && e.key === 'rows') calls.saved = e.value
    return ran
  })
  on('ui.open', (_$, e) => {
    calls.opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    calls.closed.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: calls.opened
      .filter(pane => !calls.closed.includes(pane.id))
      .map(pane => ({ id: pane.id, title: pane.title ?? pane.id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('agent.list', () => ({ value: options.agents ?? [] }))

  on('tool.call', { tool: 'Agent' }, async (_$, e) => {
    if (options.agentDelay) await calls.clock.sleep(options.agentDelay)
    if (options.agentError) return { result: { agentId: 'a1' }, text: 'Agent failed.', isError: true, ref: 1 }
    if (options.agentAsync) {
      return {
        result: { status: 'async_launched', agentId: 'a1', description: e.description, prompt: e.prompt, outputFile: '/home/me/project/out.txt' },
        text: 'Async agent launched with ID: a1',
        ref: 1,
      } as never
    }
    return {
      result: {
        agentId: 'a1', status: 'completed', prompt: e.prompt, content: [{ type: 'text', text: 'ok' }],
        totalToolUseCount: 1, totalDurationMs: 3000, totalTokens: 10,
        usage: {
          input_tokens: 5, output_tokens: 5, cache_creation_input_tokens: null, cache_read_input_tokens: null,
          server_tool_use: null, service_tier: null, cache_creation: null,
        },
      },
      text: 'ok',
      ref: 1,
    } as never
  })
  on('tool.call', { tool: 'Bash' }, (_$, e) => ({
    result: { stdout: '', stderr: '', interrupted: false },
    text: options.bashText ?? `ran: ${e.command}`,
    ref: 2,
  }))

  return calls
}

const callAgent = ($: Engine, subagent_type: string, id = 'toolu_agent') =>
  $.tool.call({ tool: 'Agent', tool_use_id: id, description: 'demo', prompt: 'demo', subagent_type })

const callBash = ($: Engine, command: string, id = 'toolu_bash') =>
  $.tool.call({ tool: 'Bash', tool_use_id: id, command })

test('default agents: [] — any subagent becomes a running row, then done with its result', async ($, on) => {
  const calls = engineBeneath(on, { agentDelay: 3000 })

  const call = callAgent($, 'explorer')
  await calls.clock.settle()
  expect(calls.saved).toHaveLength(1)
  expect(calls.saved[0]).toMatchObject({ id: 'toolu_agent', name: 'explorer', status: 'running', startedAt: 1000 })
  expect(calls.opened).toEqual([{ id: 'supervisor', title: 'Supervisors' }])

  await calls.clock.advance(3000)
  await call
  expect(calls.saved[0]).toMatchObject({ status: 'done', endedAt: 4000 })
  expect(renderLines(calls.saved, 9000)).toEqual(['✓ explorer 3s', 'done 1 / 1'])
})

test('agents: [code-reviewer] — code-reviewer gets a row, explorer does not (negative)', { options: { agents: ['code-reviewer'] } }, async ($, on) => {
  const calls = engineBeneath(on)

  await callAgent($, 'explorer', 'toolu_1')
  expect(calls.saved).toEqual([])
  expect(calls.opened).toEqual([])

  await callAgent($, 'code-reviewer', 'toolu_2')
  expect(calls.saved).toHaveLength(1)
  expect(calls.saved[0]).toMatchObject({ id: 'toolu_2', name: 'code-reviewer', status: 'done' })
})

test('commands: [deploy.sh] — "bash deploy.sh" gets a row named deploy.sh, "ls" does not', { options: { commands: ['deploy.sh'] } }, async ($, on) => {
  const calls = engineBeneath(on)

  await callBash($, 'ls -la /home/me/project', 'toolu_1')
  expect(calls.saved).toEqual([])

  await callBash($, 'bash deploy.sh --env staging', 'toolu_2')
  expect(calls.saved).toHaveLength(1)
  expect(calls.saved[0]).toMatchObject({ id: 'toolu_2', name: 'deploy.sh', status: 'done' })
})

test('default commands: [] — no Bash command becomes a row and the pane stays closed (negative)', async ($, on) => {
  const calls = engineBeneath(on)

  await callBash($, 'bash deploy.sh')
  await callBash($, 'npm test', 'toolu_2')
  expect(calls.saved).toEqual([])
  expect(calls.opened).toEqual([])
})

test('an isError result marks the row error', async ($, on) => {
  const calls = engineBeneath(on, { agentError: true })

  await callAgent($, 'test-runner')
  expect(calls.saved[0]).toMatchObject({ name: 'test-runner', status: 'error' })
})

test('a background Agent stays running with its agentId; the timer settles it to done from agent.list', async ($, on) => {
  const agents: AgentInfo[] = []
  const calls = engineBeneath(on, { agentAsync: true, agents })
  await $.session.start({ cwd: '/home/me/project', surface: 'terminal', isInteractive: true })

  await callAgent($, 'code-reviewer')
  expect(calls.saved[0]).toMatchObject({ status: 'running', agentId: 'a1' })

  agents.push({ id: 'a1', description: 'demo', type: 'code-reviewer', status: 'completed' })
  await calls.clock.advance(5000)
  expect(calls.saved[0]).toMatchObject({ status: 'done', endedAt: 6000 })
})

test('/supervisor toggles the pane open and closed', async ($, on) => {
  const calls = engineBeneath(on)

  const first = await $.command.run({ ...RUN, command: 'supervisor', args: '' })
  expect(first.text).toBe('Supervisors pane opened.')
  expect(calls.opened).toEqual([{ id: 'supervisor', title: 'Supervisors' }])

  const second = await $.command.run({ ...RUN, command: 'supervisor', args: '' })
  expect(second.text).toBe('Supervisors pane closed.')
  expect(calls.closed).toEqual(['supervisor'])
})

test('settingsFrom accepts a lone string for a list field and falls back to 30 rows', () => {
  expect(settingsFrom({ agents: 'code-reviewer', commands: ['deploy.sh', 'make'], max_rows: 10 }))
    .toEqual({ agents: ['code-reviewer'], commands: ['deploy.sh', 'make'], maxRows: 10 })
  expect(settingsFrom({})).toEqual({ agents: [], commands: [], maxRows: 30 })
})

test('rowNameFor: empty agents lists every subagent; Bash rows are named after the matched substring', () => {
  const all = settingsFrom({})
  expect(rowNameFor('Agent', 'explorer', all)).toBe('explorer')
  expect(rowNameFor('Bash', 'bash deploy.sh', all)).toBeUndefined()
  const some = settingsFrom({ agents: ['code-reviewer'], commands: ['deploy.sh', 'npm test'] })
  expect(rowNameFor('Agent', 'explorer', some)).toBeUndefined()
  expect(rowNameFor('Bash', 'cd src && npm test -- --watch', some)).toBe('npm test')
  expect(rowNameFor('Bash', undefined, some)).toBeUndefined()
  expect(rowNameFor('Read', 'src/app.ts', all)).toBeUndefined()
})

test('outcomeOf: a non-zero exit code and a deny are error, exit code 0 is done', () => {
  expect(outcomeOf({ result: { stdout: '', stderr: '', interrupted: false }, text: 'Exit code 2\nfailed' })).toEqual({ status: 'error' })
  expect(outcomeOf({ result: { stdout: '', stderr: '', interrupted: false }, text: 'Exit code 0' })).toEqual({ status: 'done' })
  expect(outcomeOf({ deny: 'refused' })).toEqual({ status: 'error' })
})

test('prune drops the oldest finished row past the limit and keeps running rows', () => {
  const old: SupervisorRow[] = Array.from({ length: 31 }, (_, i) => ({
    id: `t${i}`, name: 'test-runner', status: i === 0 ? 'running' : 'done', startedAt: i,
  }))
  const kept = prune(old)
  expect(kept).toHaveLength(30)
  expect(kept[0]?.id).toBe('t0')
  expect(kept[1]?.id).toBe('t2')
  expect(prune(old, 5)).toHaveLength(5)
})

test('renderLines is "<mark> <name> <seconds>s" per row and "done n / m" at the end', () => {
  const rows: SupervisorRow[] = [
    { id: 'a', name: 'code-reviewer', status: 'running', startedAt: 1000 },
    { id: 'b', name: 'deploy.sh', status: 'error', startedAt: 1000, endedAt: 2500 },
  ]
  expect(renderLines(rows, 8200)).toEqual(['… code-reviewer 7s', '✗ deploy.sh 1s', 'done 1 / 2'])
  expect(renderLines([], 0)).toEqual([EMPTY_LINE, 'done 0 / 0'])
  // A running row without agentId is never settled from agent.list
  expect(settleByAgents(rows, [{ id: 'x', status: 'completed' }], 9000).changed).toBe(false)
})
