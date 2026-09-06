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
import { Skeleton } from '@/components/ui/skeleton'
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
  issueTypeKey: string | null
  /** The type's display name, when the caller has it. Otherwise the key. */
  name?: string | undefined
  className?: string | undefined
}

export function TypeIcon({ issueTypeKey, name, className }: TypeIconProps) {
  if (issueTypeKey === null) {
    return (
      <Skeleton data-slot="type-icon-skeleton" className={cn('size-3.5 rounded-sm', className)} />
    )
  }

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
