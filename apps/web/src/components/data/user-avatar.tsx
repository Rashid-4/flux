import type { UserRef } from '@flux/contracts'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
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
 */
const TONE_COUNT = 8

export type UserAvatarSize = 'sm' | 'md' | 'lg'

export interface UserAvatarProps {
  user: UserRef | null
  size?: UserAvatarSize | undefined
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

export function UserAvatar({ user, size = 'md', className }: UserAvatarProps) {
  if (user === null) {
    return (
      <Skeleton
        data-slot="user-avatar-skeleton"
        className={cn(
          'rounded-chip',
          size === 'sm' && 'size-avatar',
          size === 'md' && 'size-8',
          size === 'lg' && 'size-10',
          className,
        )}
      />
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
