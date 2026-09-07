import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The header block at the top of a surface — three stacked rows.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ```
 *  y=0    ┌─ pt-9 ────────────────────────────────────────────────────┐
 *  y=36   │ ▣  Unique Website                    ⌕   ☆   ⋮            │  title
 *  y=74   ├─ mt-3.25 ─────────────────────────────────────────────────┤
 *  y=87   │  └ ▤ Website / ▤ iOS App / ▤ Design                       │  breadcrumb
 *  y=111  ├─ mt-10 ───────────────────────────────────────────────────┤
 *  y=151  │ Board   Backlog   Settings          ‹avatars› │ ＋         │  tabs
 *  y=197  ├────────────────────────────────────────────────────────────┤  rule 1
 * ```
 *
 * Every number in that diagram is measured off `UI Images/JIRA 1.webp` and
 * `JIRA 2.webp` at 1× — the references' window content box is 1841 × 1327 at image
 * origin (105, 103), so an image pixel is a CSS pixel and nothing here is scaled.
 * `docs/specs/web/shell.md` §3.2 records the measurements and the method;
 * `pnpm ui:diff` is the instrument that says whether the code still matches them.
 *
 * ### The vertical stack is derived, not chosen
 *
 * Six numbers, and they sum to the measured 197 exactly:
 *
 * | Step | Value | Lands |
 * | --- | --- | --- |
 * | `pt-9` | 36 | title line box top y=36 |
 * | title line box | 38 | `text-3xl` is 30/38 → cap top **44.1** (measured 44) |
 * | `mt-3.25` | 13 | crumb line box top y=87 |
 * | crumb line box | 24 | `text-md` is 17/24 → cap top **92.8** (measured 93) |
 * | `mt-10` | 40 | tab item top y=151 |
 * | tab item | 46 | 28 line + `pb-3.75` + 3px border → cap top **157.4**, underline **194..196** |
 *
 * 36 + 38 + 13 + 24 + 40 + 46 = 197, and the `border-b` is the 198th pixel. Each cap
 * top is Inter's ascent 0.9688em / cap height 0.7276em worked through that step's
 * line-height, and all four land within half a pixel of the reference. That is why
 * the padding steps are odd numbers rather than round ones: they are what the type
 * metrics require, and rounding any of them to a `4`-multiple moves every landmark
 * below it.
 *
 * ### One `<header>` on screen, and it is not `banner`
 *
 * There used to be two: a frame-level `TopBar` rendered by `ShellFrame` as a sibling
 * of `<main>`, and a `PageHeader` inside it. The references draw **one** block, so
 * this is it, and it is the first child of `<main>` — which is also the semantically
 * correct place for it. `<header>` carries its implicit `banner` role only while it
 * is *not* inside `main`, `article`, `aside`, `nav` or `section`; `banner` means
 * site-oriented content, and a header that says "Logistics Platform · Board" is
 * surface-oriented. Nesting demotes it to a generic group, which is exactly right
 * here and would have been wrong for the frame-level bar it replaces.
 *
 * The consequence is that the header is per-route rather than central, and that is
 * deliberate too. `routes/projects.tsx` puts a pluralised live count in its
 * description and a real "New project" button in its actions; a route→header lookup
 * table in one place would have had to drop both.
 *
 * ### `bg-panel`, and the rule is `--border`
 *
 * `--panel` is #ffffff in light and the same near-black as `--canvas` in dark, which
 * is measured: the references collapse the header block into the field in dark and
 * separate it in light. Either single token is right in one theme and wrong in the
 * other, which is the whole reason `--panel` exists. In dark that makes `border-b`
 * the *only* thing separating the header from the board, so it is `--border`
 * (L Δ17, D Δ16) and not `--border-subtle`.
 */

export interface SurfaceHeaderTab {
  /** Where it goes. A real route, always — see the tab list's own note. */
  to: string
  label: string
  /** Whether the current location is inside this tab's section. */
  active: boolean
}

export interface SurfaceHeaderProps {
  title: string
  /**
   * Left of the title — a project glyph, an issue-type mark.
   *
   * Vertically centred on the title's *line box* rather than on the header, so it
   * does not drift when a breadcrumb or a tab row appears below.
   */
  lead?: ReactNode | undefined
  /**
   * Row 2 as one line of muted text — a count, a parent name.
   *
   * Ignored when `breadcrumb` is given: they occupy the same row, and a surface with
   * a real crumb trail does not also need a sentence describing where it is.
   */
  description?: string | undefined
  /** Row 2 as a crumb trail. `<SurfaceHeaderCrumbs>` draws the connector. */
  breadcrumb?: ReactNode | undefined
  /** The title row's right cluster. */
  actions?: ReactNode | undefined
  /**
   * Row 3. Omit it and the block closes with `pb-9`, mirroring `pt-9`.
   *
   * Every entry must be a route that exists. `docs/product-quality-bar.md` §13: *"a
   * control that silently does nothing is worse than one that says why it cannot"* —
   * and a tab is worse than a button in that respect, because a tab *looks* like
   * navigation. The references show five and flux renders three, which is the honest
   * count rather than the matching one.
   */
  tabs?: readonly SurfaceHeaderTab[] | undefined
  /** Row 3's right cluster, level with the tabs. */
  tabsAside?: ReactNode | undefined
  /** Names the tab row's `<nav>`. Required whenever `tabs` is given. */
  tabsLabel?: string | undefined
  className?: string | undefined
}

export function SurfaceHeader({
  title,
  lead,
  description,
  breadcrumb,
  actions,
  tabs,
  tabsAside,
  tabsLabel,
  className,
}: SurfaceHeaderProps) {
  const hasTabs = tabs !== undefined && tabs.length > 0

  return (
    <header
      data-slot="surface-header"
      className={cn(
        'shrink-0 border-b border-border bg-panel px-gutter pt-9',
        hasTabs ? 'pb-0' : 'pb-9',
        className,
      )}
    >
      {/**
       * `items-center` on a row whose height is the title's 38px line box, so the
       * glyph and the three controls all centre on y=55 — which is where the
       * references put them (icon ink centres 55.5, 56.5, 56.5).
       */}
      <div className="flex items-center gap-2.5">
        {/**
         * 10px of gap, measured: the references' project mark boxes x 408..432 and
         * the title's first ink lands at x=442. `<ProjectGlyph size="md">` is the
         * 24px step, which is the box the reference draws — not the 32px `lg` step,
         * which is what a title this large would otherwise suggest.
         */}
        {lead !== undefined && <div className="flex shrink-0 items-center">{lead}</div>}
        {/**
         * `min-w-0` is what makes `truncate` work at all. A flex item defaults to
         * `min-width: auto` and refuses to shrink below its content, so without it a
         * long project name pushes the icon cluster off the right edge instead of
         * ellipsing — the single most common way a truncation tested on short strings
         * fails on real data.
         */}
        <h1 className="min-w-0 flex-1 truncate text-3xl font-semibold text-fg">{title}</h1>
        {actions !== undefined && (
          /**
           * `-mr-3` is optical alignment, not a mistake, and it is measured. The
           * references align the *ink* of this cluster to x=1369.5 while the content
           * column's padding edge is x=1363. A ghost icon button is 36px around a
           * 24px glyph, so 6px of its box either side is invisible — subtracting that
           * 6 plus the 6.5px the reference sits proud lands the three glyph centres at
           * 1261 / 1309 / 1357, against the measured 1262 / 1309 / 1357.5.
           *
           * Aligning the boxes instead would put the visible glyphs 12px inside the
           * gutter, and the eye reads the glyph.
           */
          <div className="-mr-3 flex shrink-0 items-center gap-3">{actions}</div>
        )}
      </div>

      {breadcrumb !== undefined
        ? breadcrumb
        : description !== undefined && (
            /**
             * The same `mt-3.25` and the same 24px line box as a crumb row, so a
             * surface with a description and one with a breadcrumb put their tab rows
             * — and their bottom rules — on the same pixel. Two headers of different
             * heights on adjacent surfaces is a jump on every navigation.
             */
            <p className="mt-3.25 truncate text-md text-fg-muted">{description}</p>
          )}

      {hasTabs && (
        <div className="mt-10 flex items-end justify-between gap-6">
          {/**
           * `aria-label` because this is the third `<nav>` on the page — the rail and
           * the project tree are the other two — and unlabelled navigation landmarks
           * are indistinguishable in a screen reader's landmark list.
           */}
          <nav aria-label={tabsLabel} className="flex items-end gap-9">
            {tabs.map((tab) => (
              <SurfaceHeaderTabLink key={tab.to} tab={tab} />
            ))}
          </nav>
          {tabsAside !== undefined && (
            /**
             * `-mt-2.5` puts the 44px avatar stack's top at y=141, which is where the
             * references draw it: 10px above the tab row's own top at y=151. It hangs
             * *up* out of the row rather than pushing the row down, so the underline
             * and the rule below stay on their measured pixels no matter what this
             * cluster contains.
             *
             * `-mr-1.25` is the same optical rule as the title row's `-mr-3`, with a
             * different number because the ink is in a different place: this cluster
             * ends in a bordered 42px disc whose visible edge *is* its box, measured
             * at x=1368 against the 1363 padding edge.
             */
            <div className="-mt-2.5 -mr-1.25 flex shrink-0 items-center gap-3">{tabsAside}</div>
          )}
        </div>
      )}
    </header>
  )
}

/**
 * One tab: 28px of line box, 15px of clear space, a 3px underline.
 *
 * **Zero horizontal padding**, which is measured rather than assumed — the
 * references' active underline runs x 571..621 and the word "Tasks" inks x 571..619,
 * so the rule is exactly as wide as the label. The 36px between labels is therefore
 * a `gap-9` on the row and not padding on the items, and a hover fill would have
 * nowhere to go. That is consistent with the references, which mark the active tab
 * with the underline and the ink weight and nothing else.
 *
 * `text-fg-muted` for the inactive ones is a **deliberate divergence** from the
 * reference pixels, and the only one in this file. The references' inactive dark ink
 * samples (102, 104, 106) on (16, 18, 19) — a contrast ratio of **3.27:1**, which
 * fails WCAG 2.2 SC 1.4.3 for 21px normal-weight text (4.5:1 required; the large-text
 * exemption starts at 24px, or 18.66px bold). `--fg-muted` is 6.97:1 dark and 7.41:1
 * light. Accessibility outranks the pixel match, and this is written down rather than
 * absorbed silently.
 *
 * `border-rail-selected` for the active underline: white in dark, the accent in
 * light, which is exactly what the references sample — L(64, 133, 212),
 * D(255, 255, 254) — and exactly the semantics the rail's own selected marker
 * already has. The token wants renaming in the colour pass now that two controls
 * share it; renaming it here would be a second change inside a geometry commit.
 */
function SurfaceHeaderTabLink({ tab }: { tab: SurfaceHeaderTab }) {
  return (
    <Link
      to={tab.to}
      /**
       * `aria-current="page"` and not `undefined` when inactive: `aria-current="false"`
       * is a valid token meaning "not current" that some screen readers announce, so
       * the attribute is meant to be absent rather than falsified.
       */
      aria-current={tab.active ? 'page' : undefined}
      data-active={tab.active ? '' : undefined}
      className={cn(
        'border-b-3 pb-3.75 text-xl whitespace-nowrap transition-colors duration-90 ease-out',
        tab.active
          ? 'border-rail-selected font-medium text-fg'
          : 'border-transparent text-fg-muted hover:text-fg',
      )}
    >
      {tab.label}
    </Link>
  )
}

export interface SurfaceHeaderCrumb {
  /** The crumb's own mark — a project glyph, a folder icon. Decorative. */
  icon?: ReactNode | undefined
  label: string
  /** `undefined` for the current location, which is text rather than a link. */
  to?: string | undefined
}

export interface SurfaceHeaderCrumbsProps {
  items: readonly SurfaceHeaderCrumb[]
  /** Names the `<nav>`. Defaults to "Breadcrumb", which is the convention. */
  label?: string | undefined
}

/**
 * Row 2's crumb trail, hung off the L-shaped connector the references draw.
 *
 * The connector is `absolute` and the row is `relative`, so its 33px of height does
 * not grow the 24px line box. That matters: the row's height is one of the six
 * numbers that sum to the measured 197, and a 33px item inside it with
 * `items-center` would push the tab row and the bottom rule 9px down.
 *
 * `left-1.75` / `-top-4` / `h-8.25` / `w-3.75` are the measured box — x 415..429,
 * y 71..104, against a row origin of (408, 87). `border-strong` rather than a fourth
 * measured grey: the references' stroke samples L(179, 179, 179) / D(81, 83, 85),
 * which is within a rung of `--border-strong` and is the same weight the project
 * tree's own connectors already use. One token for one kind of line —
 * `docs/product-quality-bar.md` §31.
 *
 * `pl-7.75` is 31px, which clears the connector: it ends at x=429 and the first
 * crumb's icon starts at 439.
 */
export function SurfaceHeaderCrumbs({ items, label = 'Breadcrumb' }: SurfaceHeaderCrumbsProps) {
  return (
    <nav aria-label={label} className="relative mt-3.25 flex items-center">
      <span
        aria-hidden="true"
        className="absolute -top-4 left-1.75 h-8.25 w-3.75 rounded-bl-sm border-b border-l border-border-strong"
      />
      {/**
       * An `<ol>`, because a breadcrumb is an ordered trail and that is what a screen
       * reader announces it as. The separators are `aria-hidden` `<li>`s rather than
       * CSS `::before` content, so the list's own item count stays honest — a
       * pseudo-element separator is invisible to the accessibility tree, which is the
       * correct outcome, and a real `<li>` holding "/" would otherwise be announced
       * as a fourth step in a three-step trail.
       */}
      <ol className="flex min-w-0 items-center gap-4 pl-7.75 text-md">
        {items.map((item, index) => (
          <li key={item.label} className="flex min-w-0 items-center gap-4">
            {index > 0 && (
              <span aria-hidden="true" className="text-fg-subtle select-none">
                /
              </span>
            )}
            {/**
             * `gap-2` — 8px, measured from the crumb icon's right edge to its label's
             * first ink. The 16px on either side of a separator is the `gap-4` above.
             */}
            <span className="flex min-w-0 items-center gap-2">
              {item.icon !== undefined && (
                <span className="flex shrink-0 items-center">{item.icon}</span>
              )}
              {item.to === undefined ? (
                /**
                 * `aria-current="page"` on the last crumb, and it is not a link.
                 * A link to the page you are already on is a control with no effect,
                 * and the attribute is how assistive technology is told which crumb
                 * is the destination rather than a step.
                 */
                <span aria-current="page" className="truncate text-fg">
                  {item.label}
                </span>
              ) : (
                <Link
                  to={item.to}
                  className="truncate text-fg-muted transition-colors duration-90 ease-out hover:text-fg"
                >
                  {item.label}
                </Link>
              )}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  )
}
