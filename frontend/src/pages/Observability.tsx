import { useEffect, useState } from 'react'
import { Activity, ExternalLink, LoaderCircle, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SelectField } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog'
import { DataTable, ErrorNotice, PageHeader, type Column } from '@/components/console/shared'
import { api, json } from '@/lib/api'
import type { Observation, ObservabilityConfig } from '@/lib/types'

const statusLabels: Record<string, string> = {
  complete: '完成',
  error: '失败',
  interrupted: '已中断',
  disabled: '仅本地',
  pending: '等待同步',
  sending: '同步中',
  synced: '已同步',
  failed: '同步失败',
}
const spanLabels: Record<string, string> = {
  retrieval: '资料检索',
  embedding: '向量调用',
  answer: '回答生成',
  'review-analysis': '文档分段分析',
  'review-model': '审查模型调用',
}
const duration = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`
const tokens = (value: number | null) => (value === null ? '未返回' : value.toLocaleString())
const badge = (state: string) => (
  <span className={`subtle-tag observation-state observation-${state}`}>
    {statusLabels[state] || state}
  </span>
)
type TraceList = { items: Observation[]; total: number }

function ObservationDetail({
  id,
  enabled,
  onRefresh,
}: {
  id: string
  enabled: boolean
  onRefresh: () => void
}) {
  const [record, setRecord] = useState<Observation | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    api<Observation>(`/observability/traces/${id}`)
      .then((value) => {
        if (active) setRecord(value)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [id, revision])
  const retry = async () => {
    setBusy(true)
    setError('')
    try {
      await api(`/observability/traces/${id}/retry`, json({}))
      toast.success('已加入同步队列，请稍后刷新查看结果')
      setRevision((v) => v + 1)
      onRefresh()
    } catch (e) {
      setError((e as Error).message)
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <DialogHeader title="观测记录详情" description={`Trace ID：${id}`} />
      {error && <ErrorNotice message={error} onRetry={() => setRevision((v) => v + 1)} />}
      {loading ? (
        <div className="loading">
          <LoaderCircle size={18} className="spin" />
          正在加载记录…
        </div>
      ) : (
        record && (
          <>
            <dl className="observation-facts">
              <div>
                <dt>操作 / 状态</dt>
                <dd>
                  {record.operation === 'chat' ? '知识问答' : '文档审查'} ·{' '}
                  {statusLabels[record.status]}
                </dd>
              </div>
              <div>
                <dt>总耗时</dt>
                <dd>{duration(record.duration_ms)}</dd>
              </div>
              <div>
                <dt>模型 / 模式</dt>
                <dd>
                  {record.model || '无外部模型调用'} · {record.mode === 'demo' ? '演示' : '正式'}
                </dd>
              </div>
              <div>
                <dt>输入 / 输出 Token</dt>
                <dd>
                  {tokens(record.input_tokens)} / {tokens(record.output_tokens)}
                </dd>
              </div>
              <div>
                <dt>开始时间</dt>
                <dd>{new Date(record.started_at).toLocaleString('zh-CN')}</dd>
              </div>
              <div>
                <dt>Langfuse 同步</dt>
                <dd>
                  {statusLabels[record.export_status]} · 已尝试 {record.export_attempts} 次
                </dd>
              </div>
              <div>
                <dt>用户 ID</dt>
                <dd>{record.user_id}</dd>
              </div>
              <div>
                <dt>会话 ID</dt>
                <dd>{record.session_id}</dd>
              </div>
            </dl>
            {record.export_error && (
              <p role="status" className="field-error">
                {record.export_error}
              </p>
            )}
            <div className="observation-detail-actions">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRevision((v) => v + 1)}
                disabled={busy}
              >
                <RefreshCw size={14} />
                刷新状态
              </Button>
              {enabled && ['failed', 'disabled'].includes(record.export_status) && (
                <Button size="sm" onClick={() => void retry()} disabled={busy}>
                  {busy && <LoaderCircle size={14} className="spin" />}
                  {record.export_status === 'disabled' ? '同步到 Langfuse' : '重新同步'}
                </Button>
              )}
              {record.langfuse_url && (
                <Button variant="outline" size="sm" asChild>
                  <a href={record.langfuse_url} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} />在 Langfuse 打开
                  </a>
                </Button>
              )}
            </div>
            <h3 className="observation-timeline-title">执行阶段</h3>
            <ol className="observation-timeline">
              {(record.spans || []).map((item) => (
                <li key={item.id} className={item.parent_id ? 'observation-child' : ''}>
                  <div>
                    <strong>{spanLabels[item.name] || item.name}</strong>
                    {badge(item.status)}
                    <span>{duration(item.duration_ms)}</span>
                  </div>
                  {item.model && (
                    <p>
                      {item.model} · 输入 {tokens(item.input_tokens)} / 输出{' '}
                      {tokens(item.output_tokens)} Token
                    </p>
                  )}
                  {item.error_type && <p className="field-error">异常类型：{item.error_type}</p>}
                </li>
              ))}
            </ol>
            {record.details && (
              <p className="muted observation-note">
                {record.details.source_count !== undefined &&
                  `检索资料片段：${record.details.source_count} 个。`}
                {record.details.total_parts !== undefined &&
                  `已审查分段：${record.details.completed_parts} / ${record.details.total_parts}。`}
                {record.details.output_characters !== undefined &&
                  `已生成正文：${record.details.output_characters} 字符。`}
                {record.details.error_type && `异常类型：${record.details.error_type}。`}
              </p>
            )}
            <p className="muted observation-note">
              仅记录运行信息，不保存提示词、问题、回答或文档正文。Token
              按模型已返回的用量统计，未返回部分不作估算。
            </p>
          </>
        )
      )}
    </>
  )
}

export function Observability() {
  const [config, setConfig] = useState<ObservabilityConfig | null>(null)
  const [configError, setConfigError] = useState('')
  const [data, setData] = useState<TraceList>({ items: [], total: 0 })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [operation, setOperation] = useState('')
  const [status, setStatus] = useState('')
  const [sync, setSync] = useState('')
  const [selected, setSelected] = useState('')
  const [help, setHelp] = useState(false)
  useEffect(() => {
    let active = true
    setConfigError('')
    api<ObservabilityConfig>('/observability/config')
      .then((value) => {
        if (active) setConfig(value)
      })
      .catch((e) => {
        if (active) setConfigError(e.message)
      })
    return () => {
      active = false
    }
  }, [revision])
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    const params = new URLSearchParams({
      page: String(page),
      page_size: '20',
      search,
      operation,
      status,
      export_status: sync,
    })
    api<TraceList>(`/observability/traces?${params}`)
      .then((value) => {
        if (active) setData(value)
      })
      .catch((e) => {
        if (active) {
          setData({ items: [], total: 0 })
          setError(e.message)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [revision, page, search, operation, status, sync])
  const columns: Column<Observation>[] = [
    {
      id: 'trace',
      header: '调用记录',
      width: 220,
      cell: (row) => (
        <div className="two-lines">
          <strong>{row.operation === 'chat' ? '知识问答' : '文档审查'}</strong>
          <small className="observation-id" title={row.id}>
            {row.id.slice(0, 18)}…
          </small>
        </div>
      ),
    },
    {
      id: 'model',
      header: '模型',
      width: 175,
      cell: (row) => (
        <div className="two-lines">
          <strong>{row.model || '本地处理'}</strong>
          <small>{row.mode === 'demo' ? '演示模式' : '正式模式'}</small>
        </div>
      ),
    },
    { id: 'status', header: '状态', width: 100, cell: (row) => badge(row.status) },
    {
      id: 'duration',
      header: '耗时',
      width: 90,
      cell: (row) => <span className="date-value">{duration(row.duration_ms)}</span>,
    },
    {
      id: 'tokens',
      header: 'Token 输入 / 输出',
      width: 150,
      cell: (row) => (
        <span className="date-value">
          {tokens(row.input_tokens)} / {tokens(row.output_tokens)}
        </span>
      ),
    },
    { id: 'sync', header: 'Langfuse', width: 110, cell: (row) => badge(row.export_status) },
    {
      id: 'time',
      header: '开始时间',
      width: 145,
      cell: (row) => (
        <span className="date-value">{new Date(row.started_at).toLocaleString('zh-CN')}</span>
      ),
    },
    {
      id: 'actions',
      header: '操作',
      width: 85,
      align: 'right',
      cell: (row) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSelected(row.id)}
          aria-label={`查看记录 ${row.id}`}
        >
          详情
        </Button>
      ),
    },
  ]
  return (
    <div className="page-container observation-page">
      <PageHeader
        eyebrow="LANGFUSE OBSERVABILITY"
        title="观测记录"
        description="追踪问答与文档审查的执行过程、耗时和模型用量。"
        action={
          <Button variant="outline" disabled={loading} onClick={() => setRevision((v) => v + 1)}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            刷新记录
          </Button>
        }
      />
      {configError && (
        <ErrorNotice message={configError} onRetry={() => setRevision((v) => v + 1)} />
      )}
      <div className="observation-connection">
        <Activity size={20} />
        <div>
          <strong>
            {config
              ? config.enabled
                ? 'Langfuse 同步已启用'
                : '本地观测已开启 · Langfuse 未启用'
              : '正在读取观测配置…'}
          </strong>
          <p>
            {config?.enabled
              ? '记录在后台同步，实际结果以每条记录的同步状态为准。'
              : '可先查看本地记录，连接 Langfuse 后再同步。'}
            只记录运行信息，不采集正文。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setHelp(true)}>
          接入说明
        </Button>
      </div>
      <section className="document-section">
        <div className="section-heading">
          <div>
            <h2>
              调用记录<span>{data.total}</span>
            </h2>
            <p>从功能启用后开始记录；中断或失败的调用也会保留。</p>
          </div>
        </div>
        <div className="document-filters observation-filters">
          <div className="search-input">
            <Search size={16} />
            <Input
              aria-label="搜索观测记录"
              placeholder="搜索 Trace ID 或模型"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>
          <SelectField
            label="操作筛选"
            value={operation}
            onChange={(v) => {
              setOperation(v)
              setPage(1)
            }}
            options={[
              { value: '', label: '全部操作' },
              { value: 'chat', label: '知识问答' },
              { value: 'review', label: '文档审查' },
            ]}
          />
          <SelectField
            label="执行状态筛选"
            value={status}
            onChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
            options={[
              { value: '', label: '全部执行状态' },
              ...['complete', 'error', 'interrupted'].map((value) => ({
                value,
                label: statusLabels[value],
              })),
            ]}
          />
          <SelectField
            label="同步状态筛选"
            value={sync}
            onChange={(v) => {
              setSync(v)
              setPage(1)
            }}
            options={[
              { value: '', label: '全部同步状态' },
              ...['disabled', 'pending', 'sending', 'synced', 'failed'].map((value) => ({
                value,
                label: statusLabels[value],
              })),
            ]}
          />
        </div>
        <DataTable
          data={data.items}
          columns={columns}
          getRowId={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={() => setRevision((v) => v + 1)}
          empty="暂无匹配的观测记录；完成一次问答或文档审查后刷新查看。"
          pagination={{ page, pageSize: 20, total: data.total, onPageChange: setPage }}
        />
      </section>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected('')
        }}
      >
        <DialogContent className="observation-dialog">
          {selected && (
            <ObservationDetail
              key={selected}
              id={selected}
              enabled={!!config?.enabled}
              onRefresh={() => setRevision((v) => v + 1)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="observation-dialog">
          <DialogHeader
            title="接入 Langfuse"
            description="由管理员在服务端配置，重启后开始后台同步。"
          />
          <p>在 Langfuse 项目设置中创建 API 密钥，将以下配置加入项目根目录的 .env：</p>
          <pre className="observation-config">{`LANGFUSE_ENABLED=true\nLANGFUSE_BASE_URL=https://cloud.langfuse.com\nLANGFUSE_PUBLIC_KEY=<项目 Public Key>\nLANGFUSE_SECRET_KEY=<项目 Secret Key>\nLANGFUSE_PROJECT_ID=<项目 ID，可选>`}</pre>
          <p className="muted observation-note">
            BASE_URL 可使用对应区域的云服务地址或自部署地址。配置项目 ID 后，已同步的记录可跳转到
            Langfuse 详情。服务端密钥不会返回浏览器。
          </p>
          <p className="muted observation-note">
            后台使用 OTLP/HTTP 接口，失败后自动重试，最多 3
            次；也可在记录详情中重新同步。应用页面仅展示本应用产生的观测记录。
          </p>
          <Button variant="outline" asChild>
            <a
              href="https://langfuse.com/integrations/native/opentelemetry"
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={15} />
              Langfuse 官方接入文档
            </a>
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
