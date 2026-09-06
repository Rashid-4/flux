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
 * `IssueType.key` is **not** a closed enum — it is `/^[a-z][a-z0-9_]{0,30}$/`,
 * and `BoardCard.issueTypeKey` is a plain string (the mock board uses `BUG`).
 * Mapping only the keys this product ships with, plus a fallback, is the
 * honest shape: a tenant-defined type must still render, it just does not get
 * a custom glyph until someone adds one here.
 *
 * Icons are named imports, not `lucide-react[name]`. A string-to-module map
 * ships the whole set; AGENTS.md's Lucide rule exists to stop that.
 *
 * ### The key is required, because an issue always has a type
 *
 * `BoardCardSchema.issueTypeKey` is `z.string()`, not nullable. This prop used to
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
}

export function TypeIcon({ issueTypeKey, name, className }: TypeIconProps) {
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
      <Icon aria-hidden="true" className="size-3.5 text-fg-muted" />
    </span>
  )
}
