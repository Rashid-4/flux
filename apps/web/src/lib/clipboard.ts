import { useCallback, useEffect, useState } from 'react'
import { toast } from '@/components/data/toaster'

/**
 * Copying, with the failure visible.
 *
 * Extracted from `components/data/issue-key.tsx` when the peek panel needed the same
 * behaviour for a different payload — an issue's URL rather than its key. The two
 * differ only in what is copied and what the failure is called, and everything else
 * about it is subtle enough that a second hand-rolled copy would have got one of the
 * three parts wrong: the transient confirmation, the reset timer, and the fact that a
 * blocked clipboard is not an exception anyone catches by accident.
 *
 * ### Why a blocked clipboard is the normal case, not the edge case
 *
 * `navigator.clipboard` is **absent entirely** on a non-secure origin — which includes
 * every `http://` staging box and every LAN address someone tests from — and even where
 * it exists, `writeText` rejects when the permission is denied or the document is not
 * focused. None of those are things the user did. So the failure path is reached by
 * ordinary people doing ordinary things, and `docs/product-quality-bar.md` §13 is the
 * rule that applies: a control that silently does nothing is worse than one that says
 * why it cannot.
 *
 * The announcement alone was not enough, and that is why the toast is in here rather
 * than left to each caller. An `sr-only` live region told a screen-reader user what
 * happened and left a sighted user pressing a button that appeared inert. Both halves
 * are needed, and a hook that returns only the state would have left the visible half
 * optional — which is how the second caller ships without it.
 *
 * ### The state machine, and why it resets
 *
 * `idle → copied → idle` on a 4s timer, or `idle → failed → idle`. The reset is what
 * keeps a stale ✓ from claiming that a *later* copy succeeded: with forty of these on a
 * board, a check mark that never clears is a check mark on the wrong row. Four seconds
 * is long enough to be read and short enough that it cannot be mistaken for a
 * persistent state.
 *
 * The timer is keyed on `outcome` rather than started inside `copy`, so copying twice
 * in a row restarts it rather than leaving the first timer to clear the second
 * confirmation early — and the cleanup runs on unmount, which matters here because the
 * peek panel is closed by the same kind of click that copies.
 */
export type CopyOutcome = 'idle' | 'copied' | 'failed'

export interface CopyToClipboard {
  /** `copied` and `failed` are transient; both fall back to `idle` after 4s. */
  outcome: CopyOutcome
  /** What to announce in a live region — `''` while idle, so nothing is spoken. */
  announcement: string
  copy: () => void
}

export interface CopyToClipboardOptions {
  /** The exact string to put on the clipboard. */
  value: string
  /**
   * What the value is called, in a sentence. `Copied LOG-142`, `Could not copy link`.
   *
   * Required rather than defaulted to the value itself, because the two are not the
   * same for a URL: `Copied https://…/browse/LOG-142` is a toast title that wraps to
   * three lines and says less than `Copied link`.
   */
  label: string
  /**
   * What the reader should do instead, when the browser refuses.
   *
   * Also required. "Select the key and copy it manually" is actionable for a key
   * rendered as selectable text and useless for a URL that is nowhere on screen, and a
   * default would have been wrong in whichever case it was not written for.
   */
  fallbackHint: string
}

const RESET_MS = 4000

export function useCopyToClipboard({
  value,
  label,
  fallbackHint,
}: CopyToClipboardOptions): CopyToClipboard {
  const [outcome, setOutcome] = useState<CopyOutcome>('idle')

  useEffect(() => {
    if (outcome === 'idle') return
    const timer = setTimeout(() => {
      setOutcome('idle')
    }, RESET_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [outcome])

  const copy = useCallback(() => {
    const reportFailure = () => {
      setOutcome('failed')
      toast({
        title: `Could not copy ${label}`,
        description: `Your browser blocked clipboard access. ${fallbackHint}`,
        tone: 'danger',
      })
    }

    /**
     * Read through a typed local rather than tested with `in` or `?.`: on a non-secure
     * origin the property is missing, and `navigator.clipboard.writeText(…)` would
     * throw a `TypeError` synchronously — outside the promise rejection handler below,
     * so nothing would catch it and the button would fail with a console error instead
     * of a toast.
     */
    const clipboard: Clipboard | undefined = navigator.clipboard
    if (clipboard === undefined) {
      reportFailure()
      return
    }

    void clipboard.writeText(value).then(() => {
      setOutcome('copied')
    }, reportFailure)
  }, [value, label, fallbackHint])

  return {
    outcome,
    announcement:
      outcome === 'copied' ? `Copied ${label}` : outcome === 'failed' ? 'Copy failed' : '',
    copy,
  }
}
