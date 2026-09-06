import type { Bootstrap } from '@flux/contracts'
import { useOutletContext } from 'react-router'

/**
 * What the shell hands to the surface inside it.
 *
 * `bootstrap` is passed down rather than re-read with `useBootstrap()` in each
 * route, and that is a deliberate difference in *kind*, not a micro-optimisation.
 * The query would be a cache hit either way. What the context buys is the type:
 * `useBootstrap()` returns `UseQueryResult<Bootstrap>`, so `data` is
 * `Bootstrap | undefined` and every route would have to handle an undefined it
 * cannot actually receive — the shell already gated on it. Nine routes each writing
 * `if (!data) return null` is nine places to get the loading state subtly wrong, and
 * `data!` is the version people write instead.
 *
 * Here it is `Bootstrap`, full stop. The shell renders no `<Outlet />` until it has
 * one, which is docs/specs/web/README.md §4: *"**The shell renders after one
 * request.**"*
 */
export interface ShellContext {
  bootstrap: Bootstrap
}

/**
 * The shell's context, or a thrown error naming the mistake.
 *
 * `useOutletContext` returns `null` when a route is not inside an `<Outlet>` that
 * provided one. Returning that `null` to the caller would make the failure a
 * `Cannot read properties of null` several frames away from its cause; throwing here
 * puts the explanation at the point where it is knowable. §13's rule about never
 * showing an error that says nothing applies to the developer reading a stack trace
 * too — and `../app-error-boundary.tsx` catches this, so the user sees a message
 * rather than a white page.
 */
export function useShellContext(): ShellContext {
  const context = useOutletContext<ShellContext | null>()
  if (context === null) {
    throw new Error(
      'useShellContext was called outside the app shell. The component is being rendered ' +
        'by a route that is not a child of the shell route, so there is no bootstrap data ' +
        'to read. Nest the route under the shell, or read the query directly.',
    )
  }
  return context
}
