/**
 * ══════════════════════════════════════════════════════════════════════
 * The query-key registry.
 * ══════════════════════════════════════════════════════════════════════
 *
 * docs/specs/web/README.md §5 specifies this file, and the object below is that
 * specification verbatim rather than an interpretation of it. Every key in one
 * place, built by a function, because — the spec's own words — *"an invalidation
 * that has to guess the shape of a key written inline in another file will guess
 * wrong, and the symptom is a view that is correct after a hard refresh and stale
 * before it."* That is the hardest class of bug to reproduce and the cheapest to
 * make impossible.
 *
 * ### Nesting is the invalidation graph
 *
 * TanStack Query matches keys by **prefix**, so a key's shape is not decoration —
 * it decides what a single `invalidateQueries` reaches:
 *
 *     keys.issue('LOG-1')          → ['issue', 'LOG-1']
 *     keys.issueComments('LOG-1')  → ['issue', 'LOG-1', 'comments']
 *
 * Invalidating the first invalidates the second, which is what the spec means by
 * *"choose nesting deliberately for exactly that reason"*: posting a comment
 * changes the issue's comment count, so the two must not be siblings.
 *
 * `board` and `backlog` are deliberately *not* nested under each other even
 * though both belong to a board, because moving an issue out of the backlog and
 * into a sprint changes both and starting a sprint changes both — a shared prefix
 * would have made every board refetch also refetch a 4,000-item backlog page, and
 * §8 forbids requesting that whole.
 *
 * ### Why nothing has been added to it
 *
 * There is no `allBoards()` prefix entry, no `keys.all`, and no factory
 * abstraction. Two reasons, and the second is the real one:
 *
 * 1. `['board']` as a broader prefix would restate the literal `'board'` a second
 *    time in this file, which is the drift the registry exists to prevent — one
 *    entry renamed, the other not, and the invalidation silently matches nothing.
 * 2. Nothing needs it yet. The board, backlog and issue surfaces are unspecified
 *    (their specs are being written), so any entry beyond the five here would be
 *    a guess at an invalidation a screen has not asked for. When a surface needs
 *    a broader prefix it gets an entry here, derived from the same tuple, in the
 *    commit that needs it.
 *
 * ### One thing that will change, and where
 *
 * `bootstrap()` takes no arguments because this client sends no organization
 * identifier — see docs/change-requests/003-organization-selection-mechanism.md.
 * When that resolves, the identifier has to participate in these keys, or
 * switching organization will serve the previous tenant's board out of cache
 * while the URL says otherwise. That is a data-disclosure bug wearing a caching
 * bug's clothes, and this file is where it is prevented.
 */
export const keys = {
  bootstrap: () => ['bootstrap'] as const,
  board: (boardId: string, sprintId: string | null) => ['board', boardId, sprintId] as const,
  backlog: (boardId: string) => ['backlog', boardId] as const,
  issue: (key: string) => ['issue', key] as const,
  issueComments: (key: string) => ['issue', key, 'comments'] as const,
} as const
