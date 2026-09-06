import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { ScrollArea } from './scroll-area'

/**
 * This is not the default way to make something scroll in flux. Native
 * `overflow-y-auto` is what the board, the backlog and every virtualised list
 * use. ScrollArea is for a constrained popover that needs a scrollbar visibly
 * part of the panel.
 */
describe('ScrollArea', () => {
  it('renders a viewport and a scrollbar without becoming the product scroller', async () => {
    const { container } = renderWithProviders(
      <ScrollArea type="always" className="h-40">
        <ul>
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i}>Option {i + 1}</li>
          ))}
        </ul>
      </ScrollArea>,
    )
    expect(container.querySelector('[data-slot="scroll-area"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="scroll-area-viewport"]')).toHaveClass(
      'rounded-inherit',
    )
    expect(container.querySelector('[data-slot="scroll-area-scrollbar"]')).toHaveClass('w-2.5')
    expect(container.querySelector('[data-slot="scroll-area"]')?.className).not.toMatch(
      /outline-none|outline-hidden/,
    )
    await expectNoAxeViolations(container)
  })
})
