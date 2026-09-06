import { X } from 'lucide-react'
import { Toast } from 'radix-ui'
import { useEffect, useState } from 'react'
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

let nextId = 0
let queue: ToastItem[] = []
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
  ]
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

const TONE_CLASS: Record<ToastTone, string> = {
  neutral: 'border-border',
  success: 'border-success-accent',
  danger: 'border-danger-accent',
  info: 'border-info-accent',
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>(queue)

  useEffect(() => {
    const sync = () => {
      setItems(queue)
    }
    listeners.add(sync)
    return () => {
      listeners.delete(sync)
    }
  }, [])

  return (
    <Toast.Provider swipeDirection="right">
      {items.map((item) => (
        <Toast.Root
          key={item.id}
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
