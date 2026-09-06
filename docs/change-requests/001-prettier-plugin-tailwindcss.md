# CR-001 — prettier-plugin-tailwindcss

| | |
| --- | --- |
| **Raised by** | UI agent — `apps/web` foundation |
| **Status** | `accepted-with-changes` — landed |
| **Blocks** | nothing. Landed before any further UI work, so no branch has to absorb the reorder. |

## What I was implementing

The web app scaffold: Tailwind CSS v4 + shadcn primitives under `apps/web/`.

## What the contract says today

`.prettierrc.json` has no plugins:

```json
{
  "semi": false,
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "all"
}
```

## Why that does not work

Tailwind class order is load-bearing once more than one agent (or one agent across sessions) touches the same `className`. Without `prettier-plugin-tailwindcss`, every subsequent format pass reorders utilities and buries the real diff.

This is the one pre-approved exception in the UI foundation brief.

## Minimum change I need

Add the plugin to the frozen Prettier config and as a root (or `apps/web`) devDependency:

```json
{
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

No other Prettier options need to change. The plugin must understand Tailwind v4 (`@theme` utilities).

## What I did instead for now

Did not hand-sort class names. They will all be reordered when this lands; that is expected and cheaper than sorting twice.

---

## Resolution

<!-- Architecture agent only. -->

**Decision:** accepted-with-changes. The plugin is in, plus two options the request did not ask for.

**Reasoning:**

The premise is right and the reason it is right is worth stating precisely, because the request states it slightly wrong. Class order in a `class` attribute does **not** affect which rule wins — CSS resolves that by source order in the stylesheet, so `p-4 flex` and `flex p-4` render identically. What is load-bearing is the **diff**. Two sessions editing the same `className` produce a merge conflict on a line that means nothing, and a format pass reorders utilities so the real change is buried in noise. That is a collaboration cost, not a rendering one, and it is exactly the cost that grows when one agent hands a tree to another.

Timing was the part worth getting right. This landed *before* Cursor or any other agent is given a surface, so the reorder is absorbed by a commit that does nothing else. Had it landed after, the reorder would have arrived inside someone's feature diff — the precise failure the request exists to prevent.

**Changes made:**

1. `prettier-plugin-tailwindcss@^0.8.1` as a root devDependency. Root rather than `apps/web`, because Prettier resolves plugins relative to the config file and `.prettierrc.json` is at the root.
2. `.prettierrc.json` — three lines, not one:

   ```json
   "plugins": ["prettier-plugin-tailwindcss"],
   "tailwindStylesheet": "apps/web/src/design/tokens.css",
   "tailwindFunctions": ["cn", "cva"]
   ```

   - **`tailwindStylesheet` is required, not optional.** Under Tailwind v4 there is no `tailwind.config.js` to find; the theme lives in CSS. Without this the plugin sorts against stock Tailwind and treats every token in `tokens.css` — `bg-surface`, `rounded-card`, `animate-pop-in`, `pop-from-top` — as an unknown class, which it parks at the front of the list in original order. It would have appeared to work. (v0.6.11 and earlier called this `tailwindConfig`; `tailwindEntryPoint` also still resolves in 0.8.1. Use `tailwindStylesheet`.)
   - **`tailwindFunctions`** covers the 90 `cn(...)` and 9 `cva(...)` call sites. The plugin sorts JSX attributes by default and nothing else, so without this the primitives in `components/ui/` — which put almost every class inside a `cva` array — would have been the one part of the tree left unsorted.
   - No `tailwindAttributes` entry: `className` is the only class-carrying prop in the tree (448 occurrences, and no `classNames`/`containerClassName` variants), so there is nothing to add.

3. Ran `pnpm format` once, in the same commit.

**Measured, because the request's prediction was wrong in a useful direction:** "they will all be reordered" turned out to be **8 files** — `error-state.tsx` and seven primitives. shadcn's generated output is already close to canonical order, so the churn was 14 lines rather than the whole tree. Every one of the 8 changes is inert: `data-[state=unchecked]:… data-[state=checked]:…` swapping places, `min-w-40 max-h-(…)` swapping places, `select-all` moving to the end. Nothing about the rendered result changed, which is the correct outcome for a sort.

Verified: `format:check` flagged exactly those 8 and now passes; a stdin probe confirms v4 custom utilities are recognised (`text-sm p-4 flex bg-surface` → `flex bg-surface p-4 text-sm`, i.e. `bg-surface` sorted *into* the sequence rather than parked in front, which is what proves `tailwindStylesheet` resolved); and the full gate is green afterwards — 608 tests, no snapshot or class-string assertion broke.

**Anyone who must pull before continuing:** everyone, before touching a `className`. `pnpm install` is required as well as `git pull`, because the plugin is a new dependency and Prettier fails to load a config naming a plugin it cannot resolve. Symptom if you skip it: `Cannot find package 'prettier-plugin-tailwindcss'` on every `format:check`, including the one in the pre-PR gate.

**Do hand-sort nothing.** This is now the machine's job and `format:check` in CI is the enforcement. If a class ends up somewhere that reads oddly, that is the canonical order — leave it.

