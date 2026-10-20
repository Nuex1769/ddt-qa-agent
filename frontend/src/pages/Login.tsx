import { useState, type FormEvent } from 'react'
import { ArrowRight, BookOpen, FileSearch, LoaderCircle, ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorNotice } from '@/components/console/shared'
import { useAuth } from '@/lib/auth'
import { toast } from 'sonner'

export function Login() {
  const auth = useAuth(),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!username.trim() || !password) {
      setError('请填写账号和密码')
      return
    }
    setBusy(true)
    try {
      await auth.login(username.trim(), password)
    } catch (e) {
      setError((e as Error).message)
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const demo = async (account: string) => {
    setBusy(true)
    setError('')
    try {
      await auth.demoLogin(account)
    } catch (e) {
      setError((e as Error).message)
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">
            <BookOpen size={23} />
          </span>
          <span>
            DDT <strong>QA Agent</strong>
          </span>
        </div>
        <div className="login-story-main">
          <span className="eyebrow">YOUR TEAM’S KNOWLEDGE, CONNECTED</span>
          <h1>
            每一个好问题，
            <br />
            都有据可循。
          </h1>
          <p>
            连接分散的产品资料，
            <br />
            让团队的经验成为随时可用的答案。
          </p>
          <div className="story-art" aria-hidden="true">
            <div className="art-document">
              <span />
              <span />
              <span />
              <div>
                <FileSearch size={35} />
                <i />
              </div>
              <span />
              <span />
            </div>
            <div className="art-answer">
              <Sparkles size={24} />
              <div>
                <span />
                <span />
                <span />
              </div>
            </div>
            <div className="art-citation">
              <ShieldCheck size={19} />
              来源可追溯
            </div>
          </div>
        </div>
        <p className="login-footnote">INTERNAL PRODUCT KNOWLEDGE WORKSPACE</p>
      </section>
      <section className="login-panel">
        <div className="login-form">
          <span className="small-brand">
            <BookOpen size={20} />
            DDT QA Agent
          </span>
          <p className="eyebrow">WELCOME BACK</p>
          <h2>进入知识工作空间</h2>
          <p className="muted">使用公司账号登录，发现与你相关的产品知识。</p>
          {auth.error && <ErrorNotice message={auth.error} onRetry={auth.reload} />}
          <form onSubmit={submit} noValidate>
            <label className="field">
              账号
              <Input
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="输入你的账号"
              />
            </label>
            <label className="field">
              密码
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入登录密码"
              />
            </label>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy} className="full-width">
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <>
                  登录工作空间
                  <ArrowRight size={17} />
                </>
              )}
            </Button>
          </form>
          {auth.demoMode && (
            <div className="demo-login">
              <div className="divider">
                <span>或先体验演示空间</span>
              </div>
              <Button
                variant="secondary"
                className="full-width"
                onClick={() => demo('admin')}
                disabled={busy}
              >
                以演示管理员身份进入
                <ArrowRight size={16} />
              </Button>
              <div className="demo-roles">
                <Button variant="ghost" size="sm" onClick={() => demo('product')} disabled={busy}>
                  产品部成员
                </Button>
                <span>·</span>
                <Button variant="ghost" size="sm" onClick={() => demo('support')} disabled={busy}>
                  客服部成员
                </Button>
              </div>
              <p className="fine-print">
                演示资料为虚构内容，未连接外部模型。
                <br />
                不同身份可体验文档访问权限的差异。
              </p>
            </div>
          )}
          <div className="login-security">
            <ShieldCheck size={15} />
            <span>文档按权限访问 · 模型密钥仅保存在服务端</span>
          </div>
        </div>
      </section>
    </main>
  )
}
