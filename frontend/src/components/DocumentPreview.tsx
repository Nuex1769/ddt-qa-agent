import { useEffect, useRef, useState } from 'react'
import { FileText, LoaderCircle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader } from './ui/dialog'
import { ErrorNotice } from './console/shared'
import { Markdown } from './Markdown'
import { api } from '@/lib/api'
import type { DocumentRecord, Source } from '@/lib/types'

export function DocumentPreview({
  documentId,
  source,
  onClose,
}: {
  documentId: string | null
  source?: Source | null
  onClose: () => void
}) {
  const [doc, setDoc] = useState<DocumentRecord | null>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0)
  const body = useRef<HTMLDivElement>(null)
  const chunkId = source?.chunk_id,
    digest = source?.digest,
    sourceRevision = source?.revision
  useEffect(() => {
    setDoc(null)
    setError('')
    if (!documentId) return
    const controller = new AbortController()
    const query = new URLSearchParams()
    if (chunkId) {
      query.set('chunk_id', chunkId)
      if (digest) query.set('digest', digest)
      if (sourceRevision) query.set('revision', sourceRevision)
    }
    api<DocumentRecord>(`/documents/${documentId}?${query}`, { signal: controller.signal })
      .then((doc) => {
        if (!controller.signal.aborted) setDoc(doc)
      })
      .catch((e) => {
        if (!controller.signal.aborted && e.name !== 'AbortError') setError(e.message)
      })
    return () => controller.abort()
  }, [documentId, chunkId, digest, sourceRevision, revision])
  useEffect(() => {
    if (!doc) return
    const frame = requestAnimationFrame(() => {
      const target = body.current?.querySelector<HTMLElement>('.citation-highlight')
      target?.scrollIntoView({ block: 'center', behavior: 'instant' })
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [doc])
  return (
    <Dialog
      open={!!documentId}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="preview-dialog">
        <DialogHeader
          title={doc?.title || '文档原文'}
          description={
            doc ? `${doc.product} · ${doc.version} · ${doc.filename}` : '正在读取有权访问的资料'
          }
        />
        <div className="preview-body" ref={body}>
          {error ? (
            <ErrorNotice message={error} onRetry={() => setRevision((v) => v + 1)} />
          ) : doc ? (
            <>
              <div className="document-meta">
                <FileText size={15} />
                原文 · {doc.chunk_count} 个知识片段
              </div>
              {doc.citation && (
                <p className="citation-notice" role="status">
                  {doc.citation.range
                    ? `已高亮引用片段 ${doc.citation.section}，可继续滚动查看上下文。`
                    : `未能在原文中准确定位引用片段 ${doc.citation.section}，请查看全文。`}
                </p>
              )}
              <Markdown highlight={doc.citation?.range || undefined}>{doc.content || ''}</Markdown>
            </>
          ) : (
            <div className="loading">
              <LoaderCircle className="spin" />
              正在加载原文…
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
