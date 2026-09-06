import { X } from 'lucide-react'
import { Toast } from 'radix-ui'
import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'

/**
 * Transient notices, on Radix Toast — not sonner, not a new dependency.
 *
 * Toasts are client state (the user dismissed this one; the next mutation will
 * emit another), so they live in a module-level queue rather than in TanStack
 * Query. `toast()` is the write; `<Toaster />` is the one subscriber the app
 * mounts. Delivery is best-effort: a reload drops the queue, which is correct
 * for a notice whose moment has passed.
 *
 * `z-70` sits above dialogs (50) and tooltips (60) — a toast that reports the
 * result of a dialog action has to clear the dialog.
 */
export type ToastTone = 'neutral' | 'success' | 'danger' | 'info'

export interface ToastInput {
  title: string
  description?: string | undefined
  tone?: ToastTone | undefined
}

type ToastItem = {
  id: string
  title: string
  description: string | undefined
  tone: ToastTone
}

/**
 * At most this many on screen at once, oldest dropped first.
 *
 * The viewport is a fixed 320px column in the corner, so an uncapped queue is not
 * a long list — it is a column that grows off the top of the window with no way to
 * scroll it. A bulk action that fails per-item, or a flaky connection retrying,
 * produces exactly that. Three is what fits without covering the content the
 * notices are about, and the newest is the one worth keeping: a toast is a report
 * on the action just taken.
 */
const MAX_VISIBLE = 3

let nextId = 0
let queue: readonly ToastItem[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function toast(input: ToastInput): string {
  nextId += 1
  const id = String(nextId)
  queue = [
    ...queue,
    {
      id,
      title: input.title,
      description: input.description,
      tone: input.tone ?? 'neutral',
    },
  ].slice(-MAX_VISIBLE)
  emit()
  return id
}

export function dismissToast(id: string): void {
  queue = queue.filter((item) => item.id !== id)
  emit()
}

/** Test-only: drop the queue so files cannot leak toasts into each other. */
export function resetToasts(): void {
  nextId = 0
  queue = []
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * The array identity *is* the change signal, which is why every write above
 * replaces `queue` rather than mutating it: `useSyncExternalStore` compares
 * snapshots with `Object.is` and would never re-render from a `push`.
 */
function getQueue(): readonly ToastItem[] {
  return queue
}

const TONE_CLASS: Record<ToastTone, string> = {
  neutral: 'border-border',
  success: 'border-success-accent',
  danger: 'border-danger-accent',
  info: 'border-info-accent',
}

/**
 * How long each tone stays, in ms.
 *
 * A `danger` toast does not expire. It is the one carrying information the user
 * has to act on — what failed, and often what to do about it — and five seconds
 * is not long enough to read a sentence, decide, and reach the mouse. Auto-hiding
 * it is the "control that silently does nothing" failure from
 * `docs/product-quality-bar.md` §13 wearing a timer: the product reported the
 * problem and then took the report away.
 *
 * Radix supports this directly — `if (!duration || duration === Infinity) return`
 * before it sets the timer — so `Infinity` genuinely means "until dismissed"
 * rather than `setTimeout(fn, Infinity)`, which browsers fire immediately.
 *
 * Radix still pauses the timer on hover and on focus, so a 5s success toast the
 * user is reading does not vanish mid-sentence.
 */
const TONE_DURATION_MS: Record<ToastTone, number> = {
  neutral: 5_000,
  success: 5_000,
  info: 6_000,
  danger: Infinity,
}

/**
 * `useSyncExternalStore`, not `useState` + `useEffect`.
 *
 * The hand-rolled version subscribed in an effect and so had a window between the
 * first render and the commit in which a `toast()` call notified nobody — the
 * listener was not attached yet, and the next render would only ever be triggered
 * by a *later* emit. The dropped toast is the first one, which is the one a
 * mutation fires on the same tick as the mount that renders the surface. This hook
 * exists precisely to close that window, and React reads the snapshot again after
 * subscribing.
 */
export function Toaster() {
  const items = useSyncExternalStore(subscribe, getQueue, getQueue)

  return (
    <Toast.Provider swipeDirection="right">
      {items.map((item) => (
        <Toast.Root
          key={item.id}
          duration={TONE_DURATION_MS[item.tone]}
          data-slot="toast"
          data-tone={item.tone}
          className={cn(
            'flex items-start gap-2 rounded-card border bg-surface p-3 shadow-overlay',
            TONE_CLASS[item.tone],
          )}
          onOpenChange={(open) => {
            if (!open) dismissToast(item.id)
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <Toast.Title className="text-sm font-medium text-fg">{item.title}</Toast.Title>
            {item.description !== undefined && (
              <Toast.Description className="text-sm text-fg-muted">
                {item.description}
              </Toast.Description>
            )}
          </div>
          <Toast.Close asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Dismiss notification">
              <X aria-hidden="true" />
            </Button>
          </Toast.Close>
        </Toast.Root>
      ))}
      <Toast.Viewport
        data-slot="toast-viewport"
        className="fixed right-4 bottom-4 z-70 flex w-80 max-w-[calc(100%-2rem)] flex-col gap-2 outline-offset-2"
      />
    </Toast.Provider>
  )
}
