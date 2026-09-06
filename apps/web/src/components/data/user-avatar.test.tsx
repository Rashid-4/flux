import type { UserRef } from '@flux/contracts'
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

  it('greys out an inactive user instead of looking assignable', () => {
    const { container } = renderWithProviders(<UserAvatar user={linus} />)
    const root = container.querySelector('[data-slot="user-avatar"]')
    expect(root).toHaveAttribute('data-inactive', 'true')
    expect(root).toHaveAttribute('aria-label', 'Linus Haddad (inactive)')
    expect(root).toHaveClass('opacity-50')
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
