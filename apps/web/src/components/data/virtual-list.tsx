import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * A keyboard-addressable virtualised list on `@tanstack/react-virtual`.
 *
 * Native overflow, not `ui/scroll-area`: that component exists for constrained
 * popovers, and a board-scale list needs momentum, rubber-banding and the OS
 * scrollbar setting. jsdom's ResizeObserver fake never fires, so tests (and
 * SSR) pass `initialRect` rather than waiting for a measurement that will not
 * arrive.
 *
 * Keyboard: the list is one tab stop. Arrow keys move `aria-activedescendant`
 * and scroll the row into view. The surface that owns selection (board,
 * backlog, palette) reads the active index; this component does not invent a
 * selection model.
 *
 * ### Why `role="grid"` and not `role="list"`
 *
 * Because of the keyboard model above. `aria-activedescendant` is only defined on
 * composite widget roles — on `role="list"` it is an invalid attribute that every
 * screen reader ignores, so the arrow keys would move a highlight that is announced
 * to nobody. A single-column `grid` is the smallest role that legitimately carries
 * `aria-activedescendant`, a container `tabIndex`, and arrow-key handling.
 *
 * `listbox`/`option` would be the other candidate and is wrong here: an `option` may
 * not contain interactive descendants, and the rows this renders are arbitrary — a
 * board card with a link and a menu in it. A `gridcell` may.
 *
 * ### Why `aria-rowcount` and `aria-rowindex`
 *
 * Virtualisation is a lie told to the DOM, and these two attributes are how it is not
 * also told to the user. Without them a screen reader counts the rows it can see and
 * says "row 3 of 14" in a list of five thousand, changing its answer as the user
 * scrolls. `aria-rowcount` is the real total; `aria-rowindex` is each row's real
 * position, 1-based.
 */
export interface VirtualListProps<T> {
  items: readonly T[]
  estimateSize: (index: number) => number
  getItemKey: (item: T, index: number) => string
  children: (item: T, index: number) => ReactNode
  /** Accessible name for the list. Required — a nameless list is "list, N items". */
  label: string
  empty?: ReactNode | undefined
  className?: string | undefined
  overscan?: number | undefined
  /**
   * Size used until ResizeObserver reports one. Required in tests because the
   * harness observer is a no-op (see `src/test/dom.ts`).
   */
  initialRect?: { width: number; height: number } | undefined
}

export function VirtualList<T>({
  items,
  estimateSize,
  getItemKey,
  children,
  label,
  empty,
  className,
  overscan = 6,
  initialRect,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const [activeIndex, setActiveIndex] = useState(0)

  const getKey = useCallback(
    (index: number) => {
      const item = items[index]
      return item === undefined ? String(index) : getItemKey(item, index)
    },
    [getItemKey, items],
  )

  /**
   * Keep the active row rendered even when it scrolls out of the window.
   *
   * `aria-activedescendant` is an IDREF, and an IDREF that resolves to nothing is not
   * a smaller problem than a missing attribute — it is a broken one. axe reports it as
   * `aria-valid-attr-value` at *critical* severity, and to a screen reader the effect
   * is that arrow keys move a highlight it cannot read out.
   *
   * With plain virtualisation that is exactly what pressing End does: the active index
   * jumps to the last item, `scrollToIndex` schedules a scroll, and until that scroll
   * lands the row the attribute names is not in the DOM. Real browsers have the same
   * gap — briefly, but a keyboard user holding ArrowDown lives inside it — and jsdom
   * never closes it at all, because it has no scrolling for `scrollToIndex` to drive.
   *
   * `rangeExtractor` is the intended hook for this (it is what TanStack's own sticky-row
   * example uses). One extra row in the DOM, always the one being talked about.
   */
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range)
      if (activeIndex >= range.count || indexes.includes(activeIndex)) return indexes
      /** Sorted, so DOM order still matches visual order for anything that walks it. */
      return [...indexes, activeIndex].sort((a, b) => a - b)
    },
    [activeIndex],
  )

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan,
    getItemKey: getKey,
    rangeExtractor,
    ...(initialRect === undefined
      ? {}
      : {
          initialRect,
          // jsdom reports 0×0 on the scroll element; initialRect is otherwise
          // ignored once the ref attaches. Tests (and SSR) pass a size instead.
          observeElementRect: (_instance, cb) => {
            cb(initialRect)
          },
        }),
  })

  const rowId = (index: number) => `${listId}-row-${getKey(index)}`
  const activeItem = items[activeIndex]
  const activeId = activeItem === undefined ? undefined : rowId(activeIndex)

  const move = (next: number) => {
    if (items.length === 0) return
    const clamped = Math.max(0, Math.min(items.length - 1, next))
    setActiveIndex(clamped)
    virtualizer.scrollToIndex(clamped)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(activeIndex + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        move(activeIndex - 1)
        break
      case 'Home':
        event.preventDefault()
        move(0)
        break
      case 'End':
        event.preventDefault()
        move(items.length - 1)
        break
      default:
        break
    }
  }

  if (items.length === 0) {
    return (
      <div
        ref={parentRef}
        role="region"
        aria-label={label}
        data-slot="virtual-list"
        data-empty="true"
        className={cn('overflow-y-auto', className)}
      >
        {empty ?? <p className="px-3 py-6 text-center text-sm text-fg-muted">Nothing here yet.</p>}
      </div>
    )
  }

  return (
    <div
      ref={parentRef}
      role="grid"
      aria-label={label}
      aria-rowcount={items.length}
      aria-activedescendant={activeId}
      tabIndex={0}
      data-slot="virtual-list"
      className={cn('overflow-y-auto', className)}
      onKeyDown={onKeyDown}
    >
      {/**
       * The sizing spacer doubles as the `rowgroup`. A `row` has to be inside a
       * `rowgroup` or the `grid` itself, and this element is already between the two —
       * giving it the role costs nothing and saves a wrapper.
       */}
      <div
        role="rowgroup"
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index]
          if (item === undefined) return null
          const index = virtualRow.index
          return (
            <div
              key={virtualRow.key}
              id={rowId(index)}
              role="row"
              aria-rowindex={index + 1}
              data-index={index}
              data-active={index === activeIndex ? 'true' : undefined}
              ref={(node) => {
                // jsdom's getBoundingClientRect is zeros; recording that would
                // collapse every row to 0px and render an empty list.
                if (node !== null && node.getBoundingClientRect().height > 0) {
                  virtualizer.measureElement(node)
                }
              }}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${String(virtualRow.start)}px)` }}
            >
              {/**
               * One cell per row, and it is not ceremony: a `row` may only contain
               * cells, and `children` is arbitrary content that frequently includes a
               * link or a button. `gridcell` is the role that permits those.
               */}
              <div role="gridcell">{children(item, index)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
