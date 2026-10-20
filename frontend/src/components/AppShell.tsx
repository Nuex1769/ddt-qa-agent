import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  ChevronRight,
  CircleHelp,
  Files,
  LogOut,
  Menu,
  MoreHorizontal,
  MessageSquare,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Hint } from './ui/tooltip'
import { Dialog, DialogContent, DialogHeader } from './ui/dialog'
import { ConfirmDialog } from './ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import type { Conversation } from '@/lib/types'

export function AppShell() {
  const { user, demoMode, logout } = useAuth(),
    location = useLocation(),
    navigate = useNavigate()
  const [history, setHistory] = useState<Conversation[]>([]),
    [historyError, setHistoryError] = useState(''),
    [revision, setRevision] = useState(0),
    [mobile, setMobile] = useState(false),
    [deleting, setDeleting] = useState<Conversation | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api<Conversation[]>('/conversations')
      .then((items) => {
        if (active) {
          setHistory(items)
          setHistoryError('')
        }
      })
      .catch((e) => {
        if (active) setHistoryError(e.message)
      })
    return () => {
      active = false
    }
  }, [revision, user?.id])
  useEffect(() => {
    const refresh = () => setRevision((v) => v + 1)
    window.addEventListener('ddt:conversations', refresh)
    return () => window.removeEventListener('ddt:conversations', refresh)
  }, [])
  useEffect(() => {
    setMobile(false)
  }, [location.pathname])
  const remove = async () => {
    if (!deleting) return
    setBusy(true)
    setError('')
    try {
      await api(`/conversations/${deleting.id}`, { method: 'DELETE' })
      if (location.pathname.endsWith(deleting.id)) navigate('/chat')
      setDeleting(null)
      setRevision((v) => v + 1)
      toast.success('会话已删除')
    } catch (e) {
      setError((e as Error).message)
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const sidebar = (
    <>
      <Link to="/chat" className="brand">
        <span className="brand-mark">
          <BookOpen size={23} />
        </span>
        <span>
          DDT <strong>QA Agent</strong>
          <small>产品知识工作空间</small>
        </span>
      </Link>
      <Button asChild variant="outline" className="new-chat">
        <Link to="/chat" state={{ reset: Date.now() }}>
          <Plus size={17} />
          发起新对话
        </Link>
      </Button>
      <p className="nav-label">工作空间</p>
      <nav className="primary-nav" aria-label="主导航">
        <NavLink to="/chat">
          <MessageSquare size={18} />
          知识问答
        </NavLink>
        <NavLink to="/documents">
          <Files size={18} />
          知识文档
        </NavLink>
        <NavLink to="/settings">
          <Settings2 size={18} />
          工作空间设置
        </NavLink>
      </nav>
      <div className="history-heading">
        <span className="nav-label">最近对话</span>
        <span>{history.length}</span>
      </div>
      <div className="history-list">
        {historyError ? (
          <Button variant="ghost" onClick={() => setRevision((v) => v + 1)}>
            加载失败，点击重试
          </Button>
        ) : !history.length ? (
          <p className="history-empty">你的问题，会从这里开始。</p>
        ) : (
          history.map((conv) => (
            <div
              className={`history-item ${location.pathname.endsWith(conv.id) ? 'selected' : ''}`}
              key={conv.id}
            >
              <Link to={`/chat/${conv.id}`}>
                <MessageSquare size={13} />
                <span>{conv.title}</span>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`会话操作 ${conv.title}`}
                    title="会话操作"
                  >
                    <MoreHorizontal size={14} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    className="danger-item"
                    onSelect={() => {
                      setError('')
                      setDeleting(conv)
                    }}
                  >
                    <Trash2 size={14} />
                    删除会话
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </div>
      <div className="sidebar-bottom">
        <div className="workspace-note">
          <ShieldCheck size={17} />
          <div>
            团队知识，按权限可见
            <small>{demoMode ? '当前为本地演示空间' : '公司内部知识空间'}</small>
          </div>
        </div>
        <div className="user-block">
          <span className="avatar">{user?.name.slice(0, 1)}</span>
          <div>
            <strong>{user?.name}</strong>
            <small>
              {user?.department} · {user?.role === 'admin' ? '管理员' : '成员'}
            </small>
          </div>
          <Hint label="退出登录">
            <Button variant="ghost" size="icon" aria-label="退出登录" onClick={logout}>
              <LogOut size={16} />
            </Button>
          </Hint>
        </div>
      </div>
    </>
  )
  const section = location.pathname.startsWith('/documents')
    ? '知识文档'
    : location.pathname.startsWith('/settings')
      ? '工作空间设置'
      : '知识问答'
  return (
    <div className="app-shell">
      <aside className="sidebar">{sidebar}</aside>
      <Dialog open={mobile} onOpenChange={setMobile}>
        <DialogContent className="mobile-sidebar">
          <div className="sr-only">
            <DialogHeader title="工作空间导航" description="访问知识问答、文档和设置" />
          </div>
          {sidebar}
        </DialogContent>
      </Dialog>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="打开导航菜单"
              title="打开导航菜单"
              className="mobile-menu"
              onClick={() => setMobile(true)}
            >
              <Menu size={19} />
            </Button>
            <span className="breadcrumb">
              工作空间
              <ChevronRight size={14} />
              <strong>{section}</strong>
            </span>
          </div>
          <div className="topbar-right">
            {demoMode && (
              <span className="demo-pill">
                <span />
                演示模式
              </span>
            )}
            <Hint label="查看运行配置和使用说明">
              <Button asChild variant="ghost" size="icon" aria-label="使用说明">
                <Link to="/settings">
                  <CircleHelp size={18} />
                </Link>
              </Button>
            </Hint>
            <span className="topbar-avatar">{user?.name.slice(0, 1)}</span>
          </div>
        </header>
        <main className="workspace-main">
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>DDT QA Agent</span>
          <span>让团队知识成为可靠的答案</span>
          <span>v0.1.0</span>
        </footer>
      </div>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null)
            setError('')
          }
        }}
        title="删除这段对话？"
        description={`「${deleting?.title || ''}」及其消息将被永久删除，无法恢复。知识文档不受影响。`}
        busy={busy}
        error={error}
        onConfirm={remove}
      />
    </div>
  )
}
