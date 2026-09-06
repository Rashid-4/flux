# CR-004 — entity colour palette for avatars

| | |
| --- | --- |
| **Raised by** | UI agent — `apps/web` primitives (`components/data/UserAvatar`) |
| **Status** | `open` |
| **Blocks** | nothing — worked around. Avatars ship single-tone (`surface-2` / `fg-muted`) with a stable `data-tone` index. |

## What I was implementing

Flux-level `<UserAvatar>`: initials from `UserRef.displayName`, a hash-stable tone so Ada is always the same colour across the board / comments / the topbar, and a greyed treatment when `isInactive`.

## What the contract says today

There is no contract type for this — it is a token gap. `apps/web/src/design/tokens.css` deletes Tailwind's default 22-hue palette (`--color-*: initial`) and `COLOR_KEYS` in `apps/web/src/design/theme-keys.ts` has surface / fg / status / primary / contrast / danger / …, **no `entity-*` hues**. `ui/avatar` is explicit that per-user colour is not its job.

A later `bg-blue-200` or `bg-[#dbe4fe]` in `UserAvatar` is a lint error (`no-restricted-syntax` hex / arbitrary colour) and would also fail `design/palette.test.ts`.

## Why that does not work

Hashing `UserId` onto a hue needs a hue palette. Without one, every avatar is the same grey. That is readable (7.41:1 / 6.97:1 on `surface-2`) but it is not the product: a board column of five assignees is un-scanable, and the inactive treatment (`opacity-50`) is the only remaining differentiator.

Inventing eight hex values in the component would:

1. Fail lint.
2. Skip the measured-ratio comment that every other pair in `tokens.css` carries.
3. Drift from `theme-keys.ts`, so `cn('bg-entity-3', 'bg-entity-4')` would not merge.

## Minimum change I need

Eight named pairs in `tokens.css` **and** `theme-keys.ts`, both themes, with the measured sRGB WCAG ratio in a comment beside each. Suggested names and measured pairs (text on fill; all ≥ 4.5:1, so 11px initials stay AA):

| Token | Light bg / fg | Light ratio | Dark bg / fg | Dark ratio |
| --- | --- | --- | --- | --- |
| `entity-0` | `#dbe4fe` / `#1e3a8a` | 8.16:1 | `#1e3a8a` / `#dbe4fe` | 8.16:1 |
| `entity-1` | `#ccfbf1` / `#115e59` | 6.73:1 | `#134e4a` / `#ccfbf1` | 8.41:1 |
| `entity-2` | `#dcfce7` / `#14532d` | 8.30:1 | `#14532d` / `#dcfce7` | 8.30:1 |
| `entity-3` | `#fef3c7` / `#78350f` | 8.15:1 | `#78350f` / `#fef3c7` | 8.15:1 |
| `entity-4` | `#ffedd5` / `#9a3412` | 6.38:1 | `#9a3412` / `#ffedd5` | 6.38:1 |
| `entity-5` | `#ffe4e6` / `#9f1239` | 6.68:1 | `#9f1239` / `#ffe4e6` | 6.68:1 |
| `entity-6` | `#ede9fe` / `#5b21b6` | 7.57:1 | `#5b21b6` / `#ede9fe` | 7.57:1 |
| `entity-7` | `#e2e8f0` / `#1e293b` | 11.87:1 | `#1e293b` / `#e2e8f0` | 11.87:1 |

Utilities: `bg-entity-0` … `bg-entity-7` and `text-entity-0-fg` … (or `entity-0` / `entity-0-fg` matching `primary` / `primary-fg`). Ratios were computed from sRGB relative luminance, same method as the comments in `tokens.css`. Architecture should re-measure against the actual `surface` each avatar sits on (`surface` and `canvas`) before committing — a fill that is 8:1 with its own fg can still fail SC 1.4.11 as a 24px graphic against its neighbour.

Inactive stays a separate signal (`opacity-50` + `(inactive)` in the accessible name). Do not reuse `entity-*` for that; Linus must not look like a seventh hue.

## What I did instead for now

`<UserAvatar>` hashes `UserRef.id` into `data-tone="0"…"7"` and paints every tone with `bg-surface-2 text-fg-muted`. When these tokens land, the component can map `data-tone` onto `bg-entity-N text-entity-N-fg` without a layout shift. `tokens.css` was not edited.

---

## Resolution

<!-- Architecture agent only. -->

**Decision:**

**Reasoning:**

**Changes made:**

**Anyone who must pull before continuing:**
