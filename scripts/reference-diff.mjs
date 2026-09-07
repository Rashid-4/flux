#!/usr/bin/env node
/**
 * ══════════════════════════════════════════════════════════════════════════
 * reference-diff — put flux and `UI Images/` side by side, and name the gap
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `docs/product-quality-bar.md` asks for a carbon copy of `UI Images/JIRA 1.webp`
 * (dark) and `JIRA 2.webp` (light). Converging on that by eye does not work: a
 * 4px error in a column width is invisible in a screenshot and obvious in a
 * product, and "it looks about right" is how a whole session's worth of spacing
 * ends up 3px off in the same direction.
 *
 * So this is the instrument. It screenshots the running app at the reference's
 * exact viewport, extracts the *structural edges* from both images, and prints
 * the two lists next to each other. An edge is a row or column where the pixel
 * content changes sharply — which is precisely what a rail divider, a panel
 * boundary, a horizontal rule and a card's top edge all are.
 *
 * Edges rather than a pixel difference, and that is the whole design. A pixel
 * diff of two screenshots whose *content* differs — flux's mock projects are not
 * the reference's — is a wall of red that says nothing. Edge positions are
 * content-independent: they are geometry, and geometry is what is being copied.
 * The amplified difference image is still written out, because it is the right
 * tool for the last mile once the edges line up.
 *
 * ### The reference is a 1x macOS window mockup, and that is measured
 *
 * The rail|sidebar divider is **exactly one pixel** (#212121 dark, #f5f5f5
 * light). A 2x or 1.25x export cannot produce a 1px line, so the images are 1x
 * and every measurement below is a CSS pixel. `WINDOW` is the window's inner
 * content box, found by walking in from each edge until the rail's flat fill
 * starts: the 1-2px window border sits just outside it.
 *
 * `TRAFFIC_LIGHTS` is the one part of the reference that must **not** be copied.
 * The mockup is a frameless desktop app whose titlebar is transparent, so
 * macOS's close/minimise/zoom buttons overlay the top of the rail. flux runs in
 * a browser tab and has no titlebar, so its rail content starts where the
 * reference's starts *after* that band. Copying the band would reserve 40px of
 * empty space for buttons that do not exist.
 *
 * ### Usage
 *
 *     pnpm ui:diff                          # dark, the LOG board
 *     pnpm ui:diff --theme light
 *     pnpm ui:diff --path '#/projects/LOG/backlog'
 *     pnpm ui:diff --base http://localhost:5174 --out /tmp/refdiff
 *
 * It needs a dev server already running (`pnpm dev`) — it deliberately does not
 * start one, because the loop this exists for is edit, save, re-run, and a
 * script that boots Vite every time turns a two-second loop into a twenty-second
 * one.
 *
 * ### Why the pixel maths happens in the browser
 *
 * Node has no image decoder in its standard library and this repository has no
 * image dependency, so the alternative was adding one to the root manifest for a
 * dev tool. Playwright is already here and it ships a complete canvas
 * implementation, so both PNGs are drawn into an `OffscreenCanvas` in the page
 * and the profiles come back as arrays. No new dependency, and the decoder is
 * the same one the app is rendered by.
 *
 * This is a development tool, not a CI check. It is not wired into
 * `.github/workflows/ci.yml`: it needs a dev server, a browser and two reference
 * images, and a check that cannot run in CI is a check that fails in CI.
 */

import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The window's inner content box inside the reference images, in image pixels.
 *
 * Measured, not guessed, and both images agree: the rail's flat fill starts at
 * x=105 and ends at x=1945, and runs from y=103 to y=1431. Outside that is a
 * 1-2px window border and then the mockup's page background, which is a
 * gradient — so a "find the non-background pixels" scan gets this wrong, and did
 * the first time. Walking in until the *fill* starts is what works.
 */
const WINDOW = { left: 105, top: 103, width: 1841, height: 1327 }

/**
 * The macOS traffic lights, in app-relative coordinates. Chrome the reference's
 * host draws and flux cannot — see the header. Excluded from every profile so
 * they cannot register as an edge flux is missing.
 *
 * Measured in both images: three circles spanning x 23..78 and y 18..32, so
 * ~13px across on a ~21px pitch. That diameter is itself the second independent
 * proof that the images are 1x — a 2x export would put 24px circles here — and
 * it corrected an earlier guess of y 8..23, which masked the wrong band and left
 * the lights' real edges in the profile. The rectangle is inset one step wider
 * on each side to swallow their antialiased rims.
 */
const TRAFFIC_LIGHTS = { x: 20, y: 14, width: 62, height: 22 }

const THEMES = {
  dark: { image: 'UI Images/JIRA 1.webp' },
  light: { image: 'UI Images/JIRA 2.webp' },
}

function parseArgs(argv) {
  const opts = {
    theme: 'dark',
    path: '#/projects/LOG/board',
    base: 'http://localhost:5174',
    out: '/tmp/refdiff',
    /** Rows/columns to print. The whole list is 1841 long; the interesting part is the top of the app. */
    limit: 40,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const key = arg.startsWith('--') ? arg.slice(2) : null
    if (key === null || !(key in opts)) {
      console.error(`Unknown argument: ${arg}\nSee the header of scripts/reference-diff.mjs.`)
      process.exit(2)
    }
    const value = argv[i + 1]
    if (value === undefined) {
      console.error(`--${key} needs a value.`)
      process.exit(2)
    }
    opts[key] = key === 'limit' ? Number(value) : value
    i += 1
  }
  if (!(opts.theme in THEMES)) {
    console.error(`--theme must be one of ${Object.keys(THEMES).join(', ')}.`)
    process.exit(2)
  }
  return opts
}

/**
 * `@playwright/test` is a devDependency of `apps/web`, not of the root, so a
 * bare import from a root script does not resolve under pnpm's strict layout.
 * Resolving through `apps/web`'s own manifest is the honest way to reach it —
 * hoisting is not something to rely on, per the two-majors lesson in CLAUDE.md.
 */
async function loadChromium() {
  const require = createRequire(join(ROOT, 'apps/web/package.json'))
  try {
    const mod = await import(require.resolve('@playwright/test'))
    /**
     * `@playwright/test` is CommonJS, so `await import()` wraps its exports in
     * `default` and the named ones are only present when Node's cjs-named-export
     * detection finds them. Reading `mod.chromium` alone got `undefined` and the
     * failure surfaced as `Cannot read properties of undefined (reading 'launch')`
     * one function later, which names the wrong thing entirely.
     */
    const chromium = mod.default?.chromium ?? mod.chromium
    if (chromium === undefined) throw new Error('@playwright/test exported no chromium')
    return chromium
  } catch (cause) {
    console.error(
      'Could not load @playwright/test from apps/web.\n' +
        'Run `pnpm install`, and `pnpm --filter @flux/web exec playwright install chromium`.',
    )
    throw cause
  }
}

/** webp is not something a browser canvas can be handed from disk here, so convert once. */
function referenceToPng(theme, outDir) {
  const source = join(ROOT, THEMES[theme].image)
  if (!existsSync(source)) {
    console.error(`Missing reference image: ${THEMES[theme].image}`)
    process.exit(1)
  }
  const target = join(outDir, `reference-${theme}.png`)
  execFileSync('sips', ['-s', 'format', 'png', source, '--out', target], { stdio: 'ignore' })
  return target
}

function dataUrl(file) {
  return `data:image/png;base64,${readFileSync(file).toString('base64')}`
}

/**
 * Everything below runs *in the page*: decode both PNGs, crop the reference to
 * the window, mask the traffic lights, and reduce each image to two profiles.
 *
 * A profile entry is the mean absolute difference between one row (or column)
 * and the next, in 0-255 units. A boundary — a divider, a rule, the top edge of
 * a card — is a spike in that series. Reducing to one number per row is what
 * makes the output readable: 1327 numbers rather than 2.4 million.
 */
const PROFILE_FN = `(fluxUrl, refUrl, win, mask) => {
  const load = (src) => new Promise((ok, no) => {
    const img = new Image()
    img.onload = () => ok(img)
    img.onerror = () => no(new Error('decode failed: ' + src.slice(0, 32)))
    img.src = src
  })

  const pixels = (img, sx, sy, w, h) => {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h)
    /** The traffic lights are window chrome, not product. Paint them out of both sides. */
    ctx.fillStyle = '#808080'
    ctx.fillRect(mask.x, mask.y, mask.width, mask.height)
    return ctx.getImageData(0, 0, w, h).data
  }

  /** Mean |delta| between adjacent rows, and between adjacent columns. */
  const profiles = (data, w, h) => {
    const lum = new Float64Array(w * h)
    for (let i = 0, p = 0; i < lum.length; i += 1, p += 4) {
      lum[i] = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]
    }
    const rows = new Float64Array(h)
    for (let y = 1; y < h; y += 1) {
      let sum = 0
      for (let x = 0; x < w; x += 1) sum += Math.abs(lum[y * w + x] - lum[(y - 1) * w + x])
      rows[y] = sum / w
    }
    const cols = new Float64Array(w)
    for (let x = 1; x < w; x += 1) {
      let sum = 0
      for (let y = 0; y < h; y += 1) sum += Math.abs(lum[y * w + x] - lum[y * w + x - 1])
      cols[x] = sum / h
    }
    return { rows: Array.from(rows), cols: Array.from(cols) }
  }

  return Promise.all([load(fluxUrl), load(refUrl)]).then(([flux, ref]) => {
    const w = win.width, h = win.height
    const fluxPixels = pixels(flux, 0, 0, w, h)
    const refPixels = pixels(ref, win.left, win.top, w, h)

    /** The amplified difference, for the last mile once the edges agree. */
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    const out = ctx.createImageData(w, h)
    let differing = 0
    for (let p = 0; p < out.data.length; p += 4) {
      const d = Math.max(
        Math.abs(fluxPixels[p] - refPixels[p]),
        Math.abs(fluxPixels[p + 1] - refPixels[p + 1]),
        Math.abs(fluxPixels[p + 2] - refPixels[p + 2]),
      )
      if (d > 8) differing += 1
      const v = Math.min(255, d * 3)
      out.data[p] = v; out.data[p + 1] = 0; out.data[p + 2] = Math.min(255, v * 0.4); out.data[p + 3] = 255
    }
    ctx.putImageData(out, 0, 0)

    return canvas.convertToBlob({ type: 'image/png' })
      .then((blob) => blob.arrayBuffer())
      .then((buf) => ({
        flux: profiles(fluxPixels, w, h),
        reference: profiles(refPixels, w, h),
        differingFraction: differing / (w * h),
        diffPng: Array.from(new Uint8Array(buf)),
      }))
  })
}`

/**
 * Turn a profile into a short list of edge positions.
 *
 * A run of adjacent above-threshold entries is one edge — a 1px rule produces two
 * (its top and its bottom), and a soft shadow produces a wide smear — so runs are
 * collapsed to the position of their strongest entry. Without that collapse a
 * single antialiased boundary reports as three edges and the two lists cannot be
 * lined up by eye at all.
 */
function edges(profile, threshold) {
  const found = []
  let run = null
  for (let i = 0; i < profile.length; i += 1) {
    if (profile[i] >= threshold) {
      if (run === null) run = { at: i, peak: profile[i] }
      else if (profile[i] > run.peak) {
        run.at = i
        run.peak = profile[i]
      }
    } else if (run !== null) {
      found.push(run)
      run = null
    }
  }
  if (run !== null) found.push(run)
  return found
}

/** The nearest edge in `candidates` to `at`, or `null` if none is within `window`. */
function nearest(candidates, at, window) {
  let best = null
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.at - at)
    if (best === null || distance < best.distance) best = { at: candidate.at, distance }
  }
  return best !== null && best.distance <= window ? best : null
}

/**
 * Pair each reference edge with the nearest flux edge, and print the delta.
 *
 * Nearest-neighbour rather than an index-for-index walk, because the two lists
 * are never the same length — flux is missing whole rows of the reference — and
 * an index walk turns one missing edge into every subsequent row reporting a
 * bogus offset.
 *
 * Both directions are printed, and the second one is not symmetry for its own
 * sake. A reference→flux walk alone answers *"what has flux not drawn?"* and is
 * structurally blind to the opposite defect: a divider, a rule or a border that
 * flux draws and the reference does not. That is a real and common error in this
 * work — the sidebar's `border-r` was one — and it is invisible in a one-way
 * report no matter how many rows it prints.
 */
function report(label, refEdges, fluxEdges, limit) {
  console.log(
    `\n  ${label}   reference → flux    (${refEdges.length} ref, ${fluxEdges.length} flux)`,
  )
  console.log(`  ${'-'.repeat(62)}`)
  let shown = 0
  for (const edge of refEdges) {
    if (shown >= limit) {
      console.log(`  … ${refEdges.length - shown} more`)
      break
    }
    const best = nearest(fluxEdges, edge.at, 24)
    const delta = best === null ? null : best.at - edge.at
    const flag =
      delta === null
        ? '  no match within 24px'
        : delta === 0
          ? '  ✓'
          : `  ${delta > 0 ? '+' : ''}${delta}`
    console.log(
      `  ${String(edge.at).padStart(5)}${best === null ? '        ·' : String(best.at).padStart(9)}` +
        `   strength ${edge.peak.toFixed(1).padStart(5)}${flag}`,
    )
    shown += 1
  }

  const extra = fluxEdges.filter((edge) => nearest(refEdges, edge.at, 24) === null)
  if (extra.length > 0) {
    console.log(`\n  ${label}   flux draws, reference does not    (${extra.length})`)
    console.log(`  ${'-'.repeat(62)}`)
    for (const edge of extra.slice(0, limit)) {
      console.log(`  ${String(edge.at).padStart(5)}           strength ${edge.peak.toFixed(1)}`)
    }
    if (extra.length > limit) console.log(`  … ${extra.length - limit} more`)
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  mkdirSync(opts.out, { recursive: true })

  const referencePng = referenceToPng(opts.theme, opts.out)
  const chromium = await loadChromium()
  const browser = await chromium.launch()
  const url = `${opts.base}/harness.html${opts.path}`

  try {
    const context = await browser.newContext({
      viewport: { width: WINDOW.width, height: WINDOW.height },
      deviceScaleFactor: 1,
      /**
       * The theme is set before the app's first script runs. Toggling `.dark`
       * afterwards is not equivalent: `tokens.css` registers 53 custom properties
       * with `@property`, so a runtime flip renders a transitional state and every
       * colour read out of it is wrong by an unpredictable amount.
       */
      colorScheme: opts.theme === 'dark' ? 'dark' : 'light',
    })
    await context.addInitScript(`window.localStorage.setItem('flux.theme', '${opts.theme}')`)
    const page = await context.newPage()
    const response = await page.goto(url, { waitUntil: 'networkidle' })
    if (response !== null && !response.ok()) {
      console.error(`${url} returned ${String(response.status())}. Is \`pnpm dev\` running?`)
      process.exit(1)
    }
    /** Motion has to finish, or a mid-transition sidebar reports as a missing edge. */
    await page.waitForTimeout(400)

    const fluxPng = join(opts.out, `flux-${opts.theme}.png`)
    await page.screenshot({ path: fluxPng, animations: 'disabled' })

    const result = await page.evaluate(
      `(${PROFILE_FN})(${JSON.stringify(dataUrl(fluxPng))}, ${JSON.stringify(dataUrl(referencePng))}, ${JSON.stringify(WINDOW)}, ${JSON.stringify(TRAFFIC_LIGHTS)})`,
    )

    const diffPng = join(opts.out, `diff-${opts.theme}.png`)
    writeFileSync(diffPng, Buffer.from(result.diffPng))

    console.log(`\n  ${opts.theme} · ${url}`)
    console.log(`  viewport ${WINDOW.width}x${WINDOW.height} at DPR 1`)
    console.log(
      `  ${(result.differingFraction * 100).toFixed(1)}% of pixels differ by more than 8/255`,
    )

    /**
     * 6.0 for columns and 4.0 for rows. Asymmetric because the images are: a
     * vertical divider runs the full 1327px height and averages high, while a
     * horizontal rule inside the content column covers barely 80% of the width
     * and a rule inside a single board column covers 17% of it. One threshold
     * for both either drowns the rows in noise or hides most of them.
     */
    report('col', edges(result.reference.cols, 6), edges(result.flux.cols, 6), opts.limit)
    report('row', edges(result.reference.rows, 4), edges(result.flux.rows, 4), opts.limit)

    console.log(`\n  ${fluxPng}\n  ${referencePng}\n  ${diffPng}\n`)
  } finally {
    await browser.close()
  }
}

await main()
