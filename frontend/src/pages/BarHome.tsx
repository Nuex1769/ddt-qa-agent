import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUp, BookOpen, CircleUserRound, Disc3, Minus, Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog'
import { inferUsual, readMockOrders, type OrderHistory } from '@/lib/bar-history'
import { createAmbience } from '@/bar/ambience'
import {
  advise,
  alcoholChoices,
  alcoholHint,
  barDrinks,
  categoryChoices,
  defaultFilters,
  drinkById,
  filtersFromText,
  flavorChoices,
  formatAbv,
  sweetnessChoices,
  type Advice,
  type BarDrink,
  type BarFilters,
} from '@/bar/catalog'
import { BarScene, webglSupported, type SceneDrink } from '@/bar/scene'
import {
  addToCart,
  cartCount,
  cartTotal,
  changeQty,
  formatStampDate,
  readCart,
  readCoasters,
  stampCoaster,
  writeCart,
  writeCoasters,
  type CartLine,
  type CoasterStamp,
} from '@/bar/storage'
import './bar-home.css'

type Tab = 'tonight' | 'menu' | 'coaster'

const prompts = [
  { label: '微甜 · 无酒精', text: '微甜一点，无酒精。' },
  { label: '来杯清爽精酿', text: '来一杯清爽的精酿' },
  { label: '老样子', text: '老样子' },
]

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return reduced
}

function sceneDrink(drink: BarDrink): SceneDrink {
  return {
    id: drink.id,
    glass: drink.glass,
    liquid: drink.liquid,
    garnish: drink.garnish,
    mint: drink.mint,
    ice: drink.ice,
    bubbles: drink.bubbles,
    foam: drink.foam,
    body: drink.body,
  }
}

function orderStatus(status: string) {
  if (status === 'completed') return '已完成'
  if (status === 'cancelled') return '已取消 · 不计入'
  return '已退款 · 不计入'
}

function orderLine(order: OrderHistory) {
  return order.items
    .map((item) => `${drinkById[item.drink_id]?.name || '已下架酒款'} × ${item.quantity}`)
    .join('、')
}

export function BarHome() {
  const reduced = useReducedMotion()
  const [tab, setTab] = useState<Tab>('tonight')
  const [filters, setFilters] = useState<BarFilters>(defaultFilters)
  const [draft, setDraft] = useState('')
  const [submittedText, setSubmittedText] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [orders, setOrders] = useState(() => readMockOrders())
  const [advice, setAdvice] = useState<Advice>(() =>
    advise({
      text: '',
      filters: defaultFilters,
      usual: inferUsual(readMockOrders()),
      submitted: false,
    }),
  )
  const [selectedId, setSelectedId] = useState('lime')
  const [cart, setCart] = useState<CartLine[]>(() => readCart())
  const [stamps, setStamps] = useState<CoasterStamp[]>(() => readCoasters())
  const [note, setNote] = useState('今晚的单还不是订单。')
  const [cartOpen, setCartOpen] = useState(false)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [music, setMusic] = useState(false)
  const [musicDisabled, setMusicDisabled] = useState(false)
  const [webgl, setWebgl] = useState<'pending' | 'live' | 'flat'>(() =>
    webglSupported() ? 'pending' : 'flat',
  )
  const sceneRef = useRef<BarScene | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ambienceRef = useRef(createAmbience())
  const reducedRef = useRef(reduced)
  const tabRef = useRef(tab)
  const selected = drinkById[selectedId] ?? barDrinks[0]
  const stampLabel = stamps.some((stamp) => stamp.drinkId === selected.id) ? selected.name : null
  const selectedRef = useRef(sceneDrink(selected))
  const stampRef = useRef<string | null>(stampLabel)
  reducedRef.current = reduced
  tabRef.current = tab
  selectedRef.current = sceneDrink(selected)
  stampRef.current = stampLabel
  const visible = barDrinks.filter((drink) => {
    if (filters.category !== 'all' && drink.kind !== filters.category) return false
    if (filters.sweetness !== 'any' && drink.sweetness !== Number(filters.sweetness)) return false
    if (filters.flavor !== 'any' && !drink.flavors.includes(filters.flavor)) return false
    if (filters.alcohol === 'none' && drink.abv !== 0) return false
    if (filters.alcohol === 'low' && !(drink.abv > 0 && drink.abv < 10)) return false
    if (filters.alcohol === 'high' && drink.abv < 10) return false
    return true
  })
  const count = cartCount(cart)
  const total = cartTotal(cart)

  useEffect(() => {
    const previous = document.title
    document.title = '慢半拍 · SLOW SIDE BAR'
    return () => {
      document.title = previous
    }
  }, [])
  useEffect(() => {
    writeCart(cart)
  }, [cart])
  useEffect(() => {
    writeCoasters(stamps)
  }, [stamps])
  useEffect(() => {
    if (webgl === 'flat') return
    const canvas = canvasRef.current
    if (!canvas) return
    let scene: BarScene | null = null
    let stopped = false
    try {
      scene = new BarScene(canvas, {
        onSelect: (id) => {
          if (stopped || !drinkById[id]) return
          setSelectedId(id)
          setTab('tonight')
        },
        onContextLost: () => {
          if (stopped) return
          scene?.dispose()
          if (sceneRef.current === scene) sceneRef.current = null
          setWebgl('flat')
          setNote('立体场景中断了，已换成平面示意图。酒单和今晚的单还能用。')
        },
      })
      sceneRef.current = scene
      scene.setReducedMotion(reducedRef.current)
      scene.setDrink(selectedRef.current)
      scene.setStamp(stampRef.current)
      scene.start()
      if (!stopped) setWebgl('live')
    } catch {
      if (!stopped) setWebgl('flat')
    }
    return () => {
      stopped = true
      scene?.dispose()
      if (sceneRef.current === scene) sceneRef.current = null
    }
  }, [webgl === 'flat'])
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || webgl !== 'live') return
    scene.setReducedMotion(reduced)
    scene.setDrink(sceneDrink(selected))
    scene.setStamp(stampLabel)
    scene.setMusic(music)
  }, [reduced, selected, stampLabel, music, webgl])
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    if (tab === 'tonight' && document.visibilityState === 'visible') {
      scene.resize()
      scene.resume()
    } else scene.pause()
  }, [tab, webgl])
  useEffect(() => {
    const onVisibility = () => {
      const scene = sceneRef.current
      if (!scene) return
      if (document.hidden || tabRef.current !== 'tonight') scene.pause()
      else {
        scene.resize()
        scene.resume()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const publish = (text: string, nextFilters: BarFilters, isSubmitted: boolean) => {
    const history = readMockOrders()
    setOrders(history)
    setFilters(nextFilters)
    setSubmitted(isSubmitted)
    setSubmittedText(isSubmitted ? text : '')
    setAdvice(
      advise({ text, filters: nextFilters, usual: inferUsual(history), submitted: isSubmitted }),
    )
  }
  const applyFilters = (next: BarFilters) => {
    publish(submitted ? submittedText : '', next, submitted)
    setNote('筛选已更新。')
  }
  const submitMood = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    publish(trimmed, filtersFromText(trimmed, filters), true)
    setDraft('')
    setNote('已按纸条更新推荐。')
  }
  const send = (event: FormEvent) => {
    event.preventDefault()
    submitMood(draft)
  }
  const add = (id: string, qty = 1) => {
    const result = addToCart(cart, id, qty)
    setCart(result.lines)
    setNote(result.note)
  }
  const adjust = (id: string, delta: number) => {
    const result = changeQty(cart, id, delta)
    setCart(result.lines)
    setNote(result.note)
  }
  const stamp = () => {
    const result = stampCoaster(stamps, selected)
    setStamps(result.stamps)
    setNote(result.note)
  }
  const focusDrink = (id: string) => {
    setSelectedId(id)
    setTab('tonight')
  }
  const onCanvasKey = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const scene = sceneRef.current
    if (!scene) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const delta = event.key === 'ArrowLeft' ? -1 : 1
      if (event.shiftKey) scene.nudgeYaw(delta * 0.08)
      else scene.nudgeGlass(delta * 0.35)
    } else if (event.key === 'Home') {
      event.preventDefault()
      scene.resetYaw()
    }
  }
  const toggleMusic = async () => {
    const next = !music
    const ok = await ambienceRef.current.set(next)
    if (!ok) {
      setMusic(false)
      setMusicDisabled(true)
      setNote('此环境播放不了氛围声。')
      return
    }
    setMusic(next)
    setNote(next ? '正在播放本机合成的轻声。' : '氛围声已关上。')
  }

  return (
    <div className="ss-app" data-reduced-motion={reduced ? 'true' : 'false'} data-webgl={webgl}>
      <header className="ss-header">
        <div className="ss-brand">
          <Disc3 size={26} strokeWidth={1.15} aria-hidden="true" />
          <div>
            <strong className="ss-serif">慢半拍</strong>
            <small>SLOW SIDE · BAR</small>
          </div>
        </div>
        <Link className="ss-exit" to="/chat">
          知识助手
        </Link>
      </header>
      <main className="ss-main">
        <div className="ss-layout" data-tab={tab}>
          <section className="ss-stage-column" hidden={tab !== 'tonight'} aria-label="吧台">
            <div className="ss-stage">
              {webgl !== 'live' && <FlatStage drink={selected} />}
              {webgl !== 'flat' && (
                <canvas
                  ref={canvasRef}
                  className={webgl === 'live' ? 'ss-canvas is-live' : 'ss-canvas'}
                  role="application"
                  tabIndex={webgl === 'live' ? 0 : -1}
                  aria-hidden={webgl === 'live' ? undefined : true}
                  aria-describedby="stage-help"
                  aria-label={`立体吧台，当前是${selected.name}。方向键旋转酒杯，按住 Shift 再按左右方向键转动视线。`}
                  onKeyDown={onCanvasKey}
                />
              )}
              <div className="ss-stage-copy">
                <p className="ss-kicker">
                  <span>The night is still young</span>
                  <span>Cocktails & craft</span>
                </p>
                <p className="ss-eyebrow">Good music. Good company.</p>
                <h1 className="ss-title ss-serif">
                  把今晚，
                  <br />
                  调成喜欢的样子。
                </h1>
                <p className="ss-lede">
                  一杯鸡尾酒，或一口刚打的精酿。
                  <br />
                  你说心情，我们来选酒。
                </p>
                <span className="ss-hand">take it slow</span>
              </div>
            </div>
            <div className="ss-stage-hud">
              <p id="stage-help" className="ss-help">
                {webgl === 'flat'
                  ? '平面示意图。这个环境没有可用的 WebGL，酒单仍可使用。'
                  : music
                    ? '本机氛围声开着。拖动杯子旋转，空白处轻轻左右看。'
                    : '音乐先关着。拖动杯子旋转，空白处轻轻左右看。'}
              </p>
              <div className="ss-stage-controls">
                <button
                  type="button"
                  className="ss-hud"
                  onClick={() => sceneRef.current?.nudgeGlass(-0.45)}
                  disabled={webgl !== 'live'}
                >
                  杯子向左转
                </button>
                <button
                  type="button"
                  className="ss-hud"
                  onClick={() => sceneRef.current?.nudgeGlass(0.45)}
                  disabled={webgl !== 'live'}
                >
                  杯子向右转
                </button>
                <button
                  type="button"
                  className="ss-hud"
                  onClick={() => sceneRef.current?.resetYaw()}
                  disabled={webgl !== 'live'}
                >
                  视角回正
                </button>
                <button type="button" className="ss-hud" onClick={() => setTab('menu')}>
                  直接翻酒单
                </button>
                <button
                  type="button"
                  className="ss-hud"
                  aria-pressed={music}
                  disabled={musicDisabled}
                  onClick={() => void toggleMusic()}
                >
                  {musicDisabled ? '氛围声不可用' : music ? '关闭氛围声' : '氛围声'}
                </button>
              </div>
            </div>
          </section>
          <div className="ss-column">
            <div hidden={tab !== 'tonight'}>
              <InfoPanel drink={selected} onAdd={() => add(selected.id)} onStamp={stamp} />
              <section className="ss-note" aria-label="调酒师纸条">
                <span className="ss-tape" aria-hidden="true" />
                <div className="ss-note-head">
                  <span>A note from your bartender</span>
                  <span>为你选酒</span>
                </div>
                {submitted && (
                  <p className="ss-guest">
                    <span>你</span>
                    {submittedText}
                  </p>
                )}
                <p className="ss-answer">{advice.answer}</p>
                <p className="ss-source">本机规则对照酒单字段筛选，没有调用模型或店员。</p>
                {advice.showEvidence && (
                  <button
                    type="button"
                    className="ss-text-btn"
                    onClick={() => setEvidenceOpen(true)}
                  >
                    查看推荐依据
                  </button>
                )}
                {advice.answer.includes('没有 0.0%') && (
                  <button
                    type="button"
                    className="ss-text-btn"
                    onClick={() =>
                      applyFilters({ ...filters, category: 'cocktail', alcohol: 'none' })
                    }
                  >
                    改看无酒精鸡尾酒
                  </button>
                )}
                <FilterBar filters={filters} onChange={applyFilters} />
                <form className="ss-composer" noValidate onSubmit={send}>
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    aria-label="告诉调酒师你的口味"
                    placeholder="把今晚的心情，交给调酒师…"
                  />
                  <button type="submit" className="ss-send" aria-label="发送口味需求">
                    <ArrowUp size={18} />
                    <span className="ss-send-label">交给调酒师</span>
                  </button>
                </form>
                <div className="ss-prompts">
                  {prompts.map((prompt) => (
                    <button
                      key={prompt.label}
                      type="button"
                      className="ss-chip"
                      onClick={() => submitMood(prompt.text)}
                    >
                      {prompt.label}
                    </button>
                  ))}
                </div>
              </section>
              <section className="ss-recs" aria-label="推荐">
                <div className="ss-rec-head">
                  <h2 className="ss-serif">今晚的纸条</h2>
                  <span>{String(advice.recommendations.length).padStart(2, '0')} 杯</span>
                </div>
                {advice.recommendations.length ? (
                  advice.recommendations.map((item) => (
                    <article
                      key={item.drink.id}
                      className="ss-rec"
                      data-usual={item.usual ? 'true' : 'false'}
                    >
                      <button
                        type="button"
                        className="ss-rec-select"
                        aria-pressed={selectedId === item.drink.id}
                        onClick={() => setSelectedId(item.drink.id)}
                      >
                        <small>
                          {item.drink.kind === 'beer' ? 'CRAFT BEER' : 'SIGNATURE COCKTAIL'}
                        </small>
                        <strong className="ss-serif">{item.drink.name}</strong>
                        <p>{item.reason}</p>
                      </button>
                      {item.usual ? (
                        <button
                          type="button"
                          className="ss-btn ss-btn-amber"
                          onClick={() => add(item.drink.id, item.quantity)}
                        >
                          按老样子加入今晚的单
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="ss-btn ss-btn-line"
                          aria-label={`按这张纸条把${item.drink.name}加入今晚的单`}
                          onClick={() => add(item.drink.id, 1)}
                        >
                          加入今晚的单
                        </button>
                      )}
                    </article>
                  ))
                ) : (
                  <div className="ss-empty">
                    <p>这一组筛选下面没有酒。</p>
                    <button
                      type="button"
                      className="ss-btn ss-btn-line"
                      onClick={() => applyFilters(defaultFilters)}
                    >
                      清空筛选
                    </button>
                  </div>
                )}
              </section>
            </div>
            <div hidden={tab !== 'menu'}>
              <MenuPanel
                drinks={visible}
                filters={filters}
                onChange={applyFilters}
                onOpen={focusDrink}
                onAdd={(id) => add(id)}
                onClear={() => applyFilters(defaultFilters)}
              />
            </div>
            <div hidden={tab !== 'coaster'}>
              <CoasterPanel
                stamps={stamps}
                onOpen={focusDrink}
                onRemove={(id) => {
                  setStamps(stamps.filter((stamp) => stamp.id !== id))
                  setNote('已从杯垫揭下。今晚的单没有变。')
                }}
                onBrowse={() => setTab('tonight')}
              />
            </div>
          </div>
        </div>
      </main>
      <footer className="ss-dock">
        <p className="ss-dock-note" role="status">
          {note}
        </p>
        <button
          type="button"
          className="ss-cart"
          onClick={() => setCartOpen(true)}
          aria-label={`今晚的单，${count}杯，合计${total}元`}
        >
          <span>今晚的单</span>
          <strong>
            {count} 杯 · ¥{total}
          </strong>
        </button>
        <nav className="ss-nav" aria-label="酒馆导航">
          <button
            type="button"
            aria-current={tab === 'tonight' ? 'page' : undefined}
            onClick={() => setTab('tonight')}
          >
            <Disc3 size={18} aria-hidden="true" />
            今晚
          </button>
          <button
            type="button"
            aria-current={tab === 'menu' ? 'page' : undefined}
            onClick={() => setTab('menu')}
          >
            <BookOpen size={18} aria-hidden="true" />
            翻酒单
          </button>
          <button
            type="button"
            aria-current={tab === 'coaster' ? 'page' : undefined}
            onClick={() => setTab('coaster')}
          >
            <CircleUserRound size={18} aria-hidden="true" />
            我的杯垫
          </button>
        </nav>
      </footer>
      <Dialog open={cartOpen} onOpenChange={setCartOpen}>
        <DialogContent className="ss-sheet">
          <DialogHeader title="今晚的单" description="先把想喝的记在这里。没有下单，也没有付款。" />
          {cart.length ? (
            <ul className="ss-cart-list">
              {cart.map((line) => {
                const drink = drinkById[line.id]
                if (!drink) return null
                return (
                  <li key={line.id}>
                    <div>
                      <strong>{drink.name}</strong>
                      <span>
                        ¥{drink.price} · {line.qty} 杯
                      </span>
                    </div>
                    <div className="ss-stepper">
                      <button
                        type="button"
                        aria-label={`减少${drink.name}数量`}
                        onClick={() => adjust(line.id, -1)}
                      >
                        <Minus size={14} />
                      </button>
                      <output aria-label={`${drink.name}数量`}>{line.qty}</output>
                      <button
                        type="button"
                        aria-label={`增加${drink.name}数量`}
                        disabled={line.qty >= 20}
                        onClick={() => adjust(line.id, 1)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <button
                      type="button"
                      className="ss-text-btn"
                      onClick={() => adjust(line.id, -line.qty)}
                    >
                      移除{drink.name}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p>今晚的单还空着。在酒单或纸条上加入，先记在这里。</p>
          )}
          <p className="ss-cart-total">
            合计 <strong>¥{total}</strong>
            <small>不是订单金额</small>
          </p>
          {cart.length > 0 && (
            <button
              type="button"
              className="ss-btn ss-btn-line"
              onClick={() => {
                setCart([])
                setNote('今晚的单已清空。没有产生订单。')
              }}
            >
              清空今晚的单
            </button>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={evidenceOpen} onOpenChange={setEvidenceOpen}>
        <DialogContent className="ss-sheet">
          <DialogHeader
            title="推荐依据"
            description="以下为虚构演示订单。仅已完成订单参与推测，杯垫和今晚的单都不计入。"
          />
          <ul className="ss-history">
            {orders.map((order) => (
              <li key={order.id}>
                <div>
                  <time>{order.completed_at.slice(0, 10)}</time>
                  <span>{orderStatus(order.status)}</span>
                </div>
                <p>{orderLine(order)}</p>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FilterBar({
  filters,
  onChange,
}: {
  filters: BarFilters
  onChange: (next: BarFilters) => void
}) {
  return (
    <div className="ss-filters">
      <FilterGroup
        label="甜度"
        value={filters.sweetness}
        options={sweetnessChoices}
        onChange={(sweetness) => onChange({ ...filters, sweetness })}
      />
      <FilterGroup
        label="风味"
        value={filters.flavor}
        options={flavorChoices}
        onChange={(flavor) => onChange({ ...filters, flavor })}
      />
      <FilterGroup
        label="酒精度"
        value={filters.alcohol}
        options={alcoholChoices}
        onChange={(alcohol) => onChange({ ...filters, alcohol })}
      />
      <p className="ss-filter-hint">{alcoholHint[filters.alcohol]}</p>
      <FilterGroup
        label="分类"
        value={filters.category}
        options={categoryChoices}
        onChange={(category) => onChange({ ...filters, category })}
      />
    </div>
  )
}

function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="ss-filter" role="radiogroup" aria-label={label}>
      <span>{label}</span>
      <div>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            className="ss-chip"
            aria-checked={value === option.value}
            aria-label={`${label} ${option.label}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function InfoPanel({
  drink,
  onAdd,
  onStamp,
}: {
  drink: BarDrink
  onAdd: () => void
  onStamp: () => void
}) {
  return (
    <section className="ss-info" aria-live="off">
      <span className="ss-tape" aria-hidden="true" />
      <p className="ss-info-kicker">
        {drink.kind === 'beer' ? 'CRAFT BEER' : 'SIGNATURE COCKTAIL'}
      </p>
      <h2 className="ss-serif">{drink.name}</h2>
      <p className="ss-english">{drink.english}</p>
      <p className="ss-taste">{drink.note}</p>
      <p className="ss-meta">
        <span>{drink.volumeMl} ml</span>
        <i aria-hidden="true" />
        <span>{formatAbv(drink.abv)} vol</span>
      </p>
      <p className="ss-ingredients">{drink.ingredients}</p>
      <div className="ss-info-row">
        <strong className="ss-price">
          <small>¥</small>
          {drink.price}
        </strong>
        <div className="ss-actions">
          <button
            type="button"
            className="ss-btn ss-btn-solid"
            aria-label={`把${drink.name}加入今晚的单`}
            onClick={onAdd}
          >
            加入今晚的单
          </button>
          <button type="button" className="ss-btn ss-btn-line" onClick={onStamp}>
            印上杯垫
          </button>
        </div>
      </div>
    </section>
  )
}

function MenuPanel({
  drinks,
  filters,
  onChange,
  onOpen,
  onAdd,
  onClear,
}: {
  drinks: BarDrink[]
  filters: BarFilters
  onChange: (next: BarFilters) => void
  onOpen: (id: string) => void
  onAdd: (id: string) => void
  onClear: () => void
}) {
  return (
    <section className="ss-menu" aria-label="酒单">
      <header className="ss-rec-head">
        <div>
          <p className="ss-info-kicker">The evening list</p>
          <h2 className="ss-serif">翻酒单</h2>
        </div>
        <span>{String(drinks.length).padStart(2, '0')} 款</span>
      </header>
      <FilterBar filters={filters} onChange={onChange} />
      {drinks.length ? (
        <ul className="ss-menu-list">
          {drinks.map((drink) => (
            <li key={drink.id}>
              <span className="ss-swatch" style={{ background: drink.liquid }} aria-hidden="true" />
              <button type="button" className="ss-menu-open" onClick={() => onOpen(drink.id)}>
                <strong className="ss-serif">{drink.name}</strong>
                <small>{drink.note}</small>
                <em>
                  {drink.volumeMl} ml · {formatAbv(drink.abv)} vol
                </em>
              </button>
              <span className="ss-menu-price">¥{drink.price}</span>
              <button
                type="button"
                className="ss-btn ss-btn-amber"
                aria-label={`从酒单把${drink.name}加入今晚的单`}
                onClick={() => onAdd(drink.id)}
              >
                加入
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ss-empty">
          <p>没有同时符合这些筛选的酒。</p>
          <button type="button" className="ss-btn ss-btn-line" onClick={onClear}>
            清空筛选
          </button>
        </div>
      )}
    </section>
  )
}

function CoasterPanel({
  stamps,
  onOpen,
  onRemove,
  onBrowse,
}: {
  stamps: CoasterStamp[]
  onOpen: (id: string) => void
  onRemove: (id: string) => void
  onBrowse: () => void
}) {
  return (
    <section className="ss-coasters" aria-label="我的杯垫">
      <header className="ss-rec-head">
        <div>
          <p className="ss-info-kicker">Your little coaster</p>
          <h2 className="ss-serif">我的杯垫</h2>
        </div>
      </header>
      <p className="ss-coaster-lead">
        杯垫记下想记住的那一杯和日期。它不是今晚的单，印上去也不会变成订单，更不会排成连续打卡。
      </p>
      {stamps.length ? (
        <ul className="ss-coaster-list">
          {stamps.map((stamp) => (
            <li key={stamp.id}>
              <div>
                <strong className="ss-serif">{stamp.name}</strong>
                <time dateTime={stamp.stampedAt}>{formatStampDate(stamp.stampedAt)}</time>
              </div>
              <button
                type="button"
                className="ss-btn ss-btn-line"
                onClick={() => onOpen(stamp.drinkId)}
              >
                在吧台看{stamp.name}
              </button>
              <button type="button" className="ss-text-btn" onClick={() => onRemove(stamp.id)}>
                从杯垫揭下{stamp.name}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ss-empty ss-empty-paper">
          <span className="ss-tape" aria-hidden="true" />
          <h3 className="ss-serif">杯垫还空着</h3>
          <p>在今晚选中一杯，再点「印上杯垫」。这里只留下纪念。</p>
          <button type="button" className="ss-btn ss-btn-solid" onClick={onBrowse}>
            回到今晚
          </button>
        </div>
      )}
    </section>
  )
}

function FlatStage({ drink }: { drink: BarDrink }) {
  return (
    <div
      className={`ss-flat is-${drink.glass}`}
      role="img"
      aria-label={`平面示意图，当前是${drink.name}`}
    >
      <div className="ss-flat-wall" />
      <div className="ss-flat-shelf" aria-hidden="true">
        {barDrinks.slice(0, 6).map((item, index) => (
          <i
            key={item.id}
            style={{
              left: `${8 + index * 14}%`,
              height: `${46 + (index % 3) * 16}px`,
              background: item.liquid,
            }}
          />
        ))}
      </div>
      <div className="ss-flat-record" aria-hidden="true" />
      <div className="ss-flat-bar" aria-hidden="true">
        <div className="ss-flat-note" />
        <div className="ss-flat-coaster" />
        <div className={`ss-flat-glass is-${drink.glass}`}>
          <span style={{ background: drink.liquid }} />
        </div>
      </div>
    </div>
  )
}
