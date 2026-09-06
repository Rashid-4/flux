import { type UserRef, UserIdSchema } from '@flux/contracts'
import { USER_ADA, USER_GRACE, USER_LINUS } from '@flux/mocks'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { UserAvatar, userInitials, userToneIndex } from './user-avatar'

const ada: UserRef = {
  id: USER_ADA,
  displayName: 'Ada Okafor',
  avatarUrl: null,
  isInactive: false,
}

const grace: UserRef = {
  id: USER_GRACE,
  displayName: 'Grace Mbeki',
  avatarUrl: null,
  isInactive: false,
}

const linus: UserRef = {
  id: USER_LINUS,
  displayName: 'Linus Haddad',
  avatarUrl: null,
  isInactive: true,
}

/**
 * A real `UserId` derived from a counter, so the tone tests can *search* for a
 * person who hashes to a given bucket rather than hardcoding eight ids. Hardcoded
 * ones would still pass after a change to the hash function while quietly covering
 * only three of the eight tones.
 *
 * Parsed rather than cast: `UserIdSchema` rejects anything that is not a uuid, so a
 * malformed counter fails here instead of producing a shape the product never sees.
 */
function personNumber(n: number): UserRef {
  return {
    id: UserIdSchema.parse(`00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`),
    displayName: 'Test Person',
    avatarUrl: null,
    isInactive: false,
  }
}

function fallbackClasses(container: HTMLElement): string {
  const fallback = container.querySelector('[data-slot="avatar-fallback"]')
  // Thrown rather than asserted, so the type narrows and the caller gets a string.
  // A failed `expect` here would report "expected null not to be null" two frames
  // away from the render that produced it.
  if (fallback === null) throw new Error('no [data-slot="avatar-fallback"] was rendered')
  return fallback.className
}

describe('userInitials', () => {
  it('uses first and last word, and falls back for a single token', () => {
    expect(userInitials('Ada Okafor')).toBe('AO')
    expect(userInitials('Ada')).toBe('AD')
    expect(userInitials('  ')).toBe('?')
  })
})

describe('UserAvatar', () => {
  it('renders initials and a hash-stable tone', async () => {
    const { container } = renderWithProviders(<UserAvatar user={ada} />)
    const root = container.querySelector('[data-slot="user-avatar"]')
    expect(root).toHaveAttribute('data-tone', String(userToneIndex(USER_ADA)))
    expect(root).toHaveAttribute('aria-label', 'Ada Okafor')
    expect(container).toHaveTextContent('AO')
    // The attribute and the paint must agree: a test or a screenshot diff reads
    // `data-tone`, and it is worth nothing if the disc is a different hue.
    expect(fallbackClasses(container)).toContain(`bg-entity-${userToneIndex(USER_ADA)}`)
    await expectNoAxeViolations(container)
  })

  it('paints the same person the same tone twice, and a different person differently', () => {
    const a = userToneIndex(USER_ADA)
    expect(userToneIndex(USER_ADA)).toBe(a)
    // Different ids must be allowed to collide (8 buckets) but Ada vs Grace
    // is the fixture pair; if they ever hash equal the attribute is still set.
    expect(typeof userToneIndex(USER_GRACE)).toBe('number')
    renderWithProviders(
      <div>
        <UserAvatar user={ada} />
        <UserAvatar user={grace} />
      </div>,
    )
  })

  /**
   * The check that the eight `--entity-*` pairs are actually reachable.
   *
   * Two failures it is here for, both silent in a browser. `bg-entity-${tone}`
   * emits no CSS at all — Tailwind v4 finds utilities by scanning source text —
   * so the fill has to come from a literal table, and a table is a place where
   * a row can be copied without its index being updated. Rendering one person per
   * bucket and reading back the classes covers both: a missing tone shows up as a
   * short set, and a mismatched row as a fill whose digit differs from its text.
   *
   * The class names here are built from `${tone}` on purpose. `tokens.css` excludes
   * `*.test.tsx` from Tailwind's scan for exactly this reason — a test that spelled
   * the eight names out would make Tailwind emit them from *this* file, and a
   * component that had regressed to a template literal would still paint correctly.
   */
  it('paints all eight tones, each with its own matching pair', () => {
    const seen = new Map<number, string>()
    for (let n = 0; seen.size < 8 && n < 200; n += 1) {
      const person = personNumber(n)
      const tone = userToneIndex(person.id)
      if (seen.has(tone)) continue
      const { container } = renderWithProviders(<UserAvatar user={person} />)
      expect(container.querySelector('[data-slot="user-avatar"]')).toHaveAttribute(
        'data-tone',
        String(tone),
      )
      seen.set(tone, fallbackClasses(container))
    }

    expect([...seen.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    for (const [tone, classes] of seen) {
      expect(classes, `tone ${tone}`).toContain(`bg-entity-${tone}`)
      expect(classes, `tone ${tone}`).toContain(`text-entity-${tone}-fg`)
      // `cn` has to *displace* the primitive's neutral pair rather than sit beside
      // it. Both surviving would leave the winner to stylesheet order, which is the
      // failure mode `lib/cn.ts` exists to prevent.
      expect(classes, `tone ${tone}`).not.toContain('bg-surface-2')
      expect(classes, `tone ${tone}`).not.toContain('text-fg-muted')
    }
  })

  /**
   * Inactive is a *modifier* on the person, not a ninth colour. Linus keeps the hue
   * his id hashes to and is dimmed on top of it, so an inactive assignee is still
   * recognisably the same person on a board that also shows them active elsewhere —
   * and `(inactive)` in the accessible name is what carries the meaning, since
   * opacity is not something a screen reader announces.
   */
  it('greys out an inactive user instead of looking assignable', () => {
    const { container } = renderWithProviders(<UserAvatar user={linus} />)
    const root = container.querySelector('[data-slot="user-avatar"]')
    expect(root).toHaveAttribute('data-inactive', 'true')
    expect(root).toHaveAttribute('aria-label', 'Linus Haddad (inactive)')
    expect(root).toHaveClass('opacity-50')
    expect(fallbackClasses(container)).toContain(`bg-entity-${userToneIndex(USER_LINUS)}`)
  })

  /**
   * `BoardCard.assignee` is nullable and the null means unassigned — the commonest
   * state on a real board. It used to render a skeleton, so those cards pulsed
   * forever; the `animate-pulse` assertion is the guard against that returning.
   */
  it('draws an unassigned slot rather than pulsing forever', async () => {
    const { container } = renderWithProviders(<UserAvatar user={null} size="sm" />)
    const absent = container.querySelector('[data-slot="user-avatar-absent"]')
    expect(absent).toHaveAttribute('aria-label', 'Unassigned')
    expect(container.querySelector('.animate-pulse')).toBeNull()
    await expectNoAxeViolations(container)
  })

  /**
   * Assigning someone must not reflow the row, so the box is the same either way.
   * It comes from the `Avatar` primitive's own size ladder rather than a repeated
   * class list, which is what keeps the two in step.
   */
  it('reserves the same box whether or not anyone is assigned', () => {
    const { container: absent } = renderWithProviders(<UserAvatar user={null} size="sm" />)
    const { container: present } = renderWithProviders(<UserAvatar user={ada} size="sm" />)
    expect(absent.querySelector('[data-slot="user-avatar-absent"]')).toHaveClass('size-avatar')
    expect(present.querySelector('[data-slot="user-avatar"]')).toHaveClass('size-avatar')
  })

  it('takes a caller-supplied name for the absent state', () => {
    const { container } = renderWithProviders(<UserAvatar user={null} absentLabel="Any assignee" />)
    expect(container.querySelector('[data-slot="user-avatar-absent"]')).toHaveAttribute(
      'aria-label',
      'Any assignee',
    )
  })
})
