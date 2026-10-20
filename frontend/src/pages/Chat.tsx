import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  CheckCheck,
  ChevronRight,
  Copy,
  FileSearch,
  FileText,
  LoaderCircle,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  WandSparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { Hint } from '@/components/ui/tooltip'
import { ErrorNotice, ScopeFilters, useConfig } from '@/components/console/shared'
import { DocumentPreview } from '@/components/DocumentPreview'
import { Markdown } from '@/components/Markdown'
import { api, streamChat } from '@/lib/api'
import type { Message, Source } from '@/lib/types'

const prompts = [
  {
    icon: BookOpen,
    title: '快速了解产品',
    question: '如何开始使用 DDT 工作台？',
    note: '从入门指南开始',
  },
  {
    icon: FileSearch,
    title: '查找操作说明',
    question: '知识库支持上传哪些文件？',
    note: '找到具体的操作方法',
  },
  {
    icon: ShieldCheck,
    title: '理解权限规则',
    question: '管理员和普通成员有什么区别？',
    note: '了解团队协作边界',
  },
]

export function Chat() {
  const { conversationId } = useParams(),
    location = useLocation(),
    navigate = useNavigate(),
    { config, configError } = useConfig()
  const [messages, setMessages] = useState<Message[]>([]),
    [question, setQuestion] = useState(''),
    [product, setProduct] = useState(''),
    [version, setVersion] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [preview, setPreview] = useState<Source | null>(null),
    [revision, setRevision] = useState(0)
  const controller = useRef<AbortController | null>(null),
    activeId = useRef<string | null>(null),
    bottom = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    atBottom = useRef(true),
    scrollRef = useRef<HTMLDivElement>(null),
    generation = useRef(0),
    running = useRef(false)
  useEffect(() => {
    if (conversationId && conversationId === activeId.current && running.current) return
    controller.current?.abort()
    running.current = false
    generation.current++
    setBusy(false)
    setError('')
    setQuestion('')
    setStatus('')
    setPreview(null)
    activeId.current = conversationId || null
    if (!conversationId) {
      setMessages([])
      setProduct('')
      setVersion('')
      setLoading(false)
      return
    }
    setLoading(true)
    setMessages([])
    const abort = new AbortController()
    api<{ messages: Message[] }>(`/conversations/${conversationId}`, { signal: abort.signal })
      .then((data) => {
        setMessages(data.messages)
        const last = data.messages.at(-1)
        setProduct(last?.product || '')
        setVersion(last?.version || '')
        atBottom.current = true
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => abort.abort()
  }, [conversationId, location.state, revision])
  useEffect(
    () => () => {
      controller.current?.abort()
      generation.current++
    },
    [],
  )
  useEffect(() => {
    if (atBottom.current) bottom.current?.scrollIntoView({ behavior: 'instant', block: 'end' })
  }, [messages, status])

  const send = async (text = question) => {
    if (running.current) return
    text = text.trim()
    setError('')
    if (!text) {
      setError('请输入你想了解的产品问题')
      input.current?.focus()
      return
    }
    if (text.length > 4000) {
      setError('问题不能超过 4000 字，请简化后发送')
      return
    }
    running.current = true
    const currentGeneration = ++generation.current,
      assistantId = crypto.randomUUID()
    const abort = new AbortController()
    controller.current = abort
    setQuestion('')
    setBusy(true)
    setStatus('正在连接知识服务…')
    atBottom.current = true
    setMessages((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        sources: [],
        status: 'complete',
        product,
        version,
      },
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        sources: [],
        status: 'streaming',
        product,
        version,
      },
    ])
    const patch = (update: Partial<Message> | ((message: Message) => Partial<Message>)) => {
      if (generation.current !== currentGeneration) return
      setMessages((items) =>
        items.map((m) =>
          m.id === assistantId
            ? { ...m, ...(typeof update === 'function' ? update(m) : update) }
            : m,
        ),
      )
    }
    try {
      await streamChat(
        { question: text, conversation_id: activeId.current, product, version },
        abort.signal,
        (type, data) => {
          if (generation.current !== currentGeneration) return
          if (type === 'conversation') {
            activeId.current = data.id as string
            navigate(`/chat/${data.id}`, { replace: true })
            window.dispatchEvent(new Event('ddt:conversations'))
          }
          if (type === 'status') setStatus(data.message as string)
          if (type === 'sources') patch({ sources: data.items as Source[] })
          if (type === 'delta') patch((m) => ({ content: m.content + data.text }))
          if (type === 'done') patch({ status: 'complete' })
        },
      )
      if (generation.current === currentGeneration) toast.success('回答已完成并保存')
    } catch (e) {
      if (generation.current !== currentGeneration) return
      const cancelled = (e as Error).name === 'AbortError'
      patch({ status: cancelled ? 'interrupted' : 'error' })
      if (cancelled) toast.message('已停止生成，已生成内容将保留')
      else {
        setError((e as Error).message)
        toast.error((e as Error).message)
      }
    } finally {
      if (generation.current === currentGeneration) {
        running.current = false
        setBusy(false)
        setStatus('')
        window.dispatchEvent(new Event('ddt:conversations'))
      }
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void send()
  }
  const retryLoad = () => {
    activeId.current = null
    setRevision((v) => v + 1)
  }
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('回答已复制')
    } catch {
      toast.error('无法访问剪贴板，请手动选择文字复制')
    }
  }
  return (
    <section className={`chat-page ${messages.length ? 'has-messages' : ''}`}>
      <div className="chat-toolbar">
        <div className="assistant-name">
          <span className="assistant-mark">
            <Sparkles size={18} />
          </span>
          <strong>产品知识助手</strong>
          <span className="subtle-tag">{config?.demo_mode ? '资料摘录' : '知识增强'}</span>
        </div>
        <span className="knowledge-status">
          <span className={configError ? 'dot-warning' : 'dot-ready'} />
          {configError
            ? '知识服务连接失败'
            : config
              ? `${config.document_count} 份文档可供检索`
              : '正在连接…'}
        </span>
      </div>
      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current
          if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
        }}
      >
        {configError && (
          <ErrorNotice message={configError} onRetry={() => window.location.reload()} />
        )}
        {loading ? (
          <div className="loading">
            <LoaderCircle className="spin" />
            正在读取对话…
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-welcome">
            <div className="welcome-icon">
              <Sparkles size={29} />
              <span />
            </div>
            <p className="eyebrow">A LITTLE KNOWLEDGE. A LOT OF CLARITY.</p>
            <h1>让产品知识，触手可及。</h1>
            <p className="welcome-description">
              不用翻遍每一份文档。说出你的问题，
              <br className="desktop-break" />
              从团队的产品知识中，找到有依据的答案。
            </p>
            <div className="prompt-grid">
              {prompts.map((p) => (
                <Button
                  variant="outline"
                  className="prompt-card"
                  key={p.title}
                  onClick={() => {
                    setQuestion(p.question)
                    input.current?.focus()
                  }}
                >
                  <p.icon size={21} />
                  <strong>
                    {p.title}
                    <ArrowRight size={15} />
                  </strong>
                  <span>{p.note}</span>
                </Button>
              ))}
            </div>
            <div className="welcome-proof">
              <span>
                <FileText size={14} />
                回答附带来源
              </span>
              <i />
              <span>
                <CheckCheck size={14} />
                支持连续追问
              </span>
              <i />
              <span>
                <ShieldCheck size={14} />
                遵循文档权限
              </span>
            </div>
          </div>
        ) : (
          <div className="messages" aria-live="off">
            {messages.map((m) => (
              <article className={`message message-${m.role}`} key={m.id}>
                <div className="message-avatar">
                  {m.role === 'assistant' ? <Sparkles size={18} /> : '我'}
                </div>
                <div className="message-main">
                  <div className="message-heading">
                    <strong>{m.role === 'assistant' ? 'DDT 产品知识助手' : '你'}</strong>
                    {m.role === 'assistant' && (
                      <span>
                        {m.status === 'streaming'
                          ? '正在回答'
                          : m.status === 'complete'
                            ? '基于知识库'
                            : m.status === 'stale'
                              ? '资料已变更'
                              : '回答未完成'}
                      </span>
                    )}
                  </div>
                  {m.content ? (
                    <Markdown>{m.content}</Markdown>
                  ) : m.status === 'streaming' ? (
                    <div className="thinking">
                      <span />
                      <span />
                      <span />
                      <small>{status}</small>
                    </div>
                  ) : (
                    <p className="muted">未生成正文，你可以重新提问。</p>
                  )}
                  {m.status === 'streaming' && m.content && (
                    <span className="stream-caret" aria-label="正在生成" />
                  )}
                  {m.sources.length > 0 && (
                    <div className="sources">
                      <p>
                        <FileSearch size={14} />
                        参考了 {m.sources.length} 个资料片段
                      </p>
                      <div className="source-list">
                        {m.sources.map((s) => (
                          <Button
                            variant="outline"
                            className="source-chip"
                            key={s.chunk_id}
                            onClick={() => setPreview(s)}
                          >
                            <span className="source-number">{s.number}</span>
                            <span>
                              <strong>{s.title}</strong>
                              <small>
                                {s.product} · {s.version} · 片段 {s.section}
                              </small>
                            </span>
                            <ChevronRight size={14} />
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                  {m.role === 'assistant' && m.content && m.status !== 'streaming' && (
                    <div className="message-actions">
                      <Hint label="复制回答">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="复制回答"
                          onClick={() => copy(m.content)}
                        >
                          <Copy size={14} />
                        </Button>
                      </Hint>
                      <span>
                        {m.status === 'complete'
                          ? '请结合来源核对重要信息'
                          : '内容未完成，请重新提问'}
                      </span>
                    </div>
                  )}
                </div>
              </article>
            ))}
            <div ref={bottom} />
          </div>
        )}
      </div>
      <div className="composer-area">
        {error && (
          <ErrorNotice
            message={error}
            onRetry={
              loading || (messages.length === 0 && !!conversationId)
                ? retryLoad
                : messages.some((m) => m.status === 'error') && !busy
                  ? () => {
                      const last = [...messages].reverse().find((m) => m.role === 'user')
                      if (last) void send(last.content)
                    }
                  : undefined
            }
          />
        )}
        <form className="composer" onSubmit={submit} noValidate>
          <div className="composer-top">
            <span>
              <BookOpen size={14} />
              知识范围
            </span>
            <ScopeFilters
              config={config}
              product={product}
              version={version}
              onProduct={setProduct}
              onVersion={setVersion}
              disabled={busy || loading}
            />
          </div>
          <Textarea
            ref={input}
            aria-label="输入产品问题"
            placeholder="向产品知识库提问，例如：如何上传并管理产品文档？"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                if (!busy) void send()
              }
            }}
          />
          <div className="composer-bottom">
            <span>
              {busy ? (
                <>
                  <LoaderCircle size={13} className="spin" />
                  {status}
                </>
              ) : (
                <>
                  <WandSparkles size={14} />
                  {config?.demo_mode ? '演示模式 · 根据资料摘录回答' : '根据你有权访问的资料回答'}
                </>
              )}
            </span>
            <div>
              <small>Enter 发送 · Shift + Enter 换行</small>
              {busy ? (
                <Hint label="停止生成">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    aria-label="停止生成"
                    onClick={() => controller.current?.abort()}
                  >
                    <Square size={15} />
                  </Button>
                </Hint>
              ) : (
                <Hint label="发送问题">
                  <Button
                    type="submit"
                    size="icon"
                    aria-label="发送问题"
                    disabled={loading || !config}
                  >
                    <Send size={17} />
                  </Button>
                </Hint>
              )}
            </div>
          </div>
        </form>
        <p className="composer-note">
          {config?.demo_mode
            ? '示例产品资料为虚构内容，仅用于体验功能。'
            : 'AI 回答可能存在偏差，重要信息请核对原始文档。'}
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                atBottom.current = true
                bottom.current?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              <ArrowDown size={12} />
              最新回答
            </Button>
          )}
        </p>
      </div>
      <DocumentPreview
        documentId={preview?.document_id || null}
        source={preview}
        onClose={() => setPreview(null)}
      />
    </section>
  )
}
