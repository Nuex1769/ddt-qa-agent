import { useEffect, useState, type FormEvent } from 'react'
import {
  Check,
  CircleDot,
  CloudUpload,
  FileText,
  Files,
  FileCheck2,
  GitCompareArrows,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SelectField } from '@/components/ui/select'
import { Hint } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import {
  DataTable,
  ErrorNotice,
  PageHeader,
  ScopeFilters,
  useConfig,
  type Column,
} from '@/components/console/shared'
import { DocumentPreview } from '@/components/DocumentPreview'
import { DocumentReviewDialog } from './DocumentReviewDialog'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import type { DocumentRecord } from '@/lib/types'
import { dateLabel } from '@/lib/utils'

const visibilityLabels = { company: '全公司', department: '仅本部门', private: '仅管理员' }

function UploadDialog({
  open,
  onClose,
  onSuccess,
  document,
  maxMB,
}: {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  document: DocumentRecord | null
  maxMB: number
}) {
  const [title, setTitle] = useState(''),
    [product, setProduct] = useState(''),
    [version, setVersion] = useState(''),
    [visibility, setVisibility] = useState('company'),
    [file, setFile] = useState<File | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setTitle(document?.title || '')
      setProduct(document?.product || '')
      setVersion(document?.version || '')
      setVisibility(document?.visibility || 'company')
      setFile(null)
      setError('')
    }
  }, [open, document])
  const choose = (selected?: File) => {
    if (!selected) return
    setError('')
    setFile(null)
    if (!/\.(pdf|docx|md|txt)$/i.test(selected.name)) {
      setError('请选择 PDF、DOCX、Markdown 或 TXT 文件')
      return
    }
    if (!selected.size || selected.size > maxMB * 1024 * 1024) {
      setError(`请选择非空文件，大小不能超过 ${maxMB} MB`)
      return
    }
    setFile(selected)
    if (!title) setTitle(selected.name.replace(/\.[^.]+$/, ''))
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!title.trim() || !product.trim() || !version.trim() || !file) {
      setError('请填写标题、产品、版本并选择文件')
      return
    }
    if (title.trim().length > 200 || product.trim().length > 80 || version.trim().length > 40) {
      setError('标题、产品、版本分别最多为 200、80、40 字')
      return
    }
    setBusy(true)
    const data = new FormData()
    data.set('title', title.trim())
    data.set('product', product.trim())
    data.set('version', version.trim())
    data.set('visibility', visibility)
    data.set('file', file)
    try {
      await api(`/documents${document ? `/${document.id}` : ''}`, {
        method: document ? 'PUT' : 'POST',
        body: data,
      })
      toast.success(document ? '文档与索引已更新' : '文档已入库，可以开始提问')
      onSuccess()
      onClose()
    } catch (e) {
      setError((e as Error).message)
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !busy) onClose()
      }}
    >
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          if (busy) e.preventDefault()
        }}
      >
        <DialogHeader
          title={document ? '更新知识文档' : '上传知识文档'}
          description={
            document
              ? '替换文件后将重建索引；更新失败时保留原文档。'
              : '把产品资料转化为团队随时可检索的知识。'
          }
        />
        <form onSubmit={submit} noValidate>
          <div
            className={`upload-dropzone ${busy ? 'disabled' : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (!busy) choose(e.dataTransfer.files[0])
            }}
          >
            <label htmlFor="document-file">
              <CloudUpload size={29} />
              <strong>{file ? file.name : '点击选择文件，或拖放到这里'}</strong>
              <span>PDF、DOCX、Markdown、TXT · 最大 {maxMB} MB</span>
              <input
                id="document-file"
                type="file"
                accept=".pdf,.docx,.md,.txt"
                onChange={(e) => choose(e.target.files?.[0])}
                disabled={busy}
              />
            </label>
          </div>
          <label className="field">
            文档标题
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：产品使用指南"
              disabled={busy}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              所属产品
              <Input
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                placeholder="例如：DDT 工作台"
                disabled={busy}
              />
            </label>
            <label className="field">
              产品版本
              <Input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="例如：v2.4"
                disabled={busy}
              />
            </label>
          </div>
          <label className="field">
            可见范围
            <SelectField
              label="文档可见范围"
              value={visibility}
              onChange={setVisibility}
              disabled={busy}
              options={[
                { value: 'company', label: '全公司 · 所有登录成员可见' },
                { value: 'department', label: '仅本部门 · 与上传者同部门' },
                { value: 'private', label: '仅管理员 · 管理员与上传者' },
              ]}
            />
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {busy && (
            <p className="indexing-note">
              <LoaderCircle className="spin" size={15} />
              正在解析文档并建立索引，请保持窗口打开…
            </p>
          )}
          <div className="dialog-footer">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
              {busy ? '正在入库…' : document ? '更新并重建索引' : '上传并建立索引'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function Documents() {
  const { user } = useAuth(),
    [revision, setRevision] = useState(0),
    { config, configError } = useConfig(revision)
  const [items, setItems] = useState<DocumentRecord[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [q, setQ] = useState(''),
    [debouncedQ, setDebouncedQ] = useState(''),
    [product, setProduct] = useState(''),
    [version, setVersion] = useState(''),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [uploadOpen, setUploadOpen] = useState(false),
    [editing, setEditing] = useState<DocumentRecord | null>(null),
    [preview, setPreview] = useState<string | null>(null),
    [reviewing, setReviewing] = useState<{ document: DocumentRecord; autoStart: boolean } | null>(
      null,
    ),
    [deleting, setDeleting] = useState<DocumentRecord | null>(null),
    [deleteError, setDeleteError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQ(q)
      setPage(1)
    }, 250)
    return () => clearTimeout(id)
  }, [q])
  useEffect(() => {
    const abort = new AbortController()
    setLoading(true)
    setError('')
    const params = new URLSearchParams({
      page: String(page),
      page_size: '10',
      q: debouncedQ,
      product,
      version,
    })
    api<{ items: DocumentRecord[]; total: number }>(`/documents?${params}`, {
      signal: abort.signal,
    })
      .then((data) => {
        if (!data.items.length && page > 1 && data.total <= (page - 1) * 10) {
          setPage(Math.max(1, Math.ceil(data.total / 10)))
          return
        }
        setItems(data.items)
        setTotal(data.total)
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => abort.abort()
  }, [page, debouncedQ, product, version, revision])
  const remove = async () => {
    if (!deleting) return
    setBusy(true)
    setDeleteError('')
    try {
      await api(`/documents/${deleting.id}`, { method: 'DELETE' })
      toast.success('文档及其索引已删除')
      setDeleting(null)
      setRevision((v) => v + 1)
    } catch (e) {
      setDeleteError((e as Error).message)
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const columns: Column<DocumentRecord>[] = [
    {
      id: 'title',
      header: '文档名称',
      width: 290,
      cell: (doc) => (
        <div className="document-name">
          <span className="file-icon">
            <FileText size={20} />
          </span>
          <div>
            <Button variant="ghost" className="document-title" onClick={() => setPreview(doc.id)}>
              {doc.title}
            </Button>
            <small>
              {doc.filename.split('.').at(-1)?.toUpperCase()} ·{' '}
              {doc.size < 1024 ? `${doc.size} B` : `${(doc.size / 1024).toFixed(1)} KB`}
            </small>
          </div>
        </div>
      ),
    },
    {
      id: 'product',
      header: '产品 / 版本',
      width: 170,
      cell: (doc) => (
        <div className="two-lines">
          <span>{doc.product}</span>
          <small>{doc.version}</small>
        </div>
      ),
    },
    {
      id: 'status',
      header: '索引状态',
      width: 125,
      cell: (doc) => (
        <div className="two-lines">
          <span className="ready-label">
            <Check size={13} />
            已就绪
          </span>
          <small>{doc.chunk_count} 个片段</small>
        </div>
      ),
    },
    {
      id: 'visibility',
      header: '可见范围',
      width: 125,
      cell: (doc) => (
        <span className="visibility-label">
          <LockKeyhole size={13} />
          {visibilityLabels[doc.visibility]}
        </span>
      ),
    },
    {
      id: 'updated',
      header: '更新时间',
      width: 135,
      cell: (doc) => <span className="date-value">{dateLabel(doc.updated_at)}</span>,
    },
    {
      id: 'actions',
      header: '操作',
      width: 175,
      align: 'right',
      cell: (doc) =>
        user?.role === 'admin' ? (
          <div className="row-actions">
            <Button
              variant="outline"
              size="sm"
              aria-label={`审查 ${doc.title}`}
              onClick={() => setReviewing({ document: doc, autoStart: true })}
            >
              <FileCheck2 size={14} />
              审查
            </Button>
            <Hint label="更新内容">
              <Button
                variant="ghost"
                size="icon"
                aria-label={`更新 ${doc.title}`}
                onClick={() => {
                  setEditing(doc)
                  setUploadOpen(true)
                }}
              >
                <RefreshCw size={15} />
              </Button>
            </Hint>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`更多操作 ${doc.title}`}
                  title="更多操作"
                >
                  <MoreHorizontal size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onSelect={() => setReviewing({ document: doc, autoStart: false })}
                >
                  <GitCompareArrows size={14} />
                  版本与草稿
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="danger-item"
                  onSelect={() => {
                    setDeleteError('')
                    setDeleting(doc)
                  }}
                >
                  <Trash2 size={14} />
                  删除文档
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <div className="row-actions">
            <Button
              variant="outline"
              size="sm"
              aria-label={`审查 ${doc.title}`}
              onClick={() => setReviewing({ document: doc, autoStart: true })}
            >
              <FileCheck2 size={14} />
              审查
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setPreview(doc.id)}>
              查看
            </Button>
          </div>
        ),
    },
  ]
  return (
    <div className="page-container">
      <PageHeader
        eyebrow="YOUR SOURCE OF TRUTH"
        title="让好答案，有据可依。"
        description="在这里管理产品资料，为团队的每一次提问提供可靠依据。"
        action={
          user?.role === 'admin' ? (
            <Button
              onClick={() => {
                setEditing(null)
                setUploadOpen(true)
              }}
            >
              <Upload size={16} />
              上传文档
            </Button>
          ) : (
            <span className="subtle-tag">
              <ShieldCheck size={14} />
              成员只读
            </span>
          )
        }
      />
      <div className="stats-strip">
        <div>
          <span className="stat-icon">
            <Files size={20} />
          </span>
          <span>
            <small>可访问文档</small>
            <strong>
              {config?.document_count ?? '—'}
              <em>份</em>
            </strong>
          </span>
        </div>
        <div>
          <span className="stat-icon">
            <CircleDot size={20} />
          </span>
          <span>
            <small>知识片段</small>
            <strong>
              {config?.chunk_count ?? '—'}
              <em>个</em>
            </strong>
          </span>
        </div>
        <div>
          <span className="stat-icon">
            <ShieldCheck size={20} />
          </span>
          <span>
            <small>产品知识范围</small>
            <strong>
              {config?.products.length ?? '—'}
              <em>个产品</em>
            </strong>
          </span>
        </div>
        <p>
          <span className="dot-ready" />
          已入库文档可即时参与问答
        </p>
      </div>
      {configError && (
        <ErrorNotice message={configError} onRetry={() => setRevision((v) => v + 1)} />
      )}
      {config?.needs_reindex ? (
        <div className="info-banner">
          {config.needs_reindex}{' '}
          份文档的向量配置与当前向量服务不一致。请更新文件重建索引；当前仍可使用关键词检索。
        </div>
      ) : null}
      <section className="document-section">
        <div className="section-heading">
          <div>
            <h2>
              产品知识文档<span>{total}</span>
            </h2>
            <p>按产品和版本组织，让知识始终保持清晰。</p>
          </div>
          <Hint label="刷新列表">
            <Button
              variant="ghost"
              size="icon"
              aria-label="刷新文档"
              disabled={loading}
              onClick={() => {
                setRevision((v) => v + 1)
                toast.message('正在刷新文档列表')
              }}
            >
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
            </Button>
          </Hint>
        </div>
        <div className="document-filters">
          <div className="search-input">
            <Search size={16} />
            <Input
              aria-label="搜索文档"
              placeholder="搜索文档名称…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="清除搜索"
                title="清除搜索"
                onClick={() => setQ('')}
              >
                <X size={14} />
              </Button>
            )}
          </div>
          <ScopeFilters
            config={config}
            product={product}
            version={version}
            onProduct={(v) => {
              setProduct(v)
              setPage(1)
            }}
            onVersion={(v) => {
              setVersion(v)
              setPage(1)
            }}
          />
        </div>
        <DataTable
          data={items}
          columns={columns}
          getRowId={(doc) => doc.id}
          loading={loading}
          error={error}
          onRetry={() => setRevision((v) => v + 1)}
          empty={
            q || product
              ? '没有匹配的文档，试试其他筛选条件。'
              : '知识库还是空的。请管理员上传第一份产品文档。'
          }
          pagination={{ page, pageSize: 10, total, onPageChange: setPage }}
        />
      </section>
      <div className="document-tip">
        <ShieldCheck size={18} />
        <div>
          <strong>知识有边界，答案有来源。</strong>
          <p>只有当前账号可访问的文档会参与检索。资料更新或删除后，相关历史回答会提示重新提问。</p>
        </div>
      </div>
      <UploadDialog
        open={uploadOpen}
        onClose={() => {
          setUploadOpen(false)
          setEditing(null)
        }}
        onSuccess={() => {
          setPage(1)
          setRevision((v) => v + 1)
        }}
        document={editing}
        maxMB={config?.max_upload_mb || 20}
      />
      <DocumentPreview documentId={preview} onClose={() => setPreview(null)} />
      {reviewing && (
        <DocumentReviewDialog
          document={reviewing.document}
          autoStart={reviewing.autoStart}
          onClose={() => setReviewing(null)}
          onPublished={() => setRevision((v) => v + 1)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => {
          if (!v) {
            setDeleting(null)
            setDeleteError('')
          }
        }}
        title="删除这份知识文档？"
        description={`「${deleting?.title || ''}」及其知识片段将被永久删除，不再参与问答。相关历史回答将标记为资料失效。`}
        busy={busy}
        error={deleteError}
        onConfirm={remove}
      />
    </div>
  )
}
