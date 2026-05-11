'use client'

import { useState, useEffect, useCallback } from 'react'

// ---- Types ----
type Status = 'reading' | 'completed' | 'dropped' | 'paused'

interface Manga {
  id: string
  title: string
  currentVol: number | null
  maxVol: number | null
  isSeriesComplete: boolean
  status: Status
  isMidVolume: boolean
  star: boolean
  registeredAt: number
  latestVol: number | null
  releaseDate: string
  isFuture: boolean
  fetchedAt: number | null
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

  // Extract volume number
  let currentVol: number | null = null
  let maxVol: number | null = null

  // Pattern: "16巻 116話まで" or "174話"
  const volTalkMatch = line.match(/(\d+)\s*巻\s*(\d+)\s*話/)
  if (volTalkMatch) {
    currentVol = parseInt(volTalkMatch[1])
    line = line.replace(volTalkMatch[0], '').trim()
  } else {
    const talkMatch = line.match(/(\d+)\s*話/)
    if (talkMatch) {
      line = line.replace(talkMatch[0], '').trim()
    }
  }

  // Pattern: number at end
  if (currentVol === null) {
    const volMatch = line.match(/(\d+)\s*$/)
    if (volMatch) {
      currentVol = parseInt(volMatch[1])
      line = line.replace(volMatch[0], '').trim()
    }
  }

  // Handle date patterns like "7/23発売"
  line = line.replace(/\d+\/\d+発売/, '').trim()

  const title = line.trim()
  if (!title) return null

  let status: Status = 'reading'
  if (isSeriesComplete && currentVol !== null) status = 'completed'
  else if (isSeriesComplete) status = 'completed'

  return {
    title,
    currentVol,
    maxVol,
    isSeriesComplete,
    status,
    isMidVolume,
    star,
  }
}

function parseMemo(text: string): Partial<Manga>[] {
  return text
    .split('\n')
    .map(parseMemoLine)
    .filter((x): x is Partial<Manga> => x !== null && !!x.title)
}

// ---- Rakuten API fetch ----
async function fetchLatestVol(title: string): Promise<{
  latestVol: number | null
  releaseDate: string
  isFuture: boolean
}> {
  try {
    const res = await fetch(`/api/rakuten?title=${encodeURIComponent(title)}`)
    const data = await res.json()
    if (data.found) {
      return {
        latestVol: data.latestVol,
        releaseDate: data.releaseDate || '',
        isFuture: data.isFuture || false,
      }
    }
  } catch {}
  return { latestVol: null, releaseDate: '', isFuture: false }
}

// ---- Storage ----
const STORAGE_KEY = 'mangadna_v1'

function loadMangas(): Manga[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveMangas(mangas: Manga[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(mangas))
}

// ---- Main App ----
export default function Home() {
  const [tab, setTab] = useState<'home' | 'shelf' | 'register'>('home')
  const [mangas, setMangas] = useState<Manga[]>([])
  const [memo, setMemo] = useState('')
  const [parsed, setParsed] = useState<Partial<Manga>[]>([])
  const [registering, setRegistering] = useState(false)
  const [registerProgress, setRegisterProgress] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'unread' | 'star'>('all')
  const [sortBy, setSortBy] = useState<'registered' | 'title' | 'unread'>('registered')
  const [fetchingIds, setFetchingIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setMangas(loadMangas())
  }, [])

  const updateMangas = (next: Manga[]) => {
    setMangas(next)
    saveMangas(next)
  }

  const handleParse = () => {
    const result = parseMemo(memo)
    setParsed(result)
  }

  const handleRegister = async () => {
    if (parsed.length === 0) return
    setRegistering(true)
    setRegisterProgress(0)

    const newMangas: Manga[] = []
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i]
      const id = `${Date.now()}_${i}`
      const manga: Manga = {
        id,
        title: p.title || '',
        currentVol: p.currentVol ?? null,
        maxVol: p.maxVol ?? null,
        isSeriesComplete: p.isSeriesComplete || false,
        status: p.status || 'reading',
        isMidVolume: p.isMidVolume || false,
        star: p.star || false,
        registeredAt: Date.now(),
        latestVol: null,
        releaseDate: '',
        isFuture: false,
        fetchedAt: null,
      }
      newMangas.push(manga)
      setRegisterProgress(Math.round(((i + 1) / parsed.length) * 50))
    }

    const merged = [...loadMangas()]
    for (const nm of newMangas) {
      const exists = merged.findIndex(m => m.title === nm.title)
      if (exists >= 0) merged[exists] = { ...merged[exists], ...nm, id: merged[exists].id }
      else merged.push(nm)
    }
    updateMangas(merged)

    // Fetch latest vol info
    for (let i = 0; i < newMangas.length; i++) {
      const nm = newMangas[i]
      const info = await fetchLatestVol(nm.title)
      setMangas(prev => {
        const next = prev.map(m =>
          m.title === nm.title
            ? { ...m, ...info, fetchedAt: Date.now() }
            : m
        )
        saveMangas(next)
        return next
      })
      setRegisterProgress(50 + Math.round(((i + 1) / newMangas.length) * 50))
      await new Promise(r => setTimeout(r, 300))
    }

    setRegistering(false)
    setParsed([])
    setMemo('')
    setTab('home')
  }

  const refreshOne = useCallback(async (id: string) => {
    const manga = mangas.find(m => m.id === id)
    if (!manga) return
    setFetchingIds(prev => new Set(prev).add(id))
    const info = await fetchLatestVol(manga.title)
    setMangas(prev => {
      const next = prev.map(m => m.id === id ? { ...m, ...info, fetchedAt: Date.now() } : m)
      saveMangas(next)
      return next
    })
    setFetchingIds(prev => { const s = new Set(prev); s.delete(id); return s })
  }, [mangas])

  // Derived stats
  const totalWorks = mangas.length
  const totalVols = mangas.reduce((s, m) => s + (m.currentVol || 0), 0)
  const unreadMangas = mangas.filter(m => m.latestVol && m.currentVol && m.latestVol > m.currentVol)
  const upcomingMangas = mangas.filter(m => m.isFuture)

  // Filtered shelf
  const filteredMangas = mangas
    .filter(m => {
      if (searchQuery) {
        return m.title.toLowerCase().includes(searchQuery.toLowerCase())
      }
      return true
    })
    .filter(m => {
      if (filterStatus === 'unread') return m.latestVol && m.currentVol && m.latestVol > m.currentVol
      if (filterStatus === 'star') return m.star
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title, 'ja')
      if (sortBy === 'unread') {
        const da = (a.latestVol || 0) - (a.currentVol || 0)
        const db = (b.latestVol || 0) - (b.currentVol || 0)
        return db - da
      }
      return b.registeredAt - a.registeredAt
    })

  const genreKeywords: Record<string, string[]> = {
    'スポーツ': ['サッカー', 'バスケ', '野球', '陸上', 'スポーツ', 'キリング', 'ブルーロック', 'アオアシ', 'mix', 'カペタ', 'クロッカーズ'],
    'SF・冒険': ['宇宙', 'キングダム', 'ハンター', 'ストーン'],
    '日常・青春': ['3月', 'うさぎ', '銀の匙', 'チャンネル'],
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f5f2ee',
      fontFamily: "'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif",
      color: '#1a1a1a',
    }}>
      {/* Header */}
      <header style={{
        background: '#fff',
        borderBottom: '1px solid #e8e4df',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{
          maxWidth: 640,
          margin: '0 auto',
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 56,
        }}>
          <div style={{ fontWeight: 900, fontSize: 20, letterSpacing: '-0.5px' }}>
            <span style={{ color: '#1a1a1a' }}>MANGA</span>
            <span style={{ color: '#e05c2a' }}>DNA</span>
          </div>
          <nav style={{ display: 'flex', gap: 4 }}>
            {(['home', 'shelf', 'register'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 20,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: tab === t ? 700 : 400,
                  background: tab === t ? '#1a1a1a' : 'transparent',
                  color: tab === t ? '#fff' : '#666',
                  transition: 'all 0.15s',
                }}
              >
                {t === 'home' ? 'ホーム' : t === 'shelf' ? '本棚' : '登録'}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 80px' }}>

        {/* ===== HOME TAB ===== */}
        {tab === 'home' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {[
                { label: '登録作品', value: totalWorks, accent: false },
                { label: '読了巻数', value: totalVols, accent: false },
                { label: '未読新刊', value: unreadMangas.length, accent: true },
              ].map(s => (
                <div key={s.label} style={{
                  background: '#fff',
                  borderRadius: 12,
                  padding: '16px 14px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                }}>
                  <div style={{
                    fontSize: 32,
                    fontWeight: 900,
                    color: s.accent ? '#e05c2a' : '#1a1a1a',
                    lineHeight: 1,
                  }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Unread new releases */}
            {unreadMangas.length > 0 && (
              <section>
                <div style={{ fontSize: 12, color: '#999', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>📦</span> 未読新刊 — 本屋モード
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {unreadMangas.map(m => (
                    <div key={m.id} style={{
                      background: '#fff',
                      borderRadius: 12,
                      padding: '14px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                    }}>
                      <div style={{
                        width: 48,
                        height: 48,
                        borderRadius: 8,
                        background: stringToColor(m.title),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        color: '#fff',
                        fontWeight: 700,
                        textAlign: 'center',
                        lineHeight: 1.3,
                        flexShrink: 0,
                      }}>
                        {m.title.slice(0, 4)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{m.title}
                          {m.isFuture && <span style={{
                            marginLeft: 8,
                            fontSize: 11,
                            background: '#fff3e0',
                            color: '#e05c2a',
                            borderRadius: 4,
                            padding: '2px 6px',
                          }}>{m.releaseDate?.replace('年', '/').replace('月', '/').replace('日', '')}</span>}
                          {!m.isFuture && <span style={{
                            marginLeft: 8,
                            fontSize: 11,
                            background: '#e05c2a',
                            color: '#fff',
                            borderRadius: 4,
                            padding: '2px 6px',
                          }}>NEW</span>}
                        </div>
                        <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                          あなた：{m.currentVol}巻 → 最新：{m.latestVol}巻
                        </div>
                      </div>
                      <div style={{
                        fontSize: 16,
                        fontWeight: 900,
                        color: '#e05c2a',
                        flexShrink: 0,
                      }}>
                        {m.isFuture ? '予告' : `+${(m.latestVol || 0) - (m.currentVol || 0)}巻`}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Empty state */}
            {mangas.length === 0 && (
              <div style={{
                background: '#fff',
                borderRadius: 16,
                padding: 40,
                textAlign: 'center',
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>📚</div>
                <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>まだ登録がありません</div>
                <div style={{ color: '#999', fontSize: 14, marginBottom: 20 }}>
                  メモを貼り付けて漫画を一括登録しましょう
                </div>
                <button
                  onClick={() => setTab('register')}
                  style={{
                    background: '#1a1a1a',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 24,
                    padding: '12px 28px',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  登録する
                </button>
              </div>
            )}

            {/* Manga personality card */}
            {mangas.length >= 5 && (
              <div style={{
                background: '#1a1a1a',
                borderRadius: 16,
                padding: 24,
                position: 'relative',
                overflow: 'hidden',
              }}>
                <div style={{
                  position: 'absolute', right: -20, top: -20,
                  width: 120, height: 120,
                  borderRadius: '50%',
                  background: '#4a1a0a',
                  opacity: 0.6,
                }} />
                <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>あなたの漫画人格</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', marginBottom: 8 }}>
                  {getMangaPersonality(mangas).title}
                </div>
                <div style={{ fontSize: 14, color: '#aaa', marginBottom: 16, lineHeight: 1.6 }}>
                  {getMangaPersonality(mangas).desc}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {getMangaPersonality(mangas).tags.map(tag => (
                    <span key={tag} style={{
                      background: '#333',
                      color: '#ccc',
                      fontSize: 12,
                      padding: '4px 10px',
                      borderRadius: 20,
                    }}>{tag}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== SHELF TAB ===== */}
        {tab === 'shelf' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Search & filters */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="タイトルで検索..."
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 24,
                  border: '1px solid #e8e4df',
                  background: '#fff',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['all', 'unread', 'star'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilterStatus(f)}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 20,
                      border: '1px solid',
                      borderColor: filterStatus === f ? '#1a1a1a' : '#e8e4df',
                      background: filterStatus === f ? '#1a1a1a' : '#fff',
                      color: filterStatus === f ? '#fff' : '#666',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {f === 'all' ? 'すべて' : f === 'unread' ? '未読あり' : '★お気に入り'}
                  </button>
                ))}
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as typeof sortBy)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 20,
                    border: '1px solid #e8e4df',
                    background: '#fff',
                    fontSize: 12,
                    color: '#666',
                    cursor: 'pointer',
                    outline: 'none',
                    marginLeft: 'auto',
                  }}
                >
                  <option value="registered">登録順</option>
                  <option value="title">タイトル順</option>
                  <option value="unread">未読差分順</option>
                </select>
              </div>
            </div>

            <div style={{ fontSize: 12, color: '#999' }}>{filteredMangas.length}作品</div>

            {/* Manga list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredMangas.map(m => {
                const unreadCount = m.latestVol && m.currentVol ? m.latestVol - m.currentVol : 0
                const isFetching = fetchingIds.has(m.id)
                return (
                  <div key={m.id} style={{
                    background: '#fff',
                    borderRadius: 12,
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  }}>
                    <div style={{
                      width: 44,
                      height: 44,
                      borderRadius: 8,
                      background: stringToColor(m.title),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      color: '#fff',
                      fontWeight: 700,
                      textAlign: 'center',
                      lineHeight: 1.3,
                      flexShrink: 0,
                    }}>
                      {m.title.slice(0, 4)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{m.title}</span>
                        {m.star && <span style={{ color: '#e05c2a', fontSize: 12 }}>★</span>}
                        {m.isSeriesComplete && (
                          <span style={{ fontSize: 10, background: '#f0f0f0', color: '#666', borderRadius: 4, padding: '1px 5px' }}>完結</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                        {m.currentVol ? `${m.currentVol}巻` : '巻数未登録'}
                        {m.isMidVolume && ' (途中)'}
                        {m.latestVol && m.latestVol > (m.currentVol || 0) && (
                          <span style={{ color: '#e05c2a', marginLeft: 6 }}>
                            → 最新{m.latestVol}巻
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => refreshOne(m.id)}
                      disabled={isFetching}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        border: '1px solid #e8e4df',
                        background: '#fff',
                        cursor: isFetching ? 'default' : 'pointer',
                        fontSize: 14,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        opacity: isFetching ? 0.5 : 1,
                      }}
                    >
                      {isFetching ? '⏳' : '🔄'}
                    </button>
                  </div>
                )
              })}
            </div>

            {filteredMangas.length === 0 && (
              <div style={{ textAlign: 'center', color: '#999', padding: 40 }}>
                該当する作品がありません
              </div>
            )}
          </div>
        )}

        {/* ===== REGISTER TAB ===== */}
        {tab === 'register' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{
              background: '#fff',
              borderRadius: 16,
              padding: 20,
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>メモから一括登録</div>
              <div style={{ fontSize: 13, color: '#999', marginBottom: 14 }}>
                「・キングダム 76★」のような形式で貼り付けてください
              </div>
              <textarea
                value={memo}
                onChange={e => setMemo(e.target.value)}
                placeholder={`例：\n・キングダム 76★\n・ブルーロック 38\n・宇宙兄弟 45★\n・ワンピース 110 完`}
                rows={10}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px solid #e8e4df',
                  fontSize: 14,
                  lineHeight: 1.7,
                  resize: 'vertical',
                  outline: 'none',
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                }}
              />
              <button
                onClick={handleParse}
                disabled={!memo.trim()}
                style={{
                  marginTop: 12,
                  width: '100%',
                  padding: '12px',
                  borderRadius: 24,
                  border: 'none',
                  background: memo.trim() ? '#1a1a1a' : '#e0e0e0',
                  color: memo.trim() ? '#fff' : '#999',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: memo.trim() ? 'pointer' : 'default',
                }}
              >
                解析する
              </button>
            </div>

            {/* Parsed preview */}
            {parsed.length > 0 && (
              <div style={{
                background: '#fff',
                borderRadius: 16,
                padding: 20,
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>
                  {parsed.length}作品を認識しました
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {parsed.slice(0, 20).map((p, i) => (
                    <div key={i} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      background: '#f9f7f5',
                      borderRadius: 8,
                    }}>
                      <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
                        {p.star && '★ '}{p.title}
                      </span>
                      <span style={{ fontSize: 12, color: '#999' }}>
                        {p.currentVol ? `${p.currentVol}巻` : '巻数不明'}
                        {p.isSeriesComplete && ' 完結'}
                      </span>
                    </div>
                  ))}
                  {parsed.length > 20 && (
                    <div style={{ fontSize: 12, color: '#999', textAlign: 'center' }}>
                      ...他 {parsed.length - 20} 作品
                    </div>
                  )}
                </div>

                {registering ? (
                  <div>
                    <div style={{
                      height: 6,
                      background: '#f0f0f0',
                      borderRadius: 3,
                      overflow: 'hidden',
                      marginBottom: 8,
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${registerProgress}%`,
                        background: '#e05c2a',
                        borderRadius: 3,
                        transition: 'width 0.3s',
                      }} />
                    </div>
                    <div style={{ fontSize: 13, color: '#999', textAlign: 'center' }}>
                      {registerProgress < 50 ? '登録中...' : '最新刊情報を取得中...'}  {registerProgress}%
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleRegister}
                    style={{
                      width: '100%',
                      padding: '14px',
                      borderRadius: 24,
                      border: 'none',
                      background: '#e05c2a',
                      color: '#fff',
                      fontSize: 15,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    本棚に登録して最新刊を取得する
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

// ---- Helpers ----
function stringToColor(str: string): string {
  const colors = [
    '#2d6a9f', '#4a9e6b', '#8b4a2d', '#6a4a9e', '#9e6a2d',
    '#2d8b6a', '#9e2d4a', '#4a6a9e', '#6a9e2d', '#9e4a6a',
  ]
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

function getMangaPersonality(mangas: Manga[]): { title: string; desc: string; tags: string[] } {
  const starCount = mangas.filter(m => m.star).length
  const completeCount = mangas.filter(m => m.isSeriesComplete).length
  const total = mangas.length

  if (starCount / total > 0.4) {
    return {
      title: '熱中型・のめり込み人間',
      desc: '一度ハマったら止まらない。お気に入りへの執着が強く、作品との一体感を求める傾向がある。',
      tags: ['のめり込み型', '感情移入', '熱狂的', '長編派'],
    }
  }
  if (completeCount / total > 0.6) {
    return {
      title: '完走型・やり遂げる人間',
      desc: '始めたら最後まで読み切る完走派。完結作品への愛着が強く、継続力と忍耐力がある。',
      tags: ['完走型', '忍耐強い', '完結重視', 'コレクター'],
    }
  }
  return {
    title: '戦略型・再起人間',
    desc: '長期戦を愛し、仲間との連帯を力に変える。挫折から立ち上がる主人公に自分を重ねる傾向が強い。',
    tags: ['成長系', 'チーム戦', '戦略思考', '長編派'],
  }
}
