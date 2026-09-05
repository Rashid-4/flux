# CR-NNN — <short title>

<!--
Copy this file to docs/change-requests/NNN-short-title.md using the next free
number. Fill in everything above "Resolution". Leave Resolution empty — the
architecture agent writes it.

This exists so you are never stuck. If a contract or a table blocks you, you do
not need permission to keep working: file this, skip that one piece, finish the
rest of the module.
-->

| | |
| --- | --- |
| **Raised by** | <agent + which module/surface you were building> |
| **Status** | `open` |
| **Blocks** | <what you could not finish, or "nothing — worked around"> |

## What I was implementing

<One or two sentences. Which module, which behaviour, which spec section.>

## What the contract says today

<Quote the exact type, field, or column. Include the file path and line.>

```ts
// packages/contracts/src/<file>.ts:NN
```

## Why that does not work

<Be concrete. "The API cannot return X because the type has no field for it" is
useful. "The types are awkward" is not. If it is a correctness problem, describe
the case that would produce a wrong result.>

## Minimum change I need

<The smallest change that unblocks you — not the most general one. If you can
think of a way to do it without changing the contract at all, say that too; it
may be the right answer.>

## What I did instead for now

<Skipped it / stubbed it / implemented the rest. So the reviewer knows what state
the branch is in.>

---

## Resolution

<!-- Architecture agent only. -->

**Decision:** <accepted / accepted-with-changes / rejected>

**Reasoning:**

**Changes made:**

**Anyone who must pull before continuing:**
