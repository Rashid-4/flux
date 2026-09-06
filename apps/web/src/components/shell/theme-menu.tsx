import { Monitor, Moon, Sun } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import {
  THEME_PREFERENCES,
  type ThemePreference,
  useSetThemePreference,
  useTheme,
  useThemePreference,
} from '@/stores/theme'

/**
 * Light, dark, or follow the system — from the icon rail.
 *
 * A radio group and not a cycling toggle. A single button that steps
 * light → dark → system through three states is a control whose next effect the user
 * has to remember, and one of the three is invisible until they land on it. Three
 * items with the current one ticked answers "what is it set to" without a click.
 *
 * ### The third label says what the system currently is
 *
 * "System (dark)", not "System". Following the OS is the default, so most users see
 * this option selected, and "System" alone leaves the obvious question unanswered —
 * *and which is that right now?* `useTheme()` is the one legitimate reason to read
 * the resolved theme in JavaScript, and ../../stores/theme.ts says so at the field:
 * styling goes through the `dark:` variant, and this is one of the handful of cases
 * the variant cannot express because the answer is a **word**, not a colour.
 */

const PREFERENCE_ICON: Record<ThemePreference, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

const PREFERENCE_LABEL: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

function isThemePreference(value: string): value is ThemePreference {
  return (THEME_PREFERENCES as readonly string[]).includes(value)
}

export function ThemeMenu() {
  const preference = useThemePreference()
  const resolved = useTheme()
  const setPreference = useSetThemePreference()
  const TriggerIcon = PREFERENCE_ICON[preference]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/**
         * No tooltip on this trigger, unlike the nav items beside it.
         *
         * Radix's tooltip and its dropdown both own the trigger's focus and hover
         * behaviour, and composing them means the tooltip is still open behind the
         * menu after a click — a stale annotation floating over the menu it
         * describes. The `aria-label` is the real name either way (a tooltip is a
         * *description*, never a name — ../ui/tooltip.tsx), so nothing is lost for
         * a screen-reader user, and a sighted user gets the answer from the menu
         * itself, which is one click away rather than a hover away.
         */}
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Theme: ${PREFERENCE_LABEL[preference]}${preference === 'system' ? ` (${resolved})` : ''}`}
        >
          <TriggerIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="right" align="end" className="w-44">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preference}
          /**
           * Radix types this callback's argument as `string`, because a radio group
           * is generic over whatever strings it is given. Narrowing rather than
           * casting: a value that is not one of the three is dropped instead of
           * being written to `localStorage`, where ../../stores/theme.ts would then
           * read it back, fail its own guard, and silently reset to `system`.
           */
          onValueChange={(value) => {
            if (isThemePreference(value)) setPreference(value)
          }}
        >
          {THEME_PREFERENCES.map((option) => {
            const Icon = PREFERENCE_ICON[option]
            return (
              <DropdownMenuRadioItem key={option} value={option}>
                <Icon aria-hidden="true" className="size-4" />
                {option === 'system' ? `System (${resolved})` : PREFERENCE_LABEL[option]}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
