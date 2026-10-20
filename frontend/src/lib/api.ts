export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, { ...init, credentials: 'same-origin' })
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    throw new ApiError(0, '无法连接服务，请检查网络后重试')
  }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('ddt:unauthorized'))
    const body = await response.json().catch(() => ({}))
    throw new ApiError(
      response.status,
      typeof body.detail === 'string' ? body.detail : '提交内容无效，请检查后重试',
    )
  }
  return response
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return (await request(path, init)).json()
}
export const json = (value: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(value),
})

// A network chunk may split UTF-8 characters, SSE lines, or entire events.
export async function streamChat(
  body: unknown,
  signal: AbortSignal,
  onEvent: (type: string, data: Record<string, unknown>) => void,
  path = '/chat',
) {
  const response = await request(path, { ...json(body), signal })
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body)
    throw new Error('服务未返回流式响应，请重试')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '',
    done = false
  try {
    while (!done) {
      const result = await reader.read()
      buffer += decoder.decode(result.value, { stream: !result.done })
      let boundary: RegExpExecArray | null
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)
        const lines = block.split(/\r?\n/)
        const type =
          lines
            .find((line) => line.startsWith('event:'))
            ?.slice(6)
            .trim() || 'message'
        const data = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (!data) continue
        const payload = JSON.parse(data)
        if (type === 'error') throw new Error(payload.message || '回答未能完整生成，请重试')
        onEvent(type, payload)
        if (type === 'done') {
          done = true
          break
        }
      }
      if (result.done) break
    }
    if (!done)
      throw new Error(
        path.startsWith('/reviews/')
          ? '连接提前中断，当前审查未完成，请重新打开窗口确认状态或继续审查'
          : '连接提前中断，当前回答未完成，请重试',
      )
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
