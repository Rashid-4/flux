import { IssueDetailSchema } from '@flux/contracts'
import { aVersionConflictError, scenario, uuidFrom } from '@flux/mocks'
import { http, HttpResponse } from 'msw'
import { ZodError } from 'zod'
import { beforeEach, describe, expect, it } from 'vitest'
import { createIssue, getIssue, transitionIssue, updateIssue } from './issues'
import { newIdempotencyKey } from './idempotency'
import { API_BASE, isApiRequestError } from './request'
import { failsWith } from '../test/failures'
import { server } from '../test/server'

/** A key that exists in the shared world, so the default handlers resolve it. */
let liveKey: string

beforeEach(() => {
  const key = scenario().boardIssueKeys[0]
  if (key === undefined) throw new Error('scenario() produced an empty board')
  liveKey = key
})

// ── getIssue ─────────────────────────────────────────────────────────

describe('getIssue', () => {
  it('returns the issue the board pointed at', async () => {
    const issue = await getIssue(liveKey)

    // Derived from the card in scenario(), so this also asserts the world is
    // coherent: clicking a card cannot open an issue the board does not show.
    expect(issue.key).toBe(liveKey)
    expect(IssueDetailSchema.safeParse(issue).success).toBe(true)
  })

  it('returns the fat read model, not a bare row', async () => {
    const issue = await getIssue(liveKey)

    // The fields that make the issue view one round trip instead of eight. A
    // screen that fetches any of these separately has misread the contract.
    expect(issue.statusName).toBeTypeOf('string')
    expect(issue.availableTransitions).toBeInstanceOf(Array)
    expect(issue.links).toBeInstanceOf(Array)
    expect(issue.permissions.canEdit).toBeTypeOf('boolean')
    expect(issue.subtaskSummary.total).toBeTypeOf('number')
  })

  it('reports an unknown key as not_found', async () => {
    const error = await getIssue('LOG-999999').catch((thrown: unknown) => thrown)

    expect(isApiRequestError(error)).toBe(true)
    if (!isApiRequestError(error)) return
    expect(error.knownCode).toBe('not_found')
    expect(error.status).toBe(404)
  })

  it('encodes the key, so a fragment cannot truncate the path', async () => {
    /**
     * Without `encodeURIComponent`, `LOG-1#evil` produces the URL
     * `/api/v1/issues/LOG-1#evil` — the `#` starts a fragment, the browser
     * discards it, and the request that goes out is for `LOG-1`. The user would
     * be shown a *different issue* than the one asked for, with no error. So this
     * asserting a 404 is the whole point: the server has to see the full string
     * and refuse it.
     */
    const error = await getIssue(`${liveKey}#evil`).catch((thrown: unknown) => thrown)

    expect(isApiRequestError(error)).toBe(true)
    if (!isApiRequestError(error)) return
    expect(error.knownCode).toBe('not_found')
  })
})

// ── createIssue ──────────────────────────────────────────────────────

describe('createIssue', () => {
  /** The smallest input `CreateIssueSchema` accepts. */
  function minimalInput() {
    const project = scenario().bootstrap.projects[0]
    if (project === undefined) throw new Error('scenario() bootstrap has no projects')
    return {
      projectId: project.id,
      issueTypeId: uuidFrom('issue-type:story'),
      summary: 'Rate limiter drops the first request after a deploy',
      idempotencyKey: newIdempotencyKey(),
    }
  }

  /** Install a capturing handler and hand back the array it fills. */
  function captureCreate() {
    const bodies: Record<string, unknown>[] = []
    server.use(
      http.post(`${API_BASE}/projects/:projectKey/issues`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(scenario().issuesByKey[liveKey], { status: 201 })
      }),
    )
    return bodies
  }

  it('creates the issue and returns the parsed detail', async () => {
    const input = minimalInput()

    const created = await createIssue('WEB', input)

    // The handler echoes the summary, so this asserts the form's value reached
    // the server rather than asserting a fixture back to itself.
    expect(created.summary).toBe(input.summary)
    expect(created.projectKey).toBe('WEB')
  })

  it("applies the schema's defaults so a form need not spell them out", async () => {
    const bodies = captureCreate()

    await createIssue('WEB', minimalInput())

    // This is why the input type is `z.input` and not `z.infer`: the caller
    // supplied none of these four and the server receives all of them.
    expect(bodies[0]).toMatchObject({
      labels: [],
      componentIds: [],
      fixVersionIds: [],
      customFields: {},
    })
  })

  it('sends the idempotency key in the body, where the contract puts it', async () => {
    const bodies = captureCreate()
    const input = minimalInput()

    await createIssue('WEB', input)

    // Not a header. `CreateIssueSchema.idempotencyKey` is a required body field,
    // and a client that sent a header instead would be silently ignored — the
    // server would create a second issue on every retry.
    expect(bodies[0]?.idempotencyKey).toBe(input.idempotencyKey)
  })

  it('sends the same key on a retry of the same intention', async () => {
    const bodies = captureCreate()
    const input = minimalInput()

    await createIssue('WEB', input)
    await createIssue('WEB', input)

    // The mechanism's entire value. A key minted inside `createIssue` would
    // differ here, the server would find no stored response, and the retry would
    // produce a duplicate ticket.
    expect(bodies[0]?.idempotencyKey).toBe(bodies[1]?.idempotencyKey)
  })

  it('rejects a missing idempotency key locally, without a round trip', async () => {
    const bodies = captureCreate()
    const { idempotencyKey: _omitted, ...withoutKey } = minimalInput()

    await expect(
      createIssue('WEB', withoutKey as ReturnType<typeof minimalInput>),
    ).rejects.toBeInstanceOf(ZodError)

    // The point of parsing the request as well as the response: a client bug is a
    // local throw naming the field, not a 422 one round trip later.
    expect(bodies).toEqual([])
  })

  it('names the offending field when the summary is empty', async () => {
    const error = await createIssue('WEB', { ...minimalInput(), summary: '' }).catch(
      (thrown: unknown) => thrown,
    )

    expect(error).toBeInstanceOf(ZodError)
    if (!(error instanceof ZodError)) return
    expect(error.issues[0]?.path).toEqual(['summary'])
  })

  it('encodes the project key in the path', async () => {
    const seen: string[] = []
    server.use(
      http.post(`${API_BASE}/projects/:projectKey/issues`, ({ params }) => {
        seen.push(String(params.projectKey))
        return HttpResponse.json(scenario().issuesByKey[liveKey], { status: 201 })
      }),
    )

    await createIssue('A B/C', minimalInput())

    expect(seen).toEqual(['A B/C'])
  })
})

// ── updateIssue ──────────────────────────────────────────────────────

describe('updateIssue', () => {
  function captureUpdate() {
    const bodies: Record<string, unknown>[] = []
    server.use(
      http.patch(`${API_BASE}/issues/:key`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(scenario().issuesByKey[liveKey])
      }),
    )
    return bodies
  }

  it('sends null to clear a field and omits an undefined one', async () => {
    /**
     * The distinction `UpdateIssueSchema`'s header calls out: `undefined` means
     * leave alone, `null` means clear, and "unassign this issue" is unexpressible
     * without both. It survives because zod keeps a present-but-undefined
     * optional key and `JSON.stringify` then drops exactly those.
     */
    const bodies = captureUpdate()

    await updateIssue(liveKey, { version: 1, assigneeId: null })
    await updateIssue(liveKey, { version: 1, assigneeId: undefined, summary: 'Renamed' })

    expect(bodies[0]).toHaveProperty('assigneeId', null)
    expect(bodies[1] === undefined ? true : 'assigneeId' in bodies[1]).toBe(false)
    expect(bodies[1]).toHaveProperty('summary', 'Renamed')
  })

  it('requires a version, so concurrency control is not opt-in', async () => {
    const bodies = captureUpdate()

    await expect(
      updateIssue(liveKey, { summary: 'x' } as { version: number; summary: string }),
    ).rejects.toBeInstanceOf(ZodError)

    expect(bodies).toEqual([])
  })

  it('strips fields the contract does not accept rather than forwarding them', async () => {
    const bodies = captureUpdate()

    await updateIssue(liveKey, {
      version: 1,
      summary: 'Renamed',
      // A stray field from a form's local state. Zod's default strip behaviour
      // keeps it out of the request instead of costing a 422 unknown_field.
      ...({ isDirty: true } as object),
    })

    expect(bodies[0]).not.toHaveProperty('isDirty')
  })

  it('surfaces a version conflict with the current version attached', async () => {
    const conflict = aVersionConflictError(7)
    server.use(failsWith('PATCH', '/issues/:key', conflict))

    const error = await updateIssue(liveKey, { version: 1, summary: 'x' }).catch(
      (thrown: unknown) => thrown,
    )

    expect(isApiRequestError(error)).toBe(true)
    if (!isApiRequestError(error)) return
    expect(error.knownCode).toBe('version_conflict')
    // §6 turns this into a real choice for the user, which needs the number.
    expect(error.detail.currentVersion).toBe(7)
    expect(error.retryable).toBe(false)
  })
})

// ── transitionIssue ──────────────────────────────────────────────────

describe('transitionIssue', () => {
  it('moves the issue through a transition the server offered', async () => {
    const issue = await getIssue(liveKey)
    const transition = issue.availableTransitions.find((t) => t.available)
    if (transition === undefined) throw new Error('the fixture offers no available transition')

    const moved = await transitionIssue(liveKey, {
      transitionId: transition.id,
      version: issue.version,
    })

    expect(moved.statusName).toBe(transition.toStateName)
    expect(moved.statusCategory).toBe(transition.toStateCategory)
    // Bumped, so the next write from this cache entry does not 409.
    expect(moved.version).toBe(issue.version + 1)
  })

  it('applies the fields default, so a dialog with no inputs still validates', async () => {
    const bodies: Record<string, unknown>[] = []
    server.use(
      http.post(`${API_BASE}/issues/:key/transitions`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(scenario().issuesByKey[liveKey])
      }),
    )

    await transitionIssue(liveKey, { transitionId: uuidFrom('transition:done'), version: 1 })

    expect(bodies[0]).toMatchObject({ fields: {} })
  })

  it('reports an unknown transition id as invalid_transition', async () => {
    // Not a 200. Status only ever changes through a transition the server
    // offered, and the client has to have a tested snap-back path.
    const error = await transitionIssue(liveKey, {
      transitionId: uuidFrom('transition:invented'),
      version: 1,
    }).catch((thrown: unknown) => thrown)

    expect(isApiRequestError(error)).toBe(true)
    if (!isApiRequestError(error)) return
    expect(error.knownCode).toBe('invalid_transition')
    expect(error.status).toBe(409)
  })

  it('reports an unmet condition distinctly from an unknown transition', async () => {
    const issue = await getIssue(liveKey)
    const blocked = issue.availableTransitions.find((t) => !t.available)
    if (blocked === undefined) throw new Error('the fixture offers no blocked transition')

    const error = await transitionIssue(liveKey, {
      transitionId: blocked.id,
      version: issue.version,
    }).catch((thrown: unknown) => thrown)

    expect(isApiRequestError(error)).toBe(true)
    if (!isApiRequestError(error)) return
    // Two different refusals, because the user can act on one and not the other:
    // a condition names what is unmet, an unknown id is a stale board.
    expect(error.knownCode).toBe('transition_condition_failed')
    expect(error.message).toBe(blocked.unavailableReason)
  })
})
