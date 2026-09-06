import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

/**
 * `variant` is on `Tabs`, not `TabsList`. Threading it down through markup
 * produced twelve `group-data-[variant=line]/tabs-list:` selectors; a context
 * is one line. `solid` is the default — a 32px trough with a 24px chip.
 */
function BoardTabs({ variant }: { variant?: 'solid' | 'line' }) {
  return (
    <Tabs defaultValue="board" variant={variant}>
      <TabsList>
        <TabsTrigger value="board">Board</TabsTrigger>
        <TabsTrigger value="backlog">Backlog</TabsTrigger>
        <TabsTrigger value="timeline" disabled>
          Timeline
        </TabsTrigger>
      </TabsList>
      <TabsContent value="board">Board view</TabsContent>
      <TabsContent value="backlog">Backlog view</TabsContent>
      <TabsContent value="timeline">Timeline view</TabsContent>
    </Tabs>
  )
}

describe('Tabs', () => {
  it('puts variant on the Tabs root and defaults to solid', async () => {
    const user = userEvent.setup()
    const { container } = renderWithProviders(<BoardTabs />)
    const root = container.querySelector('[data-slot="tabs"]')
    expect(root).toHaveAttribute('data-variant', 'solid')
    expect(container.querySelector('[data-slot="tabs-list"]')).toHaveAttribute(
      'data-variant',
      'solid',
    )
    expect(container.querySelector('[data-slot="tabs-list"]')).toHaveClass('h-8', 'rounded-card')

    const board = screen.getByRole('tab', { name: 'Board' })
    expect(board).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Board view')

    await user.click(screen.getByRole('tab', { name: 'Backlog' }))
    expect(screen.getByRole('tab', { name: 'Backlog' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Backlog view')).toBeTruthy()

    await expectNoAxeViolations(container)
  })

  it('moves between tabs with arrows and skips a disabled tab from pointer and keyboard', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BoardTabs />)

    const board = screen.getByRole('tab', { name: 'Board' })
    const backlog = screen.getByRole('tab', { name: 'Backlog' })
    const timeline = screen.getByRole('tab', { name: 'Timeline' })

    board.focus()
    await user.keyboard('{ArrowRight}')
    expect(backlog).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(timeline).not.toHaveFocus()
    expect(board).toHaveFocus()

    await user.click(timeline)
    expect(timeline).toHaveAttribute('aria-selected', 'false')
  })

  it('applies the line variant from Tabs, not from TabsList', () => {
    const { container } = renderWithProviders(<BoardTabs variant="line" />)
    expect(container.querySelector('[data-slot="tabs"]')).toHaveAttribute('data-variant', 'line')
    expect(container.querySelector('[data-slot="tabs-content"]')?.className).not.toMatch(
      /outline-none|outline-hidden/,
    )
  })
})
