import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Badge } from './badge'

const TONES = ['neutral', 'primary', 'success', 'warning', 'info', 'danger'] as const
const VARIANTS = [...TONES, 'outline'] as const
/**
 * All four rungs, not the two that existed when this file was written.
 *
 * `chip` and `lg` were both added later — the board card's label pill and the peek
 * panel's identity chips — and neither appeared here, so the exhaustive-looking
 * `it.each` below covered half the ladder. A subset that reads as a whole is the
 * blind-spot shape `CLAUDE.md` describes: it licenses the belief that the sizes are
 * checked.
 */
const SIZES = ['sm', 'chip', 'md', 'lg'] as const

describe('Badge', () => {
  it('defaults to the neutral reading at md', async () => {
    const { container } = renderWithProviders(<Badge>warehouse</Badge>)
    const badge = screen.getByText('warehouse')
    expect(badge).toHaveAttribute('data-slot', 'badge')
    expect(badge).toHaveAttribute('data-variant', 'neutral')
    expect(badge).toHaveAttribute('data-size', 'md')
    await expectNoAxeViolations(container)
  })

  it.each(VARIANTS)('sets data-variant=%s', (variant) => {
    renderWithProviders(<Badge variant={variant}>{variant}</Badge>)
    expect(screen.getByText(variant)).toHaveAttribute('data-variant', variant)
  })

  /**
   * ### The pair, which is the part no other check can see
   *
   * `badge.tsx` claims every tone is "a measured `*-soft` / `*-soft-fg` pair rather
   * than an alpha blend" and that all six clear 4.5:1 on their own fill. Until now the
   * only thing tested was the `data-variant` attribute the test had just set, which is
   * a tautology — it would pass on a component that painted all seven variants
   * identically.
   *
   * The gap is specific, and it is worth naming precisely because
   * `design/palette.test.ts` looks like it already covers this. It does not, and the
   * two are complementary rather than overlapping:
   *
   * - **`palette.test.ts` owns token existence.** Every colour utility anywhere under
   *   `src/` must resolve to a token declared in `tokens.css` (its
   *   "colour utilities resolve to a token" block). So a typo like
   *   `bg-danger-sofr` fails there, and re-checking it here would be duplication.
   * - **This owns the pairing.** `bg-danger-soft text-success-soft-fg` passes
   *   `palette.test.ts` completely — both halves are real, declared, measured tokens.
   *   It is also unreadable, and it is exactly what a copy-pasted `cva` entry produces.
   *   A contrast ratio is a property of a *pair*, so a check that only validates the
   *   two tokens separately cannot verify the claim the file makes.
   *
   * The alpha assertion is the second half of the same sentence. `bg-danger/10` is the
   * shortcut this component exists to avoid: it composites against whatever is behind
   * it, so the same chip is one colour on `canvas` and another on `surface`, and
   * neither was the ratio anybody measured.
   */
  it.each(TONES)('paints %s as its own matching soft pair', (variant) => {
    renderWithProviders(<Badge variant={variant}>{variant}</Badge>)
    const badge = screen.getByText(variant)

    expect(badge).toHaveClass(`bg-${variant}-soft`, `text-${variant}-soft-fg`)

    /** No other tone's fill or foreground has leaked in alongside it. */
    const foreign = TONES.filter((other) => other !== variant).flatMap((other) =>
      [`bg-${other}-soft`, `text-${other}-soft-fg`].filter((cls) => badge.classList.contains(cls)),
    )
    expect(foreign).toEqual([])

    /** And the pair is opaque — no `/NN` alpha modifier on any utility. */
    expect(badge.className).not.toMatch(/\/\d/)
  })

  /**
   * `outline` is the deliberate exception: the reference's category chip is outlined
   * with no fill, so a row of them beside a filled status chip does not compete with
   * it. Asserted as an absence, because "has no background" is the whole design
   * decision and an added `bg-*` would be invisible to every other test in this file.
   */
  it('gives outline a border and no fill', () => {
    renderWithProviders(<Badge variant="outline">component</Badge>)
    const badge = screen.getByText('component')

    expect(badge).toHaveClass('border-border-strong', 'text-fg-muted')
    expect([...badge.classList].filter((cls) => cls.startsWith('bg-'))).toEqual([])
  })

  it.each(SIZES)('sets data-size=%s', (size) => {
    renderWithProviders(
      <Badge size={size} variant="info">
        In progress
      </Badge>,
    )
    expect(screen.getByText('In progress')).toHaveAttribute('data-size', size)
  })

  /**
   * The four rungs are four *boxes*, and none of them is another one restyled.
   *
   * Asserted as a set of distinct heights rather than by pinning each class, because
   * the failure worth catching is a rung that silently equals its neighbour — a
   * copy-pasted `cva` entry, or `lg` added by overriding `md`'s padding at one call
   * site. `sm` and `chip` share `h-6` by design (same box, different typography), so
   * the claim is that the *ladder* has three heights and each rung names one.
   */
  it('gives each rung its own box', () => {
    const heights: Record<string, string> = {}
    for (const size of SIZES) {
      renderWithProviders(<Badge size={size}>{size}</Badge>)
      const found = [...screen.getByText(size).classList].find((cls) => /^h-\d/.test(cls))
      expect(found, `size ${size} sets no height`).toBeDefined()
      heights[size] = found ?? ''
    }

    expect(heights['sm']).toBe(heights['chip'])
    expect(new Set(Object.values(heights)).size).toBe(3)
  })

  /**
   * `lg` is the peek panel's identity chip, measured at **44px** off `UI Images/JIRA 2`
   * — five times the area of the board's pill, because those two chips are the answer to
   * "what *is* this issue" and are read rather than scanned.
   *
   * The glyph override is the part worth pinning. The base class list pins any un-sized
   * `<svg>` to `size-3.5`, so a 14px icon beside 17px text is what this rung looks like
   * without it — and that is a defect nothing else here can see, since both classes are
   * real and `palette.test.ts` only checks colour utilities.
   */
  it('sets the panel chip at the measured 44px, with a glyph to match the text', () => {
    renderWithProviders(
      <Badge size="lg" variant="primary">
        <span data-testid="glyph-stand-in" />
        Story
      </Badge>,
    )
    const badge = screen.getByText(/Story/)

    expect(badge).toHaveClass('h-11', 'gap-2', 'px-4', 'text-md')
    /** 18px, not the base rung's 14 — the cap height of `text-md` beside it. */
    expect(badge.className).toContain('size-4.5')
    expect(badge.className).not.toContain('size-3.5')
  })

  it('renders as its child when asChild is set', () => {
    renderWithProviders(
      <Badge asChild variant="outline">
        <a href="/labels/warehouse">warehouse</a>
      </Badge>,
    )
    expect(screen.getByRole('link', { name: 'warehouse' })).toHaveAttribute('data-slot', 'badge')
  })
})
