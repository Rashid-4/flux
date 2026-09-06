import { describe, expect, it } from 'vitest'
import { userToneIndex } from '@/components/data/user-avatar'
import {
  ADA,
  BROKEN_PHOTO,
  GRACE,
  INACTIVE,
  ISSUE_KEY,
  LABELS,
  LONG_ISSUE_KEY,
  LONG_NAME,
  MONONYM,
  PORTRAIT_URL,
  TONE_USERS,
  WITH_PHOTO,
} from './fixtures'

/**
 * The gallery's fixtures are only useful if they are stable and if they cover what
 * they claim to cover.
 *
 * Every value in `fixtures.ts` is already `.parse()`d by its contract schema at
 * module load, so a fixture that has drifted from the contract throws on import and
 * this file cannot even run — that half needs no assertion. What it does not check
 * is the property the *gallery* depends on: that the eight avatar specimens are
 * eight different hues, one per bucket, and stay that way.
 *
 * That mapping is a hash, not a declaration. `userToneIndex` is
 * `hash * 31 + charCode`, and changing it — or changing `TONE_COUNT`, or editing a
 * uuid by one character — silently repaints two of the eight the same colour. On a
 * swatch grid whose whole job is "these are all different", two identical chips is
 * the failure that looks like a design decision.
 */

describe('gallery fixtures', () => {
  it('covers all eight avatar tones, one specimen each', () => {
    expect(TONE_USERS).toHaveLength(8)

    const tones = TONE_USERS.map((user) => userToneIndex(user.id))

    expect(tones).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(new Set(tones).size).toBe(8)
  })

  it('gives every tone user a distinct id', () => {
    const ids = TONE_USERS.map((user) => user.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * `userInitials` has three branches — two parts, one part, and an empty name —
   * and the gallery is meant to show the first two. A fixture set where every name
   * is "First Last" exercises one of them and looks complete.
   */
  it('includes a one-word name and a multi-part name', () => {
    expect(MONONYM.displayName.split(/\s+/)).toHaveLength(1)
    expect(LONG_NAME.displayName.length).toBeGreaterThan(30)
  })

  it('includes an inactive user, so the greyed treatment has a subject', () => {
    expect(INACTIVE.isInactive).toBe(true)
    expect(ADA.isInactive).toBe(false)
    expect(GRACE.isInactive).toBe(false)
  })

  /**
   * The portrait has to render with no network. A remote URL would 404 in a
   * screenshot run and quietly demonstrate the *fallback* while the caption said
   * "image" — the specimen would be wrong and nothing would say so.
   */
  it('serves the portrait from a data URI rather than the network', () => {
    expect(PORTRAIT_URL.startsWith('data:image/svg+xml')).toBe(true)
    expect(WITH_PHOTO.avatarUrl).toBe(PORTRAIT_URL)
  })

  it('keeps one deliberately broken photo, to exercise the fallback', () => {
    expect(BROKEN_PHOTO.avatarUrl).not.toBeNull()
    expect(BROKEN_PHOTO.avatarUrl).not.toBe(PORTRAIT_URL)
  })

  /**
   * `LabelChip` and `IssueKey` both cap at `max-w-40`. A fixture set that never
   * exceeds it cannot show whether truncation works, and truncation is the thing
   * that breaks a board row.
   */
  it('spans the truncation boundary on both sides', () => {
    expect(LABELS.some((label) => label.length < 10)).toBe(true)
    expect(LABELS.some((label) => label.length > 24)).toBe(true)
    expect(LONG_ISSUE_KEY.length).toBeGreaterThan(ISSUE_KEY.length)
  })
})
