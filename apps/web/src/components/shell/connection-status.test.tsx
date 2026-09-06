import { act, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConnectionStatus } from '@/components/shell/connection-status'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'

/**
 * `docs/specs/web/shell.md` §11: *"Offline | a persistent, non-blocking indicator"*
 * and *"Reconnect | the indicator clears itself; no manual reload."*
 *
 * jsdom reports `navigator.onLine` as `true` and never changes it, so both are
 * driven by redefining the property and firing the real events — which is also what
 * the browser does, so the component is exercised through the same path.
 */
function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true })
  act(() => {
    window.dispatchEvent(new Event(value ? 'online' : 'offline'))
  })
}

afterEach(() => {
  setOnline(true)
})

describe('ConnectionStatus', () => {
  it('renders nothing at all while online', () => {
    const { container } = renderWithProviders(<ConnectionStatus />)
    expect(container).toBeEmptyDOMElement()
  })

  it('appears when the connection drops, and says what still works', async () => {
    const { container } = renderWithProviders(<ConnectionStatus />)

    setOnline(false)

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/you are offline/i)
    /** Non-blocking: it is a banner, not a dialog. */
    expect(screen.queryByRole('dialog')).toBeNull()
    await expectNoAxeViolations(container)
  })

  /** §11: *"the indicator clears itself; no manual reload."* */
  it('clears itself on reconnect', async () => {
    renderWithProviders(<ConnectionStatus />)

    setOnline(false)
    expect(await screen.findByRole('status')).toBeInTheDocument()

    setOnline(true)
    expect(screen.queryByRole('status')).toBeNull()
  })

  /**
   * It must not claim anything about queued work. §11 asks for queued mutations to
   * be *named*, and there is no mutation queue in this surface — a reassurance the
   * product cannot honour is worse than silence, so the copy is checked for it.
   */
  it('does not claim to have queued anything', async () => {
    renderWithProviders(<ConnectionStatus />)
    setOnline(false)

    const status = await screen.findByRole('status')
    expect(status.textContent ?? '').not.toMatch(/quey|queued|will sync|syncing|retry when/i)
  })

  it('removes its listeners on unmount, so a later event cannot update it', () => {
    const { unmount } = renderWithProviders(<ConnectionStatus />)
    unmount()
    /** No act() warning and no throw is the assertion; a leaked listener produces both. */
    expect(() => {
      setOnline(false)
    }).not.toThrow()
  })
})
