import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Input } from './input'
import { Label } from './label'

describe('Input', () => {
  it('renders a labelled 32px field on the shared control ladder', async () => {
    const { container } = renderWithProviders(
      <div>
        <Label htmlFor="summary">Summary</Label>
        <Input id="summary" placeholder="Warehouse scanner drops…" />
      </div>,
    )
    const input = screen.getByLabelText('Summary')
    expect(input).toHaveAttribute('data-slot', 'input')
    expect(input).toHaveClass('h-8')
    expect(input).toHaveClass('w-full')
    expect(input).toHaveClass('border-border-control')
    await expectNoAxeViolations(container)
  })

  /**
   * The rung that did not exist. README §3 promises button, input and select
   * trigger agree at each size "without per-component nudging", and until this
   * variant landed the only way to build the reference's 28px filter bar was
   * `className="h-7 text-sm"` at every call site — a local override of a shared
   * component, repeated, which is how a design system stops being one.
   *
   * Asserted through `data-size` as well as the class, because the attribute is
   * what a screenshot diff and a devtools inspection read.
   */
  it('reaches the 28px rung through a variant rather than a call-site override', () => {
    renderWithProviders(<Input size="sm" aria-label="Filter" />)
    const input = screen.getByLabelText('Filter')
    expect(input).toHaveAttribute('data-size', 'sm')
    expect(input).toHaveClass('h-7')
    expect(input).toHaveClass('text-sm')
    expect(input).not.toHaveClass('h-8')
  })

  it('defaults to the 32px rung', () => {
    renderWithProviders(<Input aria-label="Summary" />)
    expect(screen.getByLabelText('Summary')).toHaveAttribute('data-size', 'default')
  })

  /**
   * `size` is a native `<input>` attribute typed `number`, and the variant prop
   * shadows it. The `Omit` in the component's props is what makes that a compile
   * error rather than a silent conflict, and this pins the merge behaviour a
   * caller actually relies on: their `className` still wins over the variant.
   */
  it('lets a caller override the variant height through className', () => {
    renderWithProviders(<Input size="sm" className="h-10" aria-label="Tall" />)
    const input = screen.getByLabelText('Tall')
    expect(input).toHaveClass('h-10')
    expect(input).not.toHaveClass('h-7')
  })

  it('accepts typing', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Input aria-label="Summary" />)
    const input = screen.getByLabelText('Summary')
    await user.type(input, 'Fix the scanner')
    expect(input).toHaveValue('Fix the scanner')
  })

  it('marks invalid via aria-invalid rather than a second ring', () => {
    renderWithProviders(<Input aria-label="Summary" aria-invalid="true" />)
    const input = screen.getByLabelText('Summary')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveClass('aria-invalid:border-danger-accent')
    expect(input.className).not.toMatch(/outline-none|outline-hidden/)
  })

  it('does not accept pointer or keyboard input when disabled', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Input disabled aria-label="Summary" />)
    const input = screen.getByLabelText('Summary')

    expect(input).toBeDisabled()

    await user.click(input)
    await user.tab()
    expect(input).not.toHaveFocus()
  })
})
