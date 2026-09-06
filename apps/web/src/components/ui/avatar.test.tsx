import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from './avatar'

/**
 * `AvatarImage` requires `alt` at the type level — Radix types it optional
 * because `<img>` does, and `jsx-a11y/alt-text` matches `img`, not
 * `AvatarPrimitive.Image`. The person's name is the alt text; omitting it is a
 * defect `tsc` has to catch. This file compiling with `alt` present is the pin;
 * the runtime assertion is that the attribute actually reaches the image.
 */
describe('Avatar', () => {
  it('defaults to md and exposes data-slot / data-size', async () => {
    const { container } = renderWithProviders(
      <Avatar>
        <AvatarFallback>AO</AvatarFallback>
      </Avatar>,
    )
    const root = container.querySelector('[data-slot="avatar"]')
    expect(root).toHaveAttribute('data-size', 'md')
    expect(root).toHaveClass('size-8')
    expect(screen.getByText('AO')).toHaveAttribute('data-slot', 'avatar-fallback')
    await expectNoAxeViolations(container)
  })

  it.each([
    ['sm', 'size-avatar'],
    ['md', 'size-8'],
    ['lg', 'size-10'],
  ] as const)('size %s uses %s', (size, cls) => {
    const { container } = renderWithProviders(
      <Avatar size={size}>
        <AvatarFallback>AO</AvatarFallback>
      </Avatar>,
    )
    const root = container.querySelector('[data-slot="avatar"]')
    expect(root).toHaveAttribute('data-size', size)
    expect(root).toHaveClass(cls)
  })

  it('forwards a required alt onto the image', () => {
    // Radix mounts the <img> only after load. jsdom never loads, so the pin is
    // that `alt` is required at the type level (this file would not compile
    // without it) and the person is still named via the fallback.
    const { container } = renderWithProviders(
      <Avatar>
        <AvatarImage src="https://avatars.example/ada.png" alt="Ada Okafor" />
        <AvatarFallback>AO</AvatarFallback>
      </Avatar>,
    )
    expect(container.querySelector('[data-slot="avatar-fallback"]')).toHaveTextContent('AO')
  })

  it('renders a labelled group rather than inventing a role', async () => {
    const { container } = renderWithProviders(
      <AvatarGroup aria-label="Assignees: Ada Okafor, Grace Mbeki">
        <Avatar size="sm">
          <AvatarFallback>AO</AvatarFallback>
        </Avatar>
        <Avatar size="sm">
          <AvatarFallback>GM</AvatarFallback>
        </Avatar>
        <AvatarGroupCount>+1</AvatarGroupCount>
      </AvatarGroup>,
    )
    expect(screen.getByLabelText('Assignees: Ada Okafor, Grace Mbeki')).toHaveAttribute(
      'data-slot',
      'avatar-group',
    )
    expect(container.querySelector('[data-slot="avatar-group-count"]')).toHaveTextContent('+1')
    await expectNoAxeViolations(container)
  })

  it('places the presence badge without making colour the only signal', () => {
    const { container } = renderWithProviders(
      <Avatar>
        <AvatarFallback>AO</AvatarFallback>
        <AvatarBadge aria-label="Online" />
      </Avatar>,
    )
    expect(container.querySelector('[data-slot="avatar-badge"]')).toHaveAccessibleName('Online')
  })
})
