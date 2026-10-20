import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlightCitation, type CitationRange } from '@/lib/citation-highlight'
export function Markdown({ children, highlight }: { children: string; highlight?: CitationRange }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={highlight ? [[highlightCitation, highlight]] : []}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => <span className="muted">[图片：{alt || '已省略'}]</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
