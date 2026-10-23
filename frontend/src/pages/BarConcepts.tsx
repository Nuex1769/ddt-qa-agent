import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  Beer,
  BookOpen,
  Check,
  CircleUserRound,
  Disc3,
  Martini,
  Minus,
  MessageCircle,
  Plus,
  Signal,
  Sparkles,
  Wifi,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog'
import { inferUsual, readMockOrders } from '@/lib/bar-history'
import './bar-concepts.css'

type Style = 'vinyl' | 'taproom' | 'quiet'
type Drink = {
  id: string
  name: string
  english: string
  kind: 'cocktail' | 'beer'
  price: number
  abv: string
  note: string
  ingredients: string
  photo: string
}
const photos = '/bar-concepts/'
const drinks: Drink[] = [
  {
    id: 'lime',
    name: '青柠晚风',
    english: 'LIME & A LITTLE LIGHT',
    kind: 'cocktail',
    price: 38,
    abv: '0.0%',
    note: '微甜 · 柑橘 · 气泡',
    ingredients: '青柠、薄荷、苏打水、少量糖浆',
    photo: 'cocktails.jpg',
  },
  {
    id: 'wheat',
    name: '柚见小麦',
    english: 'YUZU WHEAT ALE',
    kind: 'beer',
    price: 42,
    abv: '4.5%',
    note: '柚子香 · 轻酒体 · 低苦度',
    ingredients: '水、小麦芽、大麦芽、啤酒花、柚子；含麸质',
    photo: 'craft-beer.jpg',
  },
  {
    id: 'old',
    name: '橙色旧时光',
    english: 'A SLOW OLD FASHIONED',
    kind: 'cocktail',
    price: 58,
    abv: '22%',
    note: '橙皮 · 木质 · 醇厚',
    ingredients: '波本威士忌、方糖、苦精、橙皮',
    photo: 'cocktail-bar.jpg',
  },
]
const directions: { id: Style; index: string; title: string; description: string }[] = [
  {
    id: 'vinyl',
    index: '01',
    title: '深夜唱片酒馆',
    description: '墨绿 × 琥珀橙 / 唱片、暖光、纸质酒单',
  },
  {
    id: 'taproom',
    index: '02',
    title: '复古美式精酿吧',
    description: '砖红 × 奶油黄 / 酒头编号、票据、粗体海报',
  },
  {
    id: 'quiet',
    index: '03',
    title: '日式隐秘小酒馆',
    description: '米白 × 炭黑 / 细线、留白、安静的对话',
  },
]

function Coaster({
  tray,
  note,
  experience,
  change,
  remove,
  clear,
  browse,
}: {
  tray: string[]
  note: string
  experience: boolean
  change: (id: string, delta: number) => void
  remove: (id: string) => void
  clear: () => void
  browse: () => void
}) {
  const picked = drinks.filter((d) => tray.includes(d.id))
  const total = tray.reduce((sum, id) => sum + (drinks.find((d) => d.id === id)?.price || 0), 0)
  return (
    <>
      <div className="bc-coaster-brand">
        <Disc3 size={24} strokeWidth={1.2} />
        <span>
          慢半拍<small>SLOW SIDE · BAR</small>
        </span>
      </div>
      <div className="bc-coaster-scroll">
        <header className="bc-coaster-heading">
          <small>YOUR LITTLE COASTER</small>
          <DialogHeader title="我的杯垫" description="今晚的酒，先放这里。" />
          <p>把喜欢的先留下，今晚慢慢选。</p>
        </header>
        <section className="bc-coaster-ticket" aria-label="杯垫酒款">
          <div className="bc-coaster-tape" aria-hidden="true" />
          <div className="bc-coaster-ticket-head">
            <span>ON YOUR COASTER</span>
            <span>{String(tray.length).padStart(2, '0')} 杯</span>
          </div>
          {picked.length ? (
            <>
              <div className="bc-coaster-items">
                {picked.map((drink) => {
                  const quantity = tray.filter((id) => id === drink.id).length
                  return (
                    <div
                      className="bc-coaster-item"
                      key={drink.id}
                      role="group"
                      aria-label={drink.name}
                    >
                      <img src={photos + drink.photo} alt={drink.name} />
                      <div className="bc-coaster-drink">
                        <small>{drink.kind === 'beer' ? 'CRAFT BEER' : 'SIGNATURE COCKTAIL'}</small>
                        <h3>
                          {drink.name} <small>× {quantity}</small>
                        </h3>
                        <p>{drink.note}</p>
                        <span>
                          {drink.abv} vol · ¥{drink.price} / 杯
                        </span>
                      </div>
                      <div className="bc-coaster-item-end">
                        <strong>
                          <small>¥</small>
                          {drink.price * quantity}
                        </strong>
                        <Button
                          variant="ghost"
                          aria-label={`移除${drink.name}`}
                          onClick={() => remove(drink.id)}
                        >
                          移除
                        </Button>
                      </div>
                      <div className="bc-coaster-stepper">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`减少${drink.name}数量`}
                          onClick={() => change(drink.id, -1)}
                        >
                          <Minus size={13} />
                        </Button>
                        <output aria-label={`${drink.name}数量`}>{quantity}</output>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`增加${drink.name}数量`}
                          disabled={quantity >= 20}
                          onClick={() => change(drink.id, 1)}
                        >
                          <Plus size={13} />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="bc-coaster-total">
                <div>
                  <span>今晚的小计</span>
                  <small>{tray.length} 杯 · 先选好，再慢慢聊</small>
                </div>
                <strong>
                  <small>¥</small>
                  {total}
                </strong>
              </div>
            </>
          ) : (
            <div className="bc-coaster-empty">
              <div className="bc-coaster-rings" aria-hidden="true">
                <Disc3 size={26} strokeWidth={1} />
              </div>
              <h3>杯垫还空着，今晚还长。</h3>
              <p>
                还没有选中的酒。在酒单上点一下「＋」，
                <br />
                先把喜欢的留下。
              </p>
              <Button variant="ghost" onClick={browse}>
                翻翻今晚的酒单 <ArrowUpRight size={14} />
              </Button>
            </div>
          )}
          <div className="bc-coaster-ticket-foot">
            <span>好酒不赶场，今晚慢慢来。</span>
            <span>TAKE IT SLOW.</span>
          </div>
        </section>
        {experience && tray.length > 0 && (
          <div className="bc-coaster-memory">
            <Disc3 size={22} strokeWidth={1.2} />
            <div>
              <h3>下次来，一句「老样子」。</h3>
              <p>阿麦会参考已完成订单，推测你常喝的那一杯。</p>
            </div>
          </div>
        )}
        <p className="bc-coaster-status" role="status" aria-label="杯垫操作状态">
          {note}
        </p>
      </div>
      <footer className="bc-coaster-footer">
        {tray.length > 0 ? (
          <>
            <Button className="bc-coaster-primary" onClick={browse}>
              继续选一杯
              <ArrowUpRight size={16} />
            </Button>
            <Button variant="ghost" className="bc-coaster-clear" onClick={clear}>
              清空本次选择
            </Button>
          </>
        ) : (
          <Button className="bc-coaster-primary" onClick={browse}>
            去选今晚的第一杯
            <ArrowUpRight size={16} />
          </Button>
        )}
        <small>{experience ? '演示选择保存在当前设备 · 暂不下单' : '风格预览 · 暂不下单'}</small>
      </footer>
    </>
  )
}

function readSelection(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value)
      ? value.filter((id): id is string => drinks.some((d) => d.id === id)).slice(0, 60)
      : []
  } catch {
    return []
  }
}

function Phone({ style, experience = false }: { style: Style; experience?: boolean }) {
  const [filter, setFilter] = useState('all')
  const [input, setInput] = useState('')
  const [question, setQuestion] = useState('想喝点清爽的，不要太甜。')
  const [answer, setAnswer] = useState('懂了。一杯青柠晚风，或者一杯柚见小麦，今晚慢慢选。')
  const [zero, setZero] = useState(false)
  const [selected, setSelected] = useState<Drink | null>(null)
  const [tray, setTray] = useState<string[]>(() =>
    experience ? readSelection('slow-side-tray') : [],
  )
  const [orders] = useState(() => (experience ? readMockOrders() : []))
  const history = inferUsual(orders)
  const usual: string[] =
    history.status === 'ready' && history.drink_id && drinks.some((d) => d.id === history.drink_id)
      ? Array.from({ length: history.quantity || 1 }, () => history.drink_id!)
      : []
  const [historyOpen, setHistoryOpen] = useState(false)
  const [usualPreview, setUsualPreview] = useState(false)
  const [usualBlocked, setUsualBlocked] = useState(false)
  const [selectionNote, setSelectionNote] = useState('')
  const [trayOpen, setTrayOpen] = useState(false)
  useEffect(() => {
    if (!experience) return
    try {
      localStorage.setItem('slow-side-tray', JSON.stringify(tray))
    } catch {
      /* 浏览器禁用存储时，本次会话仍可选酒。 */
    }
  }, [experience, tray])
  const inputRef = useRef<HTMLInputElement>(null)
  const flowRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLElement>(null)
  const conversationRef = useRef<HTMLElement>(null)
  const usualMatches =
    !usualBlocked && usual.every((id) => !zero || drinks.find((d) => d.id === id)?.abv === '0.0%')
  const visible = drinks.filter(
    (d) =>
      (!zero || d.abv === '0.0%') &&
      (filter === 'all'
        ? usualPreview
          ? usualMatches && usual.includes(d.id)
          : d.id !== 'old'
        : d.kind === filter),
  )
  const talk = (message: string) => {
    if (!message.trim()) return
    const noAlcohol = /无酒精|开车|不喝酒/.test(message)
    const wantsUsual = experience && /老样子/.test(message)
    const beer = /精酿|啤酒/.test(message)
    const inferredDrink = drinks.find((d) => d.id === history.drink_id)
    const budget = message.match(/(\d+(?:\.\d+)?)\s*元/)
    const avoids = [...message.matchAll(/(?:不要|不加|忌口)\s*([^，。；、\s]+)/g)].map((m) => m[1])
    const incompatible =
      !!inferredDrink &&
      ((noAlcohol && inferredDrink.abv !== '0.0%') ||
        (beer && inferredDrink.kind !== 'beer') ||
        (/鸡尾酒/.test(message) && inferredDrink.kind !== 'cocktail') ||
        (budget && inferredDrink.price > Number(budget[1])) ||
        avoids.some((word) => inferredDrink.ingredients.includes(word)))
    setUsualBlocked(wantsUsual && incompatible)
    setUsualPreview(wantsUsual)
    setQuestion(message.trim())
    setZero(noAlcohol)
    setFilter(beer && !wantsUsual ? 'beer' : 'all')
    setAnswer(
      wantsUsual
        ? usual.length
          ? incompatible
            ? '从历史订单推测的老样子不符合本次口味或预算要求，今晚重新选一杯吧。'
            : `最近${history.order_count}笔已完成订单中点了${history.occurrences}次，通常${history.quantity}杯。我猜你想喝${drinks.find((d) => d.id === history.drink_id)?.name}，这次也来这杯吗？`
          : history.status === 'ambiguous'
            ? '你最近的口味比较分散，暂时不能确定老样子。今晚更想喝哪一杯？'
            : history.status === 'ready'
              ? '从历史订单推测的老样子已下架，今晚重新选一杯吧。'
              : '近期已完成订单还不足以判断老样子，今晚想喝什么口味？'
        : noAlcohol && beer
          ? '这份精酿酒单暂时没有 0.0% 的酒款。可以试试无酒精鸡尾酒。'
          : noAlcohol
            ? '今晚选 0.0%。青柠晚风，微甜、清爽，放心把节奏放慢。'
            : beer
              ? '来杯柚见小麦。柚子香、轻酒体、低苦度，清爽一点。'
              : '懂了。一杯青柠晚风，或者一杯柚见小麦，今晚慢慢选。',
    )
    setInput('')
    setTimeout(
      () => conversationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      30,
    )
  }
  const send = (event: FormEvent) => {
    event.preventDefault()
    talk(input)
  }
  const selectFilter = (value: string) => {
    setFilter(value)
    setZero(false)
    setUsualPreview(false)
  }
  const addToTray = (ids: string[]) => {
    const next = [...tray, ...ids]
    if (drinks.some((d) => next.filter((id) => id === d.id).length > 20)) {
      setSelectionNote('每款最多选择 20 杯。')
      return
    }
    setTray(next)
    setSelectionNote('已放上你的杯垫。')
  }
  const changeTray = (id: string, delta: number) => {
    if (delta > 0) {
      addToTray([id])
      return
    }
    const index = tray.indexOf(id)
    if (index < 0) return
    setTray(tray.filter((_, i) => i !== index))
    setSelectionNote('杯垫已更新。')
  }
  const focusChat = () => {
    inputRef.current?.focus()
    conversationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <article
      className={`bar-phone bar-${style}`}
      aria-label={directions.find((d) => d.id === style)?.title}
    >
      <div className="bc-status" aria-hidden="true">
        <b>21:08</b>
        <div>
          <Signal size={13} fill="currentColor" />
          <Wifi size={13} />
          <span className="bc-battery" />
        </div>
      </div>
      <header className="bc-header">
        <div className="bc-wordmark">
          {style === 'vinyl' ? (
            <Disc3 size={29} strokeWidth={1.2} />
          ) : style === 'taproom' ? (
            <Beer size={27} strokeWidth={1.8} />
          ) : (
            <span className="bc-seal">慢</span>
          )}
          <div>
            <strong>
              慢半拍<span>{style === 'taproom' ? '®' : ''}</span>
            </strong>
            <small>SLOW SIDE · BAR</small>
          </div>
        </div>
        <div className="bc-wx-capsule" aria-hidden="true">
          <span>•••</span>
          <i />
          <span>◉</span>
        </div>
      </header>
      <div className="bc-flow" ref={flowRef}>
        {style === 'vinyl' && (
          <>
            <div className="bc-onair">
              <span>
                <i /> THE NIGHT IS STILL YOUNG
              </span>
              <span>COCKTAILS & CRAFT</span>
            </div>
            <section className="bc-hero">
              <img src={photos + 'cocktail-bar.jpg'} alt="暖光下正在调制的橙皮鸡尾酒" />
              <div className="bc-hero-shade" />
              <div className="bc-hero-copy">
                <small>GOOD MUSIC. GOOD COMPANY.</small>
                <h1>
                  把今晚，
                  <br />
                  调成喜欢的样子。
                </h1>
                <p>
                  一杯鸡尾酒，或一口刚打的精酿。
                  <br />
                  你说心情，我们来选酒。
                </p>
              </div>
              <span className="bc-handwritten">take it slow ↗</span>
              <div className="bc-playing">
                <Disc3 size={14} />
                <span>NOW SPINNING</span>
                <b>Jazz after dark</b>
                <AudioLines size={17} />
              </div>
            </section>
          </>
        )}
        {style === 'taproom' && (
          <>
            <div className="bc-onair">
              <span>
                <i /> NOW POURING. ALWAYS GOOD.
              </span>
              <span>EST. 2026</span>
            </div>
            <section className="bc-hero">
              <div className="bc-hero-copy">
                <small>COME THIRSTY. STAY A WHILE.</small>
                <h1>
                  GOOD
                  <br />
                  NIGHTS.
                  <br />
                  <em>GREAT</em>
                  <br />
                  <em>PINTS.</em>
                </h1>
              </div>
              <img src={photos + 'craft-beer.jpg'} alt="带有绵密泡沫和冷凝水的金黄色精酿" />
              <span className="bc-tap-stamp">
                <small>8 TAPS</small>
                <b>鲜打上场</b>
                <small>ON ROTATION</small>
              </span>
              <span className="bc-hero-foot">鸡尾酒也拿手，精酿更来劲。 ↗</span>
            </section>
          </>
        )}
        {style === 'quiet' && (
          <>
            <div className="bc-onair">
              <span>COCKTAIL & CRAFT BEER</span>
              <span>一席 · 一杯 · 一会</span>
            </div>
            <section className="bc-hero">
              <div className="bc-hero-copy">
                <small>THE ART OF TAKING YOUR TIME</small>
                <h1>
                  留一点空白，
                  <br />
                  给今晚。
                </h1>
                <p>
                  不必想好喝什么。
                  <br />
                  坐下来，慢慢说。
                </p>
              </div>
              <img src={photos + 'cocktail-bar.jpg'} alt="木质吧台上的橙色鸡尾酒特写" />
              <span className="bc-vertical">今宵も、いい一杯を。</span>
              <span className="bc-quiet-number">壹 / 夜</span>
            </section>
          </>
        )}
        <section className="bc-conversation" ref={conversationRef}>
          <div className="bc-talk-heading">
            <span>
              {style === 'vinyl' ? (
                <Sparkles size={13} />
              ) : style === 'taproom' ? (
                <MessageCircle size={14} />
              ) : (
                <span className="bc-dot" />
              )}{' '}
              {style === 'taproom'
                ? 'ASK THE BARTENDER'
                : style === 'quiet'
                  ? '吧台的一点建议'
                  : 'A NOTE FROM YOUR BARTENDER'}
            </span>
            <span>{style === 'taproom' ? '吧台阿麦 ↗' : '为你选酒'}</span>
          </div>
          <div className="bc-guest-question">
            <span>你</span>
            <p>{question}</p>
          </div>
          <div className="bc-bartender-answer">
            <div className="bc-bartender-avatar">
              {style === 'quiet' ? '慢' : <Martini size={16} />}
            </div>
            <div>
              <small>{style === 'taproom' ? '阿麦 · 今晚我在吧台' : '阿麦 · 你的选酒搭子'}</small>
              <p>{answer}</p>
            </div>
          </div>
          <div className="bc-prompts">
            <Button variant="ghost" onClick={() => talk('微甜一点，无酒精。')}>
              微甜 · 无酒精 <ArrowUpRight size={11} />
            </Button>
            <Button variant="ghost" onClick={() => talk('来一杯清爽的精酿')}>
              来杯清爽精酿 <ArrowUpRight size={11} />
            </Button>
            {experience && (
              <Button variant="ghost" onClick={() => talk('老样子')}>
                老样子 <ArrowUpRight size={11} />
              </Button>
            )}
          </div>
        </section>
        <section className="bc-menu" ref={menuRef}>
          <div className="bc-menu-heading">
            <div>
              <small>
                {style === 'taproom'
                  ? 'THE LINEUP'
                  : style === 'quiet'
                    ? 'THE EVENING SELECTION'
                    : 'TONIGHT’S GOOD THINGS'}
              </small>
              <h2>
                {usualPreview ? '阿麦猜你想喝' : zero ? '今晚，零酒精也尽兴' : '今晚的心头好'}
                <span>{style === 'quiet' ? ' / 本日のおすすめ' : ''}</span>
              </h2>
            </div>
            <span className="bc-menu-counter">{String(visible.length).padStart(2, '0')} 款</span>
          </div>
          <div className="bc-filters" aria-label="酒单分类">
            <Button
              variant="ghost"
              aria-pressed={filter === 'all'}
              onClick={() => selectFilter('all')}
            >
              为你选的
            </Button>
            <Button
              variant="ghost"
              aria-pressed={filter === 'cocktail'}
              onClick={() => selectFilter('cocktail')}
            >
              <Martini size={12} />
              鸡尾酒
            </Button>
            <Button
              variant="ghost"
              aria-pressed={filter === 'beer'}
              onClick={() => selectFilter('beer')}
            >
              <Beer size={12} />
              精酿
            </Button>
          </div>
          {visible.length ? (
            <div className="bc-drink-list">
              {visible.map((drink, index) => (
                <div className="bc-drink" key={drink.id}>
                  <Button
                    variant="ghost"
                    className="bc-drink-open"
                    onClick={() => setSelected(drink)}
                    aria-label={`查看${drink.name}`}
                  >
                    <span className="bc-drink-photo">
                      <img src={photos + drink.photo} alt={drink.name} />
                      <span>{drink.kind === 'beer' ? 'TAP 02' : 'NO. 01'}</span>
                    </span>
                    <span className="bc-drink-info">
                      <small>
                        {style === 'taproom' ? `${String(index + 1).padStart(2, '0')} / ` : ''}
                        {drink.kind === 'beer' ? 'CRAFT BEER' : 'SIGNATURE COCKTAIL'}
                      </small>
                      <strong>{drink.name}</strong>
                      <span>{drink.note}</span>
                      <em>
                        {drink.kind === 'beer' ? '330 ml' : '180 ml'} <i>·</i> {drink.abv} vol
                      </em>
                    </span>
                  </Button>
                  <div className="bc-drink-action">
                    <strong>
                      <small>¥</small>
                      {drink.price}
                    </strong>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`把${drink.name}加入杯垫`}
                      onClick={() => addToTray([drink.id])}
                    >
                      {tray.includes(drink.id) ? <Check size={15} /> : <Plus size={16} />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="bc-no-results">这一类暂时没有符合要求的酒款，换个口味聊聊。</p>
          )}
          {usualPreview && usual.length > 0 && usualMatches && (
            <div className="bc-usual-confirm">
              <small>根据近期已完成订单推测 · 演示历史</small>
              <Button
                variant="ghost"
                className="bc-history-link"
                onClick={() => setHistoryOpen(true)}
              >
                查看推荐依据 ↗
              </Button>
              <p>
                {drinks
                  .filter((d) => usual.includes(d.id))
                  .map((d) => `${d.name} × ${usual.filter((id) => id === d.id).length}`)
                  .join(' · ')}
              </p>
              <Button
                onClick={() => {
                  addToTray(usual)
                  setUsualPreview(false)
                }}
              >
                确认老样子，加入杯垫
              </Button>
            </div>
          )}
          <p className="bc-selection-note" role="status">
            {selectionNote}
          </p>
          <div className="bc-menu-end">
            <span>好酒不赶场，今晚慢慢来。</span>
            <span>DRINK SLOW, FEEL MORE.</span>
          </div>
          {experience && <p className="bc-mock-note">风格体验 · 虚构酒单与订单 · 暂不下单</p>}
        </section>
      </div>
      <footer className="bc-footer">
        <form className="bc-composer" noValidate onSubmit={send}>
          <MessageCircle size={19} />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="告诉调酒师你的口味"
            placeholder={style === 'quiet' ? '说说，今晚想喝点什么…' : '把今晚的心情，交给调酒师…'}
          />
          <Button type="submit" size="icon" aria-label="发送口味需求">
            <ArrowUp size={18} />
          </Button>
        </form>
        <nav className="bc-bottomnav" aria-label="酒馆导航">
          <Button variant="ghost" className="active" onClick={focusChat}>
            {style === 'vinyl' ? <Disc3 size={18} /> : <MessageCircle size={18} />}
            <span>今晚</span>
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              selectFilter('cocktail')
              menuRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          >
            <BookOpen size={18} />
            <span>翻酒单</span>
          </Button>
          <Button
            variant="ghost"
            aria-label="我的杯垫"
            onClick={() => {
              setSelectionNote('')
              setTrayOpen(true)
            }}
          >
            <span className="bc-tray-icon">
              <CircleUserRound size={18} />
              {tray.length > 0 && <i>{tray.length}</i>}
            </span>
            <span>我的杯垫</span>
          </Button>
        </nav>
        <div className="bc-home-indicator" aria-hidden="true" />
      </footer>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <DialogContent className={experience ? 'bc-detail bc-selected-detail' : 'bc-detail'}>
          <DialogHeader
            title={selected?.name || '酒款'}
            description="主界面风格预览 · 虚构 mock 酒款"
          />
          {selected && (
            <>
              <img src={photos + selected.photo} alt={selected.name} />
              <p>
                {selected.note} · {selected.abv} vol
              </p>
              <p>{selected.ingredients}</p>
              <Button
                onClick={() => {
                  addToTray([selected.id])
                  setSelected(null)
                }}
              >
                加入我的杯垫 · ¥{selected.price}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={trayOpen} onOpenChange={setTrayOpen}>
        <DialogContent className={style === 'vinyl' ? 'bc-coaster' : 'bc-detail'}>
          {style === 'vinyl' ? (
            <Coaster
              tray={tray}
              note={selectionNote}
              experience={experience}
              change={changeTray}
              remove={(id) => {
                setTray(tray.filter((value) => value !== id))
                setSelectionNote('杯垫已更新。')
              }}
              clear={() => {
                setTray([])
                setSelectionNote('')
                setTrayOpen(false)
              }}
              browse={() => {
                setTrayOpen(false)
                selectFilter('cocktail')
                menuRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            />
          ) : (
            <>
              <DialogHeader
                title="我的杯垫"
                description={
                  experience
                    ? '演示选择保存在当前浏览器，不会下单。'
                    : '只在本次风格预览中保存，不会下单。'
                }
              />
              {tray.length ? (
                <>
                  {drinks
                    .filter((d) => tray.includes(d.id))
                    .map((d) => (
                      <p key={d.id}>
                        {d.name} × {tray.filter((id) => id === d.id).length}{' '}
                        <span>¥{d.price * tray.filter((id) => id === d.id).length}</span>
                      </p>
                    ))}
                  <p>
                    合计{' '}
                    <span>
                      ¥
                      {tray.reduce(
                        (sum, id) => sum + (drinks.find((d) => d.id === id)?.price || 0),
                        0,
                      )}
                    </span>
                  </p>
                  <p role="status">{selectionNote}</p>
                  <Button
                    onClick={() => {
                      setTray([])
                      setTrayOpen(false)
                    }}
                  >
                    清空本次选择
                  </Button>
                </>
              ) : (
                <p>还没有选中的酒。在酒单上点一下「＋」，先把喜欢的留下。</p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="bc-detail bc-selected-detail bc-order-history">
          <DialogHeader
            title="推荐依据"
            description="以下为虚构演示订单；仅已完成订单参与推测，杯垫选择不计入。"
          />
          {orders.map((order) => (
            <div className="bc-history-row" key={order.id}>
              <div>
                <time>{order.completed_at.slice(0, 10)}</time>
                <span>
                  {order.status === 'completed'
                    ? '已完成'
                    : order.status === 'cancelled'
                      ? '已取消 · 不计入'
                      : '已退款 · 不计入'}
                </span>
              </div>
              <p>
                {order.items
                  .map(
                    (i) =>
                      `${drinks.find((d) => d.id === i.drink_id)?.name || '已下架酒款'} × ${i.quantity}`,
                  )
                  .join('、')}
              </p>
            </div>
          ))}
        </DialogContent>
      </Dialog>
    </article>
  )
}

export function BarHome() {
  return (
    <main className="bar-concepts bc-single bc-experience">
      <Phone style="vinyl" experience />
    </main>
  )
}

export function BarConcepts() {
  const params = new URLSearchParams(window.location.search)
  const picked = params.get('style')
  const single = directions.find((d) => d.id === picked)
  if (single)
    return (
      <div className="bar-concepts bc-single">
        <Phone style={single.id} />
      </div>
    )
  return (
    <main className="bar-concepts bc-board">
      <header className="bc-board-heading">
        <div>
          <p>SLOW SIDE · CONCEPT STUDY 001</p>
          <h1>同一家酒馆，三种入夜方式。</h1>
          <span>鸡尾酒 × 精酿 · 对话选酒小程序主界面</span>
        </div>
        <div className="bc-board-note">
          同一份 mock 酒单 · 同一个推荐场景
          <br />
          临时品牌「慢半拍」 / 仅供视觉方向比较
        </div>
      </header>
      <div className="bc-directions">
        {directions.map((direction) => (
          <section className="bc-direction" key={direction.id}>
            <header>
              <span>{direction.index}</span>
              <div>
                <h2>{direction.title}</h2>
                <p>{direction.description}</p>
              </div>
              <a href={`?style=${direction.id}`} aria-label={`单独查看${direction.title}`}>
                <ArrowUpRight size={19} />
              </a>
            </header>
            <Phone style={direction.id} />
          </section>
        ))}
      </div>
    </main>
  )
}
