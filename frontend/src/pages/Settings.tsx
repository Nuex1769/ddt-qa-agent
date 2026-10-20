import { useEffect, useState, type FormEvent } from 'react'
import {
  BookOpen,
  Check,
  Cpu,
  Database,
  KeyRound,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog'
import {
  DataTable,
  ErrorNotice,
  PageHeader,
  useConfig,
  type Column,
} from '@/components/console/shared'
import { useAuth } from '@/lib/auth'
import { api, json } from '@/lib/api'
import type { User } from '@/lib/types'

export function Settings() {
  const { user } = useAuth(),
    [revision, setRevision] = useState(0),
    { config, configError } = useConfig(revision),
    [users, setUsers] = useState<User[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState(1),
    [open, setOpen] = useState(false),
    [formError, setFormError] = useState(''),
    [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ username: '', name: '', department: '', password: '' })
  useEffect(() => {
    if (user?.role !== 'admin') {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setError('')
    api<User[]>('/users')
      .then((u) => {
        if (active) setUsers(u)
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
  }, [revision, user?.role])
  const create = async (e: FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!form.username.trim() || !form.name.trim() || !form.department.trim() || !form.password) {
      setFormError('请填写所有账号信息')
      return
    }
    if (!/^[a-zA-Z0-9_.-]{2,80}$/.test(form.username.trim())) {
      setFormError('账号需为 2–80 位字母、数字、点、下划线或短横线')
      return
    }
    if (form.password.trim().length < 12 || form.password.length > 256) {
      setFormError('密码需为 12–256 位字符')
      return
    }
    if (form.name.trim().length > 100 || form.department.trim().length > 80) {
      setFormError('姓名最多 100 字，部门最多 80 字')
      return
    }
    setBusy(true)
    try {
      await api(
        '/users',
        json({
          ...form,
          username: form.username.trim(),
          name: form.name.trim(),
          department: form.department.trim(),
        }),
      )
      toast.success('成员账号已创建')
      setOpen(false)
      setRevision((v) => v + 1)
    } catch (e) {
      setFormError((e as Error).message)
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const columns: Column<User>[] = [
    {
      id: 'name',
      header: '成员',
      width: 220,
      cell: (u) => (
        <div className="member-name">
          <span className="avatar">{u.name.slice(0, 1)}</span>
          <div className="two-lines">
            <strong>{u.name}</strong>
            <small>{u.username}</small>
          </div>
        </div>
      ),
    },
    { id: 'department', header: '所属部门', width: 200, cell: (u) => u.department },
    {
      id: 'role',
      header: '角色',
      width: 150,
      cell: (u) => <span className="subtle-tag">{u.role === 'admin' ? '管理员' : '普通成员'}</span>,
    },
    {
      id: 'status',
      header: '账号状态',
      width: 140,
      cell: () => (
        <span className="ready-label">
          <Check size={13} />
          可用
        </span>
      ),
    },
  ]
  return (
    <div className="page-container settings-page">
      <PageHeader
        eyebrow="WORKSPACE PREFERENCES"
        title="工作空间设置"
        description="查看知识服务状态，管理团队成员与使用方式。"
      />
      {configError && (
        <ErrorNotice message={configError} onRetry={() => setRevision((v) => v + 1)} />
      )}
      <section className="settings-section">
        <h2>知识服务</h2>
        <p className="muted">模型密钥保存在服务端，不会在浏览器展示。</p>
        <div className="service-grid">
          <div>
            <Cpu size={21} />
            <small>回答模式</small>
            <strong>{config?.demo_mode ? '本地资料摘录' : config?.model || '加载中…'}</strong>
            <span>
              {config?.demo_mode
                ? '未连接外部模型，不产生模型调用费用'
                : '使用服务端配置的兼容模型接口'}
            </span>
          </div>
          <div>
            <Database size={21} />
            <small>知识存储</small>
            <strong>
              {config?.database === 'postgresql'
                ? 'PostgreSQL + pgvector'
                : config
                  ? 'SQLite · 本地模式'
                  : '加载中…'}
            </strong>
            <span>
              {config
                ? config.retrieval_mode === 'hybrid'
                  ? '关键词 + 语义混合检索'
                  : '关键词检索 · 无需向量服务'
                : '正在读取检索配置…'}
            </span>
          </div>
          <div>
            <ShieldCheck size={21} />
            <small>访问保护</small>
            <strong>按身份与部门过滤</strong>
            <span>检索、原文与历史引用使用一致权限</span>
          </div>
        </div>
      </section>
      <section className="settings-section">
        <h2>从演示到团队使用</h2>
        <div className="setup-steps">
          <div>
            <span>01</span>
            <div>
              <strong>整理真实产品资料</strong>
              <p>为每份文档标注产品、版本与可见范围，再上传到知识库。</p>
            </div>
          </div>
          <div>
            <span>02</span>
            <div>
              <strong>连接模型和数据库</strong>
              <p>在服务端配置聊天模型与密钥；可先使用关键词检索，团队环境关闭演示入口。</p>
            </div>
          </div>
          <div>
            <span>03</span>
            <div>
              <strong>重建索引并核对答案</strong>
              <p>启用或更换向量服务后，更新文档重建索引；用常见产品问题核对检索依据与回答。</p>
            </div>
          </div>
        </div>
      </section>
      {user?.role === 'admin' ? (
        <section className="document-section">
          <div className="section-heading">
            <div>
              <h2>
                <Users size={18} />
                团队成员<span>{users.length}</span>
              </h2>
              <p>管理员负责维护知识，成员只访问有权查看的资料。</p>
            </div>
            <Button
              onClick={() => {
                setForm({ username: '', name: '', department: '', password: '' })
                setFormError('')
                setOpen(true)
              }}
            >
              <Plus size={16} />
              添加成员
            </Button>
          </div>
          <DataTable
            data={users.slice((page - 1) * 10, page * 10)}
            columns={columns}
            getRowId={(u) => u.id}
            loading={loading}
            error={error}
            onRetry={() => setRevision((v) => v + 1)}
            empty="还没有团队成员"
            pagination={{ page, pageSize: 10, total: users.length, onPageChange: setPage }}
          />
        </section>
      ) : (
        <div className="info-banner">
          <KeyRound size={17} />
          你当前是普通成员。如需上传文档或添加成员，请联系工作空间管理员。
        </div>
      )}
      <div className="document-tip">
        <BookOpen size={18} />
        <div>
          <strong>当前版本：v0.1.0</strong>
          <p>
            已提供文档管理、混合检索接口、流式问答与账号权限。单点登录、飞书同步、OCR
            和质量评测可在后续接入。
          </p>
        </div>
      </div>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) {
            setOpen(v)
            setFormError('')
          }
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
            title="添加团队成员"
            description="新成员仅能访问全公司文档和其所属部门的资料。"
          />
          <form onSubmit={create} noValidate>
            {(['name', 'username', 'department', 'password'] as const).map((key) => (
              <label className="field" key={key}>
                {
                  {
                    name: '成员姓名',
                    username: '登录账号',
                    department: '所属部门',
                    password: '初始密码',
                  }[key]
                }
                <Input
                  value={form[key]}
                  type={key === 'password' ? 'password' : 'text'}
                  autoComplete={key === 'password' ? 'new-password' : 'off'}
                  onChange={(e) => setForm((v) => ({ ...v, [key]: e.target.value }))}
                  placeholder={
                    {
                      name: '例如：张明',
                      username: '例如：zhangming',
                      department: '例如：产品部',
                      password: '至少 12 位字符',
                    }[key]
                  }
                  disabled={busy}
                />
              </label>
            ))}
            {formError && (
              <p role="alert" className="field-error">
                {formError}
              </p>
            )}
            <div className="dialog-footer">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                取消
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <LoaderCircle className="spin" size={15} />}
                {busy ? '正在创建…' : '创建成员'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
