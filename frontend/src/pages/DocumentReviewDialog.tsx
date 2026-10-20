import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, FileCheck2, GitCompareArrows, LoaderCircle, Save, Send, Square } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { SelectField } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { ErrorNotice } from '@/components/console/shared'
import { Markdown } from '@/components/Markdown'
import { DocumentPreview } from '@/components/DocumentPreview'
import { useAuth } from '@/lib/auth'
import { api, json, streamChat } from '@/lib/api'
import type {
  DocumentRecord,
  DocumentReview,
  DocumentVersion,
  ReviewTurn,
  Source,
} from '@/lib/types'
import { dateLabel } from '@/lib/utils'

const defaultQuestion =
  '请审查当前文档是否存在内容冲突、内容缺失、内部不一致或描述不清，并给出可采用的修改建议。'
const kindLabel = { conflict: '内容冲突', missing: '内容缺失', clarity: '描述建议' }

export function DocumentReviewDialog({
  document,
  autoStart = true,
  onClose,
  onPublished,
}: {
  document: DocumentRecord
  autoStart?: boolean
  onClose: () => void
  onPublished: () => void
}) {
  const { user } = useAuth()
  const admin = user?.role === 'admin'
  const [currentDoc, setCurrentDoc] = useState(document)
  const [review, setReview] = useState<DocumentReview | null>(null)
  const [versions, setVersions] = useState<DocumentVersion[]>([])
  const [draft, setDraft] = useState<DocumentVersion | null>(null)
  const [content, setContent] = useState(''),
    [version, setVersion] = useState('')
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(true),
    [generating, setGenerating] = useState(false)
  const [mutating, setMutating] = useState(false),
    [status, setStatus] = useState('')
  const [error, setError] = useState(''),
    [draftError, setDraftError] = useState('')
  const [compare, setCompare] = useState(false),
    [confirmPublish, setConfirmPublish] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [preview, setPreview] = useState<Source | null>(null)
  const [retry, setRetry] = useState(0)
  const controller = useRef<AbortController | null>(null)
  const running = useRef(false),
    started = useRef(''),
    alive = useRef(true)
  const bottom = useRef<HTMLDivElement>(null)
  const unconfirmed = useRef<{ id: string; status: ReviewTurn['status'] } | null>(null)
  const applyServerReview = (value: DocumentReview) => {
    const failed = unconfirmed.current
    if (failed)
      value.turns = value.turns.map((turn) =>
        turn.id === failed.id ? { ...turn, status: failed.status } : turn,
      )
    setReview((previous) => {
      const partial = failed && previous?.turns.find((turn) => turn.id === failed.id)
      if (partial && !value.turns.some((turn) => turn.id === partial.id)) {
        return { ...value, turns: [...value.turns, { ...partial, status: failed!.status }] }
      }
      return value
    })
  }
  const dirty =
    !!draft && draft.status === 'draft' && (content !== draft.content || version !== draft.version)
  const busy = generating || !!review?.busy
  const showDraft = (value: DocumentVersion) => {
    setDraft(value)
    setContent(value.content || '')
    setVersion(value.version)
    setDraftError('')
  }
  const refreshVersions = async () => {
    if (!admin) return
    const items = await api<DocumentVersion[]>(`/documents/${document.id}/versions`)
    if (alive.current) setVersions(items)
  }
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      controller.current?.abort()
    }
  }, [])
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    Promise.all([
      api<DocumentReview>(`/documents/${document.id}/reviews`, json({})),
      api<DocumentRecord>(`/documents/${document.id}`),
      admin ? api<DocumentVersion[]>(`/documents/${document.id}/versions`) : Promise.resolve([]),
    ])
      .then(async ([value, doc, items]) => {
        if (!active) return
        setCurrentDoc(doc)
        setReview(value)
        setVersions(items)
        const id = value.draft_id || items.find((item) => item.status === 'draft')?.id
        if (id && admin) {
          try {
            const saved = await api<DocumentVersion>(`/documents/${document.id}/versions/${id}`)
            if (active) showDraft(saved)
          } catch (e) {
            if (active) setDraftError((e as Error).message)
          }
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message)
          toast.error(e.message)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [document.id, admin, retry])

  const send = async (text = question, resumeTurnId?: string) => {
    if (!review || running.current || review.busy || review.stale) return
    text = text.trim()
    if (!text || text.length > 4000) {
      setError('请填写 1–4000 字的审查重点')
      return
    }
    running.current = true
    setGenerating(true)
    setQuestion('')
    setError('')
    setStatus('正在分析文档与相关资料…')
    const abort = new AbortController()
    controller.current = abort
    let turnId = ''
    let receivedDone = false
    let failedStatus: ReviewTurn['status'] = 'error'
    try {
      await streamChat(
        { question: text, resume_turn_id: resumeTurnId },
        abort.signal,
        (type, data) => {
          if (!alive.current) return
          if (type === 'status') setStatus(data.message as string)
          if (type === 'result') {
            const turn = data as unknown as ReviewTurn
            turnId = turn.id
            setReview(
              (old) =>
                old && {
                  ...old,
                  turns: old.turns.some((t) => t.id === turn.id)
                    ? old.turns.map((t) => (t.id === turn.id ? turn : t))
                    : [...old.turns, turn],
                },
            )
          }
          if (type === 'done') {
            receivedDone = true
            if (unconfirmed.current?.id === turnId) unconfirmed.current = null
            setReview(
              (old) =>
                old && {
                  ...old,
                  busy: false,
                  turns: old.turns.map((t) => (t.id === turnId ? { ...t, status: 'complete' } : t)),
                },
            )
          }
        },
        `/reviews/${review.id}/messages`,
      )
      if (alive.current) toast.success('文档审查已完成')
    } catch (e) {
      if (alive.current) {
        const cancelled = (e as Error).name === 'AbortError'
        failedStatus = cancelled ? 'interrupted' : 'error'
        const message = cancelled ? '已停止审查，已完成的部分将保留' : (e as Error).message
        setError(message)
        if (cancelled) toast.message(message)
        else toast.error(message)
      }
    } finally {
      running.current = false
      if (alive.current) {
        setGenerating(false)
        setStatus('')
        try {
          if (!receivedDone && turnId) unconfirmed.current = { id: turnId, status: failedStatus }
          applyServerReview(await api<DocumentReview>(`/reviews/${review.id}`))
        } catch (e) {
          setError((e as Error).message)
        }
      }
    }
  }
  useEffect(() => {
    if (
      autoStart &&
      review &&
      !review.turns.length &&
      !review.busy &&
      started.current !== review.id
    ) {
      started.current = review.id
      void send(defaultQuestion)
    }
  }, [review?.id])
  useEffect(() => {
    if (!review?.busy || generating) return
    const timer = setInterval(() => {
      api<DocumentReview>(`/reviews/${review.id}`)
        .then((value) => {
          if (alive.current) applyServerReview(value)
        })
        .catch((e) => {
          if (alive.current) setError(e.message)
        })
    }, 1500)
    return () => clearInterval(timer)
  }, [review?.id, review?.busy, generating])
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' })
  }, [review?.turns, status])

  const adopt = async (findingId: string) => {
    if (!review || mutating) return
    setMutating(true)
    setDraftError('')
    try {
      const value = await api<DocumentVersion>(
        `/reviews/${review.id}/adopt`,
        json({
          finding_id: findingId,
          draft_id: draft?.id,
          expected_updated_at: draft?.updated_at,
        }),
      )
      showDraft(value)
      setReview((old) => old && { ...old, draft_id: value.id })
      toast.success('已采用建议并保存为草稿')
      await refreshVersions()
    } catch (e) {
      setDraftError((e as Error).message)
      toast.error((e as Error).message)
    } finally {
      setMutating(false)
    }
  }
  const createDraft = async (fresh = false) => {
    if (!review) return
    setMutating(true)
    setDraftError('')
    try {
      const value = await api<DocumentVersion>(
        `/documents/${document.id}/drafts?review_id=${review.id}&fresh=${fresh}`,
        json({}),
      )
      showDraft(value)
      setReview((old) => old && { ...old, draft_id: value.id })
      toast.success('已创建文档草稿')
      await refreshVersions()
    } catch (e) {
      setDraftError((e as Error).message)
      toast.error((e as Error).message)
    } finally {
      setMutating(false)
    }
  }
  const save = async (): Promise<DocumentVersion | null> => {
    if (!draft || mutating) return null
    if (
      content.trim().length < 10 ||
      content.length > 2_000_000 ||
      !version.trim() ||
      version.trim().length > 40 ||
      version.trim() === currentDoc.version
    ) {
      setDraftError('正文至少 10 字；新版本号须为 1–40 字且与当前版本不同')
      return null
    }
    setMutating(true)
    setDraftError('')
    try {
      const value = await api<DocumentVersion>(`/documents/${document.id}/versions/${draft.id}`, {
        ...json({
          content: content.trim(),
          version: version.trim(),
          expected_updated_at: draft.updated_at,
        }),
        method: 'PUT',
      })
      showDraft(value)
      toast.success('草稿已保存，尚未发布')
      await refreshVersions()
      return value
    } catch (e) {
      setDraftError((e as Error).message)
      toast.error((e as Error).message)
      return null
    } finally {
      setMutating(false)
    }
  }
  const openCompare = async () => {
    if (dirty && !(await save())) return
    setCompare(true)
  }
  const publish = async () => {
    if (!draft) return
    setMutating(true)
    setDraftError('')
    try {
      const value = await api<DocumentVersion>(
        `/documents/${document.id}/versions/${draft.id}/publish`,
        json({ expected_updated_at: draft.updated_at }),
      )
      showDraft(value)
      setConfirmPublish(false)
      setReview((old) => old && { ...old, stale: true })
      toast.success(`版本 ${value.version} 已发布，知识库索引已更新`)
      onPublished()
      await refreshVersions()
      setCurrentDoc(await api<DocumentRecord>(`/documents/${document.id}`))
    } catch (e) {
      setDraftError((e as Error).message)
      toast.error((e as Error).message)
    } finally {
      setMutating(false)
    }
  }
  const changeVersion = async (id: string) => {
    setMutating(true)
    setDraftError('')
    try {
      showDraft(await api<DocumentVersion>(`/documents/${document.id}/versions/${id}`))
    } catch (e) {
      setDraftError((e as Error).message)
      toast.error((e as Error).message)
    } finally {
      setMutating(false)
    }
  }
  const close = () => {
    if (mutating) return
    if (dirty) {
      setConfirmDiscard(true)
      return
    }
    controller.current?.abort()
    onClose()
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void send()
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent
          className="review-dialog"
          onEscapeKeyDown={(e) => {
            if (mutating) e.preventDefault()
          }}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader
            title={`文档审查 · ${currentDoc.title}`}
            description={`${currentDoc.product} · 当前已发布 ${currentDoc.version} · 审查相关资料，无关联资料时仅分析当前文档`}
          />
          {loading ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              正在打开审查工作区…
            </div>
          ) : !review ? (
            <ErrorNotice
              message={error || '无法打开文档审查'}
              onRetry={() => setRetry((v) => v + 1)}
            />
          ) : (
            <div className={`review-workspace ${admin ? '' : 'review-readonly'}`}>
              <section className="review-conversation" aria-label="文档审查对话">
                <div className="review-section-title">
                  <FileCheck2 size={17} />
                  <strong>审查对话</strong>
                  <span className="muted">冲突 · 缺失 · 表述</span>
                </div>
                <div className="review-messages">
                  {!review.turns.length && !busy && (
                    <div className="review-empty">
                      <FileCheck2 size={28} />
                      <h3>让文档更完整、更一致</h3>
                      <p>逐段分析当前文档，并按相关性检索可访问资料。建议需要你确认后才会发布。</p>
                      <Button onClick={() => void send(defaultQuestion)}>开始审查</Button>
                    </div>
                  )}
                  {review.turns.map((turn) => (
                    <article key={turn.id} className="review-turn">
                      <p className="review-question">{turn.question}</p>
                      <div className="review-turn-heading">
                        <strong>审查结果</strong>
                        <span
                          className={`subtle-tag ${turn.status !== 'complete' ? 'review-incomplete' : ''}`}
                        >
                          {turn.status === 'complete'
                            ? '审查完成'
                            : turn.status === 'streaming'
                              ? '审查中'
                              : turn.status === 'stale'
                                ? '资料已变化'
                                : '审查未完成'}{' '}
                          · {turn.completed_parts}/{turn.total_parts} 段
                        </span>
                      </div>
                      {turn.summary && <Markdown>{turn.summary}</Markdown>}
                      {turn.sources.length > 0 && (
                        <div className="review-source-note">
                          结合了 {new Set(turn.sources.map((s) => s.document_id)).size}{' '}
                          份相关文档；未引用的资料不作为结论依据。
                          {turn.sources.map((source) => (
                            <Button
                              key={source.chunk_id}
                              variant="ghost"
                              size="sm"
                              className="review-source"
                              onClick={() => setPreview(source)}
                            >
                              查看资料：{source.title} · {source.version} · 片段 {source.section}
                            </Button>
                          ))}
                        </div>
                      )}
                      {!turn.sources.length && turn.completed_parts > 0 && (
                        <p className="review-source-note">
                          未找到相关资料，本轮仅针对当前文档审查。
                        </p>
                      )}
                      {turn.findings.map((finding) => (
                        <section
                          key={finding.id}
                          className={`review-finding review-finding-${finding.kind}`}
                        >
                          <div className="review-finding-heading">
                            <span className="subtle-tag">{kindLabel[finding.kind]}</span>
                            <h4>{finding.title}</h4>
                          </div>
                          <p>{finding.explanation}</p>
                          <div className="review-edit-proposed review-suggestion">
                            <small>处理建议</small>
                            <pre>
                              {finding.suggestion ||
                                '该历史问题尚未包含处理建议，请重新审查以生成具体建议。'}
                            </pre>
                          </div>
                          {finding.original && (
                            <div className="review-edit-original">
                              <small>原文</small>
                              <pre>{finding.original}</pre>
                            </div>
                          )}
                          {finding.replacement && (
                            <div className="review-edit-proposed">
                              <small>{finding.original ? '建议替换为' : '建议新增段落'}</small>
                              <pre>{finding.replacement}</pre>
                            </div>
                          )}
                          {finding.sources.map((source) => (
                            <Button
                              key={source.chunk_id}
                              variant="ghost"
                              size="sm"
                              className="review-source"
                              onClick={() => setPreview(source)}
                            >
                              参考：{source.title} · {source.version} · 片段 {source.section}
                            </Button>
                          ))}
                          {admin && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                !finding.can_apply ||
                                turn.status !== 'complete' ||
                                busy ||
                                mutating ||
                                dirty ||
                                review.stale ||
                                draft?.status === 'published' ||
                                !!draft?.adopted_ids?.includes(finding.id)
                              }
                              onClick={() => void adopt(finding.id)}
                            >
                              {draft?.adopted_ids?.includes(finding.id) ? (
                                <>
                                  <Check size={14} />
                                  已采用
                                </>
                              ) : finding.can_apply ? (
                                '采用建议'
                              ) : (
                                '需人工确认'
                              )}
                            </Button>
                          )}
                        </section>
                      ))}
                      {!busy &&
                        ['error', 'interrupted'].includes(turn.status) &&
                        turn.completed_parts < turn.total_parts && (
                          <Button
                            variant="outline"
                            onClick={() => void send(turn.question, turn.id)}
                            disabled={review.stale}
                          >
                            继续未完成审查
                          </Button>
                        )}
                    </article>
                  ))}
                  {busy && (
                    <p className="review-progress" role="status">
                      <LoaderCircle className="spin" size={16} />
                      {status || '审查正在其他窗口进行，结果会自动同步…'}
                    </p>
                  )}
                  <div ref={bottom} />
                </div>
                {error && (
                  <p className="field-error" role="alert">
                    {error}
                  </p>
                )}
                {review.stale ? (
                  <div className="review-stale">
                    <p>文档已更新，请针对当前已发布版本重新审查。</p>
                    <Button variant="outline" onClick={() => setRetry((v) => v + 1)}>
                      重新审查当前版本
                    </Button>
                  </div>
                ) : (
                  <form className="review-composer" onSubmit={submit} noValidate>
                    <Textarea
                      aria-label="审查追问"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="继续追问，例如：重点检查参数是否一致、操作步骤是否缺失…"
                      disabled={busy}
                    />
                    <div>
                      <small>可继续讨论并逐条采用建议</small>
                      {generating ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => controller.current?.abort()}
                        >
                          <Square size={14} />
                          停止审查
                        </Button>
                      ) : (
                        <Button type="submit" disabled={busy}>
                          <Send size={14} />
                          发送审查重点
                        </Button>
                      )}
                    </div>
                  </form>
                )}
              </section>
              {admin && (
                <section className="review-draft-panel" aria-label="版本与草稿">
                  <div className="review-section-title">
                    <GitCompareArrows size={17} />
                    <strong>版本与草稿</strong>
                    <span className="subtle-tag">发布前不参与检索</span>
                    {draft && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={mutating || busy || dirty || review.stale}
                        onClick={() => void createDraft(true)}
                      >
                        新建草稿
                      </Button>
                    )}
                  </div>
                  {versions.length > 0 && (
                    <label className="field">
                      打开已保存版本
                      <SelectField
                        label="选择文档版本"
                        value={draft?.id || ''}
                        onChange={(id) => {
                          if (id) void changeVersion(id)
                        }}
                        disabled={mutating || dirty}
                        placeholder="选择草稿或历史版本"
                        options={[
                          { value: '', label: '选择草稿或历史版本' },
                          ...versions.map((item) => ({
                            value: item.id,
                            label: `${item.status === 'draft' ? '草稿' : '已发布'} · ${item.version} · ${dateLabel(item.created_at)}`,
                          })),
                        ]}
                      />
                    </label>
                  )}
                  {draft ? (
                    <>
                      <div className="review-draft-meta">
                        <span className="subtle-tag">
                          {draft.status === 'draft' ? '草稿' : '已发布'}
                        </span>
                        <span>基于 {draft.base_version}</span>
                        {dirty && <span className="review-unsaved">有未保存修改</span>}
                      </div>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          void save()
                        }}
                        noValidate
                      >
                        <label className="field">
                          新版本号
                          <Input
                            value={version}
                            onChange={(e) => setVersion(e.target.value)}
                            disabled={mutating || draft.status !== 'draft'}
                            placeholder="例如：v2"
                          />
                        </label>
                        <label className="field">
                          {draft.status === 'draft' ? '草稿正文（可编辑）' : '版本正文'}
                          <Textarea
                            className="review-draft-editor"
                            aria-label="草稿正文"
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            disabled={mutating || draft.status !== 'draft'}
                          />
                        </label>
                        {draftError && (
                          <p className="field-error" role="alert">
                            {draftError}
                          </p>
                        )}
                        {dirty && (
                          <p className="muted">请先保存当前修改，再切换版本或采用其他建议。</p>
                        )}
                        <div className="review-draft-actions">
                          {draft.status === 'draft' && (
                            <Button type="submit" variant="outline" disabled={mutating}>
                              <Save size={15} />
                              保存为草稿
                            </Button>
                          )}
                          <Button
                            type="button"
                            disabled={mutating}
                            onClick={() => void openCompare()}
                          >
                            <GitCompareArrows size={15} />
                            版本对比{draft.status === 'draft' ? '与发布' : ''}
                          </Button>
                        </div>
                      </form>
                      <p className="review-format-note">
                        修订正文以 Markdown 保存。发布后保留旧版本，并更新问答引用与检索索引。
                      </p>
                    </>
                  ) : (
                    <div className="review-empty">
                      <GitCompareArrows size={28} />
                      <h3>采用建议，生成修订草稿</h3>
                      <p>原文会一直保留。你也可以创建草稿并手动编辑，再查看版本对比。</p>
                      {draftError && (
                        <p className="field-error" role="alert">
                          {draftError}
                        </p>
                      )}
                      <Button
                        variant="outline"
                        disabled={mutating || busy || review.stale}
                        onClick={() => void createDraft(!!draftError)}
                      >
                        从当前版本创建草稿
                      </Button>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={compare}
        onOpenChange={(open) => {
          if (!mutating) setCompare(open)
        }}
      >
        <DialogContent
          className="version-compare-dialog"
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader
            title="文档版本对比"
            description={`${currentDoc.title} · ${draft?.base_version || ''} → ${draft?.version || ''} · 删除与新增内容分别标注`}
          />
          <div className="version-diff-labels">
            <strong>原版本 · {draft?.base_version}</strong>
            <strong>
              {draft?.status === 'draft' ? '草稿' : '已发布'} · {draft?.version}
            </strong>
          </div>
          <div className="version-diff" aria-label="新旧版本差异">
            {draft?.diff?.map((change, i) => (
              <div key={i} className={`version-diff-row version-diff-${change.kind}`}>
                <pre>{change.old || '—'}</pre>
                <pre>{change.new || '—'}</pre>
              </div>
            ))}
          </div>
          {draftError && (
            <p className="field-error" role="alert">
              {draftError}
            </p>
          )}
          <div className="dialog-footer">
            <p className="muted">
              {draft?.status === 'draft'
                ? '确认发布后，新版才会进入知识库检索。'
                : '该版本已发布，旧版本仍可在版本列表中查看。'}
            </p>
            <Button variant="outline" onClick={() => setCompare(false)} disabled={mutating}>
              返回
            </Button>
            {draft?.status === 'draft' && (
              <Button
                disabled={mutating || dirty || draft.base_revision !== currentDoc.updated_at}
                onClick={() => {
                  setDraftError('')
                  setConfirmPublish(true)
                }}
              >
                确认发布
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmPublish}
        onOpenChange={setConfirmPublish}
        title={`确认发布 ${draft?.version || ''}？`}
        description={`「${currentDoc.title}」将升级为新版本并重建检索索引。旧版本会保留；引用旧内容的历史回答将标记为资料已更新。`}
        busy={mutating}
        error={draftError}
        confirmLabel="确认发布新版本"
        pendingLabel="正在发布并建立索引…"
        destructive={false}
        onConfirm={() => void publish()}
      />
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="放弃未保存的修改？"
        description="已保存的草稿和已采用建议会保留。本次尚未保存的手动编辑将丢失。"
        busy={false}
        confirmLabel="放弃修改并关闭"
        onConfirm={() => {
          controller.current?.abort()
          onClose()
        }}
      />
      <DocumentPreview
        documentId={preview?.document_id || null}
        source={preview}
        onClose={() => setPreview(null)}
      />
    </>
  )
}
