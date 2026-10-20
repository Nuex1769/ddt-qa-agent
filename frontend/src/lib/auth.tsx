import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { api, json } from './api'
import type { User } from './types'

interface AuthContextValue {
  user: User | null
  loading: boolean
  demoMode: boolean
  error: string
  login: (username: string, password: string) => Promise<void>
  demoLogin: (account: string) => Promise<void>
  logout: () => Promise<void>
  reload: () => void
}
const AuthContext = createContext<AuthContextValue>(null!)
function loggedOutLocally(value?: boolean) {
  try {
    if (value !== undefined) {
      if (value) sessionStorage.setItem('ddt:logged-out', '1')
      else sessionStorage.removeItem('ddt:logged-out')
    }
    return sessionStorage.getItem('ddt:logged-out') === '1'
  } catch {
    return false
  }
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const expired = useRef(false)
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [demoMode, setDemoMode] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    Promise.all([
      api<{ demo_mode: boolean }>('/auth/config'),
      loggedOutLocally()
        ? Promise.resolve(null)
        : api<User>('/auth/me').catch((e) => {
            if (e.status === 401) return null
            throw e
          }),
    ])
      .then(([config, current]) => {
        if (active) {
          setDemoMode(config.demo_mode)
          setUser(current)
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    const expire = () => {
      if (expired.current) return
      expired.current = true
      loggedOutLocally(true)
      setUser(null)
      toast.error('会话已失效，请重新登录')
    }
    window.addEventListener('ddt:unauthorized', expire)
    return () => {
      active = false
      window.removeEventListener('ddt:unauthorized', expire)
    }
  }, [revision])
  const login = async (username: string, password: string) => {
    const u = await api<User>('/auth/login', json({ username, password }))
    expired.current = false
    loggedOutLocally(false)
    setUser(u)
    toast.success('登录成功')
  }
  const demoLogin = async (account: string) => {
    const u = await api<User>('/auth/demo', json({ account }))
    expired.current = false
    loggedOutLocally(false)
    setUser(u)
    toast.success('已进入演示工作空间')
  }
  const logout = async () => {
    loggedOutLocally(true)
    setUser(null)
    try {
      await api('/auth/logout', { method: 'POST' })
      toast.success('已退出登录')
    } catch {
      toast.error('退出请求失败，本地身份已清除；请关闭页面或重试退出')
    } finally {
      setUser(null)
    }
  }
  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        demoMode,
        error,
        login,
        demoLogin,
        logout,
        reload: () => setRevision((x) => x + 1),
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
export const useAuth = () => useContext(AuthContext)
