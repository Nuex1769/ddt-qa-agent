import { useEffect, useState, type FormEvent } from 'react'
import { Download, LoaderCircle, Pencil, Plus, Search, Upload, Wine } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SelectField } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog'
import { DataTable, ErrorNotice, PageHeader, type Column } from '@/components/console/shared'
import { api, json, request } from '@/lib/api'
import { money, sweetnessLabels, type Drink } from '@/lib/tavern'

const initialForm = {
  name: '',
  description: '',
  category: '鸡尾酒',
  price: '',
  alcohol: '',
  sweetness: '1',
  ingredients: '',
  allergens: '',
  tags: '',
  private_recipe: '',
  available: 'true',
}
const labels = (value: string) => [
  ...new Set(
    value
      .split(/[,，、\n]/)
      .map((v) => v.trim())
      .filter(Boolean),
  ),
]

function DrinkEditor({
  drink,
  onClose,
  onSaved,
}: {
  drink: Drink | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState(
    drink
      ? {
          name: drink.name,
          description: drink.description,
          category: drink.category,
          price: String(drink.price_fen / 100),
          alcohol: String(drink.alcohol_percent),
          sweetness: String(drink.sweetness),
          ingredients: drink.ingredients.join('，'),
          allergens: drink.allergens.join('，'),
          tags: drink.tags.join('，'),
          private_recipe: drink.private_recipe,
          available: String(drink.available),
        }
      : initialForm,
  )
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const field = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (
      !form.name.trim() ||
      !form.category.trim() ||
      !labels(form.ingredients).length ||
      !/^\d+(\.\d{1,2})?$/.test(form.price) ||
      !/^\d+(\.\d+)?$/.test(form.alcohol)
    ) {
      setError('请填写酒名、分类、公开原料、价格和酒精度；价格最多两位小数')
      return
    }
    if (
      Number(form.price) > 1000 ||
      Number(form.alcohol) > 100 ||
      form.name.trim().length > 80 ||
      form.category.trim().length > 40 ||
      form.description.trim().length > 500 ||
      form.private_recipe.length > 20000 ||
      [form.ingredients, form.allergens, form.tags].some((v) =>
        labels(v).some((s) => s.length > 40),
      ) ||
      labels(form.ingredients).length > 40 ||
      labels(form.allergens).length > 20 ||
      labels(form.tags).length > 20
    ) {
      setError('请检查字段长度、标签数量、价格（0–1000 元）和酒精度（0–100%）')
      return
    }
    setBusy(true)
    try {
      await api(`/admin/tavern/drinks${drink ? `/${drink.id}` : ''}`, {
        ...json({
          name: form.name.trim(),
          description: form.description.trim(),
          category: form.category.trim(),
          price_fen: Math.round(Number(form.price) * 100),
          alcohol_percent: Number(form.alcohol),
          sweetness: Number(form.sweetness),
          ingredients: labels(form.ingredients),
          allergens: labels(form.allergens),
          tags: labels(form.tags),
          private_recipe: form.private_recipe.trim(),
          available: form.available === 'true',
          ...(drink ? { revision: drink.revision } : {}),
        }),
        method: drink ? 'PUT' : 'POST',
      })
      toast.success(drink ? '酒款已更新，小程序将使用最新酒单' : '酒款已创建')
      onSaved()
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
      open
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
          title={drink ? '编辑酒款与配方' : '新增酒款'}
          description="公开资料用于顾客推荐；内部配方仅管理员可见。"
        />
        <form noValidate onSubmit={submit} className="tavern-form">
          <div className="tavern-fields">
            <label>
              酒款名称
              <Input
                value={form.name}
                onChange={(e) => field('name', e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              酒款分类
              <Input
                value={form.category}
                onChange={(e) => field('category', e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              售价（元）
              <Input
                inputMode="decimal"
                value={form.price}
                onChange={(e) => field('price', e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              酒精度（%）
              <Input
                inputMode="decimal"
                value={form.alcohol}
                onChange={(e) => field('alcohol', e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              甜度
              <SelectField
                label="甜度"
                value={form.sweetness}
                onChange={(v) => field('sweetness', v)}
                disabled={busy}
                options={sweetnessLabels.map((v, i) => ({
                  value: String(i),
                  label: `${i} · ${v}`,
                }))}
              />
            </label>
            <label>
              上架状态
              <SelectField
                label="上架状态"
                value={form.available}
                onChange={(v) => field('available', v)}
                disabled={busy}
                options={[
                  { value: 'true', label: '上架' },
                  { value: 'false', label: '下架' },
                ]}
              />
            </label>
          </div>
          <label>
            公开介绍
            <Input
              value={form.description}
              onChange={(e) => field('description', e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            公开原料（用逗号分隔）
            <Input
              value={form.ingredients}
              onChange={(e) => field('ingredients', e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            过敏原（无已知过敏原可留空）
            <Input
              value={form.allergens}
              placeholder="例如：乳制品，坚果"
              onChange={(e) => field('allergens', e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            风味标签
            <Input
              value={form.tags}
              placeholder="例如：清爽，柑橘，果香"
              onChange={(e) => field('tags', e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            内部配方
            <textarea
              className="input tavern-recipe"
              value={form.private_recipe}
              onChange={(e) => field('private_recipe', e.target.value)}
              disabled={busy}
            />
          </label>
          <p className="muted">
            无酒精需明确填写 0。请核实原料实际酒精含量和过敏原，甜度不代表糖含量。
          </p>
          {error && <ErrorNotice message={error} />}
          <div className="dialog-actions">
            <Button variant="outline" onClick={onClose} type="button" disabled={busy}>
              取消
            </Button>
            <Button disabled={busy} type="submit">
              {busy && <LoaderCircle className="spin" size={15} />}保存酒款
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ImportDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!file || !file.name.endsWith('.json') || file.size > 2 * 1024 * 1024) {
      setError('请选择不超过 2 MB 的 JSON 酒单文件')
      return
    }
    let data: unknown
    try {
      data = JSON.parse(await file.text())
    } catch {
      setError('文件不是有效的 JSON，请按模板修改')
      return
    }
    setBusy(true)
    try {
      const result = await api<{ count: number }>('/admin/tavern/import', json(data))
      toast.success(`已导入 ${result.count} 款酒`)
      onSaved()
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
      open
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
          title="导入酒单与配方"
          description="使用 JSON 模板批量新增酒款。重复酒名将阻止整批导入，已有数据不会被覆盖。"
        />
        <form noValidate onSubmit={submit} className="tavern-form">
          <label>
            酒单文件
            <Input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <p className="muted">
            最多 200 款、2 MB。模板内全部为虚构示例，正式经营前请替换。PDF / Word
            原始资料仍可在“知识文档”中上传，并设为仅管理员可见；上架酒款需在这里核实结构化字段。
          </p>
          {error && <ErrorNotice message={error} />}
          <div className="dialog-actions">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={15} />}导入酒单
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function Tavern() {
  const [items, setItems] = useState<Drink[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [q, setQ] = useState(''),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [editor, setEditor] = useState<{ drink: Drink | null } | null>(null),
    [importing, setImporting] = useState(false),
    [downloading, setDownloading] = useState(false)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    api<{ items: Drink[]; total: number }>(
      `/admin/tavern/drinks?q=${encodeURIComponent(q)}&page=${page}`,
    )
      .then((data) => {
        if (active) {
          setItems(data.items)
          setTotal(data.total)
        }
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
  }, [q, page, revision])
  const refresh = () => setRevision((v) => v + 1)
  const download = async () => {
    setDownloading(true)
    try {
      const blob = await (await request('/admin/tavern/template')).blob()
      const url = URL.createObjectURL(blob),
        link = document.createElement('a')
      link.href = url
      link.download = 'tavern-menu.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success('酒单模板已下载')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDownloading(false)
    }
  }
  const columns: Column<Drink>[] = [
    {
      id: 'name',
      header: '酒款',
      width: 240,
      cell: (d) => (
        <div className="two-lines">
          <strong>{d.name}</strong>
          <small>
            {d.category} · {d.tags.join(' / ') || '未设置风味'}
          </small>
        </div>
      ),
    },
    { id: 'price', header: '售价', width: 110, cell: (d) => money(d.price_fen) },
    {
      id: 'alcohol',
      header: '酒精度',
      width: 120,
      cell: (d) => (
        <span className={d.alcohol_percent === 0 ? 'ready-label' : ''}>{d.alcohol_percent}%</span>
      ),
    },
    { id: 'sweetness', header: '甜度', width: 100, cell: (d) => sweetnessLabels[d.sweetness] },
    {
      id: 'allergens',
      header: '过敏原',
      width: 160,
      cell: (d) => d.allergens.join('、') || '无已标注过敏原',
    },
    {
      id: 'status',
      header: '状态',
      width: 100,
      cell: (d) => <span className="subtle-tag">{d.available ? '上架' : '下架'}</span>,
    },
    {
      id: 'actions',
      header: '操作',
      width: 110,
      align: 'right',
      cell: (d) => (
        <Button variant="ghost" size="sm" onClick={() => setEditor({ drink: d })}>
          <Pencil size={14} />
          编辑
        </Button>
      ),
    },
  ]
  return (
    <div className="page-container tavern-page">
      <PageHeader
        eyebrow="TAVERN CATALOG"
        title="酒单与配方"
        description="维护可售酒款，让每一次推荐都有准确的口味、价格与原料依据。"
        action={
          <Button onClick={() => setEditor({ drink: null })}>
            <Plus size={16} />
            新增酒款
          </Button>
        }
      />
      <div className="tavern-note">
        <Wine size={20} />
        <div>
          <strong>从一句“想喝什么”开始</strong>
          <p>
            小程序支持需求推荐、购物车与依据已完成订单推测“老样子”。当前阶段不提交订单、不发起支付。
          </p>
        </div>
      </div>
      <div className="tavern-toolbar">
        <div className="tavern-search">
          <Search size={16} />
          <Input
            aria-label="搜索酒款"
            placeholder="搜索酒款名称"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <div>
          <Button variant="outline" onClick={download} disabled={downloading}>
            <Download size={15} />
            下载模板
          </Button>
          <Button variant="outline" onClick={() => setImporting(true)}>
            <Upload size={15} />
            导入酒单
          </Button>
        </div>
      </div>
      <DataTable
        data={items}
        columns={columns}
        getRowId={(d) => d.id}
        loading={loading}
        error={error}
        onRetry={refresh}
        empty={q ? '没有匹配的酒款' : '还没有酒款，请新增或按模板导入酒单'}
        pagination={{ page, pageSize: 10, total, onPageChange: setPage }}
      />
      {editor && (
        <DrinkEditor drink={editor.drink} onClose={() => setEditor(null)} onSaved={refresh} />
      )}
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onSaved={() => {
            setPage(1)
            refresh()
          }}
        />
      )}
    </div>
  )
}
