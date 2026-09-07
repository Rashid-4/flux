import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { LabelChip } from './label-chip'

describe('LabelChip', () => {
  /**
   * Filled and hue-coded, not outlined. It was outlined, on the reasoning that a
   * row of labels should not compete with the status chip — sound in the abstract,
   * and wrong against `UI Images/JIRA 1` and `JIRA 2`, where saturated pills across
   * the top of a card are the loudest thing on the board and most of what makes it
   * recognisable. The competition worry is answered by the board card putting
   * status on a different row instead.
   */
  it('renders a filled chip in one of the measured entity hues', async () => {
    const { container } = renderWithProviders(<LabelChip label="warehouse" />)
    const chip = screen.getByText('warehouse').closest('[data-slot="label-chip"]')

    const tone = chip?.getAttribute('data-tone')
    expect(tone).not.toBeNull()
    expect(Number(tone)).toBeGreaterThanOrEqual(0)
    expect(Number(tone)).toBeLessThan(8)
    /** The fill and its measured foreground travel together, or the text is unreadable. */
    expect(chip).toHaveClass(`bg-entity-${String(tone)}`)
    expect(chip).toHaveClass(`text-entity-${String(tone)}-fg`)

    await expectNoAxeViolations(container)
  })

  /**
   * The hue is an identity, so it has to be stable: the same label is the same
   * colour on every board, on every machine. Hashed rather than stored, because
   * `BoardCardSchema.labels` is `z.array(z.string())` and carries no colour.
   */
  it('gives the same label the same hue every time, and different labels differ', () => {
    const first = renderWithProviders(<LabelChip label="warehouse" />)
    const toneA = first.container
      .querySelector('[data-slot="label-chip"]')
      ?.getAttribute('data-tone')
    first.unmount()

    const second = renderWithProviders(<LabelChip label="warehouse" />)
    expect(
      second.container.querySelector('[data-slot="label-chip"]')?.getAttribute('data-tone'),
    ).toBe(toneA)
    second.unmount()

    const tones = new Set(
      ['warehouse', 'hardware', 'offline', 'data-integrity', 'billing', 'urgent'].map((label) => {
        const view = renderWithProviders(<LabelChip label={label} />)
        const tone = view.container
          .querySelector('[data-slot="label-chip"]')
          ?.getAttribute('data-tone')
        view.unmount()
        return tone
      }),
    )
    /** Collisions are fine at eight hues; all six landing on one would not be. */
    expect(tones.size).toBeGreaterThan(1)
  })

  it('truncates a long label and keeps the full value for hover', () => {
    const long = 'needs-warehouse-scanner-firmware-confirmation-before-rollout'
    renderWithProviders(<LabelChip label={long} />)
    const chip = screen.getByText(long).closest('[data-slot="label-chip"]')
    expect(chip).toHaveAttribute('title', long)
    expect(screen.getByText(long)).toHaveClass('truncate')
  })

  /**
   * A stray `''` in `BoardCard.labels` would otherwise draw an empty outlined pill
   * that cannot be read or clicked. There is no null case: the array's elements are
   * `z.string()`, and an empty array simply renders no chips.
   */
  it('renders nothing for an empty label', () => {
    const { container } = renderWithProviders(<LabelChip label="" />)
    expect(container.querySelector('[data-slot="label-chip"]')).toBeNull()
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })
})
