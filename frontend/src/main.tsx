import { Component, StrictMode, Suspense, lazy, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { AppShell } from '@/components/AppShell'
import { AuthProvider, useAuth } from '@/lib/auth'
import { Login } from '@/pages/Login'
import './styles.css'

const Chat = lazy(() => import('@/pages/Chat').then((m) => ({ default: m.Chat })))
const Documents = lazy(() => import('@/pages/Documents').then((m) => ({ default: m.Documents })))
const Settings = lazy(() => import('@/pages/Settings').then((m) => ({ default: m.Settings })))

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <div className="app-error" role="alert">
        <h1>页面遇到了一点问题</h1>
        <p>请重新加载页面；已保存的知识文档和会话不会丢失。</p>
        <Button onClick={() => window.location.reload()}>重新加载</Button>
      </div>
    ) : (
      this.props.children
    )
  }
}
function App() {
  const { user, loading } = useAuth()
  if (loading)
    return (
      <div className="loading fullscreen">
        <LoaderCircle className="spin" />
        正在打开知识工作空间…
      </div>
    )
  if (!user) return <Login />
  return (
    <Suspense
      fallback={
        <div className="loading fullscreen">
          <LoaderCircle className="spin" />
          正在加载页面…
        </div>
      }
    >
      <Routes>
        <Route element={<AppShell key={user.id} />}>
          <Route path="/chat" element={<Chat />} />
          <Route path="/chat/:conversationId" element={<Chat />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <TooltipProvider delayDuration={250}>
          <AuthProvider>
            <App />
            <Toaster position="top-right" richColors closeButton />
          </AuthProvider>
        </TooltipProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
