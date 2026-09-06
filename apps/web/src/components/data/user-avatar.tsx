import type { UserRef } from '@flux/contracts'
import { UserRound } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/cn'

/**
 * A person, as the product renders them.
 *
 * The primitive in `ui/avatar` is a box. This is the person: initials from
 * `displayName`, a hash-stable `data-tone` so a later palette can colour them
 * without a layout shift, and a greyed treatment when `UserRef.isInactive` —
 * Linus, the fixture for "assigned to someone who left".
 *
 * There is no per-user hue token yet (`tokens.css` deletes Tailwind's default
 * palette on purpose). Shipping invented hex here would fail lint and, worse,
 * paint eight unmeasured pairs. So every tone currently shares `surface-2` /
 * `fg-muted` (7.41:1 / 6.97:1) and the attribute is the stable contract; the
 * palette itself is docs/change-requests/004-entity-colour-palette.md.
 *
 * ### `null` is unassigned, and never "loading"
 *
 * `BoardCardSchema.assignee` is `.nullable()`, and what that null means in the
 * contract is *nobody is assigned* — the most common state on a real board. So a
 * caller writes `<UserAvatar user={card.assignee} />` and the null flows straight
 * through, which is the whole point of matching the contract's nullability.
 *
 * This used to render a `Skeleton` for null, and that made unassigned issues pulse
 * forever: an animation that promises data which is never going to arrive, on the
 * majority of cards. Loading belongs to whoever knows a request is in flight, and
 * that is never this component — `routes/shell.tsx` and `shell/shell-skeleton.tsx`
 * are the pattern, a composed placeholder in the shape of the content it stands in
 * for, which is what `docs/specs/web/README.md` §11 asks for. Eight independent
 * pulsing rectangles per card is not that shape.
 *
 * Unassigned is therefore a designed state rather than a fallback: a dashed ring
 * around an empty silhouette, which reads as a slot waiting to be filled rather
 * than as a person whose name failed to load. It keeps the box the same size, so
 * assigning someone does not reflow the row.
 */
const TONE_COUNT = 8

export type UserAvatarSize = 'sm' | 'md' | 'lg'

export interface UserAvatarProps {
  /** The assignee, or `null` for unassigned. Never a loading sentinel. */
  user: UserRef | null
  size?: UserAvatarSize | undefined
  /**
   * What an absent user is called here. "Unassigned" is right on an issue; a
   * reporter or a comment author is never absent, and a filter row wants
   * "Any assignee". It is the accessible name, so it is never left to a default
   * that would be wrong in two of those three places.
   */
  absentLabel?: string | undefined
  className?: string | undefined
}

export function userInitials(displayName: string): string {
  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
  const first = parts[0]
  if (first === undefined) return '?'
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined
  if (last === undefined) return first.slice(0, 2).toUpperCase()
  const a = first[0]
  const b = last[0]
  if (a === undefined || b === undefined) return first.slice(0, 2).toUpperCase()
  return (a + b).toUpperCase()
}

/**
 * Stable across sessions and across machines: the same `UserId` always hashes
 * to the same bucket. Not cryptographic — it is a paint index.
 */
export function userToneIndex(userId: string): number {
  let hash = 0
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + (userId.charCodeAt(i) ?? 0)) | 0
  }
  return Math.abs(hash) % TONE_COUNT
}

export function UserAvatar({
  user,
  size = 'md',
  absentLabel = 'Unassigned',
  className,
}: UserAvatarProps) {
  if (user === null) {
    return (
      /**
       * The real `Avatar`, not a hand-rolled box. It owns the size ladder
       * (`size-avatar` / `size-8` / `size-10`) and the fallback surface, so the
       * unassigned state cannot drift out of alignment with the assigned one — the
       * previous branch repeated those three classes and would have.
       */
      <Avatar
        size={size}
        data-slot="user-avatar-absent"
        role="img"
        aria-label={absentLabel}
        title={absentLabel}
        className={className}
      >
        <AvatarFallback
          aria-hidden="true"
          className="border border-dashed border-border-strong bg-transparent text-fg-subtle"
        >
          <UserRound
            className={cn('size-3.5', size === 'md' && 'size-4', size === 'lg' && 'size-5')}
          />
        </AvatarFallback>
      </Avatar>
    )
  }

  const initials = userInitials(user.displayName)
  const tone = userToneIndex(user.id)
  const label = user.isInactive ? `${user.displayName} (inactive)` : user.displayName

  return (
    <Avatar
      size={size}
      data-slot="user-avatar"
      data-tone={String(tone)}
      data-inactive={user.isInactive ? 'true' : undefined}
      role="img"
      aria-label={label}
      className={cn(user.isInactive && 'opacity-50', className)}
    >
      {user.avatarUrl !== null && <AvatarImage src={user.avatarUrl} alt={user.displayName} />}
      <AvatarFallback aria-hidden="true">{initials}</AvatarFallback>
    </Avatar>
  )
}
