# CR-010 — There is no `payload_too_large` code, so a 413 is answered as a 400

| | |
| --- | --- |
| **Raised by** | Claude Code, building `services/api/src/http/api-error.ts` (the foreign-status boundary) |
| **Status** | `open` |
| **Blocks** | nothing — implemented with the closest existing code. The status sent is wrong by one hop and the message is right. |

## What I was implementing

`services/api/src/http/api-error.ts`: the boundary that turns everything we did
not write — Fastify's own pre-handler errors and any `HttpException` thrown by a
library — into one of our error codes.
[`docs/specs/api/README.md`](../specs/api/README.md) §7 forbids choosing an HTTP
status by hand, so the mapping runs in one direction only: the foreign status
picks one of our codes, and **the code determines the status we send**.

That closes the loop for every status except one. A body over Fastify's
`bodyLimit` arrives as a 413, and there is no code in the enum whose status is
413.

## What the contract says today

`ErrorCodeSchema` is a closed enum, and the status for each code is derived from
it rather than passed alongside it:

```ts
// packages/contracts/src/errors.ts
export const ErrorCodeSchema = z.enum([
  'malformed_query',
  'validation_failed',
  // …
])
```

The nearest candidates and what each is for:

| Code | Status | Meaning |
| --- | --- | --- |
| `malformed_query` | 400 | the request could not be read |
| `validation_failed` | 422 | the request was read and a field was rejected |
| `rate_limited` | 429 | too many requests, retry later |

None of the three means "the request was well-formed, and too big". The upload
limit is a *quota-shaped* refusal — the client's fix is to send less, not to fix
its syntax — and 413 is the status that says so.

## Why that does not work

Three concrete costs, in order of how much they matter.

**A client cannot distinguish "unreadable" from "too large".** `api-error.ts`
maps five foreign statuses — 400, 406, 413, 414, 415 — to `malformed_query`,
because that is the only code available for a request the server declined to
read. A client switching on `code` therefore cannot tell an upload that exceeded
a limit from a JSON syntax error, which are the two failures with the most
different remedies in the set: one is "retry with a smaller file", the other is
"this is a bug in the caller". §13 forbids answering a known cause with a generic
message, and this is the structural version of the same problem — the *message*
is specific and the *machine-readable field* is not.

**Every proxy in front of the service already has an opinion.** A body over a
limit is refused by nginx, by an ALB, and by Cloudflare with a 413 before the
request reaches this process at all. So a client that learns "flux answers 400
for an oversized upload" learns something that is true only when the request got
far enough — the same failure returns 400 or 413 depending on which hop caught
it, which is exactly the kind of inconsistency that makes client-side handling
untestable.

**The status is observably wrong.** `curl -w '%{http_code}'` on an oversized body
prints 400. There is no reading of the HTTP spec under which that is right, and
"the code determines the status" — the rule that makes §7 work — is what forces
it: with no 413 code, there is no way to send a 413 without special-casing this
one path and breaking the invariant everywhere else.

Inventing a code in a service file is not an option: `ErrorCodeSchema` is what
`check:errors` audits the specs against, and a code the contract does not have is
a code the client cannot parse.

## Minimum change I need

One value:

```ts
// packages/contracts/src/errors.ts
'payload_too_large',   // 413
```

plus its entry in the status map, its row in the errors table the specs share,
and a `retryAfterSeconds`-free `meta` (this is not retryable — retrying the same
body fails identically).

**A way to do it without changing the contract:** none that is honest.
`validation_failed` at 422 would at least be a distinct code, but it claims the
body was parsed and a field rejected — and for a body over the limit the body was
never read, so the `fields` array that code's consumers expect would be empty for
a reason no client could infer. That trades a wrong status for a lying code,
which is worse: a wrong status is visible in a network panel, and a lying code is
not visible anywhere.

The one genuinely contract-free option is to raise `bodyLimit` high enough that
the case does not arise, and it is not viable. `docs/specs/api/README.md` §3
routes attachments to presigned storage URLs specifically so file bytes never
traverse the API body, which means the limit is there to *catch a mistake* rather
than to size a feature — and raising it to hide the mistake removes the check.

## What I did instead for now

Implemented, with the divergence written down in three places rather than left as
a surprise:

- `CODE_BY_FOREIGN_STATUS` maps `413: 'malformed_query'`, with a comment naming
  this CR and stating that the status is wrong by one hop.
- `MESSAGE_BY_FOREIGN_STATUS` gives 413 its **own** message, separate from the
  other four statuses that share the code — so the message is specific even
  though the code is not. That is the half of §13 that can be honoured today.
- `api-error.test.ts` pins the 413 → 400 mapping *and* the distinct message, and
  the test's comment cites this file. When the code lands, that test fails, which
  is how the workaround gets removed rather than surviving as an unexplained
  mapping.
- `services/api/README.md` records it under "Open".

Nothing is blocked. A resolution here is a one-value contract change, ~4 lines in
`api-error.ts`, and one test edit.

---

## Resolution

<!-- Architecture agent only. -->

**Decision:**

**Reasoning:**

**Changes made:**

**Anyone who must pull before continuing:**
