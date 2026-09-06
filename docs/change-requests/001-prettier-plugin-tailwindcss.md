# CR-001 — prettier-plugin-tailwindcss

| | |
| --- | --- |
| **Raised by** | UI agent — `apps/web` foundation |
| **Status** | `open` |
| **Blocks** | nothing — worked around. Class names are not hand-sorted until this lands. |

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

