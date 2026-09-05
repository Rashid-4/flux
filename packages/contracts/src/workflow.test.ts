import { describe, expect, it } from 'vitest'
import type { Brand } from './ids.js'
import type { WorkflowState, WorkflowTransition } from './workflow.js'
import { validateWorkflowGraph } from './workflow.js'
import { canBeChildOf, wouldCreateCycle } from './issue.js'

const id = <B extends string>(v: string) => v as unknown as Brand<string, B>

function state(name: string, over: Partial<WorkflowState> = {}): WorkflowState {
  return {
    id: id<'WorkflowStateId'>(name),
    familyId: `fam-${name}`,
    name,
    description: null,
    category: 'todo',
    color: null,
    position: 0,
    isInitial: false,
    pausesSla: false,
    ...over,
  }
}

function transition(name: string, from: string | null, to: string): WorkflowTransition {
  return {
    id: id<'WorkflowTransitionId'>(name),
    familyId: `fam-${name}`,
    name,
    fromStateId: from === null ? null : id<'WorkflowStateId'>(from),
    toStateId: id<'WorkflowStateId'>(to),
    conditions: [],
    validators: [],
    postFunctions: [],
    screenFieldKeys: [],
    position: 0,
  }
}

const codes = (states: WorkflowState[], transitions: WorkflowTransition[]) =>
  validateWorkflowGraph(states, transitions).map((p) => p.code)

describe('validateWorkflowGraph', () => {
  it('accepts a well-formed linear workflow', () => {
    const states = [
      state('todo', { isInitial: true, category: 'todo' }),
      state('doing', { category: 'in_progress' }),
      state('done', { category: 'done' }),
    ]
    const transitions = [transition('start', 'todo', 'doing'), transition('finish', 'doing', 'done')]
    expect(validateWorkflowGraph(states, transitions)).toEqual([])
  })

  it('rejects a workflow with no initial state', () => {
    expect(codes([state('todo'), state('done', { category: 'done' })], [])).toContain('no_initial_state')
  })

  it('rejects more than one initial state', () => {
    const states = [
      state('a', { isInitial: true }),
      state('b', { isInitial: true }),
      state('done', { category: 'done' }),
    ]
    expect(codes(states, [transition('t', 'a', 'done')])).toContain('multiple_initial_states')
  })

  it('warns rather than errors when nothing is in the done category', () => {
    const problems = validateWorkflowGraph([state('triage', { isInitial: true })], [])
    const noDone = problems.find((p) => p.code === 'no_done_state')
    expect(noDone?.severity).toBe('warning')
  })

  it('detects an unreachable state', () => {
    const states = [
      state('todo', { isInitial: true }),
      state('done', { category: 'done' }),
      state('island'),
    ]
    const problems = validateWorkflowGraph(states, [transition('finish', 'todo', 'done')])
    const unreachable = problems.filter((p) => p.code === 'unreachable_state')
    expect(unreachable).toHaveLength(1)
    expect(unreachable[0]?.stateId).toBe('island')
  })

  it('treats a global transition as reaching its target from anywhere', () => {
    // fromStateId === null means "from any state". Getting this wrong would
    // flag every Jira-style global "Close" target as unreachable.
    const states = [state('todo', { isInitial: true }), state('cancelled', { category: 'cancelled' }), state('done', { category: 'done' })]
    const transitions = [transition('cancel', null, 'cancelled'), transition('finish', null, 'done')]
    expect(codes(states, transitions)).not.toContain('unreachable_state')
  })

  it('flags a transition pointing at a state that does not exist', () => {
    const states = [state('todo', { isInitial: true }), state('done', { category: 'done' })]
    const problems = validateWorkflowGraph(states, [transition('ghost', 'todo', 'nowhere')])
    expect(problems.map((p) => p.code)).toContain('transition_to_missing_state')
  })

  it('flags duplicate names case- and whitespace-insensitively', () => {
    const states = [
      state('todo', { isInitial: true }),
      state('  In Progress  ', { id: id<'WorkflowStateId'>('s2'), category: 'in_progress' }),
      state('in progress', { id: id<'WorkflowStateId'>('s3'), category: 'in_progress' }),
      state('done', { category: 'done' }),
    ]
    const transitions = [
      transition('a', 'todo', 's2'),
      transition('b', 's2', 's3'),
      transition('c', 's3', 'done'),
    ]
    expect(codes(states, transitions)).toContain('duplicate_state_name')
  })

  it('warns about a state with no inbound transition', () => {
    const states = [state('todo', { isInitial: true }), state('done', { category: 'done' })]
    const problems = validateWorkflowGraph(states, [transition('loop', 'todo', 'todo')])
    const orphan = problems.find((p) => p.code === 'orphaned_state')
    expect(orphan?.stateId).toBe('done')
    expect(orphan?.severity).toBe('warning')
  })

  it('does not report the initial state as orphaned', () => {
    const states = [state('todo', { isInitial: true }), state('done', { category: 'done' })]
    const problems = validateWorkflowGraph(states, [transition('finish', 'todo', 'done')])
    expect(problems.filter((p) => p.code === 'orphaned_state')).toEqual([])
  })
})

describe('issue hierarchy invariants', () => {
  it('permits a child exactly one level below its parent', () => {
    expect(canBeChildOf(1, 2)).toBe(true) // task under epic
    expect(canBeChildOf(0, 1)).toBe(true) // subtask under task
    expect(canBeChildOf(2, 3)).toBe(true) // epic under initiative
  })

  it('refuses level skips in both directions', () => {
    // A subtask hanging directly off an initiative is what makes every
    // roll-up total ambiguous, so "any level below" is not good enough.
    expect(canBeChildOf(0, 2)).toBe(false)
    expect(canBeChildOf(1, 1)).toBe(false)
    expect(canBeChildOf(2, 1)).toBe(false)
  })

  it('detects direct self-parenting', () => {
    expect(wouldCreateCycle('a', 'a', () => [])).toBe(true)
  })

  it('detects an indirect cycle through ancestors', () => {
    // a → b → c; reparenting a under c would close the loop.
    const ancestors: Record<string, string[]> = { c: ['b', 'a'], b: ['a'], a: [] }
    expect(wouldCreateCycle('a', 'c', (n) => ancestors[n] ?? [])).toBe(true)
    expect(wouldCreateCycle('c', 'a', (n) => ancestors[n] ?? [])).toBe(false)
  })
})
