import type { Bootstrap } from '@flux/contracts'
import { Check, Lock } from 'lucide-react'
import { useId } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/cn'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Who you are signed in as, and which organization you are in.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ### A popover, not a dropdown menu
 *
 * Everything in here is information: a name, an email, a job title, a list of
 * organizations. `DropdownMenu` would give all of it `role="menuitem"`, which tells
 * a screen-reader user that each line is a command they can run — and then nothing
 * happens when they press Enter on their own email address. A menu with no commands
 * in it is a lie about the shape of the UI, and Radix has the right primitive for
 * this one already.
 *
 * ### The org list is read-only, and says so
 *
 * `docs/change-requests/003-organization-selection-mechanism.md` is open: `request.ts`
 * sends **no** organization identifier, so the server decides the active org from the
 * session and the client has no way to change it. Rendering a switcher that appears
 * to work would be the exact failure in docs/product-quality-bar.md §13 — *"a
 * control that silently does nothing is worse than one that says why it cannot."*
 *
 * So the other orgs are listed, visibly inert, with **one** sentence under the list
 * explaining why. One sentence and not a tooltip per row, for a mechanical reason as
 * well as a copy one: a tooltip needs a hoverable trigger, and a control disabled
 * with `pointer-events-none` fires no pointer events at all — the tooltip would
 * simply never appear for exactly the rows that need it. They are `<li>` elements
 * rather than disabled buttons, which is the honest markup: there is no control here
 * to disable.
 *
 * ### No sign-out
 *
 * There is no auth surface yet — no sign-in page, no session endpoint the client may
 * call. A "Sign out" item would either do nothing or drop the user somewhere that
 * does not exist. It arrives with `docs/specs/web/auth.md`, and until then its
 * absence is the honest state.
 */

/**
 * One or two letters for the avatar fallback.
 *
 * Local and deliberately minimal. `components/data/UserAvatar` is the component that
 * will own this properly — with the initials rule, the per-user colour and the
 * presence dot — and it is being built in parallel; a shared helper written here
 * would be a shared helper written twice. When it lands, this block becomes
 * `<UserAvatar user={user} size="lg" />` and the function goes.
 */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const first = words[0]?.slice(0, 1) ?? ''
  const last = words.length > 1 ? (words[words.length - 1]?.slice(0, 1) ?? '') : ''
  return (first + last).toLocaleUpperCase()
}

export interface AccountPopoverProps {
  bootstrap: Bootstrap
}

export function AccountPopover({ bootstrap }: AccountPopoverProps) {
  const { user, organization, membership, organizations } = bootstrap
  const titleId = useId()

  /**
   * The org-specific name wins. `OrgMembershipSchema.displayNameOverride` exists so a
   * contractor can appear as "Ada (Northwind)" in one org and "Ada Okafor" in
   * another; showing the account-level name here would contradict the name on every
   * issue they touch.
   */
  const name = membership.displayNameOverride ?? user.displayName
  const others = organizations.filter((entry) => entry.id !== organization.id)

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/**
         * No tooltip, for the reason ./theme-menu.tsx gives: Radix's tooltip and
         * popover both take over the trigger, and the tooltip lingers behind the
         * open panel. The `aria-label` carries the name, which is what a tooltip
         * could never do anyway.
         */}
        <Button variant="ghost" size="icon" aria-label={`Account: ${name}`}>
          <Avatar size="sm">
            {user.avatarUrl !== null && <AvatarImage src={user.avatarUrl} alt="" />}
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
        </Button>
      </PopoverTrigger>

      {/**
       * `aria-labelledby` and not `aria-label`. Radix gives the content
       * `role="dialog"`, and ../ui/popover.tsx is explicit that naming it is the
       * caller's job and not optional — an unnamed dialog is announced as "dialog"
       * and nothing else. Pointing at the visible title means the name a screen
       * reader reads is the name on the screen, which cannot drift out of sync the
       * way a duplicated string would.
       */}
      <PopoverContent side="right" align="end" aria-labelledby={titleId} className="w-72">
        <div className="flex items-start gap-3">
          <Avatar size="lg">
            {user.avatarUrl !== null && <AvatarImage src={user.avatarUrl} alt="" />}
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <PopoverTitle id={titleId} className="truncate text-md font-medium text-fg">
              {name}
            </PopoverTitle>
            {/**
             * `break-all` on the email and not `truncate`. An address is an
             * identifier someone may need to read in full to confirm which account
             * they are in, and a truncated one hides the part that distinguishes
             * `ada@northwind.example` from `ada@northwind-staging.example`.
             */}
            <p className="text-sm break-all text-fg-muted">{user.email}</p>
            {membership.jobTitle !== null && (
              <p className="mt-0.5 truncate text-sm text-fg-subtle">{membership.jobTitle}</p>
            )}
          </div>
        </div>

        <Separator className="my-3" />

        <div className="flex items-center justify-between gap-2">
          <p className="text-2xs text-fg-subtle">Organization</p>
          <Badge variant="neutral" size="sm">
            {membership.role}
          </Badge>
        </div>

        <ul className="mt-1.5 flex flex-col gap-0.5">
          <OrgRow name={organization.name} slug={organization.slug} current />
          {others.map((entry) => (
            <OrgRow key={entry.id} name={entry.name} slug={entry.slug} current={false} />
          ))}
        </ul>

        {others.length > 0 && (
          <p className="mt-2 text-sm text-fg-subtle">
            Switching organization is not available yet. Sign in again to reach a different
            organization.
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface OrgRowProps {
  name: string
  slug: string
  current: boolean
}

/**
 * `<li>`, not a button. There is nothing to press — see the header.
 *
 * The current org is marked three ways, because none of the three works alone: a
 * tick (invisible to a screen reader on its own), the word "Current" (which is what
 * the tick is for sighted users), and a stronger text colour. §9's rule that colour
 * is never the only carrier of meaning applies to weight and to iconography just as
 * much.
 */
function OrgRow({ name, slug, current }: OrgRowProps) {
  return (
    <li
      className={cn(
        'flex h-row items-center gap-2 rounded-control px-2 text-base',
        current ? 'bg-surface-2 text-fg' : 'text-fg-subtle',
      )}
    >
      {current ? (
        <Check aria-hidden="true" className="size-3.5 shrink-0 text-primary-accent" />
      ) : (
        <Lock aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      <span className="truncate">{name}</span>
      <span className="ml-auto shrink-0 font-mono text-sm text-fg-subtle">{slug}</span>
      {current && <span className="sr-only">Current organization</span>}
    </li>
  )
}
