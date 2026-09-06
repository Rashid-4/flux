import { ChevronDown, Plus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Note, Panel, Section, Specimen } from '../frame'

/**
 * The form controls, and the ladder they all share.
 *
 * The row worth staring at is "one ladder, four components": button, input, select
 * trigger and a bare 32px block at each size. If a form row shifts by a pixel when
 * a select replaces an input, it shows up there and nowhere else — a component
 * looked at on its own always looks fine.
 */

const BUTTON_VARIANTS = [
  'primary',
  'contrast',
  'secondary',
  'ghost',
  'danger',
  'danger-ghost',
  'link',
] as const

const BUTTON_SIZES = ['xs', 'sm', 'md', 'lg'] as const
const ICON_SIZES = ['icon-xs', 'icon-sm', 'icon', 'icon-lg'] as const

export function ControlsSection() {
  const [checked, setChecked] = useState(true)
  const [indeterminate, setIndeterminate] = useState<boolean | 'indeterminate'>('indeterminate')
  const [radio, setRadio] = useState('kanban')
  const [enabled, setEnabled] = useState(true)

  return (
    <Section
      id="controls"
      title="Controls"
      note="Button, Input, Label, Checkbox, RadioGroup, Switch and Select. Every height comes from one ladder — 24 / 28 / 32 / 40 — so a filter bar lines up without per-component nudging."
    >
      <Panel label="Button · variants" note="Default variant is secondary, not primary.">
        {BUTTON_VARIANTS.map((variant) => (
          <Specimen key={variant} label={variant}>
            <Button variant={variant}>Create task</Button>
          </Specimen>
        ))}
      </Panel>

      <Panel label="Button · sizes" note="Baseline-aligned so the ladder is readable as a ladder.">
        {BUTTON_SIZES.map((size) => (
          <Specimen key={size} label={size}>
            <Button size={size}>Create task</Button>
          </Specimen>
        ))}
        {BUTTON_SIZES.map((size) => (
          <Specimen key={`icon-${size}`} label={`${size} + icon`}>
            <Button size={size}>
              <Plus aria-hidden="true" />
              Create
            </Button>
          </Specimen>
        ))}
      </Panel>

      <Panel label="Button · icon only" note="Square at every rung. Always an aria-label.">
        {ICON_SIZES.map((size) => (
          <Specimen key={size} label={size}>
            <Button size={size} aria-label="Add issue">
              <Plus aria-hidden="true" />
            </Button>
          </Specimen>
        ))}
      </Panel>

      <Panel label="Button · states">
        <Specimen label="rest">
          <Button variant="primary">Publish</Button>
        </Specimen>
        <Specimen label="hover (forced in screenshots)">
          <Button variant="primary" data-probe="hover">
            Publish
          </Button>
        </Specimen>
        <Specimen label="focus-visible (tab to it)">
          <Button variant="primary" data-probe="focus-visible">
            Publish
          </Button>
        </Specimen>
        <Specimen label="active (forced)">
          <Button variant="primary" data-probe="active">
            Publish
          </Button>
        </Specimen>
        <Specimen label="disabled">
          <Button variant="primary" disabled>
            Publish
          </Button>
        </Specimen>
        <Specimen label="danger disabled">
          <Button variant="danger" disabled>
            <Trash2 aria-hidden="true" />
            Delete
          </Button>
        </Specimen>
        <Specimen label="long label · no wrap">
          <div className="w-[220px]">
            <Button variant="secondary" className="w-full">
              <span className="truncate">Republish workflow to every project</span>
            </Button>
          </div>
        </Specimen>
      </Panel>

      <Note>
        The <code className="font-mono">data-probe</code> specimens render at rest in a browser —
        hover them, or tab to them. A screenshot run drives them for real rather than pasting the
        hover classes into a class list, so what a screenshot shows is the actual rule:{' '}
        <code className="font-mono">:hover</code> and <code className="font-mono">:active</code> are
        forced through CDP, and <code className="font-mono">:focus-visible</code> is a genuine{' '}
        <code className="font-mono">focus(&#123;focusVisible: true&#125;)</code>, captured one
        element at a time because only one thing can hold focus. CDP&rsquo;s{' '}
        <code className="font-mono">forcePseudoState</code> silently does nothing for{' '}
        <code className="font-mono">:focus-visible</code> — it was measured, and the first version
        of this page claimed otherwise.
      </Note>

      <Panel label="Input" grid>
        <Specimen label="placeholder">
          <Input placeholder="Search issues" aria-label="Search issues" />
        </Specimen>
        <Specimen label="filled">
          <Input defaultValue="status = open" aria-label="Filter" />
        </Specimen>
        <Specimen label="sm · 28px">
          <Input size="sm" placeholder="Search" aria-label="Small search" />
        </Specimen>
        <Specimen label="quiet fill · bg-surface-2">
          <Input placeholder="Search" aria-label="Quiet search" className="bg-surface-2" />
        </Specimen>
        <Specimen label="focus-visible (tab to it)">
          <Input placeholder="Search" aria-label="Focused search" data-probe="focus-visible" />
        </Specimen>
        <Specimen label="invalid">
          <Input defaultValue="not-an-email" aria-invalid aria-label="Email" />
        </Specimen>
        <Specimen label="disabled">
          <Input defaultValue="Locked" disabled aria-label="Locked" />
        </Specimen>
        <Specimen label="overflowing value">
          <Input
            defaultValue="project = PLATFORM AND status changed to 'In Progress' after -14d"
            aria-label="Long filter"
          />
        </Specimen>
        <Specimen label="with leading icon">
          <div className="relative w-full">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle"
            />
            <Input placeholder="Search" aria-label="Search with icon" className="pl-8" />
          </div>
        </Specimen>
      </Panel>

      <Panel label="Label + field" grid>
        <Specimen label="paired">
          <div className="flex w-full flex-col gap-1.5">
            <Label htmlFor="gallery-summary">Summary</Label>
            <Input id="gallery-summary" placeholder="What needs doing?" />
          </div>
        </Specimen>
        <Specimen label="disabled pair">
          <div className="flex w-full flex-col gap-1.5">
            <Label htmlFor="gallery-key">Project key</Label>
            <Input id="gallery-key" defaultValue="FLUX" disabled className="peer" />
          </div>
        </Specimen>
      </Panel>

      <Panel label="Checkbox">
        <Specimen label="unchecked">
          <Checkbox aria-label="Unchecked" />
        </Specimen>
        <Specimen label="checked">
          <Checkbox
            checked={checked}
            onCheckedChange={(next) => {
              setChecked(next === true)
            }}
            aria-label="Checked"
          />
        </Specimen>
        <Specimen label="indeterminate">
          <Checkbox
            checked={indeterminate}
            onCheckedChange={() => {
              setIndeterminate((prev) => (prev === 'indeterminate' ? true : 'indeterminate'))
            }}
            aria-label="Some selected"
          />
        </Specimen>
        <Specimen label="focus-visible (tab to it)">
          <Checkbox aria-label="Focused" data-probe="focus-visible" />
        </Specimen>
        <Specimen label="disabled">
          <Checkbox disabled aria-label="Disabled" />
        </Specimen>
        <Specimen label="disabled + checked">
          <Checkbox disabled checked aria-label="Disabled checked" />
        </Specimen>
        <Specimen label="with label">
          <div className="flex items-center gap-2">
            <Checkbox id="gallery-done" />
            <Label htmlFor="gallery-done">Only my issues</Label>
          </div>
        </Specimen>
      </Panel>

      <Panel label="Radio group">
        <Specimen label="group" wide>
          <RadioGroup value={radio} onValueChange={setRadio} aria-label="Board type">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="kanban" id="gallery-kanban" />
              <Label htmlFor="gallery-kanban">Kanban</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="scrum" id="gallery-scrum" />
              <Label htmlFor="gallery-scrum">Scrum</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="none" id="gallery-none" disabled />
              <Label htmlFor="gallery-none">No board (disabled)</Label>
            </div>
          </RadioGroup>
        </Specimen>
        <Specimen label="focus-visible (tab to it)">
          <RadioGroup defaultValue="a" aria-label="Focused radio">
            <RadioGroupItem value="a" aria-label="Focused item" data-probe="focus-visible" />
          </RadioGroup>
        </Specimen>
      </Panel>

      <Panel label="Switch" note="Toggles on Enter, unlike Checkbox. Upstream and deliberate.">
        <Specimen label="sm · off">
          <Switch size="sm" aria-label="Small off" />
        </Specimen>
        <Specimen label="sm · on">
          <Switch size="sm" defaultChecked aria-label="Small on" />
        </Specimen>
        <Specimen label="md · off">
          <Switch aria-label="Off" />
        </Specimen>
        <Specimen label="md · on">
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Notifications enabled"
          />
        </Specimen>
        <Specimen label="focus-visible (tab to it)">
          <Switch aria-label="Focused switch" data-probe="focus-visible" />
        </Specimen>
        <Specimen label="disabled">
          <Switch disabled aria-label="Disabled switch" />
        </Specimen>
        <Specimen label="disabled + on">
          <Switch disabled defaultChecked aria-label="Disabled on" />
        </Specimen>
      </Panel>

      <Panel
        label="Select"
        note="A select, not a combobox: correct for a closed list, wrong for anything that grows. position defaults to popper here, unlike shadcn — under item-aligned every side/offset class the generator wrote was inert."
        grid
      >
        <Specimen label="default · 32px">
          <Select>
            <SelectTrigger aria-label="Status">
              <SelectValue placeholder="Any status" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Category</SelectLabel>
                <SelectItem value="todo">To do</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </Specimen>
        <Specimen label="sm · 28px">
          <Select>
            <SelectTrigger size="sm" aria-label="Small status">
              <SelectValue placeholder="Any status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todo">To do</SelectItem>
              <SelectItem value="done">Done</SelectItem>
            </SelectContent>
          </Select>
        </Specimen>
        <Specimen label="with a value">
          <Select defaultValue="in_progress">
            <SelectTrigger aria-label="Chosen status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todo">To do</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
            </SelectContent>
          </Select>
        </Specimen>
        <Specimen label="long value truncates">
          <Select defaultValue="long">
            <SelectTrigger aria-label="Long value">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="long">Awaiting security review from the platform team</SelectItem>
            </SelectContent>
          </Select>
        </Specimen>
        <Specimen label="invalid">
          <Select>
            <SelectTrigger aria-invalid aria-label="Invalid select">
              <SelectValue placeholder="Required" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">A</SelectItem>
            </SelectContent>
          </Select>
        </Specimen>
        <Specimen label="disabled">
          <Select disabled>
            <SelectTrigger aria-label="Disabled select">
              <SelectValue placeholder="Unavailable" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">A</SelectItem>
            </SelectContent>
          </Select>
        </Specimen>
      </Panel>

      <Panel
        label="One ladder, four components"
        note="The whole reason the ladder exists. Any disagreement in height shows here as a step in the baseline."
        className="flex-col items-stretch"
      >
        {(['sm', 'md'] as const).map((size) => (
          <div key={size} className="flex flex-wrap items-end gap-2">
            <span className="w-10 shrink-0 font-mono text-2xs text-fg-subtle">{size}</span>
            <Button size={size}>Button</Button>
            <Button size={size === 'sm' ? 'icon-sm' : 'icon'} aria-label={`Add ${size}`}>
              <Plus aria-hidden="true" />
            </Button>
            <div className={size === 'sm' ? 'w-40' : 'w-48'}>
              <Input
                size={size === 'sm' ? 'sm' : 'default'}
                placeholder="Input"
                aria-label={`Input ${size}`}
              />
            </div>
            <Select>
              <SelectTrigger
                size={size === 'sm' ? 'sm' : 'default'}
                className="w-40"
                aria-label={`Select ${size}`}
              >
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a">A</SelectItem>
              </SelectContent>
            </Select>
            <div
              className={`flex items-center rounded-control border border-dashed border-border-strong px-2 text-2xs text-fg-subtle ${
                size === 'sm' ? 'h-7' : 'h-8'
              }`}
            >
              <ChevronDown aria-hidden="true" className="mr-1 size-3" />
              {size === 'sm' ? '28px' : '32px'}
            </div>
          </div>
        ))}
      </Panel>
    </Section>
  )
}
