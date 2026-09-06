import { type IssueKey, IssueKeySchema, type UserRef, UserRefSchema } from '@flux/contracts'

/**
 * The gallery's specimen data, parsed by its contract schema at construction.
 *
 * ### Why not `@flux/mocks`
 *
 * That package is the right answer for tests and for MSW, and it is a
 * devDependency — `src/test/**` imports it and is excluded from
 * `tsconfig.app.json` for exactly that reason. `src/gallery/**` is *not* excluded
 * from that project, so importing it here would put a devDependency inside the
 * config whose whole job is to describe what ships to a browser. The gallery needs
 * six users and a handful of strings; that is not worth blurring the line.
 *
 * What is worth keeping is the property that makes `@flux/mocks` trustworthy: every
 * fixture below goes through `.parse()`, so a fixture that has drifted from the
 * contract fails at module load with a path to the offending field, rather than
 * rendering a shape the API will never send. A hand-written object literal is a
 * *claim* that the contract looks like this; a parsed one is checked.
 *
 * ### Why the ids are fixed strings and not `newId()`
 *
 * `UserAvatar` derives its hue from a hash of the user id, so random ids would
 * repaint the avatar row on every reload and make a screenshot diff meaningless.
 * These are fixed, and chosen so that the six people below plus `TONE_USERS` cover
 * all eight `--entity-*` hues exactly once — the last hex digit is what moves the
 * hash between buckets, and the mapping is asserted in
 * `src/gallery/fixtures.test.ts` so a change to `userToneIndex` shows up as a
 * failing test rather than as two people in the same colour.
 */

/** A valid v7-shaped uuid whose final digit selects the avatar tone. */
function userId(tail: string): string {
  return `0195f0d2-7a41-7c3b-9e10-00000000000${tail}`
}

/** `userToneIndex` bucket -> the id tail that lands in it. Verified by test. */
const TONE_TAIL = ['2', '3', '4', '5', '6', '7', '0', '1'] as const

function user(tone: number, displayName: string, isInactive = false): UserRef {
  const tail = TONE_TAIL[tone]
  if (tail === undefined) throw new Error(`No id tail for tone ${String(tone)}`)
  return UserRefSchema.parse({
    id: userId(tail),
    displayName,
    avatarUrl: null,
    isInactive,
  })
}

/**
 * One user per hue, in tone order, so the avatar row shows all eight fills and
 * their measured foregrounds side by side.
 *
 * The names are ordinary on purpose. An avatar row full of "Test User 1" hides the
 * two things this component actually gets wrong: initials derived from a
 * single-word name, and initials derived from a name with three parts.
 */
export const TONE_USERS: readonly UserRef[] = [
  user(0, 'Ada Lovelace'),
  user(1, 'Grace Hopper'),
  user(2, 'Linus Torvalds'),
  user(3, 'Katherine Johnson'),
  user(4, 'Alan Turing'),
  user(5, 'Radia Perlman'),
  user(6, 'Bjarne Stroustrup'),
  user(7, 'Barbara Liskov'),
]

function requireUser(index: number): UserRef {
  const value = TONE_USERS[index]
  if (value === undefined) throw new Error(`No tone user at ${String(index)}`)
  return value
}

export const ADA = requireUser(0)
export const GRACE = requireUser(1)

/** One name, no surname — `userInitials` has a separate branch for this. */
export const MONONYM: UserRef = UserRefSchema.parse({
  id: userId('4'),
  displayName: 'Prince',
  avatarUrl: null,
  isInactive: false,
})

/** Long enough to prove the row truncates rather than reflows around it. */
export const LONG_NAME: UserRef = UserRefSchema.parse({
  id: userId('5'),
  displayName: 'Maximiliana Featherstonehaugh-Wentworth',
  avatarUrl: null,
  isInactive: false,
})

/** The assignee who has left. Greyed, still identifiable, still their own hue. */
export const INACTIVE: UserRef = UserRefSchema.parse({
  id: userId('6'),
  displayName: 'Linus Torvalds',
  avatarUrl: null,
  isInactive: true,
})

/**
 * A user with a photo.
 *
 * An inline SVG data URI rather than a network image: the gallery has to render
 * identically offline and in a screenshot run, and a remote avatar that 404s would
 * silently demonstrate the *fallback* while claiming to demonstrate the image. The
 * colour is a CSS colour keyword because a `#rrggbb` in a JSX attribute is a lint
 * error, and rightly so — this is the one place in the tree where a literal colour
 * is not a token, and it is a fixture rather than a style.
 */
const PORTRAIT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="rebeccapurple"/>
  <circle cx="32" cy="24" r="11" fill="gainsboro"/>
  <path d="M8 64c0-14 11-22 24-22s24 8 24 22z" fill="gainsboro"/>
</svg>`

export const PORTRAIT_URL = `data:image/svg+xml;utf8,${encodeURIComponent(PORTRAIT_SVG)}`

export const WITH_PHOTO: UserRef = UserRefSchema.parse({
  id: userId('7'),
  displayName: 'Ada Lovelace',
  avatarUrl: PORTRAIT_URL,
  isInactive: false,
})

/** A photo URL that will not resolve, so Radix falls through to the initials. */
export const BROKEN_PHOTO: UserRef = UserRefSchema.parse({
  id: userId('0'),
  displayName: 'Grace Hopper',
  avatarUrl: '/gallery-no-such-image.png',
  isInactive: false,
})

export const ISSUE_KEY: IssueKey = IssueKeySchema.parse('FLUX-128')

/**
 * The longest key the contract permits: `ProjectKeySchema` caps the project part
 * at 10 characters, so this is the widest an issue key can legitimately get. Worth
 * pinning rather than inventing — the first attempt here used an 11-character
 * project key, which `IssueKeySchema.parse` rejected at module load. A fixture that
 * cannot exist is not a truncation test.
 */
export const LONG_ISSUE_KEY: IssueKey = IssueKeySchema.parse('INFRAPLTFM-148302')

/**
 * Labels chosen to span the width the component has to survive: one that fits,
 * one at roughly the truncation boundary, and one well past it.
 */
export const LABELS = ['backend', 'needs-design', 'regression-from-2024-q4-migration'] as const

export const LONG_SUMMARY =
  'Board columns lose their mapping when a workflow is republished with a renamed state family'

export const SHORT_SUMMARY = 'Fix the login redirect'
