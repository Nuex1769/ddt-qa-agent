import type { Element, Root, RootContent, Text } from 'hast'
import { decodeString } from 'micromark-util-decode-string'

export interface CitationRange {
  start: number
  end: number
}

// Work on Markdown's parsed text nodes so formatting, links and tables stay intact.
export function highlightCitation(range: CitationRange) {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value)
    const visit = (parent: Root | Element) => {
      parent.children = parent.children.flatMap((node): RootContent[] => {
        if (node.type === 'element') {
          visit(node)
          return [node]
        }
        if (node.type !== 'text' || !node.value.trim()) return [node]
        let start = node.position?.start.offset
        let end = node.position?.end.offset
        // Code text has a position on its enclosing code element instead.
        if (start === undefined && parent.type === 'element' && parent.tagName === 'code') {
          const position = parent.position
          if (position?.start.offset !== undefined && position.end.offset !== undefined) {
            const raw = source.slice(position.start.offset, position.end.offset)
            const index = raw.indexOf(node.value.trimEnd())
            if (index >= 0) {
              start = position.start.offset + index
              end = start + node.value.trimEnd().length
            } else {
              start = position.start.offset
              end = position.end.offset
            }
          }
        }
        if (start === undefined || end === undefined || range.start >= end || range.end <= start)
          return [node]
        const raw = source.slice(start, end)
        const isCode = parent.type === 'element' && parent.tagName === 'code'
        const rendered = (text: string) =>
          (isCode ? text : decodeString(text)).replace(/\r\n?/g, '\n')
        const aligned = rendered(raw) === node.value.trimEnd() || rendered(raw) === node.value
        const from = aligned ? rendered(raw.slice(0, Math.max(0, range.start - start))).length : 0
        const to = aligned
          ? rendered(raw.slice(0, Math.min(raw.length, range.end - start))).length
          : node.value.length
        if (from >= to) return [node]
        const text = (value: string): Text => ({ type: 'text', value })
        return [
          ...(from ? [text(node.value.slice(0, from))] : []),
          {
            type: 'element',
            tagName: 'mark',
            properties: { className: ['citation-highlight'], tabIndex: -1 },
            children: [text(node.value.slice(from, to))],
          },
          ...(to < node.value.length ? [text(node.value.slice(to))] : []),
        ]
      })
    }
    visit(tree)
  }
}
