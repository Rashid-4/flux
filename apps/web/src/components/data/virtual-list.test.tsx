import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { VirtualList } from './virtual-list'

const ITEMS = Array.from({ length: 40 }, (_, i) => ({
  id: `row-${String(i)}`,
  label: `Issue ${String(i)}`,
}))

describe('VirtualList', () => {
  it('virtualises, names itself, and moves with arrows', async () => {
    const user = userEvent.setup()
    const { container } = renderWithProviders(
      <VirtualList
        items={ITEMS}
        label="Issues"
        estimateSize={() => 32}
        getItemKey={(item) => item.id}
        initialRect={{ width: 400, height: 320 }}
        className="h-80"
      >
        {(item) => <div className="h-8 px-2">{item.label}</div>}
      </VirtualList>,
    )

    const list = screen.getByRole('grid', { name: 'Issues' })
    const rows = screen.getAllByRole('row')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(ITEMS.length)
    expect(screen.getByText('Issue 0')).toBeTruthy()
    expect(screen.queryByText('Issue 39')).toBeNull()

    /**
     * The point of the two attributes: fewer rows in the DOM than there are items, and
     * the count a screen reader announces is still the real one. Without
     * `aria-rowcount` this list would announce "40 rows" as "14 rows", and the number
     * would change as the user scrolled.
     */
    expect(list).toHaveAttribute('aria-rowcount', String(ITEMS.length))
    expect(rows[0]).toHaveAttribute('aria-rowindex', '1')

    list.focus()
    await user.keyboard('{ArrowDown}')
    expect(list.getAttribute('aria-activedescendant')).toContain('row-row-1')
    await user.keyboard('{End}')
    expect(list.getAttribute('aria-activedescendant')).toContain('row-row-39')

    await expectNoAxeViolations(container)
  })

  it('renders the empty state instead of a blank box', async () => {
    const { container } = renderWithProviders(
      <VirtualList
        items={[]}
        label="Issues"
        estimateSize={() => 32}
        getItemKey={(item: { id: string }) => item.id}
        empty={<p>No issues in this sprint</p>}
      >
        {(item: { id: string }) => item.id}
      </VirtualList>,
    )
    expect(screen.getByRole('region', { name: 'Issues' })).toHaveAttribute('data-empty', 'true')
    expect(screen.getByText('No issues in this sprint')).toBeTruthy()
    await expectNoAxeViolations(container)
  })
})
