import type { RichTextDoc, RichTextNode } from '@flux/contracts'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { plainText, RichText, safeHref } from './rich-text'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The document renderer — where a comment body becomes markup.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This module is the one place in the product where **stored data becomes DOM**, so it
 * gets the most adversarial tests in the tree. A comment body is written by one user and
 * rendered to every other one, which makes every branch here a decision about somebody
 * else's document:
 *
 *   - **`safeHref` is a security boundary.** `javascript:` in a link mark is stored XSS
 *     if it reaches an `href`, and the four ways of hiding a scheme — a tab inside it,
 *     leading control characters, mixed case, a newline — are each a real payload rather
 *     than a hypothetical. They are tested against the *browser's* parser because the
 *     browser's parser is what will eventually interpret the value.
 *   - **An unknown node must not lose its words.** The schema is open: a document written
 *     by a future editor, or imported from Jira, will carry types this renderer has never
 *     heard of. Dropping them silently deletes part of someone's comment, and the reader
 *     has no way to know a sentence is missing.
 *   - **`trailing` must always land somewhere.** It is the timestamp, drawn inside the
 *     last line so a short comment does not get a second row for four words. A branch
 *     that returns early without it is a bubble with no time on it.
 *   - **`plainText` is the panel's two-line preview**, and its whole job is that block
 *     structure collapses to a *space* rather than to nothing — "…the firmwareWe rolled
 *     it back" reads as a typo in a colleague's writing.
 *
 * `render` rather than `renderWithProviders`: this component takes no context, and a
 * wrapper would be four providers of ceremony around a pure function of its props.
 */

function doc(...content: RichTextNode[]): RichTextDoc {
  return { type: 'doc', content }
}

function paragraph(...content: RichTextNode[]): RichTextNode {
  return { type: 'paragraph', content }
}

function text(value: string, href?: string): RichTextNode {
  return href === undefined
    ? { type: 'text', text: value }
    : { type: 'text', text: value, marks: [{ type: 'link', attrs: { href } }] }
}

describe('safeHref', () => {
  it.each(['https://example.com/a?b=c#d', 'http://example.com', 'mailto:ada@example.com'])(
    'keeps %s',
    (href) => {
      expect(safeHref(href)).toBe(href)
    },
  )

  /**
   * A relative link comes back **as it was written**, not resolved.
   *
   * `new URL(href, 'https://flux.invalid')` is how the scheme is checked, and returning
   * the parsed result would rewrite `/browse/LOG-1` into `https://flux.invalid/browse/LOG-1`
   * — a link to a host that cannot exist, which is a worse outcome than rejecting it.
   */
  it('keeps a relative link relative', () => {
    expect(safeHref('/browse/LOG-101')).toBe('/browse/LOG-101')
    expect(safeHref('./attachment.png')).toBe('./attachment.png')
  })

  /**
   * The four disguises, each of which a naive `startsWith('javascript:')` misses and the
   * browser executes. `URL` strips control characters and whitespace, lowercases the
   * scheme and normalises the whole thing before reporting `protocol` — which is why the
   * check is made through it rather than against the raw string.
   */
  it.each([
    ['plain', 'javascript:alert(1)'],
    ['mixed case', 'JavaScript:alert(1)'],
    ['tab inside the scheme', 'java\tscript:alert(1)'],
    ['newline inside the scheme', 'java\nscript:alert(1)'],
    ['leading control characters', 'javascript:alert(1)'],
    ['leading whitespace', '   javascript:alert(1)'],
  ])('rejects a script URL disguised by %s', (_disguise, href) => {
    expect(safeHref(href)).toBeNull()
  })

  it('rejects the other schemes a document has no business carrying', () => {
    expect(safeHref('data:text/html;base64,PHNjcmlwdD4=')).toBeNull()
    expect(safeHref('vbscript:msgbox(1)')).toBeNull()
    expect(safeHref('file:///etc/passwd')).toBeNull()
  })

  it('rejects what is not a string, and the empty string', () => {
    expect(safeHref('')).toBeNull()
    expect(safeHref(undefined)).toBeNull()
    expect(safeHref(null)).toBeNull()
    expect(safeHref(42)).toBeNull()
    expect(safeHref({ href: 'https://example.com' })).toBeNull()
  })
})

describe('RichText', () => {
  it('renders one paragraph per block', () => {
    const { container } = render(
      <RichText doc={doc(paragraph(text('First')), paragraph(text('Second')))} />,
    )

    const paragraphs = container.querySelectorAll('[data-slot="rich-text"] > p')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0]).toHaveTextContent('First')
    expect(paragraphs[1]).toHaveTextContent('Second')
  })

  /**
   * A safe link becomes an anchor with both `rel` tokens.
   *
   * `noopener` denies the destination a handle on `window.opener`, which it could use to
   * navigate this tab somewhere phishy; `noreferrer` withholds a `Referer` that would
   * otherwise hand an external site this organization's host and the issue key. They are
   * asserted as a pair because either one alone reads as "we thought about this".
   */
  it('renders a safe link as an anchor that cannot reach back', () => {
    render(<RichText doc={doc(paragraph(text('the runbook', 'https://example.com/runbook')))} />)

    const link = screen.getByRole('link', { name: 'the runbook' })
    expect(link).toHaveAttribute('href', 'https://example.com/runbook')
    expect(link).toHaveAttribute('rel', 'noreferrer noopener')
    expect(link).toHaveAttribute('target', '_blank')
  })

  /**
   * An unsafe link keeps its words and loses its destination.
   *
   * Rendering nothing would delete text from someone's comment; rendering an anchor with
   * no `href` would leave a control that looks live and goes nowhere. Plain text is the
   * only answer that is both honest and safe.
   */
  it('renders an unsafe link as text, with no anchor at all', () => {
    const { container } = render(
      <RichText doc={doc(paragraph(text('click me', 'javascript:alert(1)')))} />,
    )

    expect(screen.getByText('click me')).toBeInTheDocument()
    expect(container.querySelector('a')).toBeNull()
    expect(container.innerHTML).not.toContain('javascript')
  })

  it.each(['hardBreak', 'hard_break'])('renders %s as a line break', (type) => {
    const { container } = render(<RichText doc={doc(paragraph(text('a'), { type }, text('b')))} />)
    expect(container.querySelectorAll('br')).toHaveLength(1)
  })

  /**
   * An unknown *inline* wrapper keeps its contents. An unknown *block* keeps its
   * children at block level.
   *
   * The schema is open by design, so this is the ordinary case rather than the odd one:
   * an imported document carries `blockquote`, `bulletList`, `codeBlock`, `mention`. None
   * of them render specially yet, and none of them may swallow a word.
   */
  it('keeps the words inside a node type it has never heard of', () => {
    render(
      <RichText
        doc={doc(paragraph({ type: 'underline', content: [text('emphasised')] }), {
          type: 'blockquote',
          content: [paragraph(text('quoted'))],
        })}
      />,
    )

    expect(screen.getByText('emphasised')).toBeInTheDocument()
    expect(screen.getByText('quoted')).toBeInTheDocument()
  })

  /**
   * `trailing` follows the recursion to the last leaf.
   *
   * It is the timestamp, and it is drawn *inside* the final line so that a four-word
   * comment does not get a second row for it. A flattened unknown block is where that
   * goes wrong most easily: the naive version puts the timestamp after the wrapper, which
   * is a row of its own again.
   */
  it('puts the trailing element on the last line, even through a flattened block', () => {
    const { container } = render(
      <RichText
        doc={doc({ type: 'bulletList', content: [paragraph(text('one')), paragraph(text('two'))] })}
        trailing={<time data-testid="stamp">3h</time>}
      />,
    )

    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[1]).toContainElement(screen.getByTestId('stamp'))
  })

  /**
   * A leaf with neither text nor children renders nothing — but the timestamp still has
   * to appear, on a line of its own.
   *
   * A bubble holding only an image is the case: nothing draws yet, and a bubble with no
   * time on it reads as a comment that failed to load rather than as one with a picture
   * in it.
   */
  it('gives the trailing element its own line when there is nothing to render', () => {
    render(<RichText doc={doc({ type: 'image' })} trailing={<time data-testid="stamp">3h</time>} />)
    expect(screen.getByTestId('stamp')).toBeInTheDocument()
  })

  it('renders nothing for an empty document, and only the trailing element when given one', () => {
    const { container: bare } = render(<RichText doc={doc()} />)
    expect(bare.innerHTML).toBe('')

    render(<RichText doc={null} trailing={<time data-testid="stamp">3h</time>} />)
    expect(screen.getByTestId('stamp')).toBeInTheDocument()
  })
})

describe('plainText', () => {
  it('joins blocks with a space, so sentences do not fuse', () => {
    const value = plainText(
      doc(paragraph(text('the firmware')), paragraph(text('We rolled it back'))),
    )
    expect(value).toBe('the firmware We rolled it back')
  })

  it('collapses runs of whitespace and trims the ends', () => {
    const value = plainText(doc(paragraph(text('  two   words \n')), paragraph(text('  '))))
    expect(value).toBe('two words')
  })

  /**
   * Text under an unknown wrapper survives here too — this is the panel's preview, and a
   * preview that silently drops a sentence is worse than one that shows a plain version
   * of it.
   */
  it('reaches text nested inside node types it does not render', () => {
    const value = plainText(
      doc({
        type: 'blockquote',
        content: [paragraph({ type: 'underline', content: [text('deep')] })],
      }),
    )
    expect(value).toBe('deep')
  })

  it('is the empty string for no document and for an empty one', () => {
    expect(plainText(null)).toBe('')
    expect(plainText(doc())).toBe('')
    /** Which is what the peek panel's `No description yet` branch tests against. */
    expect(plainText(doc(paragraph()))).toBe('')
  })
})
