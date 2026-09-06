import { useEffect } from 'react'

/**
 * The product name, as `index.html` sets it before React runs.
 *
 * Lower case, because that is how the brand is written everywhere else in this
 * repository — the `<title>` in `index.html` says `flux` and a capital here would be
 * a second spelling of the name.
 */
export const APP_NAME = 'flux'

/**
 * Set the browser tab's title for as long as this component is mounted.
 *
 * Worth a hook rather than being skipped, because the tab title is the only label a
 * user has for a window they are not currently looking at — and a person triaging
 * issues has four flux tabs open. Four tabs all reading `flux` means the browser's
 * tab-search finds nothing and ⌘-clicking through to a board loses which one it was.
 * It is also what a bookmark and a browser-history entry are named after, so an
 * untitled page is an unfindable bookmark.
 *
 * ### Restores on unmount
 *
 * The cleanup puts back whatever the title was before, rather than resetting to
 * `APP_NAME`. Those differ in the case that actually happens: two components with
 * titles mounted in sequence during a route transition, where React unmounts the old
 * one *after* mounting the new one. Resetting to a constant there would leave the tab
 * reading `flux` on a page that had set its own title a moment earlier.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title
    /**
     * `Board — LOG · flux`, with the specific part first. A tab is 150px wide with
     * twelve of them open, and the browser truncates from the *end* — so a title that
     * leads with the product name shows twelve tabs reading `flux — f…` and
     * distinguishes none of them.
     */
    document.title = `${title} · ${APP_NAME}`
    return () => {
      document.title = previous
    }
  }, [title])
}
