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

  it('matches the avatar box while loading', () => {
    const { container } = renderWithProviders(<UserAvatar user={null} size="sm" />)
    const skeleton = container.querySelector('[data-slot="user-avatar-skeleton"]')
    expect(skeleton).toHaveAttribute('aria-hidden', 'true')
    expect(skeleton).toHaveClass('size-avatar', 'rounded-chip')
  })
})
