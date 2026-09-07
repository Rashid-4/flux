import type { RichTextDoc, RichTextNode } from '@flux/contracts'
import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * ══════════════════════════════════════════════════════════════════════
 * A `RichTextDoc`, rendered.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `RichTextDocSchema` is a ProseMirror-shaped tree: `{ type: 'doc', content: [...] }`
 * where every node has a `type`, optional `content`, optional `marks` and optional
 * `text`. The schema is deliberately open — `RichTextNodeSchema` is `z.lazy` over a
 * `type: z.string()` — because the node vocabulary is the editor's to grow and the
 * contract must not have to be re-released to allow a table.
 *
 * That openness is the whole design problem for a *renderer*. It cannot switch
 * exhaustively on a closed union, so it has to decide what happens to a node it has
 * never seen, and the two obvious answers are both wrong: throwing takes out the
 * thread over one unrecognised node, and returning `null` deletes text a person
 * wrote. Neither is acceptable on a comment — a comment that silently loses a
 * sentence is worse than one that loses its formatting.
 *
 * ### So: render what is known, and degrade the rest to its text
 *
 * Known today, because it is what the fixtures actually produce and therefore all
 * that is testable: `doc → paragraph → text`, plus a `link` mark. That is not a
 * guess about the shape — `packages/mocks/src/thread.ts` builds every comment body
 * out of exactly those, one of them carrying a link.
 *
 * Everything else falls through two rules, and both keep the words:
 *
 *   - **An unknown block node renders its children as blocks.** A `bulletList` whose
 *     `listItem`s each hold a `paragraph` therefore comes out as paragraphs — the
 *     bullets are lost, the sentences are not. Flattening rather than nesting is
 *     also what keeps the output valid: a `<p>` may not contain a `<p>`, so a
 *     renderer that wrapped unknown blocks in one would emit markup the browser
 *     re-parses into something else.
 *   - **An unknown inline node or mark renders its text unstyled.** A `strong` mark
 *     arriving from a future editor loses its weight and keeps its words.
 *
 * The moment the composer that *writes* `strong`, `em`, `code`, lists and headings
 * exists, this file grows the cases for them alongside the fixtures that prove them.
 * Adding them now would mean writing renderers for node types nothing in the
 * repository can produce, which is untestable by construction.
 *
 * ### Why the caller sets the type, not this file
 *
 * There is no `text-md` here. The same document is rendered at two sizes on two
 * backgrounds — 17/24 inside a comment bubble, and larger with wider paragraph gaps
 * in the issue page's description — so the type belongs to whoever knows which. This
 * file owns the *structure*: paragraph rhythm, and the link.
 */

export interface RichTextProps {
  /**
   * The document, or `null`.
   *
   * `null` is a real value — `IssueSchema.description` is nullable — and it is not
   * the same as an empty document. Both render nothing here; the difference is the
   * caller's, because "no description" wants a designed empty state and "an empty
   * document" is a save that produced nothing.
   */
  doc: RichTextDoc | null
  /**
   * Inline content appended **inside the last block**, sharing its final line.
   *
   * This exists for one measured behaviour, and it cannot be done from outside. The
   * reference's comment bubbles put the timestamp immediately after the last word of
   * the message and let it drop to a line of its own only when it does not fit —
   * which is a property of the last paragraph's *line box*, so a sibling rendered
   * after this component can never participate in it. A `float`, an absolute corner
   * and a hand-measured spacer are the three usual workarounds; all three either
   * mis-wrap or need the meta's width known in advance.
   *
   * Rendered as a block of its own if the document's last node has no line to join —
   * an image, a horizontal rule, an empty leaf. A timestamp is never dropped.
   */
  trailing?: ReactNode | undefined
  className?: string | undefined
}

/**
 * The protocols a link in user-authored content may use.
 *
 * This is an allowlist rather than a `javascript:` denylist, and that direction is
 * the point: a comment body is authored by a person and travels through the API
 * unmodified, so an `href` here is untrusted input rendered into an attribute the
 * browser will *execute* for some schemes. `javascript:` is the famous one, `data:`
 * lets an attacker serve HTML from this origin's context, and `vbscript:` still
 * exists in the wild. A denylist has to enumerate all of them correctly forever; an
 * allowlist fails closed on the one nobody thought of.
 *
 * The server sanitises too — it must, since a client is not a security boundary and
 * this document is also rendered by email digests and by the API's own search
 * indexer. Doing it here as well is defence in depth at the cost of four lines.
 */
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * The `href` if it is safe to render, else `null`.
 *
 * Parsed by `new URL` rather than by a regexp on the string, because the browser's
 * own parser is the thing that will eventually interpret this value and a
 * hand-written test disagrees with it in exactly the cases that matter:
 * `java\tscript:alert(1)` has a tab in the middle of the scheme, `  javascript:…`
 * has leading control characters, and `JavaScript:` differs in case. `URL` strips,
 * lowercases and normalises all three before reporting `protocol`, so the check is
 * made against what will actually run.
 *
 * The base is what makes a relative `href` resolvable instead of a parse error. A
 * relative link inside a comment is unusual but not wrong — it is how a link to
 * another issue on this instance would be written — and the base is a domain that
 * cannot exist (`.invalid` is reserved by RFC 2606), so nothing can be requested
 * from it if it ever leaked into the output. It does not: the *original* string is
 * returned, never the resolved one, so a relative link stays relative.
 */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string' || href === '') return null
  try {
    return SAFE_PROTOCOLS.has(new URL(href, 'https://flux.invalid').protocol) ? href : null
  } catch {
    /** Not a URL at all. Rendered as text by the caller, which is the honest answer. */
    return null
  }
}

/**
 * The document as one line of plain text.
 *
 * For the places a document has to be *quoted* rather than rendered: the one-line
 * preview of the comment a reply is answering, and the same preview in a search
 * result. Those are single lines by construction, so block structure has to collapse
 * to a space rather than to nothing — otherwise two paragraphs quote as
 * "…the scanner firmwareWe rolled it back" and read as a typo in someone's comment.
 *
 * Whitespace is collapsed at the end rather than per node, because a paragraph
 * ending in a space followed by another paragraph would otherwise produce a double
 * one, and a trailing space inside a `line-clamp-1` is a visible half-character of
 * indent on the ellipsis.
 */
export function plainText(doc: RichTextDoc | null): string {
  if (doc === null) return ''

  const parts: string[] = []
  const walk = (nodes: readonly RichTextNode[]): void => {
    for (const node of nodes) {
      if (typeof node.text === 'string') parts.push(node.text)
      if (node.content !== undefined) walk(node.content)
      /** A block boundary is a space, so sentences do not fuse across paragraphs. */
      if (node.type !== 'text' && node.content !== undefined) parts.push(' ')
    }
  }
  walk(doc.content)

  return parts.join('').replace(/\s+/g, ' ').trim()
}

/** The `link` mark's `href`, if the node carries one and it is safe. */
function linkHref(node: RichTextNode): string | null {
  const mark = node.marks?.find((candidate) => candidate.type === 'link')
  return mark === undefined ? null : safeHref(mark.attrs?.['href'])
}

/**
 * One inline node.
 *
 * `typeof node.text === 'string'` rather than `node.type === 'text'`, because the
 * two are not the same test and the weaker one is the one that keeps the words: a
 * node carrying text under a type this renderer does not know still gets rendered.
 */
function renderInline(node: RichTextNode, key: string): ReactNode {
  if (typeof node.text === 'string') {
    const href = linkHref(node)
    if (href === null) return <Fragment key={key}>{node.text}</Fragment>

    return (
      <a
        key={key}
        href={href}
        /**
         * `noreferrer` as well as `noopener`, and both matter for different reasons.
         * `noopener` denies the opened page a handle on `window.opener`, which it
         * could otherwise use to navigate this tab to a phishing page — a link in a
         * comment is exactly the untrusted-destination case that attack needs.
         * `noreferrer` withholds the `Referer` header, which on an internal tool
         * would otherwise leak the issue key and the organization's host to whatever
         * site was linked.
         */
        rel="noreferrer noopener"
        target="_blank"
        /**
         * The underline carries the affordance and the colour does not, which is
         * §9's rule and here it is also the only workable answer: this renders on a
         * near-white bubble *and* on a saturated blue one, and no single link colour
         * clears 4.5:1 on both. `text-current` inherits the surrounding text colour,
         * which has already been contrast-checked against whichever background it is
         * on, so the link is guaranteed readable in both places rather than tuned for
         * one of them.
         */
        className="text-current underline decoration-1 underline-offset-2 hover:decoration-2"
      >
        {node.text}
      </a>
    )
  }

  /** `hardBreak` in one editor, `hard_break` in another. Both mean a line ended. */
  if (node.type === 'hardBreak' || node.type === 'hard_break') return <br key={key} />

  /** An unknown inline wrapper: keep its contents, drop its meaning. */
  return <Fragment key={key}>{renderInlineList(node.content, key)}</Fragment>
}

function renderInlineList(nodes: RichTextNode[] | undefined, keyPrefix: string): ReactNode {
  if (nodes === undefined) return null
  return nodes.map((node, index) => renderInline(node, `${keyPrefix}.${String(index)}`))
}

/**
 * One block node.
 *
 * The index is part of the key because nothing in a `RichTextNode` identifies it —
 * there is no id in the schema, and there should not be: the document is a value, so
 * two identical paragraphs are indistinguishable by design. A positional key is
 * therefore the only honest one, and it is safe here because these lists are
 * re-rendered whole rather than reordered in place.
 */
function renderBlock(node: RichTextNode, key: string, trailing: ReactNode): ReactNode {
  if (node.type === 'paragraph') {
    return (
      <p key={key}>
        {renderInlineList(node.content, key)}
        {trailing}
      </p>
    )
  }

  /** A stray text node where a block was expected. Wrapped so it keeps its rhythm. */
  if (typeof node.text === 'string') {
    return (
      <p key={key}>
        {node.text}
        {trailing}
      </p>
    )
  }

  /**
   * An unknown block: its children, at block level. See the header's second rule.
   * `trailing` follows the recursion down to the last leaf, so a timestamp lands on
   * the final line of a flattened list rather than after the list.
   */
  if (node.content !== undefined && node.content.length > 0) {
    const last = node.content.length - 1
    return (
      <Fragment key={key}>
        {node.content.map((child, index) =>
          renderBlock(child, `${key}.${String(index)}`, index === last ? trailing : null),
        )}
      </Fragment>
    )
  }

  /**
   * A leaf with neither text nor children — a `horizontalRule`, an `image`, a
   * `mention` whose label lives only in `attrs`. Nothing to render *and nothing
   * lost*, which is why this is `null` rather than a placeholder: an "unsupported
   * content" chip on every image would be a worse thread than one that quietly does
   * not draw the images yet.
   *
   * `trailing` still has to go somewhere, so it gets its own line. A bubble holding
   * only an image is a bubble whose timestamp would otherwise vanish.
   */
  return trailing === null || trailing === undefined ? null : <p key={key}>{trailing}</p>
}

export function RichText({ doc, trailing = null, className }: RichTextProps) {
  /**
   * An absent or empty document renders nothing — unless there is `trailing`, which
   * is a timestamp and must not disappear with the text it was attached to. A comment
   * whose body came back empty is a write that went wrong, and a bubble showing only
   * "3 hours ago" says so; an element that renders nothing at all reads as a bug in
   * the thread.
   */
  if (doc === null || doc.content.length === 0) {
    if (trailing === null || trailing === undefined) return null
    return (
      <div data-slot="rich-text" className={cn('flex flex-col gap-2 break-words', className)}>
        <p>{trailing}</p>
      </div>
    )
  }

  return (
    /**
     * `gap-2` between paragraphs rather than a margin on `<p>`, so the first and last
     * paragraph have no outer space and the bubble's own `py-2` is the only vertical
     * padding in play. A `space-y` or a `mt` on every-but-first is the same result
     * spelled less obviously, and it breaks the moment a caller wraps the output.
     *
     * `break-words`: a comment is where a 90-character URL or a stack frame gets
     * pasted, and without it one such token widens the bubble past its `max-w` and
     * pushes the whole thread sideways.
     */
    <div data-slot="rich-text" className={cn('flex flex-col gap-2 break-words', className)}>
      {doc.content.map((node, index) =>
        renderBlock(node, String(index), index === doc.content.length - 1 ? trailing : null),
      )}
    </div>
  )
}
