import { useEffect, useState, type ReactNode } from 'react'
import { AlertCircle, ArrowLeft, ArrowRight, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/ui/select'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { api } from '@/lib/api'
import type { Config } from '@/lib/types'

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action}
    </header>
  )
}
export function ScopeFilters({
  config,
  product,
  version,
  onProduct,
  onVersion,
  disabled,
}: {
  config: Config | null
  product: string
  version: string
  onProduct: (v: string) => void
  onVersion: (v: string) => void
  disabled?: boolean
}) {
  const versions = config?.products.find((p) => p.name === product)?.versions || []
  return (
    <div className="scope-filters">
      <SelectField
        label="产品筛选"
        value={product}
        onChange={(v) => {
          onProduct(v)
          onVersion('')
        }}
        disabled={disabled}
        options={[
          { value: '', label: '全部产品' },
          ...(config?.products || []).map((p) => ({ value: p.name, label: p.name })),
        ]}
      />
      <SelectField
        label="版本筛选"
        value={version}
        onChange={onVersion}
        disabled={disabled || !product}
        options={[
          { value: '', label: '全部版本' },
          ...versions.map((v) => ({ value: v, label: v })),
        ]}
      />
    </div>
  )
}
export function useConfig(revision = 0) {
  const [config, setConfig] = useState<Config | null>(null),
    [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setError('')
    api<Config>('/config')
      .then((c) => {
        if (active) setConfig(c)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [revision])
  return { config, configError: error }
}
export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-notice" role="alert">
      <AlertCircle size={17} />
      <span>{message}</span>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      )}
    </div>
  )
}
export interface Column<T> {
  id: string
  header: string
  cell: (row: T) => ReactNode
  width?: number
  align?: 'left' | 'right'
}
export function DataTable<T>({
  data,
  columns,
  getRowId,
  loading,
  error,
  onRetry,
  empty,
  pagination,
}: {
  data: T[]
  columns: Column<T>[]
  getRowId: (row: T) => string
  loading?: boolean
  error?: string
  onRetry?: () => void
  empty: string
  pagination: {
    page: number
    pageSize: number
    total: number
    onPageChange: (page: number) => void
  }
}) {
  const pages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize))
  return (
    <div className="records">
      <div className="table-scroll">
        <Table style={{ minWidth: columns.reduce((sum, col) => sum + (col.width || 140), 0) }}>
          <colgroup>
            {columns.map((col) => (
              <col key={col.id} style={{ width: col.width }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.id} style={{ textAlign: col.align }}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length}>
                  <div className="table-state">
                    <LoaderCircle className="spin" size={20} />
                    正在加载…
                  </div>
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={columns.length}>
                  <div className="table-state">
                    <ErrorNotice message={error} onRetry={onRetry} />
                  </div>
                </TableCell>
              </TableRow>
            ) : !data.length ? (
              <TableRow>
                <TableCell colSpan={columns.length}>
                  <div className="table-state">{empty}</div>
                </TableCell>
              </TableRow>
            ) : (
              data.map((row) => (
                <TableRow key={getRowId(row)}>
                  {columns.map((col) => (
                    <TableCell key={col.id} style={{ textAlign: col.align }}>
                      {col.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="pagination">
        <span>共 {pagination.total} 条记录</span>
        <div>
          <Button
            aria-label="上一页"
            title="上一页"
            variant="outline"
            size="icon"
            disabled={pagination.page <= 1 || loading}
            onClick={() => pagination.onPageChange(pagination.page - 1)}
          >
            <ArrowLeft size={15} />
          </Button>
          <span>
            {pagination.page} / {pages}
          </span>
          <Button
            aria-label="下一页"
            title="下一页"
            variant="outline"
            size="icon"
            disabled={pagination.page >= pages || loading}
            onClick={() => pagination.onPageChange(pagination.page + 1)}
          >
            <ArrowRight size={15} />
          </Button>
        </div>
      </div>
    </div>
  )
}
