import {
  Bookmark,
  Bug,
  CircleDot,
  Hexagon,
  Layers,
  ListTree,
  Milestone,
  SquareCheck,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/cn'

/**
 * An issue type's glyph.
 *
 * `IssueTypeKeySchema` is **not** a closed enum — it is
 * `/^[a-z][a-z0-9_]{0,30}$/`, and the values are tenant-defined. Mapping only
 * the keys this product ships with, plus a fallback, is the honest shape: a
 * tenant-defined type must still render, it just does not get a custom glyph
 * until someone adds one here.
 *
 * The `.toLowerCase()` below is now belt-and-braces rather than load-bearing.
 * It was load-bearing: `BoardCardSchema.issueTypeKey` was `z.string()` and the
 * mock board shipped `BUG`, so the map lookup missed and every bug card fell
 * through to the generic glyph. CR-006 gave the field its schema, the pattern
 * is lower-case only, and the fixture was corrected. Keep the call: the prop is
 * still typed `string`, so a hand-written call site can pass anything, and a
 * case fold is cheaper than a wrong icon.
 *
 * Icons are named imports, not `lucide-react[name]`. A string-to-module map
 * ships the whole set; AGENTS.md's Lucide rule exists to stop that.
 *
 * ### The key is required, because an issue always has a type
 *
 * `BoardCardSchema.issueTypeKey` is `IssueTypeKeySchema`, not nullable. This prop used to
 * accept `null` and render a `Skeleton` for it, which gave one value a meaning the
 * contract does not have — and the same `null` means *absent* in
 * `./relative-time.tsx`, `./user-avatar.tsx` and `./priority-icon.tsx`, where the
 * contract genuinely is nullable. See `./status-chip.tsx` for the full reasoning;
 * loading is composed by the caller in the shape of what is loading.
 */
const KNOWN: Record<string, { label: string; Icon: ComponentType<{ className?: string }> }> = {
  bug: { label: 'Bug', Icon: Bug },
  story: { label: 'Story', Icon: Bookmark },
  task: { label: 'Task', Icon: SquareCheck },
  subtask: { label: 'Subtask', Icon: ListTree },
  epic: { label: 'Epic', Icon: Layers },
  initiative: { label: 'Initiative', Icon: Milestone },
  theme: { label: 'Theme', Icon: Hexagon },
}

export interface TypeIconProps {
  issueTypeKey: string
  /** The type's display name, when the caller has it. Otherwise the key. */
  name?: string | undefined
  className?: string | undefined
  /**
   * The glyph's own classes, when 14px in `--color-fg-muted` is not the right reading.
   *
   * A second `className` is a smell and it is the right shape here, because the two
   * boxes are genuinely different: the outer `<span>` is the accessible image and the
   * thing a caller positions, and the `<svg>` inside it is the ink. `className` can
   * never reach the ink, since the size and colour below are set *on* the glyph and
   * `cn` resolves conflicts within one class list rather than across a boundary.
   *
   * The alternative — a `size` prop with two or three named rungs — was rejected
   * because the callers do not agree on colour either. `board/board-card.tsx` wants
   * the muted 14px default; `issue/issue-peek-panel.tsx` draws a 116px hero circle
   * with a 48px glyph in the full foreground; the issue page's own header wants 24px.
   * That is a ladder that grows a rung per surface, and every rung would restate a
   * size and a colour that Tailwind already spells.
   *
   * What must **not** move out to the caller is the map above. A surface needing a
   * bigger bug glyph reaches for `Bug` from lucide directly the moment this prop does
   * not exist, and then the type→icon vocabulary lives in two places — §31.
   */
  glyphClassName?: string | undefined
}

export function TypeIcon({ issueTypeKey, name, className, glyphClassName }: TypeIconProps) {
  const reading = KNOWN[issueTypeKey.toLowerCase()] ?? {
    label: name ?? issueTypeKey,
    Icon: CircleDot,
  }
  const Icon = reading.Icon
  const label = name ?? reading.label

  return (
    <span
      data-slot="type-icon"
      data-issue-type={issueTypeKey}
      role="img"
      aria-label={label}
      title={label}
      className={cn('inline-flex', className)}
    >
      <Icon aria-hidden="true" className={cn('size-3.5 text-fg-muted', glyphClassName)} />
    </span>
  )
}
