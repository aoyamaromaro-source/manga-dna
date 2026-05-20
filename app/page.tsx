'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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
  rating: number // 1-5
  registeredAt: number
  latestVol: number | null
  releaseDate: string
  isFuture: boolean
  fetchedAt: number | null
  coverUrl: string
}

function toRow(m: Manga) {
  return {
    id: m.id,
    user_id: 'default',
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
  }
}

async function loadFromSupabase(): Promise<Manga[]> {
  const { data, error } = await supabase
    .from('mangas')
    .select('*')
    .eq('user_id', 'default')
    .order('registered_at', { ascending: false })
  if (error || !data) return []
  return data.map(fromRow)
}

async function upsertToSupabase(manga: Manga) {
  await supabase.from('mangas').upsert(toRow(manga))
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
  latestVol: number | null; releaseDate: string; isFuture: boolean; coverUrl: string
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
      }
    }
  } catch {}
  return { latestVol: null, releaseDate: '', isFuture: false, coverUrl: '' }
}

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

// ---- MangaCover component ----
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

// ---- StarRating component ----
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

// ---- Main App ----
export default function Home() {
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

  // Single book registration
  const [singleTitle, setSingleTitle] = useState('')
  const [singleVol, setSingleVol] = useState(1)
  const [singleMode, setSingleMode] = useState(false)
  const [singleRegistering, setSingleRegistering] = useState(false)

  useEffect(() => {
    loadFromSupabase().then(data => { setMangas(data); setLoading(false) })
  }, [])

  const handleParse = () => setParsed(parseMemo(memo))

  const handleRegister = async () => {
    if (parsed.length === 0) return
    setRegistering(true)
    setRegisterProgress(0)
    const existing = await loadFromSupabase()
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
      }
      newMangas.push(manga)
      await upsertToSupabase(manga)
      setRegisterProgress(Math.round(((i + 1) / parsed.length) * 50))
    }
    const needFetch = newMangas.filter(m => !m.fetchedAt)
    for (let i = 0; i < needFetch.length; i++) {
      const nm = needFetch[i]
      const info = await fetchLatestVol(nm.title)
      const updated = { ...nm, ...info, fetchedAt: Date.now() }
      await upsertToSupabase(updated)
      setMangas(prev => prev.map(m => m.id === nm.id ? updated : m))
      setRegisterProgress(50 + Math.round(((i + 1) / needFetch.length) * 50))
      await new Promise(r => setTimeout(r, 400))
    }
    const latest = await loadFromSupabase()
    setMangas(latest)
    setRegistering(false)
    setParsed([])
    setMemo('')
    setTab('home')
  }

  const handleSingleRegister = async () => {
    if (!singleTitle.trim()) return
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
      coverUrl: existing?.coverUrl ?? '',
    }
    await upsertToSupabase(manga)
    if (!manga.fetchedAt) {
      const info = await fetchLatestVol(manga.title)
      const updated = { ...manga, ...info, fetchedAt: Date.now() }
      await upsertToSupabase(updated)
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
    setSingleMode(false)
    setTab('home')
  }

  const refreshOne = useCallback(async (id: string) => {
    const manga = mangas.find(m => m.id === id)
    if (!manga) return
    setFetchingIds(prev => new Set(prev).add(id))
    const info = await fetchLatestVol(manga.title)
    const updated = { ...manga, ...info, fetchedAt: Date.now() }
    await upsertToSupabase(updated)
    setMangas(prev => prev.map(m => m.id === id ? updated : m))
    setFetchingIds(prev => { const s = new Set(prev); s.delete(id); return s })
  }, [mangas])

  const updateRating = async (id: string, rating: number) => {
    const manga = mangas.find(m => m.id === id)
    if (!manga) return
    const updated = { ...manga, rating }
    await upsertToSupabase(updated)
    setMangas(prev => prev.map(m => m.id === id ? updated : m))
  }

  const updateVol = async (id: string, delta: number) => {
    const manga = mangas.find(m => m.id === id)
    if (!manga) return
    const newVol = Math.max(0, (manga.currentVol || 0) + delta)
    const updated = { ...manga, currentVol: newVol }
    await upsertToSupabase(updated)
    setMangas(prev => prev.map(m => m.id === id ? updated : m))
  }

  const totalWorks = mangas.filter(m => m.status !== 'wishlist').length
  const totalVols = mangas.filter(m => m.status !== 'wishlist').reduce((s, m) => s + (m.currentVol || 0), 0)
  const unreadMangas = mangas.filter(m => m.latestVol && m.currentVol && m.latestVol > m.currentVol)
  const topRated = mangas.filter(m => m.rating === 5 && m.status !== 'wishlist')

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
          <nav style={{ display: 'flex', gap: 4 }}>
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
                            ? <span style={{ marginLeft: 8, fontSize: 11, background: '#fff3e0', color: '#e05c2a', borderRadius: 4, padding: '2px 6px' }}>{m.releaseDate?.replace('年', '/').replace('月', '/').replace('日', '')}</span>
                            : <span style={{ marginLeft: 8, fontSize: 11, background: '#e05c2a', color: '#fff', borderRadius: 4, padding: '2px 6px' }}>NEW</span>
                          }
                        </div>
                        <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>あなた：{m.currentVol}巻 → 最新：{m.latestVol}巻</div>
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 900, color: '#e05c2a', flexShrink: 0 }}>
                        {m.isFuture ? '予告' : `+${(m.latestVol || 0) - (m.currentVol || 0)}巻`}
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
              </div>
            )}
          </div>
        )}

        {/* ===== SHELF ===== */}
        {tab === 'shelf' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="タイトルで検索..." style={{ width: '100%', padding: '12px 16px', borderRadius: 24, border: '1px solid #e8e4df', background: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
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

            <div style={{ fontSize: 12, color: '#999' }}>{filteredMangas.length}作品</div>

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
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                          <StarRating rating={m.rating} onChange={(r) => updateRating(m.id, r)} />
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button onClick={() => updateVol(m.id, -1)} style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid #e8e4df', background: '#fff', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                            <span style={{ fontSize: 12, color: '#666', minWidth: 30, textAlign: 'center' }}>{m.currentVol || 0}巻</span>
                            <button onClick={() => updateVol(m.id, 1)} style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid #e8e4df', background: '#fff', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>＋</button>
                          </div>
                        </div>
                      )}
                    </div>
                    <button onClick={() => refreshOne(m.id)} disabled={isFetching} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #e8e4df', background: '#fff', cursor: isFetching ? 'default' : 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: isFetching ? 0.5 : 1 }}>
                      {isFetching ? '⏳' : '🔄'}
                    </button>
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
            {/* Toggle */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setSingleMode(false)} style={{ flex: 1, padding: '10px', borderRadius: 12, border: 'none', background: !singleMode ? '#1a1a1a' : '#f0f0f0', color: !singleMode ? '#fff' : '#666', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>一括登録</button>
              <button onClick={() => setSingleMode(true)} style={{ flex: 1, padding: '10px', borderRadius: 12, border: 'none', background: singleMode ? '#1a1a1a' : '#f0f0f0', color: singleMode ? '#fff' : '#666', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>1冊ずつ登録</button>
            </div>

            {!singleMode ? (
              <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>メモから一括登録</div>
                <div style={{ fontSize: 13, color: '#999', marginBottom: 14 }}>「・キングダム 76★」のような形式で貼り付けてください</div>
                <textarea value={memo} onChange={e => setMemo(e.target.value)} placeholder={`例：\n・キングダム 76★\n・ブルーロック 38\n・宇宙兄弟 45★`} rows={10} style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #e8e4df', fontSize: 14, lineHeight: 1.7, resize: 'vertical', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }} />
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
            ) : (
              <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>1冊ずつ登録</div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>タイトル</div>
                  <input value={singleTitle} onChange={e => setSingleTitle(e.target.value)} placeholder="例：キングダム" style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #e8e4df', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
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

                {/* Wishlist */}
                <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: 13, color: '#666', marginBottom: 10 }}>読みたいリストに追加する場合</div>
                  <button onClick={async () => {
                    if (!singleTitle.trim()) return
                    const id = `${Date.now()}_wish`
                    const manga: Manga = {
                      id, title: singleTitle.trim(), currentVol: null, maxVol: null,
                      isSeriesComplete: false, status: 'wishlist', isMidVolume: false,
                      star: false, rating: 0, registeredAt: Date.now(),
                      latestVol: null, releaseDate: '', isFuture: false, fetchedAt: null, coverUrl: '',
                    }
                    await upsertToSupabase(manga)
                    setMangas(prev => [manga, ...prev])
                    setSingleTitle('')
                    setTab('shelf')
                    setFilterStatus('wishlist')
                  }} disabled={!singleTitle.trim()} style={{ width: '100%', padding: '12px', borderRadius: 24, border: '1px solid #2d6a9f', background: '#fff', color: '#2d6a9f', fontSize: 14, fontWeight: 700, cursor: singleTitle.trim() ? 'pointer' : 'default', opacity: singleTitle.trim() ? 1 : 0.5 }}>
                    📌 読みたいリストに追加
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== RECOMMEND ===== */}
        {tab === 'recommend' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>⭐️ 友達におすすめできる漫画</div>
              <div style={{ fontSize: 13, color: '#999', marginBottom: 16 }}>評価5をつけた作品一覧</div>
              {topRated.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#999', padding: 24 }}>
                  まだ⭐️5の作品がありません。本棚で評価をつけてみてください！
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {topRated.map(m => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#f9f7f5', borderRadius: 10 }}>
                      <MangaCover manga={m} size={44} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{m.title}</div>
                        <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                          {m.currentVol}巻まで読了
                          {m.isSeriesComplete && ' · 完結'}
                        </div>
                      </div>
                      <StarRating rating={m.rating} />
                    </div>
                  ))}
                </div>
              )}
            </div>

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
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
