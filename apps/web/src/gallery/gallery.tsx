import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_PREFERENCES,
  useSetThemePreference,
  useTheme,
  useThemePreference,
  type ThemePreference,
} from '@/stores/theme'
import { ComposedSection } from './sections/composed'
import { ControlsSection } from './sections/controls'
import { DataSection } from './sections/data'
import { SurfacesSection } from './sections/surfaces'
import { TokensSection } from './sections/tokens'

/**
 * The component gallery.
 *
 * Not a route, and not in `ROUTE_PATTERNS`. See `main.tsx` for why, and
 * `gallery.html` for how it is served.
 *
 * ### The theme control is the real store
 *
 * `useSetThemePreference` writes through `src/stores/theme.ts` to
 * `localStorage['flux.theme']`, which is the same key `index.html` and
 * `gallery.html` read before first paint. So flipping the theme here is the
 * product's own mechanism rather than a class toggled on a div, and a bug in it
 * shows up here first. It also means the choice survives a reload, which is what
 * makes screenshotting both themes a matter of setting the key and loading the
 * page twice.
 *
 * Rendering both themes side by side was considered and rejected: `tokens.css`
 * declares light on `:root` and dark on `.dark`, so a dark subtree nests inside a
 * light page but a light subtree cannot nest inside a dark one. Half the pairing
 * would work and half would silently show two dark panels — which is precisely the
 * kind of instrument that lies. Adding a `.light` block to carry it is a change to
 * every token in the file, not an addition, and that is a change request rather
 * than a convenience.
 */

const SECTIONS = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'controls', label: 'Controls' },
  { id: 'surfaces', label: 'Surfaces' },
  { id: 'data', label: 'Data' },
  { id: 'composed', label: 'Composed' },
] as const

const PREFERENCE_ICON = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const satisfies Record<ThemePreference, typeof Sun>

function ThemeControl() {
  const preference = useThemePreference()
  const resolved = useTheme()
  const setPreference = useSetThemePreference()

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex h-8 items-center gap-1 rounded-card bg-surface-2 p-1"
    >
      {THEME_PREFERENCES.map((option) => {
        const Icon = PREFERENCE_ICON[option]
        const active = option === preference
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => {
              setPreference(option)
            }}
            className={`flex h-6 items-center gap-1.5 rounded-control px-2 text-sm font-medium capitalize transition-colors duration-90 ease-out ${
              active
                ? 'bg-raised text-fg shadow-raised'
                : 'text-fg-muted hover:bg-surface-3 hover:text-fg'
            }`}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            {option}
            {option === 'system' && <span className="text-fg-subtle">({resolved})</span>}
          </button>
        )
      })}
    </div>
  )
}

export function Gallery() {
  return (
    <div className="min-h-dvh bg-canvas">
      {/*
        Sticky rather than fixed: a fixed header would need the page to reserve its
        height, and every anchor jump would land under it. `scroll-mt-20` on each
        Section is the other half of that.
      */}
      <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
          <div className="flex min-w-0 flex-col">
            <h1 className="text-lg font-semibold text-fg">flux — component gallery</h1>
            <p className="text-sm text-fg-subtle">
              27 components, every variant and state. Dev only; never built into production.
            </p>
          </div>

          <nav aria-label="Sections" className="flex flex-wrap items-center gap-1">
            {SECTIONS.map((section) => (
              <Button key={section.id} asChild variant="ghost" size="sm">
                <a href={`#${section.id}`}>{section.label}</a>
              </Button>
            ))}
          </nav>

          <div className="ml-auto">
            <ThemeControl />
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1400px] flex-col gap-10 px-6 py-8">
        <p className="max-w-[80ch] text-base text-fg-muted">
          Default preference is <code className="font-mono">{DEFAULT_THEME_PREFERENCE}</code>, and
          the control above writes through the product&rsquo;s own theme store — the same
          localStorage key <code className="font-mono">index.html</code> reads before first paint.
          Every colour, radius, shadow and type step on this page comes from{' '}
          <code className="font-mono">src/design/tokens.css</code>; anything that paints as nothing
          is a token that does not exist.
        </p>

        <TokensSection />
        <ControlsSection />
        <SurfacesSection />
        <DataSection />
        <ComposedSection />

        <footer className="border-t border-border pt-6 pb-16 text-sm text-fg-subtle">
          Specimens marked <code className="font-mono">data-probe</code> render at rest here. Hover
          and press states are forced through CDP in a screenshot run;{' '}
          <code className="font-mono">:focus-visible</code> is real focus, one element at a time.
        </footer>
      </main>
    </div>
  )
}
