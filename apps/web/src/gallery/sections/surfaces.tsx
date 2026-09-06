import { Archive, Copy, MoreHorizontal, Pencil, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Note, Panel, Section, Specimen } from '../frame'
import { PORTRAIT_URL } from '../fixtures'

/**
 * Everything that is a surface, a container, or a floating layer.
 *
 * ### Why the menus are not pinned open
 *
 * They were, briefly, via `useState(true)`. It does not work and the reason is
 * worth writing down: Radix writes back through `onOpenChange`, and under
 * `StrictMode`'s deliberate mount → unmount → remount the teardown fires
 * `onOpenChange(false)`, which the controlled state then keeps. The panel is shut
 * before the first paint, and the page looks exactly as if the prop had been
 * ignored.
 *
 * `Tooltip` is unaffected — `open` on it is not written back the same way — which
 * is why the pinned tooltips below do work, and why the inconsistency looked like a
 * Radix bug rather than a StrictMode interaction.
 *
 * They are also portalled to `document.body`, so an element-scoped screenshot of
 * this section would not contain them even when open. Both problems have the same
 * answer: the screenshot run clicks each trigger and captures the viewport, the
 * same way it handles dialogs.
 */

const BADGE_VARIANTS = [
  'neutral',
  'primary',
  'success',
  'warning',
  'info',
  'danger',
  'outline',
] as const

export function SurfacesSection() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [density, setDensity] = useState('comfortable')
  const [showDone, setShowDone] = useState(true)

  return (
    <Section
      id="surfaces"
      title="Surfaces and overlays"
      note="Badge, Avatar, Separator, Skeleton, ScrollArea, Tabs, Tooltip, Popover, DropdownMenu and Dialog. Open the menus and popovers to judge them — item height, the check-mark column and the separator inset only exist once the panel is on screen, and a screenshot run clicks each one and captures it."
    >
      <Panel label="Badge · variants">
        {BADGE_VARIANTS.map((variant) => (
          <Specimen key={variant} label={variant}>
            <Badge variant={variant}>In progress</Badge>
          </Specimen>
        ))}
      </Panel>

      <Panel
        label="Badge · sizes"
        note="sm is the uppercase micro-label: 10px, 600 weight and 0.08em tracking carried by the token itself, which is what stops uppercase from setting as a solid block."
      >
        <Specimen label="sm · uppercase">
          <Badge size="sm">Review</Badge>
        </Specimen>
        <Specimen label="md">
          <Badge size="md">Review</Badge>
        </Specimen>
        <Specimen label="sm · danger">
          <Badge size="sm" variant="danger">
            Breached
          </Badge>
        </Specimen>
        <Specimen label="md · outline">
          <Badge variant="outline">needs-design</Badge>
        </Specimen>
        <Specimen label="long value">
          <Badge variant="outline" className="max-w-40">
            <span className="truncate">regression-from-2024-q4-migration</span>
          </Badge>
        </Specimen>
        <Specimen label="row of six">
          <Badge variant="primary">Sprint 24</Badge>
          <Badge variant="info">In progress</Badge>
          <Badge variant="success">Done</Badge>
          <Badge variant="warning">At risk</Badge>
          <Badge variant="danger">Breached</Badge>
          <Badge variant="outline">backend</Badge>
        </Specimen>
      </Panel>

      <Panel label="Avatar · sizes and slots">
        <Specimen label="sm · 24px">
          <Avatar size="sm">
            <AvatarFallback>AL</AvatarFallback>
          </Avatar>
        </Specimen>
        <Specimen label="md · 32px">
          <Avatar>
            <AvatarFallback>AL</AvatarFallback>
          </Avatar>
        </Specimen>
        <Specimen label="lg · 40px">
          <Avatar size="lg">
            <AvatarFallback>AL</AvatarFallback>
          </Avatar>
        </Specimen>
        <Specimen label="image">
          <Avatar size="lg">
            <AvatarImage src={PORTRAIT_URL} alt="Ada Lovelace" />
            <AvatarFallback>AL</AvatarFallback>
          </Avatar>
        </Specimen>
        <Specimen label="image 404 → fallback">
          <Avatar size="lg">
            <AvatarImage src="/gallery-no-such-image.png" alt="Grace Hopper" />
            <AvatarFallback>GH</AvatarFallback>
          </Avatar>
        </Specimen>
        <Specimen label="badge">
          <Avatar size="lg">
            <AvatarFallback>AL</AvatarFallback>
            <AvatarBadge className="bg-success-solid" aria-label="Online" role="img" />
          </Avatar>
        </Specimen>
        <Specimen label="group + count">
          <AvatarGroup aria-label="Ada Lovelace, Grace Hopper, Alan Turing and 32 others">
            <Avatar size="sm">
              <AvatarFallback>AL</AvatarFallback>
            </Avatar>
            <Avatar size="sm">
              <AvatarFallback>GH</AvatarFallback>
            </Avatar>
            <Avatar size="sm">
              <AvatarFallback>AT</AvatarFallback>
            </Avatar>
            <AvatarGroupCount>+32</AvatarGroupCount>
          </AvatarGroup>
        </Specimen>
      </Panel>

      <Note>
        The ring on a grouped avatar is a cut-out and has to match whatever is behind the stack.
        These sit on <code className="font-mono">surface</code>, which is what{' '}
        <code className="font-mono">ring-surface</code> assumes; on{' '}
        <code className="font-mono">canvas</code> the caller passes{' '}
        <code className="font-mono">ring-canvas</code>.
      </Note>

      <Panel label="Separator">
        <Specimen label="horizontal" wide>
          <div className="w-full max-w-md">
            <p className="text-sm text-fg-muted">Details</p>
            <Separator className="my-2" />
            <p className="text-sm text-fg-muted">Activity</p>
          </div>
        </Specimen>
        <Specimen label="vertical">
          <div className="flex h-8 items-center gap-3">
            <span className="text-sm text-fg-muted">Board</span>
            <Separator orientation="vertical" />
            <span className="text-sm text-fg-muted">Backlog</span>
            <Separator orientation="vertical" />
            <span className="text-sm text-fg-muted">Reports</span>
          </div>
        </Specimen>
      </Panel>

      <Panel
        label="Skeleton"
        note="A skeleton must occupy exactly the box its real content will, or the page jumps when data lands. The pair below is the check: the same row, loading and loaded."
        className="flex-col items-stretch"
      >
        <Specimen label="loading row · SkeletonText" wide>
          {/*
            The two text steps are marked up exactly as the loaded row is —
            `text-base` over `text-sm` — and SkeletonText takes its height from
            that rather than from a guessed `h-3.5`. The hand-picked version of
            this row measured 58px against the loaded row's 70.
          */}
          <div className="flex w-full max-w-md items-center gap-3 rounded-card border border-border p-3">
            <Skeleton className="size-avatar rounded-chip" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="text-base">
                <SkeletonText className="w-2/3" />
              </div>
              <div className="text-sm">
                <SkeletonText className="w-1/3" />
              </div>
            </div>
            <Skeleton className="h-5 w-16 rounded-chip" />
          </div>
        </Specimen>
        <Specimen label="loading row · hand-picked heights" wide>
          {/*
            Kept beside it on purpose. This is the version a caller writes when the
            rule is "match the box" and the tool is a plain Skeleton, and the gap
            between this row and the loaded one is the whole argument for the
            variant above.
          */}
          <div className="flex w-full max-w-md items-center gap-3 rounded-card border border-border p-3">
            <Skeleton className="size-avatar rounded-chip" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-5 w-16 rounded-chip" />
          </div>
        </Specimen>
        <Specimen label="the same row, loaded" wide>
          <div className="flex w-full max-w-md items-center gap-3 rounded-card border border-border p-3">
            <Avatar size="sm">
              <AvatarFallback>AL</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="truncate text-base text-fg">Fix the login redirect</p>
              <p className="truncate text-sm text-fg-subtle">Ada Lovelace</p>
            </div>
            <Badge variant="info">In progress</Badge>
          </div>
        </Specimen>
      </Panel>

      <Panel
        label="ScrollArea"
        note="For constrained popovers. A board-scale list uses VirtualList."
      >
        <Specimen label="vertical" wide>
          <ScrollArea className="h-40 w-64 rounded-card border border-border">
            <div className="flex flex-col p-2">
              {Array.from({ length: 18 }, (_, index) => (
                <div key={index} className="rounded-control px-2 py-1.5 text-base text-fg">
                  Workflow state {String(index + 1)}
                </div>
              ))}
            </div>
          </ScrollArea>
        </Specimen>
      </Panel>

      <Panel label="Tabs" className="flex-col items-stretch">
        <Specimen label="solid · the default" wide>
          <Tabs defaultValue="board">
            <TabsList>
              <TabsTrigger value="board">Board</TabsTrigger>
              <TabsTrigger value="backlog">Backlog</TabsTrigger>
              <TabsTrigger value="reports">Reports</TabsTrigger>
            </TabsList>
            <TabsContent value="board" className="pt-3 text-sm text-fg-muted">
              A 32px trough with p-1, giving a 24px chip at 8px radius.
            </TabsContent>
            <TabsContent value="backlog" className="pt-3 text-sm text-fg-muted">
              Backlog panel.
            </TabsContent>
            <TabsContent value="reports" className="pt-3 text-sm text-fg-muted">
              Reports panel.
            </TabsContent>
          </Tabs>
        </Specimen>
        <Specimen label="line" wide>
          <Tabs variant="line" defaultValue="details">
            <TabsList>
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="pt-3 text-sm text-fg-muted">
              The underlined strip.
            </TabsContent>
            <TabsContent value="activity" className="pt-3 text-sm text-fg-muted">
              Activity panel.
            </TabsContent>
            <TabsContent value="history" className="pt-3 text-sm text-fg-muted">
              History panel.
            </TabsContent>
          </Tabs>
        </Specimen>
        <Specimen label="solid · vertical" wide>
          <Tabs orientation="vertical" defaultValue="general" className="flex gap-4">
            <TabsList>
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="fields">Fields</TabsTrigger>
              <TabsTrigger value="access">Access</TabsTrigger>
            </TabsList>
            <TabsContent value="general" className="text-sm text-fg-muted">
              General settings.
            </TabsContent>
            <TabsContent value="fields" className="text-sm text-fg-muted">
              Field configuration.
            </TabsContent>
            <TabsContent value="access" className="text-sm text-fg-muted">
              Access and roles.
            </TabsContent>
          </Tabs>
        </Specimen>
      </Panel>

      <Panel
        label="Tooltip"
        note="400ms delay — Radix ships 700, which feels broken, and shadcn ships 0, which fires at a pointer merely crossing a toolbar. z-60, so a tooltip inside a dialog clears it."
      >
        <Specimen label="hover or focus me">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Archive">
                <Archive aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Archive this issue</TooltipContent>
          </Tooltip>
        </Specimen>
        <Specimen label="pinned open">
          <Tooltip open>
            <TooltipTrigger asChild>
              <Button variant="secondary" size="sm">
                Trigger
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Assign to me · A</TooltipContent>
          </Tooltip>
        </Specimen>
        <Specimen label="pinned · long">
          <Tooltip open>
            <TooltipTrigger asChild>
              <Button variant="secondary" size="sm">
                Long
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Republishing changes the workflow for every project that uses this family
            </TooltipContent>
          </Tooltip>
        </Specimen>
      </Panel>

      <Panel label="Popover">
        <Specimen label="closed">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary" size="sm">
                <UserPlus aria-hidden="true" />
                Invite
              </Button>
            </PopoverTrigger>
            <PopoverContent aria-label="Invite a teammate">
              <PopoverHeader>
                <PopoverTitle>Invite a teammate</PopoverTitle>
                <PopoverDescription>They will get a seat on this organization.</PopoverDescription>
              </PopoverHeader>
              <div className="flex flex-col gap-2 pt-3">
                <Label htmlFor="gallery-invite">Email</Label>
                <Input id="gallery-invite" placeholder="name@example.com" />
              </div>
            </PopoverContent>
          </Popover>
        </Specimen>
        <Specimen label="open">
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="secondary" size="sm">
                Toggle open
              </Button>
            </PopoverTrigger>
            <PopoverContent aria-label="Account" side="bottom" align="start">
              <PopoverHeader>
                <PopoverTitle>Ada Lovelace</PopoverTitle>
                <PopoverDescription>ada@nimbus.example</PopoverDescription>
              </PopoverHeader>
            </PopoverContent>
          </Popover>
        </Specimen>
      </Panel>

      <Note>
        <code className="font-mono">PopoverContent</code> makes one of{' '}
        <code className="font-mono">aria-label</code> /{' '}
        <code className="font-mono">aria-labelledby</code> a <em>type</em> requirement. Radix gives
        the panel <code className="font-mono">role=&quot;dialog&quot;</code>, and a dialog with no
        name is announced as &ldquo;dialog&rdquo; and nothing else — unlike{' '}
        <code className="font-mono">Dialog</code>, which labels itself from its own{' '}
        <code className="font-mono">Title</code>.
      </Note>

      <Panel label="Dropdown menu">
        <Specimen label="closed">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Issue actions">
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Issue</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem>
                  <Pencil aria-hidden="true" />
                  Edit
                  <DropdownMenuShortcut>E</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Copy aria-hidden="true" />
                  Copy link
                  <DropdownMenuShortcut>⌘⇧C</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem>Platform</DropdownMenuItem>
                    <DropdownMenuItem>Growth</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="danger">
                <Trash2 aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Specimen>

        <Specimen label="open · full vocabulary">
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm">
                Toggle open
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="bottom">
              <DropdownMenuLabel>View</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={showDone}
                onCheckedChange={(next) => {
                  setShowDone(next)
                }}
              >
                Show done issues
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={false}>Show subtasks</DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Density</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={density} onValueChange={setDensity}>
                <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>
                <Archive aria-hidden="true" />
                Archive (no permission)
              </DropdownMenuItem>
              <DropdownMenuItem variant="danger">
                <Trash2 aria-hidden="true" />
                Delete board
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Specimen>
      </Panel>

      <Note>
        The check-mark column on a menu reserves its width whether or not anything is selected —
        that is what stops the label shifting sideways when a checkbox item is toggled. It is
        visible in the &ldquo;open&rdquo; specimen above with <em>Show subtasks</em> unchecked next
        to <em>Show done issues</em> checked.
      </Note>

      <Panel label="Dialog">
        <Specimen label="destructive confirm">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="danger" size="sm">
                Delete project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Platform Engineering?</DialogTitle>
                <DialogDescription>
                  1,284 issues, 3 boards and 12 saved views will be archived. This cannot be undone
                  from the UI.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary">Cancel</Button>
                </DialogClose>
                <Button variant="danger">Delete</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Specimen>
        <Specimen label="long body scrolls, footer stays">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary" size="sm">
                Long dialog
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  A title long enough to wrap onto a second line, which is why leading-none was
                  dropped
                </DialogTitle>
                <DialogDescription>
                  max-h of the viewport minus 4rem, with overflow-y auto. Without it a long form
                  runs off the top and the bottom at once and the submit button is unreachable.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                {Array.from({ length: 12 }, (_, index) => (
                  <div key={index} className="flex flex-col gap-1.5">
                    <Label htmlFor={`gallery-field-${String(index)}`}>
                      Field {String(index + 1)}
                    </Label>
                    <Input id={`gallery-field-${String(index)}`} placeholder="Value" />
                  </div>
                ))}
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary">Cancel</Button>
                </DialogClose>
                <Button variant="primary">Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Specimen>
      </Panel>
    </Section>
  )
}
