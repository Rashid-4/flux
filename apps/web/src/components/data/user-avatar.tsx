import type { UserRef } from '@flux/contracts'
import { UserRound } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/cn'

/**
 * A person, as the product renders them.
 *
 * The primitive in `ui/avatar` is a box. This is the person: initials from
 * `displayName`, a hash-stable tone that colours the disc, and a greyed treatment
 * when `UserRef.isInactive` — Linus, the fixture for "assigned to someone who
 * left". Inactive is `opacity-50` over the person's own hue rather than a ninth
 * colour, so a departed assignee still reads as the same person.
 *
 * ### Eight measured hues, written out one at a time
 *
 * `tokens.css` declares eight `--entity-*` fill and foreground pairs — every one
 * measured in both themes, 6.19:1 in light and 6.75:1 or better in dark, and
 * checked on every test run by `design/contrast.test.ts`. `data-tone` stays on the
 * element beside the class, because it is what a test and a screenshot diff read,
 * and neither should have to parse a class list to find out who is who.
 *
 * The pairs are spelled out in `TONE_CLASSES` because `bg-entity-${tone}` produces
 * no CSS at all. Tailwind v4 finds utilities by scanning source text, so a class
 * that only exists once a template literal has run is a class it never sees: the
 * disc would paint with no background, silently, in the one state — a user whose
 * avatar image is missing — that no build step can fail on. `TONE_COUNT` is that
 * table's length rather than a second `8`, so the hash cannot address a tone the
 * table does not have. See docs/change-requests/004-entity-colour-palette.md for
 * why the palette is indices rather than names.
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
const TONE_CLASSES = [
  'bg-entity-0 text-entity-0-fg',
  'bg-entity-1 text-entity-1-fg',
  'bg-entity-2 text-entity-2-fg',
  'bg-entity-3 text-entity-3-fg',
  'bg-entity-4 text-entity-4-fg',
  'bg-entity-5 text-entity-5-fg',
  'bg-entity-6 text-entity-6-fg',
  'bg-entity-7 text-entity-7-fg',
] as const

const TONE_COUNT = TONE_CLASSES.length

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
  /**
   * The caller draws the person's name in visible text beside this, so the disc is
   * `aria-hidden` instead of a second announcement of it.
   *
   * `role="img"` labelled with the name is right where the disc stands alone — a board
   * card, an avatar stack, a comment bubble — and wrong the moment the name is also on
   * screen: a screen reader then says "Ada Okafor, Ada Okafor", which is precisely the
   * visible-label-plus-`sr-only`-copy that ../error-state.tsx argues against. In that
   * pairing the initials and the tone are decoration and the text is the content.
   *
   * It is a prop rather than the caller wrapping this in an `aria-hidden` span because
   * the *absent* branch has a label too, and "Unassigned" announced twice is the same
   * defect for the row that has no person in it at all.
   */
  decorative?: boolean | undefined
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
  decorative = false,
  className,
}: UserAvatarProps) {
  /**
   * One helper for both branches, so the decorative case cannot be right for an
   * assigned avatar and forgotten for an unassigned one.
   *
   * `title` travels with the label, which also closes a gap: the absent branch carried
   * one and the assigned branch did not, so a board of initials discs had no tooltip on
   * the only avatars whose name is not obvious from context. And in the decorative
   * pairing it goes away with the label — a tooltip repeating text six pixels to its
   * right is noise for a mouse user in the same way the duplicate is for a screen reader.
   */
  const naming = (label: string) =>
    decorative
      ? ({ 'aria-hidden': true } as const)
      : ({ role: 'img', 'aria-label': label, title: label } as const)

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
        {...naming(absentLabel)}
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
      {...naming(label)}
      className={cn(user.isInactive && 'opacity-50', className)}
    >
      {user.avatarUrl !== null && <AvatarImage src={user.avatarUrl} alt={user.displayName} />}
      <AvatarFallback aria-hidden="true" className={TONE_CLASSES[tone]}>
        {initials}
      </AvatarFallback>
    </Avatar>
  )
}
