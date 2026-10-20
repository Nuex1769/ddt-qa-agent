export interface User {
  id: string
  username: string
  name: string
  role: 'admin' | 'member'
  department: string
}
export interface Config {
  demo_mode: boolean
  model: string
  retrieval_mode: 'keyword' | 'hybrid'
  database: string
  max_upload_mb: number
  document_count: number
  chunk_count: number
  products: { name: string; versions: string[] }[]
  needs_reindex: number
}
export interface DocumentRecord {
  id: string
  title: string
  filename: string
  product: string
  version: string
  visibility: 'company' | 'department' | 'private'
  department: string
  chunk_count: number
  size: number
  updated_at: string
  content?: string
  citation?: { section: number; range: { start: number; end: number } | null }
}
export interface Source {
  number: number
  document_id: string
  chunk_id: string
  title: string
  product: string
  version: string
  text: string
  digest: string
  revision?: string
  section: number
}
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources: Source[]
  status: 'complete' | 'streaming' | 'interrupted' | 'error' | 'stale'
  product?: string
  version?: string
}
export interface Conversation {
  id: string
  title: string
  updated_at: string
}

export interface ReviewFinding {
  id: string
  kind: 'conflict' | 'missing' | 'clarity'
  title: string
  explanation: string
  suggestion?: string
  original: string
  replacement: string
  can_apply: boolean
  sources: Source[]
}
export interface ReviewTurn {
  id: string
  question: string
  summary: string
  findings: ReviewFinding[]
  sources: Source[]
  status: 'complete' | 'streaming' | 'interrupted' | 'error' | 'stale'
  completed_parts: number
  total_parts: number
}
export interface DocumentReview {
  id: string
  document_id: string
  base_revision: string
  draft_id: string
  busy: boolean
  stale: boolean
  turns: ReviewTurn[]
}
export interface DocumentVersion {
  id: string
  document_id: string
  status: 'draft' | 'published'
  version: string
  base_version: string
  base_revision: string
  published_revision: string
  created_at: string
  updated_at: string
  content?: string
  base_content?: string
  adopted_ids?: string[]
  diff?: { kind: 'equal' | 'insert' | 'delete' | 'replace'; old: string; new: string }[]
}

export interface Observation {
  id: string
  operation: 'chat' | 'review'
  user_id: string
  session_id: string
  mode: 'demo' | 'production'
  model: string
  status: 'complete' | 'error' | 'interrupted'
  started_at: string
  ended_at: string
  duration_ms: number
  input_tokens: number | null
  output_tokens: number | null
  export_status: 'disabled' | 'pending' | 'sending' | 'synced' | 'failed'
  export_attempts: number
  export_error: string
  exported_at: string
  langfuse_url: string
  spans?: {
    id: string
    parent_id: string
    name: string
    kind: string
    model?: string
    status: string
    duration_ms: number
    input_tokens: number | null
    output_tokens: number | null
    error_type?: string
  }[]
  details?: Record<string, number | string>
}
export interface ObservabilityConfig {
  enabled: boolean
  configured: boolean
  base_url: string
  project_link_configured: boolean
  content_capture: boolean
}
