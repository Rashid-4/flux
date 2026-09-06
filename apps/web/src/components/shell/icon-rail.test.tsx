import { aBootstrap } from '@flux/mocks'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IconRail } from '@/components/shell/icon-rail'
import { NewProjectButton } from '@/components/new-project-button'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'

/**
 * `docs/specs/web/shell.md` §13: *"Nav gating: a matrix over `orgPermissions`
 * asserting hidden vs disabled-with-reason, per §5."*
 *
 * §5's two rules, which are easy to state and easy to get backwards:
 *
 * - **Navigation** to a place the user cannot enter is **hidden**. *"You do not
 *   advertise doors that do not open."*
 * - **An action** the user cannot perform is **shown and disabled, with the reason
 *   in a tooltip and in `aria-describedby`.**
 *
 * Getting them the wrong way round leaks the existence of features people cannot
 * use, or hides the reason they cannot — and the quality bar is explicit that a
 * control which silently does nothing is worse than one that says why it cannot.
 */

/** The rail entries that are gated, and the permission each reads. */
const GATED: readonly { label: string; permission: 'canRunImport' | 'canManageOrganization' }[] = [
  { label: 'Import', permission: 'canRunImport' },
  { label: 'Administration', permission: 'canManageOrganization' },
]

/** The entries that are never gated, so the matrix cannot pass by hiding everything. */
const ALWAYS_PRESENT = ['Your work', 'Projects', 'Search', 'Reports'] as const

function railWith(overrides: Partial<ReturnType<typeof aBootstrap>['orgPermissions']>) {
  const bootstrap = aBootstrap({ orgPermissions: overrides })
  return renderWithProviders(<IconRail bootstrap={bootstrap} />)
}

describe('rule 1 — a place you cannot enter is hidden', () => {
  for (const { label, permission } of GATED) {
    it(`hides ${label} when ${permission} is false`, async () => {
      const { container } = railWith({ [permission]: false })

      expect(screen.queryByRole('link', { name: label })).toBeNull()
      /** Hidden entirely, not rendered-and-disabled: it is a place, not an action. */
      expect(screen.queryByText(label)).toBeNull()
      await expectNoAxeViolations(container)
    })

    it(`shows ${label} as a real link when ${permission} is true`, () => {
      railWith({ [permission]: true })

      const link = screen.getByRole('link', { name: label })
      expect(link).toHaveAttribute('href')
      expect(link).not.toHaveAttribute('aria-disabled')
    })
  }

  /**
   * The anti-vacuity half. Every assertion above is "this is absent", which is also
   * what a rail that rendered nothing at all would produce.
   */
  it('still renders the ungated entries when every permission is false', () => {
    railWith({
      canRunImport: false,
      canManageOrganization: false,
      canCreateProject: false,
      canManageMembers: false,
      canManageFields: false,
      canViewAuditLog: false,
      canRunExport: false,
    })

    for (const label of ALWAYS_PRESENT) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('shows both gated entries when both permissions are true', () => {
    railWith({ canRunImport: true, canManageOrganization: true })
    for (const { label } of GATED) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })
})

describe('rule 2 — an action you cannot perform says why', () => {
  /**
   * `NewProjectButton` is the live implementation of the second rule, and it is
   * `aria-disabled` rather than `disabled` on purpose: a truly disabled button
   * dispatches no pointer events, so the tooltip explaining *why* would never open
   * for exactly the control that needs an explanation.
   */
  it('renders the action, disabled, with the reason reachable', async () => {
    const { container } = renderWithProviders(<NewProjectButton permitted />)

    const button = screen.getByRole('button', { name: /new project/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    /** Not natively disabled — that would remove it from the tab order. */
    expect(button).not.toBeDisabled()
    await expectNoAxeViolations(container)
  })

  it('states the reason rather than leaving the control silent', async () => {
    renderWithProviders(<NewProjectButton permitted />)

    /** Focus opens the tooltip, which is the keyboard path to the explanation. */
    screen.getByRole('button', { name: /new project/i }).focus()
    expect(await screen.findByText(/arrives with project settings/i)).toBeInTheDocument()
  })

  /**
   * The rail hides *places*; this action is hidden when the user cannot perform it
   * at all. Both rules coexist: the reason it is disabled-with-explanation for a
   * permitted user is that the destination does not exist yet, which is a different
   * question from permission.
   */
  it('renders nothing at all for a user who cannot create projects', () => {
    const { container } = renderWithProviders(<NewProjectButton permitted={false} />)
    expect(container).toBeEmptyDOMElement()
  })
})
