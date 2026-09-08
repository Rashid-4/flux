import { Search } from 'lucide-react'
import { openPalette } from '@/command-palette/command-palette'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatChord } from '@/keyboard/keys'

/**
 * The magnifier: the palette's front door, in the place the references put it.
 *
 * `UI Images/JIRA 1.webp` and `JIRA 2.webp` draw a bare 24px magnifier as the first of
 * three glyphs at the top right of the header block, and this is it. It goes in
 * `<SurfaceHeader actions>` on **every** surface rather than only the project ones,
 * which is the reason it is a file of its own: `docs/specs/web/README.md` §9 calls the
 * palette *"the primary navigation for anyone who has used the app twice"*, and a
 * surface that omits its one visible entry point is a surface where a mouse user has
 * to already know the chord.
 *
 * ### It replaces a labelled button, and the chord had to survive the move
 *
 * The frame-level top bar this header block replaces carried a wider control — a
 * magnifier, the word "Search", and a `<kbd>` printing the chord. That was more
 * discoverable and it is not what the references draw, so the chord moved into the
 * tooltip and into `aria-keyshortcuts`. Both matter, and for different people:
 * `aria-keyshortcuts` is the attribute assistive technology reads, and it reads
 * neither a visible `<kbd>` nor `keyboard/registry.ts`; the tooltip is what a sighted
 * mouse user finds by hovering the thing they were already reaching for.
 *
 * `formatChord` decides between `⌘K` and `Ctrl+K` from the same platform detection the
 * shortcut registry uses. A hard-coded `⌘K` would be a second copy of a platform rule
 * and wrong on most machines.
 */
export function PaletteAction() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={openPalette}
          /**
           * "Search flux" and not "Search": an icon-only control's accessible name is
           * read out of context in a screen reader's control list, where a bare verb
           * sits beside three other things that also search something.
           */
          aria-label="Search flux"
          aria-keyshortcuts="Meta+K Control+K"
          /**
           * `text-fg`, over the ghost variant's muted default. The references draw
           * the header's three glyphs in their brightest ink — pure white in dark,
           * near-black in light — the same weight as the title beside them. A muted
           * magnifier read as a secondary control, and the palette is not one.
           */
          className="text-fg [&_svg]:size-6"
        >
          <Search aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Search · {formatChord({ key: 'k', mod: true })}</TooltipContent>
    </Tooltip>
  )
}
