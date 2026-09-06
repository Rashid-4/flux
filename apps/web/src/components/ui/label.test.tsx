import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Input } from './input'
import { Label } from './label'

describe('Label', () => {
  it('associates with a control and paints as primary text, not muted', async () => {
    const user = userEvent.setup()
    const { container } = renderWithProviders(
      <div>
        <Label htmlFor="assignee">Assignee</Label>
        <Input id="assignee" />
      </div>,
    )
    const label = screen.getByText('Assignee')
    expect(label).toHaveAttribute('data-slot', 'label')
    expect(label).toHaveClass('text-fg')
    expect(label).toHaveClass('text-sm')

    await user.click(label)
    expect(screen.getByLabelText('Assignee')).toHaveFocus()
    await expectNoAxeViolations(container)
  })
})
