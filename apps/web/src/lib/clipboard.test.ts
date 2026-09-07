import { act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetToasts } from '@/components/data/toaster'
import { renderHookWithProviders } from '@/test/render'
import { useCopyToClipboard } from './clipboard'

/**
 * ══════════════════════════════════════════════════════════════════════
 * `useCopyToClipboard` — the three branches, and the timer.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The success path is already exercised through its callers (`data/issue-key.test.tsx`,
 * and the copy-link button in `issue/issue-actions.test.tsx`). What is here is what a
 * component test cannot reach:
 *
 *   - **The missing-property branch.** `navigator.clipboard` is *absent* on a non-secure
 *     origin — not a stub that rejects. `navigator.clipboard.writeText(…)` then throws a
 *     `TypeError` synchronously, outside any promise handler, so the button fails with a
 *     console error instead of a toast. The guard is a typed local read, which is exactly
 *     the kind of line a later refactor "simplifies" to `?.` — and `?.` returns
 *     `undefined` instead of copying, silently.
 *   - **The four-second reset.** The confirmation has to go away, or the second copy of
 *     the session has no visible confirmation at all: the glyph is already a tick.
 *   - **Copying twice restarts the window** rather than expiring on the first copy's
 *     schedule. The timer is keyed on `outcome` for this reason, and a second copy inside
 *     four seconds is the ordinary case, not an edge one.
 *
 * `vi.useFakeTimers()` is scoped to the one test that asserts the timer. Installing it
 * for the file would freeze the timers React and MSW use to settle, and the failures read
 * as hangs rather than as a clock problem.
 */

const OPTIONS = { value: 'LOG-101', label: 'key', fallbackHint: 'Copy it from the URL.' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  resetToasts()
})

/** Absent, not stubbed — the non-secure-origin shape. */
function removeClipboard() {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
}

/**
 * The parameter is typed as the real `writeText` — `(value: string) => Promise<void>` —
 * rather than as the nullary shape most of these tests happen to need. A stub whose
 * signature is narrower than the API it replaces cannot be handed a spy that asserts
 * *what* was copied, which is the one thing this module's defects are about.
 */
function stubClipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
}

describe('useCopyToClipboard', () => {
  it('starts idle, and announces nothing until something happens', () => {
    const { result } = renderHookWithProviders(() => useCopyToClipboard(OPTIONS))

    expect(result.current.outcome).toBe('idle')
    expect(result.current.announcement).toBe('')
  })

  it('reports the outcome and names what it copied', async () => {
    const writeText = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    stubClipboard(writeText)
    const { result } = renderHookWithProviders(() => useCopyToClipboard(OPTIONS))

    await act(async () => {
      result.current.copy()
    })

    expect(writeText).toHaveBeenCalledWith('LOG-101')
    expect(result.current.outcome).toBe('copied')
    expect(result.current.announcement).toBe('Copied key')
  })

  /**
   * No clipboard at all is a reported failure, not a throw.
   *
   * The assertion that matters is the *absence* of an exception: `copy()` is called
   * directly rather than through a control, so a synchronous `TypeError` fails the test
   * here instead of being swallowed by React's error handling in a component tree.
   */
  it('fails cleanly when the browser exposes no clipboard', () => {
    removeClipboard()
    const { result } = renderHookWithProviders(() => useCopyToClipboard(OPTIONS))

    act(() => {
      result.current.copy()
    })

    expect(result.current.outcome).toBe('failed')
    expect(result.current.announcement).toBe('Copy failed')
  })

  it('fails when the write is refused', async () => {
    stubClipboard(vi.fn<() => Promise<void>>().mockRejectedValue(new Error('NotAllowedError')))
    const { result } = renderHookWithProviders(() => useCopyToClipboard(OPTIONS))

    await act(async () => {
      result.current.copy()
    })

    expect(result.current.outcome).toBe('failed')
  })

  /**
   * The confirmation expires, and a second copy gets a fresh window.
   *
   * Both halves in one test because the second is only meaningful against the first: if
   * the timer were started inside `copy` rather than keyed on the outcome, the second
   * copy would keep the first one's deadline and the tick would vanish part-way through
   * the confirmation it was meant to give.
   */
  it('clears the confirmation after four seconds, and restarts it on a second copy', async () => {
    /**
     * The clock is faked **before** the first copy, not after it. The reset is scheduled
     * by an effect that runs on the transition to `copied`, so a `useFakeTimers()` call
     * in between installs a clock that the already-pending real timer ignores — and
     * advancing it then proves nothing while looking like it proved everything.
     *
     * Every copy is flushed with `advanceTimersByTimeAsync(0)` for the same reason in
     * reverse: `writeText`'s resolution is a microtask, and under a fake clock nothing
     * else is going to drain it.
     */
    vi.useFakeTimers()
    stubClipboard(vi.fn<() => Promise<void>>().mockResolvedValue(undefined))
    const { result } = renderHookWithProviders(() => useCopyToClipboard(OPTIONS))

    await act(async () => {
      result.current.copy()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.outcome).toBe('copied')

    act(() => {
      vi.advanceTimersByTime(3999)
    })
    expect(result.current.outcome).toBe('copied')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.outcome).toBe('idle')

    await act(async () => {
      result.current.copy()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.outcome).toBe('copied')

    act(() => {
      vi.advanceTimersByTime(3999)
    })
    expect(result.current.outcome).toBe('copied')
  })

  /**
   * The callback's identity tracks its inputs.
   *
   * `copy` is `useCallback`'d over `value`, and the panel's copy-link button rebuilds
   * that value from the issue key — so a stale closure means clicking the button on the
   * second issue you peek at copies a link to the first. The bug is invisible in a
   * single-issue test and reported as "the copy button copies the wrong thing".
   */
  it('copies the current value after the value changes', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined)
    stubClipboard(writeText)
    const { result, rerender } = renderHookWithProviders(
      ({ value }: { value: string }) => useCopyToClipboard({ ...OPTIONS, value }),
      { initialProps: { value: 'LOG-101' } },
    )

    rerender({ value: 'LOG-202' })
    await act(async () => {
      result.current.copy()
    })

    expect(writeText).toHaveBeenLastCalledWith('LOG-202')
  })
})
