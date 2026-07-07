'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
)

// ---- Types ----
type Status = 'reading' | 'completed' | 'dropped' | 'wishlist'

interface Manga {
  id: string
  title: string
  currentVol: number | null
  maxVol: number | null
  isSeriesComplete: boolean
  status: Status
  isMidVolume: boolean
  star: boolean
  rating: number
  registeredAt: number
  latestVol: number | null
  releaseDate: string
  isFuture: boolean
  fetchedAt: number | null
  coverUrl: string
  affiliateUrl: string
  author: string
}

interface UserProfile {
  id: string
  email: string | undefined
}

interface RecommendBook {
  title: string
  author: string
  coverUrl: string
  buyUrl: string
}

interface RecommendGroup {
  sourceManga: string
  author: string
  books: RecommendBook[]
}

interface SuggestResult {
  title: string
  author: string
  coverUrl: string
  affiliateUrl: string
}

// ---- Supabase helpers ----
function toRow(m: Manga, userId: string) {
  return {
    id: m.id,
    user_id: userId,
    title: m.title,
    current_vol: m.currentVol,
    max_vol: m.maxVol,
    is_series_complete: m.isSeriesComplete,
    status: m.status,
    is_mid_volume: m.isMidVolume,
    star: m.star,
    rating: m.rating,
    registered_at: m.registeredAt,
    latest_vol: m.latestVol,
    release_date: m.releaseDate,
    is_future: m.isFuture,
    fetched_at: m.fetchedAt,
    cover_url: m.coverUrl,
    affiliate_url: m.affiliateUrl,
    author: m.author,
  }
}

function fromRow(row: any): Manga {
  return {
    id: row.id,
    title: row.title,
    currentVol: row.current_vol,
    maxVol: row.max_vol,
    isSeriesComplete: row.is_series_complete,
    status: row.status || 'reading',
    isMidVolume: row.is_mid_volume,
    star: row.star,
    rating: row.rating || 0,
    registeredAt: row.registered_at,
    latestVol: row.latest_vol,
    releaseDate: row.release_date || '',
    isFuture: row.is_future,
    fetchedAt: row.fetched_at,
    coverUrl: row.cover_url || '',
    affiliateUrl: row.affiliate_url || '',
    author: row.author || '',
  }
}

async function loadFromSupabase(userId: string): Promise<Manga[]> {
  const { data, error } = await supabase
    .from('mangas')
    .select('*')
    .eq('user_id', userId)
    .order('registered_at', { ascending: false })
  if (error || !data) return []
  return data.map(fromRow)
}

async function upsertToSupabase(manga: Manga, userId: string) {
  await supabase.from('mangas').upsert(toRow(manga, userId))
}

// ---- Parser ----
function parseMemoLine(line: string): Partial<Manga> | null {
  line = line.trim()
  if (!line) return null
  line = line.replace(/^[・\-\*\.\s]+/, '').trim()
  if (!line) return null

  const star = line.includes('★')
  line = line.replace(/★/g, '').trim()

  const isSeriesComplete =
    /完結|完了/.test(line) || /\s+完$/.test(line) || /(\d+)\s*完$/.test(line)
  line = line.replace(/完結|完了/g, '').replace(/\s*完$/g, '').trim()

  const isMidVolume = /途中/.test(line)
  line = line.replace(/途中/g, '').trim()

  let currentVol: number | null = null
  const volTalkMatch = line.match(/(\d+)\s*巻\s*(\d+)\s*話/)
  if (volTalkMatch) {
    currentVol = parseInt(volTalkMatch[1])
    line = line.replace(volTalkMatch[0], '').trim()
  } else {
    const talkMatch = line.match(/(\d+)\s*話/)
    if (talkMatch) line = line.replace(talkMatch[0], '').trim()
  }
  if (currentVol === null) {
    const volMatch = line.match(/(\d+)\s*$/)
    if (volMatch) {
      currentVol = parseInt(volMatch[1])
      line = line.replace(volMatch[0], '').trim()
    }
  }
  line = line.replace(/\d+\/\d+発売/, '').trim()
  const title = line.trim()
  if (!title) return null

  return {
    title,
    currentVol,
    maxVol: null,
    isSeriesComplete,
    status: isSeriesComplete ? 'completed' : 'reading',
    isMidVolume,
    star,
    rating: 0,
    coverUrl: '',
  }
}

function parseMemo(text: string): Partial<Manga>[] {
  return text.split('\n').map(parseMemoLine).filter((x): x is Partial<Manga> => x !== null && !!x.title)
}

async function fetchLatestVol(title: string): Promise<{
  latestVol: number | null
  releaseDate: string
  isFuture: boolean
  coverUrl: string
  author: string
  affiliateUrl: string
}> {
  try {
    const res = await fetch(`/api/rakuten?title=${encodeURIComponent(title)}`)
    const data = await res.json()
    if (data.found) {
      return {
        latestVol: data.latestVol,
        releaseDate: data.releaseDate || '',
        isFuture: data.isFuture || false,
        coverUrl: data.coverUrl || '',
        author: data.author || '',
        affiliateUrl: data.affiliateUrl || '',
      }
    }
  } catch {}
  return { latestVol: null, releaseDate: '', isFuture: false, coverUrl: '', author: '', affiliateUrl: '' }
}

// ---- Helpers ----
function stringToColor(str: string): string {
  const colors = ['#2d6a9f', '#4a9e6b', '#8b4a2d', '#6a4a9e', '#9e6a2d', '#2d8b6a', '#9e2d4a', '#4a6a9e', '#6a9e2d', '#9e4a6a']
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

function getMangaPersonality(mangas: Manga[]): { title: string; desc: string; tags: string[] } {
  const starCount = mangas.filter(m => m.star).length
  const completeCount = mangas.filter(m => m.isSeriesComplete).length
  const total = mangas.length
  if (starCount / total > 0.4) return {
    title: '熱中型・のめり込み人間',
    desc: '一度ハマったら止まらない。お気に入りへの執着が強く、作品との一体感を求める傾向がある。',
    tags: ['のめり込み型', '感情移入', '熱狂的', '長編派'],
  }
  if (completeCount / total > 0.6) return {
    title: '完走型・やり遂げる人間',
    desc: '始めたら最後まで読み切る完走派。完結作品への愛着が強く、継続力と忍耐力がある。',
    tags: ['完走型', '忍耐強い', '完結重視', 'コレクター'],
  }
  return {
    title: '戦略型・再起人間',
    desc: '長期戦を愛し、仲間との連帯を力に変える。挫折から立ち上がる主人公に自分を重ねる傾向が強い。',
    tags: ['成長系', 'チーム戦', '戦略思考', '長編派'],
  }
}

const RAKUTEN_AFFILIATE_ID = "54dd456c.699422ca.54dd456d.4bf7e5c6"

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const RECOMMEND_SHOWN_KEY = 'mangadna_recommend_shown'

function getShownRecommendTitles(userId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(`${RECOMMEND_SHOWN_KEY}_${userId}`)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

function addShownRecommendTitles(userId: string, titles: string[]) {
  if (typeof window === 'undefined') return
  try {
    const existing = getShownRecommendTitles(userId)
    titles.forEach(t => existing.add(t))
    localStorage.setItem(`${RECOMMEND_SHOWN_KEY}_${userId}`, JSON.stringify([...existing]))
  } catch {}
}

// 著者で検索してシリーズをユニーク化して返す（まだ提示していない作品を優先しつつランダムに選ぶ）
async function fetchAuthorRecommends(author: string, shelfTitles: string[], shownTitles: Set<string>): Promise<RecommendBook[]> {
  try {
    const res = await fetch(`/api/rakuten?mode=author&author=${encodeURIComponent(author)}`)
    const data = await res.json()
    if (!data.found || !data.books) return []

    const seen = new Set<string>()
    const candidates: RecommendBook[] = []

    for (const book of data.books) {
      // 巻数を除いたシリーズ名
      const baseTitle = book.title.replace(/\s*[\d０-９]+\s*$/, '').replace(/（.*?）/g, '').trim()
      if (!baseTitle) continue
      if (seen.has(baseTitle)) continue

      // すでに本棚にある作品はスキップ
      const isOnShelf = shelfTitles.some(t => {
        const base = t.replace(/\s*[\d０-９]+\s*$/, '').trim()
        return base === baseTitle || base.includes(baseTitle) || baseTitle.includes(base)
      })
      if (isOnShelf) continue

      seen.add(baseTitle)
      candidates.push({
        title: baseTitle,
        author: book.author,
        coverUrl: book.coverUrl,
        buyUrl: book.affiliateUrl || `https://search.books.rakuten.co.jp/booksearch/?keyword=${encodeURIComponent(baseTitle)}`,
      })
    }

    // まだ提示していない作品を優先し、足りない分は既出作品からランダムに補う
    const unseen = shuffleArray(candidates.filter(c => !shownTitles.has(c.title)))
    const alreadyShown = shuffleArray(candidates.filter(c => shownTitles.has(c.title)))
    return [...unseen, ...alreadyShown].slice(0, 5)
  } catch {
    return []
  }
}

// ---- Components ----
function MangaCover({ manga, size = 44 }: { manga: Manga; size?: number }) {
  const [imgError, setImgError] = useState(false)
  if (manga.coverUrl && !imgError) {
    return (
      <img
        src={manga.coverUrl}
        alt={manga.title}
        onError={() => setImgError(true)}
        style={{ width: size, height: size * 1.4, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size,
      borderRadius: 8, background: stringToColor(manga.title),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.22, color: '#fff', fontWeight: 700,
      textAlign: 'center', lineHeight: 1.3, flexShrink: 0,
    }}>
      {manga.title.slice(0, 4)}
    </div>
  )
}

function RecommendCover({ coverUrl, title, size = 44 }: { coverUrl: string; title: string; size?: number }) {
  const [imgError, setImgError] = useState(false)
  if (coverUrl && !imgError) {
    return (
      <img
        src={coverUrl}
        alt={title}
        onError={() => setImgError(true)}
        style={{ width: size, height: size * 1.4, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size,
      borderRadius: 8, background: stringToColor(title),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.22, color: '#fff', fontWeight: 700,
      textAlign: 'center', lineHeight: 1.3, flexShrink: 0,
    }}>
      {title.slice(0, 4)}
    </div>
  )
}

function StarRating({ rating, onChange }: { rating: number; onChange?: (r: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <span
          key={i}
          onClick={onChange ? (e) => { e.stopPropagation(); onChange(i) } : undefined}
          style={{
            fontSize: 16,
            cursor: onChange ? 'pointer' : 'default',
            color: i <= rating ? '#e05c2a' : '#ddd',
            lineHeight: 1,
          }}
        >★</span>
      ))}
    </div>
  )
}

function RakutenBuyButton({ title, affiliateUrl, size = 'normal' }: { title: string; affiliateUrl?: string; size?: 'normal' | 'small' }) {
  const targetUrl = affiliateUrl || `https://search.books.rakuten.co.jp/booksearch/?keyword=${encodeURIComponent(title)}`
  const url = `https://hb.afl.rakuten.co.jp/ichiba/${RAKUTEN_AFFILIATE_ID}/?pc=${encodeURIComponent(targetUrl)}`
  if (size === 'small') {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          padding: '3px 8px', borderRadius: 10,
          background: '#bf0000', color: '#fff',
          fontSize: 10, fontWeight: 700, textDecoration: 'none',
          flexShrink: 0, whiteSpace: 'nowrap',
        }}
      >
        楽天
      </a>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '6px 14px', borderRadius: 20,
        background: '#bf0000', color: '#fff',
        fontSize: 12, fontWeight: 700, textDecoration: 'none',
        flexShrink: 0,
      }}
    >
      楽天で買う
    </a>
  )
}

// ---- EditMangaModal ----
function EditMangaModal({ manga, onSave, onClose, onDelete }: {
  manga: Manga
  onSave: (updated: Manga) => void
  onClose: () => void
  onDelete: (id: string) => void
}) {
  const [title, setTitle] = useState(manga.title)
  const [currentVol, setCurrentVol] = useState(manga.currentVol ?? 0)
  const [status, setStatus] = useState<Status>(manga.status)
  const [isSeriesComplete, setIsSeriesComplete] = useState(manga.isSeriesComplete)
  const [star, setStar] = useState(manga.star)
  const [author, setAuthor] = useState(manga.author)
  const [coverUrl, setCoverUrl] = useState(manga.coverUrl)
  const [affiliateUrl, setAffiliateUrl] = useState(manga.affiliateUrl)
  const [candidates, setCandidates] = useState<SuggestResult[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleTitleChange = (value: string) => {
    setTitle(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (value.length < 3) { setCandidates([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/rakuten?mode=suggest&title=${encodeURIComponent(value)}`)
        const data = await res.json()
        setCandidates(data.suggestions || [])
      } catch { setCandidates([]) }
      setSearching(false)
    }, 500)
  }

  const selectCandidate = (c: SuggestResult) => {
    setTitle(c.title)
    setAuthor(c.author)
    setCoverUrl(c.coverUrl)
    setAffiliateUrl(c.affiliateUrl)
    setCandidates([])
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 10,
    border: '1px solid #e8e4df', fontSize: 14, outline: 'none',
    boxSizing: 'border-box' as const, color: '#1a1a1a', background: '#fff',
  }
  const statusOptions: [Status, string][] = [
    ['reading', '読書中'], ['completed', '読了'], ['dropped', '積読'], ['wishlist', '読みたい'],
  ]

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', width: '100%', maxWidth: 640, borderRadius: '20px 20px 0 0', padding: '24px 20px 48px', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>漫画を編集</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#999', lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: '#666', fontWeight: 600, marginBottom: 6 }}>タイトル</div>
            <div style={{ position: 'relative' }}>
              <input
                value={title}
                onChange={e => handleTitleChange(e.target.value)}
                onBlur={() => setTimeout(() => setCandidates([]), 150)}
                style={inputStyle}
              />
              {searching && (
                <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#aaa', pointerEvents: 'none' }}>検索中...</div>
              )}
              {candidates.length > 0 && (
                <div style={{ position: 'absolute', zIndex: 200, width: '100%', background: '#fff', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.12)', border: '1px solid #e8e4df', overflow: 'hidden', top: 'calc(100% + 4px)', left: 0 }}>
                  {candidates.map((c, i) => (
                    <div
                      key={i}
                      onMouseDown={() => selectCandidate(c)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', borderTop: i > 0 ? '1px solid #f5f2ee' : 'none' }}
                    >
                      {c.coverUrl
                        ? <img src={c.coverUrl} alt={c.title} style={{ width: 34, height: 48, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                        : <div style={{ width: 34, height: 48, background: stringToColor(c.title), borderRadius: 4, flexShrink: 0 }} />
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                        <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{c.author}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', fontWeight: 600, marginBottom: 8 }}>読んだ巻数</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button onClick={() => setCurrentVol(v => Math.max(0, v - 1))} style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid #e8e4df', background: '#fff', cursor: 'pointer', fontSize: 20 }}>−</button>
              <span style={{ fontSize: 22, fontWeight: 900, minWidth: 60, textAlign: 'center' }}>{currentVol}巻</span>
              <button onClick={() => setCurrentVol(v => v + 1)} style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid #e8e4df', background: '#fff', cursor: 'pointer', fontSize: 20 }}>＋</button>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#666', fontWeight: 600, marginBottom: 8 }}>ステータス</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {statusOptions.map(([val, label]) => (
                <button key={val} onClick={() => setStatus(val)} style={{ padding: '8px 16px', borderRadius: 20, border: '1px solid', borderColor: status === val ? '#1a1a1a' : '#e8e4df', background: status === val ? '#1a1a1a' : '#fff', color: status === val ? '#fff' : '#666', fontSize: 13, cursor: 'pointer' }}>{label}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setIsSeriesComplete(v => !v)} style={{ flex: 1, padding: '10px', borderRadius: 12, border: '1px solid', borderColor: isSeriesComplete ? '#1a1a1a' : '#e8e4df', background: isSeriesComplete ? '#1a1a1a' : '#fff', color: isSeriesComplete ? '#fff' : '#666', fontSize: 13, cursor: 'pointer' }}>
              完結済み {isSeriesComplete ? '✓' : ''}
            </button>
            <button onClick={() => setStar(v => !v)} style={{ flex: 1, padding: '10px', borderRadius: 12, border: '1px solid', borderColor: star ? '#e05c2a' : '#e8e4df', background: star ? '#fff3ee' : '#fff', color: star ? '#e05c2a' : '#666', fontSize: 13, cursor: 'pointer', fontWeight: star ? 700 : 400 }}>
              ★ お気に入り {star ? '✓' : ''}
            </button>
          </div>
          <button onClick={() => onSave({ ...manga, title, currentVol, status, isSeriesComplete, star, author, coverUrl, affiliateUrl })} style={{ width: '100%', padding: '14px', borderRadius: 24, border: 'none', background: '#e05c2a', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginTop: 4 }}>
            保存する
          </button>
          <button
            onClick={() => {
              if (window.confirm(`「${manga.title}」を本棚から削除しますか？この操作は取り消せません。`)) {
                onDelete(manga.id)
              }
            }}
            style={{ width: '100%', padding: '12px', borderRadius: 24, border: '1px solid #e05c2a', background: '#fff', color: '#e05c2a', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
          >
            この漫画を削除
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- AuthScreen ----
type AuthMode = 'login' | 'signup' | 'forgot'

function AuthScreen({ onAuth }: { onAuth: (user: UserProfile) => void }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const inputStyle = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid #e8e4df',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box' as const,
    color: '#1a1a1a',
    background: '#fff',
    WebkitTextFillColor: '#1a1a1a',
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/`,
        })
        if (error) throw error
        setMessage('パスワードリセットメールを送信しました。メールをご確認ください。')
        setLoading(false)
        return
      }

      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (data.user && !data.session) {
          setMessage('確認メールを送信しました。メールをクリックしてアカウントを有効化してください。')
          setLoading(false)
          return
        }
        if (data.user) {
          onAuth({ id: data.user.id, email: data.user.email })
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        if (data.user) {
          onAuth({ id: data.user.id, email: data.user.email })
        }
      }
    } catch (err: any) {
      const msg = err.message || 'エラーが発生しました'
      if (msg.includes('Invalid login credentials')) setError('メールアドレスまたはパスワードが正しくありません')
      else if (msg.includes('Email not confirmed')) setError('メールアドレスが未確認です。確認メールをご確認ください。')
      else if (msg.includes('User already registered')) setError('このメールアドレスは既に登録されています')
      else if (msg.includes('Password should be at least')) setError('パスワードは6文字以上にしてください')
      else setError(msg)
    }
    setLoading(false)
  }

  const handleGoogle = async () => {
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) setError(error.message)
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f5f2ee',
      fontFamily: "'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif",
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px 16px',
    }}>
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <div style={{ fontWeight: 900, fontSize: 32, letterSpacing: '-1px', marginBottom: 8 }}>
          <span style={{ color: '#1a1a1a' }}>MANGA</span>
          <span style={{ color: '#e05c2a' }}>DNA</span>
        </div>
        <div style={{ fontSize: 13, color: '#999' }}>あなたの漫画遺伝子を記録する</div>
      </div>

      <div style={{
        width: '100%',
        maxWidth: 400,
        background: '#fff',
        borderRadius: 20,
        padding: '24px 20px',
        boxSizing: 'border-box',
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
      }}>
        {mode !== 'forgot' && (
          <div style={{ display: 'flex', background: '#f5f2ee', borderRadius: 12, padding: 4, marginBottom: 24 }}>
            {(['login', 'signup'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(''); setMessage('') }}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: 9,
                  border: 'none',
                  background: mode === m ? '#1a1a1a' : 'transparent',
                  color: mode === m ? '#fff' : '#666',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                {m === 'login' ? 'ログイン' : '新規登録'}
              </button>
            ))}
          </div>
        )}

        {mode === 'forgot' && (
          <div style={{ marginBottom: 20 }}>
            <button
              onClick={() => { setMode('login'); setError(''); setMessage('') }}
              style={{ background: 'none', border: 'none', color: '#999', fontSize: 13, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              ← ログインに戻る
            </button>
            <div style={{ fontWeight: 700, fontSize: 18, marginTop: 12 }}>パスワードをお忘れの方</div>
            <div style={{ fontSize: 13, color: '#999', marginTop: 4 }}>登録したメールアドレスにリセットリンクを送信します</div>
          </div>
        )}

        {mode !== 'forgot' && (
          <>
            <button
              onClick={handleGoogle}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 12,
                border: '1px solid #e8e4df',
                background: '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                color: '#1a1a1a',
                marginBottom: 16,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
                <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
                <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
                <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
              </svg>
              Googleでログイン
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: '#e8e4df' }} />
              <span style={{ fontSize: 12, color: '#bbb' }}>または</span>
              <div style={{ flex: 1, height: 1, background: '#e8e4df' }} />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6, fontWeight: 600 }}>メールアドレス</div>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="example@email.com"
              required
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = '#1a1a1a'}
              onBlur={e => e.target.style.borderColor = '#e8e4df'}
            />
          </div>

          {mode !== 'forgot' && (
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6, fontWeight: 600 }}>パスワード</div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? '6文字以上' : 'パスワード'}
                required
                minLength={6}
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = '#1a1a1a'}
                onBlur={e => e.target.style.borderColor = '#e8e4df'}
              />
            </div>
          )}

          {error && (
            <div style={{ background: '#fff3f0', border: '1px solid #ffd5cc', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#c0392b' }}>
              {error}
            </div>
          )}

          {message && (
            <div style={{ background: '#f0fff4', border: '1px solid #c3e6cb', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#2d7a4a' }}>
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '13px',
              borderRadius: 24,
              border: 'none',
              background: loading ? '#ccc' : '#1a1a1a',
              color: '#fff',
              fontSize: 15,
              fontWeight: 700,
              cursor: loading ? 'default' : 'pointer',
              marginTop: 4,
            }}
          >
            {loading ? '処理中...' : mode === 'login' ? 'ログイン' : mode === 'signup' ? 'アカウントを作成' : 'リセットメールを送信'}
          </button>
        </form>

        {mode === 'login' && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button
              onClick={() => { setMode('forgot'); setError(''); setMessage('') }}
              style={{ background: 'none', border: 'none', color: '#999', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}
            >
              パスワードを忘れた方はこちら
            </button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 24, fontSize: 12, color: '#bbb', textAlign: 'center', lineHeight: 1.8 }}>
        アカウントを作成することで、利用規約および<br />プライバシーポリシーに同意したものとみなされます
      </div>
    </div>
  )
}

// ---- ResetPasswordScreen ----
function ResetPasswordScreen({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const inputStyle = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid #e8e4df',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box' as const,
    color: '#1a1a1a',
    background: '#fff',
    WebkitTextFillColor: '#1a1a1a',
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setError('パスワードが一致しません'); return }
    if (password.length < 6) { setError('パスワードは6文字以上にしてください'); return }
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    setSuccess(true)
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname)
    }
    setTimeout(onComplete, 2000)
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f5f2ee',
      fontFamily: "'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif",
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px 16px',
    }}>
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <div style={{ fontWeight: 900, fontSize: 32, letterSpacing: '-1px', marginBottom: 8 }}>
          <span style={{ color: '#1a1a1a' }}>MANGA</span>
          <span style={{ color: '#e05c2a' }}>DNA</span>
        </div>
      </div>

      <div style={{
        width: '100%',
        maxWidth: 400,
        background: '#fff',
        borderRadius: 20,
        padding: '24px 20px',
        boxSizing: 'border-box',
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
      }}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>新しいパスワードを設定</div>
        <div style={{ fontSize: 13, color: '#999', marginBottom: 20 }}>6文字以上のパスワードを入力してください</div>

        {success ? (
          <div style={{
            background: '#f0fff4', border: '1px solid #c3e6cb',
            borderRadius: 10, padding: '16px', fontSize: 14, color: '#2d7a4a', textAlign: 'center',
          }}>
            パスワードを更新しました。<br />ホーム画面に移動します...
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6, fontWeight: 600 }}>新しいパスワード</div>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="6文字以上"
                required
                minLength={6}
                style={inputStyle}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6, fontWeight: 600 }}>パスワード（確認）</div>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="もう一度入力"
                required
                minLength={6}
                style={inputStyle}
              />
            </div>
            {error && (
              <div style={{ background: '#fff3f0', border: '1px solid #ffd5cc', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#c0392b' }}>
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '13px', borderRadius: 24, border: 'none',
                background: loading ? '#ccc' : '#1a1a1a', color: '#fff',
                fontSize: 15, fontWeight: 700, cursor: loading ? 'default' : 'pointer', marginTop: 4,
              }}
            >
              {loading ? '更新中...' : 'パスワードを更新する'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

// ---- Main App ----
export default function Home() {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [isRecoveryMode, setIsRecoveryMode] = useState(false)

  const [tab, setTab] = useState<'home' | 'shelf' | 'register' | 'recommend'>('home')
  const [mangas, setMangas] = useState<Manga[]>([])
  const [loading, setLoading] = useState(true)
  const [memo, setMemo] = useState('')
  const [parsed, setParsed] = useState<Partial<Manga>[]>([])
  const [registering, setRegistering] = useState(false)
  const [registerProgress, setRegisterProgress] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'unread' | 'star' | 'wishlist'>('all')
  const [sortBy, setSortBy] = useState<'registered' | 'title' | 'unread' | 'rating'>('registered')
  const [fetchingIds, setFetchingIds] = useState<Set<string>>(new Set())
  const [updatingAll, setUpdatingAll] = useState(false)
  const [editManga, setEditManga] = useState<Manga | null>(null)
  const [promptCopied, setPromptCopied] = useState(false)
  const [topRatedFilter, setTopRatedFilter] = useState<'five' | 'fourPlus'>('fourPlus')

  const [singleTitle, setSingleTitle] = useState('')
  const [singleVol, setSingleVol] = useState(1)
  const [registerMode, setRegisterMode] = useState<'bulk' | 'single' | 'search'>('bulk')
  const [singleRegistering, setSingleRegistering] = useState(false)

  // Recommend state
  const [recommendGroups, setRecommendGroups] = useState<RecommendGroup[]>([])
  const [loadingRecommend, setLoadingRecommend] = useState(false)
  const [recommendFetched, setRecommendFetched] = useState(false)
  const [recommendProgress, setRecommendProgress] = useState('')

  const [singleCandidates, setSingleCandidates] = useState<SuggestResult[]>([])
  const [singleSearching, setSingleSearching] = useState(false)
  const [singlePreFill, setSinglePreFill] = useState<SuggestResult | null>(null)
  const singleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [registerSearchQuery, setRegisterSearchQuery] = useState('')
  const [registerSearchResults, setRegisterSearchResults] = useState<Array<{ title: string; author: string; coverUrl: string; latestVol: number | null; affiliateUrl: string }>>([])
  const [registerSearching, setRegisterSearching] = useState(false)
  const [registerSearchDone, setRegisterSearchDone] = useState(false)
  const [selectedSearchManga, setSelectedSearchManga] = useState<{ title: string; author: string; coverUrl: string; latestVol: number | null; affiliateUrl: string } | null>(null)
  const [searchRegisterVol, setSearchRegisterVol] = useState(1)
  const [searchRegistering, setSearchRegistering] = useState(false)

  // ---- Auth state ----
  useEffect(() => {
    // URLハッシュにアクセストークンがあるか確認（メール確認・パスワードリセット後）
    const hasHashToken = typeof window !== 'undefined' &&
      window.location.hash.includes('access_token')

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        // ハッシュトークンがある場合は後続イベント（SIGNED_IN / PASSWORD_RECOVERY）を待つ
        if (!hasHashToken) {
          if (session?.user) setUser({ id: session.user.id, email: session.user.email })
          setAuthLoading(false)
        }
      } else if (event === 'PASSWORD_RECOVERY') {
        // パスワードリセットリンクからの遷移
        setIsRecoveryMode(true)
        if (session?.user) setUser({ id: session.user.id, email: session.user.email })
        setAuthLoading(false)
      } else if (event === 'SIGNED_IN') {
        // メール確認後・通常ログイン後
        setIsRecoveryMode(false)
        if (session?.user) setUser({ id: session.user.id, email: session.user.email })
        setAuthLoading(false)
        // URLハッシュをクリーンアップ
        if (typeof window !== 'undefined' && window.location.hash) {
          window.history.replaceState(null, '', window.location.pathname)
        }
      } else if (event === 'SIGNED_OUT') {
        setIsRecoveryMode(false)
        setUser(null)
        setMangas([])
        setAuthLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // ---- ユーザーが確定したらデータ読み込み ----
  useEffect(() => {
    if (!user) return
    setLoading(true)
    loadFromSupabase(user.id).then(data => {
      setMangas(data)
      setLoading(false)
    })
  }, [user])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setMangas([])
  }

  // useCallback は early return より前に宣言しなければならない（Rules of Hooks）
  const refreshOne = useCallback(async (id: string) => {
    if (!user) return
    const manga = mangas.find(m => m.id === id)
    if (!manga) return
    setFetchingIds(prev => new Set(prev).add(id))
    const info = await fetchLatestVol(manga.title)
    const updated = { ...manga, ...info, fetchedAt: Date.now() }
    await upsertToSupabase(updated, user.id)
    setMangas(prev => prev.map(m => m.id === id ? updated : m))
    setFetchingIds(prev => { const s = new Set(prev); s.delete(id); return s })
  }, [mangas, user])

  // ---- Auth loading ----
  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f2ee' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 900, fontSize: 28, letterSpacing: '-0.5px', marginBottom: 16 }}>
            <span style={{ color: '#1a1a1a' }}>MANGA</span><span style={{ color: '#e05c2a' }}>DNA</span>
          </div>
          <div style={{ color: '#999', fontSize: 14 }}>読み込み中...</div>
        </div>
      </div>
    )
  }

  // ---- Password recovery ----
  if (isRecoveryMode) {
    return <ResetPasswordScreen onComplete={() => setIsRecoveryMode(false)} />
  }

  // ---- Not authenticated ----
  if (!user) {
    return <AuthScreen onAuth={setUser} />
  }

  // ---- Manga data loading ----
  const handleParse = () => setParsed(parseMemo(memo))

  const handleRegister = async () => {
    if (parsed.length === 0 || !user) return
    setRegistering(true)
    setRegisterProgress(0)
    const existing = await loadFromSupabase(user.id)
    const newMangas: Manga[] = []
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i]
      const existingManga = existing.find(m => m.title === p.title)
      const id = existingManga?.id || `${Date.now()}_${i}`
      const manga: Manga = {
        id, title: p.title || '',
        currentVol: p.currentVol ?? null, maxVol: null,
        isSeriesComplete: p.isSeriesComplete || false,
        status: p.status || 'reading',
        isMidVolume: p.isMidVolume || false,
        star: p.star || false,
        rating: existingManga?.rating || 0,
        registeredAt: existingManga?.registeredAt || Date.now(),
        latestVol: existingManga?.latestVol ?? null,
        releaseDate: existingManga?.releaseDate ?? '',
        isFuture: existingManga?.isFuture ?? false,
        fetchedAt: existingManga?.fetchedAt ?? null,
        coverUrl: existingManga?.coverUrl ?? '',
        affiliateUrl: existingManga?.affiliateUrl ?? '',
        author: existingManga?.author ?? '',
      }
      newMangas.push(manga)
      await upsertToSupabase(manga, user.id)
      setRegisterProgress(Math.round(((i + 1) / parsed.length) * 50))
    }
    const needFetch = newMangas.filter(m => !m.fetchedAt)
    for (let i = 0; i < needFetch.length; i++) {
      const nm = needFetch[i]
      const info = await fetchLatestVol(nm.title)
      const updated = { ...nm, ...info, fetchedAt: Date.now() }
      await upsertToSupabase(updated, user.id)
      setMangas(prev => prev.map(m => m.id === nm.id ? updated : m))
      setRegisterProgress(50 + Math.round(((i + 1) / needFetch.length) * 50))
      await new Promise(r => setTimeout(r, 400))
    }
    const latest = await loadFromSupabase(user.id)
    setMangas(latest)
    setRegistering(false)
    setParsed([])
    setMemo('')
    setTab('home')
  }

  const handleSingleRegister = async () => {
    if (!singleTitle.trim() || !user) return
    setSingleRegistering(true)
    const existing = mangas.find(m => m.title === singleTitle.trim())
    const id = existing?.id || `${Date.now()}_single`
    const manga: Manga = {
      id, title: singleTitle.trim(),
      currentVol: singleVol, maxVol: null,
      isSeriesComplete: false, status: 'reading',
      isMidVolume: false, star: false, rating: 0,
      registeredAt: existing?.registeredAt || Date.now(),
      latestVol: existing?.latestVol ?? null,
      releaseDate: existing?.releaseDate ?? '',
      isFuture: existing?.isFuture ?? false,
      fetchedAt: existing?.fetchedAt ?? null,
      coverUrl: singlePreFill?.coverUrl || (existing?.coverUrl ?? ''),
      affiliateUrl: singlePreFill?.affiliateUrl || (existing?.affiliateUrl ?? ''),
      author: singlePreFill?.author || (existing?.author ?? ''),
    }
    await upsertToSupabase(manga, user.id)
    if (!manga.fetchedAt) {
      const info = await fetchLatestVol(manga.title)
      const updated = { ...manga, ...info, fetchedAt: Date.now() }
      await upsertToSupabase(updated, user.id)
      setMangas(prev => {
        const exists = prev.find(m => m.id === updated.id)
        if (exists) return prev.map(m => m.id === updated.id ? updated : m)
        return [updated, ...prev]
      })
    } else {
      setMangas(prev => {
        const exists = prev.find(m => m.id === manga.id)
        if (exists) return prev.map(m => m.id === manga.id ? manga : m)
        return [manga, ...prev]
      })
    }
    setSingleTitle('')
    setSingleVol(1)
    setSingleRegistering(false)
    setRegisterMode('bulk')
    setSinglePreFill(null)
    setSingleCandidates([])
    setTab('home')
  }

  const updateRating = async (id: string, rating: number) => {
    if (!user) return
    const manga = mangas.find(m => m.id === id)
    if (!manga) return
    const updated = { ...manga, rating }
    await upsertToSupabase(updated, user.id)
    setMangas(prev => prev.map(m => m.id === id ? updated : m))
  }

  const updateVol = async (id: string, delta: number) => {
    if (!user) return
    const manga = mangas.find(m => m.id === id)
    if (!manga) return
    const newVol = Math.max(0, (manga.currentVol || 0) + delta)
    const updated = { ...manga, currentVol: newVol }
    await upsertToSupabase(updated, user.id)
    setMangas(prev => prev.map(m => m.id === id ? updated : m))
  }

  const handleEditSave = async (updated: Manga) => {
    if (!user) return
    await upsertToSupabase(updated, user.id)
    setMangas(prev => prev.map(m => m.id === updated.id ? updated : m))
    setEditManga(null)
  }

  const handleDeleteManga = async (id: string) => {
    if (!user) return
    await supabase.from('mangas').delete().eq('id', id).eq('user_id', user.id)
    setMangas(prev => prev.filter(m => m.id !== id))
    setEditManga(null)
  }

  const handleRefreshAll = async () => {
    if (!user || updatingAll) return
    setUpdatingAll(true)
    const targets = mangas.filter(m => m.status !== 'wishlist')
    for (const manga of targets) {
      await refreshOne(manga.id)
      await new Promise(r => setTimeout(r, 400))
    }
    setUpdatingAll(false)
  }

  const handleFetchRecommendations = async () => {
    if (loadingRecommend || !user) return
    setLoadingRecommend(true)
    setRecommendGroups([])

    const shelfTitles = mangas.map(m => m.title)
    const topMangas = mangas
      .filter(m => m.rating >= 4 && m.status !== 'wishlist')
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3)

    if (topMangas.length === 0) {
      setLoadingRecommend(false)
      setRecommendFetched(true)
      return
    }

    const groups: RecommendGroup[] = []
    const seenAuthors = new Set<string>()
    const excludeTitles = getShownRecommendTitles(user.id)

    for (const manga of topMangas) {
      let author = manga.author
      if (!author) {
        setRecommendProgress(`「${manga.title}」の著者を検索中...`)
        const res = await fetch(`/api/rakuten?title=${encodeURIComponent(manga.title)}`)
        const data = await res.json()
        author = data.author || ''
        await new Promise(r => setTimeout(r, 400))
      }

      if (!author || seenAuthors.has(author)) continue
      seenAuthors.add(author)

      setRecommendProgress(`${author} の作品を検索中...`)
      await new Promise(r => setTimeout(r, 400))

      const books = await fetchAuthorRecommends(author, shelfTitles, excludeTitles)
      if (books.length > 0) {
        books.forEach(b => excludeTitles.add(b.title))
        groups.push({ sourceManga: manga.title, author, books })
      }
      await new Promise(r => setTimeout(r, 400))
    }

    if (groups.length > 0) {
      addShownRecommendTitles(user.id, groups.flatMap(g => g.books.map(b => b.title)))
    }

    setRecommendGroups(groups)
    setRecommendProgress('')
    setLoadingRecommend(false)
    setRecommendFetched(true)
  }

  const handleCopyPrompt = async () => {
    const shelf = mangas.filter(m => m.status !== 'wishlist')
    const lines = shelf.map(m => {
      const parts: string[] = []
      if (m.currentVol) parts.push(`${m.currentVol}巻`)
      if (m.rating) parts.push(`評価${m.rating}`)
      if (m.star) parts.push('お気に入り')
      if (m.isSeriesComplete) parts.push('完結')
      return `・${m.title}${parts.length ? `（${parts.join('・')}）` : ''}`
    })
    const completeCount = shelf.filter(m => m.isSeriesComplete).length
    const starCount = shelf.filter(m => m.star).length
    const rated = shelf.filter(m => m.rating > 0)
    const avg = rated.length ? (rated.reduce((s, m) => s + m.rating, 0) / rated.length).toFixed(1) : '0.0'
    const prompt = `以下は私が読んだ漫画リストです。この読書傾向からわかる私の漫画の好みや人格を分析してください。\n\n【登録漫画】\n${lines.join('\n')}\n\n完結済み作品数：${completeCount}作品\nお気に入り数：${starCount}作品\n平均評価：${avg}`
    await navigator.clipboard.writeText(prompt)
    setPromptCopied(true)
    setTimeout(() => setPromptCopied(false), 2000)
  }

  const handleSingleTitleChange = (value: string) => {
    setSingleTitle(value)
    setSinglePreFill(null)
    if (singleDebounceRef.current) clearTimeout(singleDebounceRef.current)
    if (value.length < 3) { setSingleCandidates([]); return }
    singleDebounceRef.current = setTimeout(async () => {
      setSingleSearching(true)
      try {
        const res = await fetch(`/api/rakuten?mode=suggest&title=${encodeURIComponent(value)}`)
        const data = await res.json()
        setSingleCandidates(data.suggestions || [])
      } catch { setSingleCandidates([]) }
      setSingleSearching(false)
    }, 500)
  }

  const selectSingleCandidate = (c: SuggestResult) => {
    setSingleTitle(c.title)
    setSinglePreFill(c)
    setSingleCandidates([])
    if (singleDebounceRef.current) clearTimeout(singleDebounceRef.current)
  }

  const handleRegisterSearch = async () => {
    if (!registerSearchQuery.trim()) return
    setRegisterSearching(true)
    setRegisterSearchDone(false)
    setRegisterSearchResults([])
    try {
      const res = await fetch(`/api/rakuten?mode=search&title=${encodeURIComponent(registerSearchQuery.trim())}`)
      const data = await res.json()
      setRegisterSearchResults(data.results || [])
      setRegisterSearchDone(true)
    } catch { setRegisterSearchResults([]); setRegisterSearchDone(true) }
    setRegisterSearching(false)
  }

  const handleSearchRegister = async () => {
    if (!selectedSearchManga || !user || searchRegistering) return
    setSearchRegistering(true)
    const id = `${Date.now()}_search`
    const manga: Manga = {
      id,
      title: selectedSearchManga.title,
      currentVol: searchRegisterVol,
      maxVol: null,
      isSeriesComplete: false,
      status: 'reading',
      isMidVolume: false,
      star: false,
      rating: 0,
      registeredAt: Date.now(),
      latestVol: selectedSearchManga.latestVol,
      releaseDate: '',
      isFuture: false,
      fetchedAt: Date.now(),
      coverUrl: selectedSearchManga.coverUrl,
      affiliateUrl: selectedSearchManga.affiliateUrl,
      author: selectedSearchManga.author,
    }
    await upsertToSupabase(manga, user.id)
    setMangas(prev => [manga, ...prev])
    setSelectedSearchManga(null)
    setSearchRegistering(false)
    setTab('home')
  }

  const totalWorks = mangas.filter(m => m.status !== 'wishlist').length
  const totalVols = mangas.filter(m => m.status !== 'wishlist').reduce((s, m) => s + (m.currentVol || 0), 0)
  const unreadMangas = mangas.filter(m => m.latestVol && m.currentVol && m.latestVol > m.currentVol)
  const topRated = mangas
    .filter(m => m.status !== 'wishlist')
    .filter(m => topRatedFilter === 'five' ? m.rating === 5 : m.rating >= 4)
    .sort((a, b) => b.rating - a.rating)

  const filteredMangas = mangas
    .filter(m => {
      if (searchQuery) return m.title.toLowerCase().includes(searchQuery.toLowerCase())
      return true
    })
    .filter(m => {
      if (filterStatus === 'unread') return m.latestVol && m.currentVol && m.latestVol > m.currentVol
      if (filterStatus === 'star') return m.star
      if (filterStatus === 'wishlist') return m.status === 'wishlist'
      return m.status !== 'wishlist'
    })
    .sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title, 'ja')
      if (sortBy === 'unread') return ((b.latestVol || 0) - (b.currentVol || 0)) - ((a.latestVol || 0) - (a.currentVol || 0))
      if (sortBy === 'rating') return b.rating - a.rating
      return b.registeredAt - a.registeredAt
    })

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f2ee' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📚</div>
        <div style={{ color: '#999', fontSize: 14 }}>読み込み中...</div>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f5f2ee', fontFamily: "'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif", color: '#1a1a1a' }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #e8e4df', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 }}>
          <div style={{ fontWeight: 900, fontSize: 20, letterSpacing: '-0.5px' }}>
            <span style={{ color: '#1a1a1a' }}>MANGA</span><span style={{ color: '#e05c2a' }}>DNA</span>
          </div>
          <nav style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {(['home', 'shelf', 'register', 'recommend'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '6px 10px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12,
                fontWeight: tab === t ? 700 : 400,
                background: tab === t ? '#1a1a1a' : 'transparent',
                color: tab === t ? '#fff' : '#666',
              }}>
                {t === 'home' ? 'ホーム' : t === 'shelf' ? '本棚' : t === 'register' ? '登録' : 'おすすめ'}
              </button>
            ))}
            <button
              onClick={handleSignOut}
              title={`${user.email} からログアウト`}
              style={{
                marginLeft: 4, width: 32, height: 32,
                borderRadius: '50%', border: '1px solid #e8e4df',
                background: '#f5f2ee', cursor: 'pointer', fontSize: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
            >
              👤
            </button>
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 80px' }}>

        {/* ===== HOME ===== */}
        {tab === 'home' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {[
                { label: '登録作品', value: totalWorks, accent: false },
                { label: '読了巻数', value: totalVols, accent: false },
                { label: '未読新刊', value: unreadMangas.length, accent: true },
              ].map(s => (
                <div key={s.label} style={{ background: '#fff', borderRadius: 12, padding: '16px 14px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                  <div style={{ fontSize: 32, fontWeight: 900, color: s.accent ? '#e05c2a' : '#1a1a1a', lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {unreadMangas.length > 0 && (
              <section>
                <div style={{ fontSize: 12, color: '#999', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>📦</span> 未読新刊 — 本屋モード
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {unreadMangas.map(m => (
                    <div key={m.id} style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                      <MangaCover manga={m} size={48} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>
                          {m.title}
                          {m.isFuture
                            ? <span style={{ marginLeft: 8, fontSize: 11, background: '#fff3e0', color: '#e05c2a', borderRadius: 4, padding: '2px 6px' }}>{m.releaseDate?.replace('年', '/').replace('月', '/').replace(/日.*/, '') + '発売予定'}</span>
                            : <span style={{ marginLeft: 8, fontSize: 11, background: '#e05c2a', color: '#fff', borderRadius: 4, padding: '2px 6px' }}>NEW</span>
                          }
                        </div>
                        <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>あなた：{m.currentVol}巻 → 最新：{m.latestVol}巻</div>
                        <div style={{ marginTop: 8 }}>
                          <RakutenBuyButton title={m.title} affiliateUrl={m.affiliateUrl} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                        <button onClick={() => setEditManga(m)} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid #e8e4df', background: '#fff', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✏️</button>
                        <div style={{ fontSize: 16, fontWeight: 900, color: '#e05c2a' }}>
                          {m.isFuture ? '予告' : `+${(m.latestVol || 0) - (m.currentVol || 0)}巻`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {mangas.length === 0 && (
              <div style={{ background: '#fff', borderRadius: 16, padding: 40, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📚</div>
                <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>まだ登録がありません</div>
                <button onClick={() => setTab('register')} style={{ background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 24, padding: '12px 28px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>登録する</button>
              </div>
            )}

            {mangas.length >= 5 && (
              <div style={{ background: '#1a1a1a', borderRadius: 16, padding: 24, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', right: -20, top: -20, width: 120, height: 120, borderRadius: '50%', background: '#4a1a0a', opacity: 0.6 }} />
                <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>あなたの漫画人格</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', marginBottom: 8 }}>{getMangaPersonality(mangas).title}</div>
                <div style={{ fontSize: 14, color: '#aaa', marginBottom: 16, lineHeight: 1.6 }}>{getMangaPersonality(mangas).desc}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {getMangaPersonality(mangas).tags.map(tag => (
                    <span key={tag} style={{ background: '#333', color: '#ccc', fontSize: 12, padding: '4px 10px', borderRadius: 20 }}>{tag}</span>
                  ))}
                </div>
                <button onClick={handleCopyPrompt} style={{ marginTop: 16, padding: '8px 18px', borderRadius: 20, border: '1px solid #555', background: 'transparent', color: promptCopied ? '#aaa' : '#ddd', fontSize: 12, cursor: 'pointer' }}>
                  {promptCopied ? 'コピーしました！' : '🤖 AIに詳しく聞く'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ===== SHELF ===== */}
        {tab === 'shelf' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="タイトルで検索..."
                style={{
                  width: '100%', padding: '12px 16px', borderRadius: 24,
                  border: '1px solid #e8e4df', background: '#fff', fontSize: 14, outline: 'none',
                  boxSizing: 'border-box', color: '#1a1a1a',
                }}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['all', 'unread', 'star', 'wishlist'] as const).map(f => (
                  <button key={f} onClick={() => setFilterStatus(f)} style={{
                    padding: '6px 12px', borderRadius: 20, border: '1px solid',
                    borderColor: filterStatus === f ? '#1a1a1a' : '#e8e4df',
                    background: filterStatus === f ? '#1a1a1a' : '#fff',
                    color: filterStatus === f ? '#fff' : '#666',
                    fontSize: 12, cursor: 'pointer',
                  }}>
                    {f === 'all' ? 'すべて' : f === 'unread' ? '未読あり' : f === 'star' ? '★お気に入り' : '読みたい'}
                  </button>
                ))}
                <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} style={{ padding: '6px 12px', borderRadius: 20, border: '1px solid #e8e4df', background: '#fff', fontSize: 12, color: '#666', cursor: 'pointer', outline: 'none', marginLeft: 'auto' }}>
                  <option value="registered">登録順</option>
                  <option value="title">タイトル順</option>
                  <option value="unread">未読差分順</option>
                  <option value="rating">評価順</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 12, color: '#999' }}>{filteredMangas.length}作品</div>
              <button
                onClick={handleRefreshAll}
                disabled={updatingAll}
                style={{
                  padding: '6px 14px', borderRadius: 20, border: '1px solid #e8e4df',
                  background: updatingAll ? '#f0f0f0' : '#fff', color: updatingAll ? '#999' : '#666',
                  fontSize: 12, cursor: updatingAll ? 'default' : 'pointer',
                }}
              >
                {updatingAll ? '更新中...' : '🔄 全て更新'}
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredMangas.map(m => {
                const isFetching = fetchingIds.has(m.id)
                return (
                  <div key={m.id} style={{ background: '#fff', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                    <MangaCover manga={m} size={44} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{m.title}</span>
                        {m.star && <span style={{ color: '#e05c2a', fontSize: 12 }}>★</span>}
                        {m.isSeriesComplete && <span style={{ fontSize: 10, background: '#f0f0f0', color: '#666', borderRadius: 4, padding: '1px 5px' }}>完結</span>}
                        {m.status === 'wishlist' && <span style={{ fontSize: 10, background: '#e3f0ff', color: '#2d6a9f', borderRadius: 4, padding: '1px 5px' }}>読みたい</span>}
                      </div>
                      <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                        {m.status !== 'wishlist' && (
                          <>
                            {m.currentVol ? `${m.currentVol}巻` : '巻数未登録'}
                            {m.isMidVolume && ' (途中)'}
                            {m.latestVol && m.latestVol > (m.currentVol || 0) && <span style={{ color: '#e05c2a', marginLeft: 6 }}>→ 最新{m.latestVol}巻</span>}
                          </>
                        )}
                      </div>
                      {m.status !== 'wishlist' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                          <StarRating rating={m.rating} onChange={(r) => updateRating(m.id, r)} />
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button onClick={() => updateVol(m.id, -1)} style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid #e8e4df', background: '#fff', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                            <span style={{ fontSize: 12, color: '#666', minWidth: 30, textAlign: 'center' }}>{m.currentVol || 0}巻</span>
                            <button onClick={() => updateVol(m.id, 1)} style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid #e8e4df', background: '#fff', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>＋</button>
                          </div>
                          <RakutenBuyButton title={m.title} affiliateUrl={m.affiliateUrl} size="small" />
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={() => setEditManga(m)} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #e8e4df', background: '#fff', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✏️</button>
                      <button onClick={() => refreshOne(m.id)} disabled={isFetching} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #e8e4df', background: '#fff', cursor: isFetching ? 'default' : 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: isFetching ? 0.5 : 1 }}>
                        {isFetching ? '⏳' : '🔄'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            {filteredMangas.length === 0 && <div style={{ textAlign: 'center', color: '#999', padding: 40 }}>該当する作品がありません</div>}
          </div>
        )}

        {/* ===== REGISTER ===== */}
        {tab === 'register' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setRegisterMode('bulk')} style={{ flex: 1, padding: '10px 4px', borderRadius: 12, border: 'none', background: registerMode === 'bulk' ? '#1a1a1a' : '#f0f0f0', color: registerMode === 'bulk' ? '#fff' : '#666', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>一括登録</button>
              <button onClick={() => setRegisterMode('single')} style={{ flex: 1, padding: '10px 4px', borderRadius: 12, border: 'none', background: registerMode === 'single' ? '#1a1a1a' : '#f0f0f0', color: registerMode === 'single' ? '#fff' : '#666', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>1冊ずつ</button>
              <button onClick={() => setRegisterMode('search')} style={{ flex: 1, padding: '10px 4px', borderRadius: 12, border: 'none', background: registerMode === 'search' ? '#1a1a1a' : '#f0f0f0', color: registerMode === 'search' ? '#fff' : '#666', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>検索して登録</button>
            </div>

            {registerMode === 'bulk' ? (
              <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>メモから一括登録</div>
                <div style={{ fontSize: 13, color: '#999', marginBottom: 14 }}>「・キングダム 76★」のような形式で貼り付けてください</div>
                <textarea
                  value={memo}
                  onChange={e => setMemo(e.target.value)}
                  placeholder={`例：\n・キングダム 76★\n・ブルーロック 38\n・宇宙兄弟 45★`}
                  rows={10}
                  style={{
                    width: '100%', padding: '12px 14px', borderRadius: 10,
                    border: '1px solid #e8e4df', fontSize: 14, lineHeight: 1.7,
                    resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                    fontFamily: 'monospace', color: '#1a1a1a', background: '#fff',
                  }}
                />
                <button onClick={handleParse} disabled={!memo.trim()} style={{ marginTop: 12, width: '100%', padding: '12px', borderRadius: 24, border: 'none', background: memo.trim() ? '#1a1a1a' : '#e0e0e0', color: memo.trim() ? '#fff' : '#999', fontSize: 14, fontWeight: 700, cursor: memo.trim() ? 'pointer' : 'default' }}>解析する</button>

                {parsed.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>{parsed.length}作品を認識しました</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                      {parsed.slice(0, 20).map((p, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#f9f7f5', borderRadius: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{p.star && '★ '}{p.title}</span>
                          <span style={{ fontSize: 12, color: '#999' }}>{p.currentVol ? `${p.currentVol}巻` : '巻数不明'}{p.isSeriesComplete && ' 完結'}</span>
                        </div>
                      ))}
                      {parsed.length > 20 && <div style={{ fontSize: 12, color: '#999', textAlign: 'center' }}>...他 {parsed.length - 20} 作品</div>}
                    </div>
                    {registering ? (
                      <div>
                        <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
                          <div style={{ height: '100%', width: `${registerProgress}%`, background: '#e05c2a', borderRadius: 3, transition: 'width 0.3s' }} />
                        </div>
                        <div style={{ fontSize: 13, color: '#999', textAlign: 'center' }}>{registerProgress < 50 ? '登録中...' : '最新刊情報を取得中...'} {registerProgress}%</div>
                      </div>
                    ) : (
                      <button onClick={handleRegister} style={{ width: '100%', padding: '14px', borderRadius: 24, border: 'none', background: '#e05c2a', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>本棚に登録して最新刊を取得する</button>
                    )}
                  </div>
                )}
              </div>
            ) : registerMode === 'single' ? (
              <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>1冊ずつ登録</div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>
                    タイトル <span style={{ fontSize: 11, color: '#aaa', fontWeight: 400 }}>（3文字以上で候補を表示）</span>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <input
                      value={singleTitle}
                      onChange={e => handleSingleTitleChange(e.target.value)}
                      onBlur={() => setTimeout(() => setSingleCandidates([]), 150)}
                      placeholder="例：キングダム"
                      style={{
                        width: '100%', padding: '12px 14px', borderRadius: 10,
                        border: '1px solid #e8e4df', fontSize: 14, outline: 'none',
                        boxSizing: 'border-box', color: '#1a1a1a', background: '#fff',
                      }}
                    />
                    {singleSearching && (
                      <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#aaa', pointerEvents: 'none' }}>検索中...</div>
                    )}
                    {singleCandidates.length > 0 && (
                      <div style={{ position: 'absolute', zIndex: 200, width: '100%', background: '#fff', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.12)', border: '1px solid #e8e4df', overflow: 'hidden', top: 'calc(100% + 4px)', left: 0 }}>
                        {singleCandidates.map((c, i) => (
                          <div
                            key={i}
                            onMouseDown={() => selectSingleCandidate(c)}
                            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', borderTop: i > 0 ? '1px solid #f5f2ee' : 'none' }}
                          >
                            {c.coverUrl
                              ? <img src={c.coverUrl} alt={c.title} style={{ width: 34, height: 48, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                              : <div style={{ width: 34, height: 48, background: stringToColor(c.title), borderRadius: 4, flexShrink: 0 }} />
                            }
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                              <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{c.author}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>読んだ巻数</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <button onClick={() => setSingleVol(v => Math.max(0, v - 1))} style={{ width: 44, height: 44, borderRadius: '50%', border: '1px solid #e8e4df', background: '#fff', cursor: 'pointer', fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                    <span style={{ fontSize: 28, fontWeight: 900, minWidth: 60, textAlign: 'center' }}>{singleVol}巻</span>
                    <button onClick={() => setSingleVol(v => v + 1)} style={{ width: 44, height: 44, borderRadius: '50%', border: '1px solid #e8e4df', background: '#fff', cursor: 'pointer', fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>＋</button>
                  </div>
                </div>
                <button onClick={handleSingleRegister} disabled={!singleTitle.trim() || singleRegistering} style={{ width: '100%', padding: '14px', borderRadius: 24, border: 'none', background: singleTitle.trim() ? '#e05c2a' : '#e0e0e0', color: singleTitle.trim() ? '#fff' : '#999', fontSize: 15, fontWeight: 700, cursor: singleTitle.trim() ? 'pointer' : 'default' }}>
                  {singleRegistering ? '登録中...' : '本棚に追加する'}
                </button>

                <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: 13, color: '#666', marginBottom: 10 }}>読みたいリストに追加する場合</div>
                  <button onClick={async () => {
                    if (!singleTitle.trim() || !user) return
                    const id = `${Date.now()}_wish`
                    const manga: Manga = {
                      id, title: singleTitle.trim(), currentVol: null, maxVol: null,
                      isSeriesComplete: false, status: 'wishlist', isMidVolume: false,
                      star: false, rating: 0, registeredAt: Date.now(),
                      latestVol: null, releaseDate: '', isFuture: false, fetchedAt: null, coverUrl: '',
                      affiliateUrl: '', author: '',
                    }
                    await upsertToSupabase(manga, user.id)
                    setMangas(prev => [manga, ...prev])
                    setSingleTitle('')
                    setTab('shelf')
                    setFilterStatus('wishlist')
                  }} disabled={!singleTitle.trim()} style={{ width: '100%', padding: '12px', borderRadius: 24, border: '1px solid #2d6a9f', background: '#fff', color: '#2d6a9f', fontSize: 14, fontWeight: 700, cursor: singleTitle.trim() ? 'pointer' : 'default', opacity: singleTitle.trim() ? 1 : 0.5 }}>
                    📌 読みたいリストに追加
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>漫画を検索して登録</div>
                <div style={{ fontSize: 13, color: '#999', marginBottom: 14 }}>タイトルで検索して本棚に追加できます</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <input
                    value={registerSearchQuery}
                    onChange={e => setRegisterSearchQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRegisterSearch() }}
                    placeholder="タイトルを入力..."
                    style={{ flex: 1, padding: '12px 14px', borderRadius: 10, border: '1px solid #e8e4df', fontSize: 14, outline: 'none', color: '#1a1a1a', background: '#fff', boxSizing: 'border-box' }}
                  />
                  <button
                    onClick={handleRegisterSearch}
                    disabled={!registerSearchQuery.trim() || registerSearching}
                    style={{ padding: '12px 16px', borderRadius: 10, border: 'none', background: registerSearchQuery.trim() ? '#1a1a1a' : '#e0e0e0', color: registerSearchQuery.trim() ? '#fff' : '#999', fontWeight: 700, cursor: registerSearchQuery.trim() ? 'pointer' : 'default', fontSize: 14, whiteSpace: 'nowrap' }}
                  >
                    {registerSearching ? '検索中' : '検索'}
                  </button>
                </div>

                {registerSearching && (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: '#999', fontSize: 13 }}>検索中...</div>
                )}

                {registerSearchDone && registerSearchResults.length === 0 && !registerSearching && (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: '#999', fontSize: 13 }}>
                    見つかりませんでした。別のキーワードで試してください
                  </div>
                )}

                {registerSearchResults.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {registerSearchResults.map((r, i) => (
                      <div
                        key={i}
                        onClick={() => { setSelectedSearchManga(r); setSearchRegisterVol(r.latestVol || 1) }}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: '#f9f7f5', borderRadius: 12, cursor: 'pointer' }}
                      >
                        {r.coverUrl
                          ? <img src={r.coverUrl} alt={r.title} style={{ width: 46, height: 66, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                          : <div style={{ width: 46, height: 66, background: stringToColor(r.title), borderRadius: 6, flexShrink: 0 }} />
                        }
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                          <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{r.author}</div>
                          {r.latestVol && <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>既刊 {r.latestVol}巻</div>}
                        </div>
                        <div style={{ fontSize: 20, color: '#ccc', flexShrink: 0 }}>›</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedSearchManga && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: 24, width: '100%', maxWidth: 640, boxSizing: 'border-box' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                    {selectedSearchManga.coverUrl
                      ? <img src={selectedSearchManga.coverUrl} alt={selectedSearchManga.title} style={{ width: 48, height: 68, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                      : <div style={{ width: 48, height: 68, background: stringToColor(selectedSearchManga.title), borderRadius: 6, flexShrink: 0 }} />
                    }
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedSearchManga.title}</div>
                      <div style={{ fontSize: 13, color: '#999' }}>{selectedSearchManga.author}</div>
                    </div>
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 13, color: '#666', marginBottom: 10 }}>読んだ巻数</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <button onClick={() => setSearchRegisterVol(v => Math.max(0, v - 1))} style={{ width: 44, height: 44, borderRadius: '50%', border: '1px solid #e8e4df', background: '#fff', cursor: 'pointer', fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                      <span style={{ fontSize: 28, fontWeight: 900, minWidth: 60, textAlign: 'center' }}>{searchRegisterVol}巻</span>
                      <button onClick={() => setSearchRegisterVol(v => v + 1)} style={{ width: 44, height: 44, borderRadius: '50%', border: '1px solid #e8e4df', background: '#fff', cursor: 'pointer', fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>＋</button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setSelectedSearchManga(null)} style={{ flex: 1, padding: '12px', borderRadius: 24, border: '1px solid #e8e4df', background: '#fff', color: '#666', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>キャンセル</button>
                    <button onClick={handleSearchRegister} disabled={searchRegistering} style={{ flex: 2, padding: '12px', borderRadius: 24, border: 'none', background: '#e05c2a', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                      {searchRegistering ? '登録中...' : '本棚に追加する'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== RECOMMEND ===== */}
        {tab === 'recommend' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* AI推薦セクション */}
            <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>あなたへのおすすめ</div>
                {recommendFetched && !loadingRecommend && (
                  <button
                    onClick={() => { setRecommendFetched(false); handleFetchRecommendations() }}
                    style={{ background: 'none', border: '1px solid #e8e4df', borderRadius: 20, padding: '4px 12px', fontSize: 12, color: '#666', cursor: 'pointer' }}
                  >
                    更新
                  </button>
                )}
              </div>
              <div style={{ fontSize: 13, color: '#999', marginBottom: 16 }}>高評価作品の著者から、まだ読んでいない作品をご提案</div>

              {!recommendFetched && !loadingRecommend && (
                <div style={{ textAlign: 'center' }}>
                  {mangas.filter(m => m.rating >= 4).length === 0 ? (
                    <div style={{ color: '#999', fontSize: 13, padding: '16px 0' }}>
                      本棚で4〜5の評価をつけると、おすすめが表示されます
                    </div>
                  ) : (
                    <button
                      onClick={handleFetchRecommendations}
                      style={{
                        background: '#1a1a1a', color: '#fff', border: 'none',
                        borderRadius: 24, padding: '12px 28px',
                        fontSize: 14, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      おすすめを探す
                    </button>
                  )}
                </div>
              )}

              {loadingRecommend && (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ fontSize: 24, marginBottom: 12 }}>🔍</div>
                  <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>楽天ブックスで検索中...</div>
                  {recommendProgress && (
                    <div style={{ fontSize: 12, color: '#999' }}>{recommendProgress}</div>
                  )}
                </div>
              )}

              {recommendFetched && !loadingRecommend && recommendGroups.length === 0 && (
                <div style={{ textAlign: 'center', color: '#999', fontSize: 13, padding: '16px 0' }}>
                  おすすめ作品が見つかりませんでした。評価をもっとつけてみてください！
                </div>
              )}

              {recommendGroups.map((group, gi) => (
                <div key={gi} style={{ marginBottom: gi < recommendGroups.length - 1 ? 24 : 0 }}>
                  <div style={{
                    fontSize: 11, color: '#e05c2a', fontWeight: 700,
                    marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span style={{ background: '#fff3ee', borderRadius: 4, padding: '2px 6px' }}>
                      「{group.sourceManga}」と同じ著者 / {group.author}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {group.books.map((book, bi) => (
                      <div key={bi} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#f9f7f5', borderRadius: 10 }}>
                        <RecommendCover coverUrl={book.coverUrl} title={book.title} size={44} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{book.title}</div>
                          <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{book.author}</div>
                        </div>
                        <RakutenBuyButton title={book.title} affiliateUrl={book.buyUrl} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* 高評価作品 */}
            <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>友達におすすめできる漫画</div>
              <div style={{ fontSize: 13, color: '#999', marginBottom: 12 }}>高評価をつけた作品一覧</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {([['fourPlus', '⭐️4以上'], ['five', '⭐️5のみ']] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setTopRatedFilter(val)}
                    style={{
                      padding: '6px 14px', borderRadius: 20, border: '1px solid',
                      borderColor: topRatedFilter === val ? '#1a1a1a' : '#e8e4df',
                      background: topRatedFilter === val ? '#1a1a1a' : '#fff',
                      color: topRatedFilter === val ? '#fff' : '#666',
                      fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {topRated.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#999', padding: 24 }}>
                  {topRatedFilter === 'five' ? 'まだ⭐️5の作品がありません。' : 'まだ⭐️4以上の作品がありません。'}本棚で評価をつけてみてください！
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {topRated.map(m => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#f9f7f5', borderRadius: 10 }}>
                      <MangaCover manga={m} size={44} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{m.title}</div>
                        <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                          {m.currentVol}巻まで読了
                          {m.isSeriesComplete && ' · 完結'}
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <StarRating rating={m.rating} />
                        </div>
                      </div>
                      <RakutenBuyButton title={m.title} affiliateUrl={m.affiliateUrl} size="small" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 読みたいリスト */}
            {mangas.filter(m => m.status === 'wishlist').length > 0 && (
              <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>📌 読みたいリスト</div>
                <div style={{ fontSize: 13, color: '#999', marginBottom: 16 }}>次に読む候補</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {mangas.filter(m => m.status === 'wishlist').map(m => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#f0f7ff', borderRadius: 10 }}>
                      <div style={{ fontSize: 24 }}>📌</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{m.title}</div>
                      </div>
                      <RakutenBuyButton title={m.title} size="small" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
      {editManga && <EditMangaModal manga={editManga} onSave={handleEditSave} onClose={() => setEditManga(null)} onDelete={handleDeleteManga} />}
    </div>
  )
}
