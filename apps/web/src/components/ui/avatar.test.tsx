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
 * `AvatarImage` requires `alt` at the type level — Radix types it optional because
 * `<img>` does, and `jsx-a11y/alt-text` matches `img`, not `AvatarPrimitive.Image`.
 * The person's name *is* the alt text, so a missing one is a real defect and `tsc` is
 * the only tool positioned to catch it.
 *
 * This header used to end "the runtime assertion is that the attribute actually
 * reaches the image", and there was no such assertion — there cannot be. Radix mounts
 * the `<img>` only after the image loads, jsdom never loads one, so the element does
 * not exist to be queried. The test below said so in an inline comment while the
 * header above it claimed the opposite, which is the worse half: a doc comment
 * describing coverage that does not exist is read as evidence and costs more than
 * silence.
 *
 * So the pin is now a real one, in the direction that can actually be checked. A
 * positive test ("this file compiles with `alt` present") is worth very little,
 * because it also passes when `alt` is optional. What needs pinning is that omitting
 * it **fails**, and `@ts-expect-error` inverts the check: if `alt` ever stops being
 * required, the suppression becomes unused and `tsc` reports TS2578 on that line.
 *
 * That pin only works because `tsconfig.json` includes the test files. It did not
 * until the 117-phantom-error fix — this file belonged to no project a language
 * server could find, and a `@ts-expect-error` here would have been checked by
 * nothing at all. See that config's header.
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

  it('names the person via the fallback while the image has not loaded', () => {
    const { container } = renderWithProviders(
      <Avatar>
        <AvatarImage src="https://avatars.example/ada.png" alt="Ada Okafor" />
        <AvatarFallback>AO</AvatarFallback>
      </Avatar>,
    )
    /**
     * The `<img>` is genuinely absent, not merely unasserted — Radix mounts it on
     * load and jsdom never loads. Asserting that directly is what keeps the next
     * reader from adding a `toHaveAttribute('alt', …)` that can only ever fail.
     */
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[data-slot="avatar-fallback"]')).toHaveTextContent('AO')
  })

  /**
   * The type-level half, and the only one that can fail if `alt` is loosened. `tsc`
   * reports TS2578 ("unused '@ts-expect-error' directive") the moment the line below
   * compiles cleanly, so `pnpm typecheck` is what enforces the requirement and this
   * test body only exists to keep the JSX in a position the compiler visits.
   */
  it('will not compile an AvatarImage without alt', () => {
    const { container } = renderWithProviders(
      <Avatar>
        {/* @ts-expect-error alt is required on AvatarImage; omitting it must not compile. */}
        <AvatarImage src="https://avatars.example/ada.png" />
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
