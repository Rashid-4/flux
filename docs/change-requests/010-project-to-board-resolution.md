# CR-010 — `/projects/:projectKey/board` cannot resolve a board id

| | |
| --- | --- |
| **Raised by** | Claude Code, building the board surface on `ui/copy-work` |
| **Status** | `open` |
| **Blocks** | the board route in the real app. It does not block the harness or the visual work, because both seed the query cache directly. |

## What I was implementing

`ROUTE_PATTERNS.board` is `/projects/:projectKey/board`, and `docs/specs/web/README.md`
§1 lists the board as a surface driven by `BoardViewSchema`. So the route has a
project key and needs a `BoardView`.

## What the contract says

`api/boards.ts` is the only way to get one:

```ts
getBoard(boardId: string, options): Promise<BoardView>   // GET /boards/:id
```

It needs a **board id**, and nothing in the client can produce one from a project
key:

- `BootstrapSchema.projects[]` carries `id`, `key`, `name`, `avatarUrl` and
  `isFavourite`. No board.
- `docs/specs/api/boards-sprints.md` specifies `GET /boards/:id` and
  `GET /boards/:id/backlog`, and no endpoint that lists or resolves the boards of a
  project.
- `BoardSchema.projectIds` points the *other* way — a board knows its projects, so
  the mapping exists in the data and is only reachable if you already have the
  board.

A project may legitimately have several boards (`projectIds` is an array of 1–20,
so boards and projects are many-to-many), which is why this is a real modelling
question and not just a missing field.

## Minimum change

Either would unblock it; the second is smaller and the first is better.

1. **`GET /projects/:key/boards`** returning the project's boards as
   `{ id, name, type, isDefault }`, and the route picks the default. This is the one
   that survives a project having more than one board, and it gives the board
   switcher a source when that surface arrives.
2. **`defaultBoardId` on `BootstrapSchema.projects[]`.** One nullable field, no new
   endpoint, and the shell already has it in memory — but it silently picks a
   winner when a project has several boards, and it grows bootstrap for something
   most page loads do not need.

## What I did meanwhile

The board renders from whatever `BoardView` is already in the query cache, matched
by `board.projectIds` against the project's id — which is what the harness seeds,
so the surface is fully buildable and reviewable. In the real app that cache is
empty on a cold load and the route renders its "board unavailable" state rather
than guessing an id. The resolution lives in one function
(`apps/web/src/queries/board.ts`), so accepting either option above is a change to
that function and nothing else.
