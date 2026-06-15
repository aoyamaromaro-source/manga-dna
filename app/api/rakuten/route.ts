import { NextRequest, NextResponse } from 'next/server'

const APP_ID = process.env.RAKUTEN_APP_ID!
const ACCESS_KEY = process.env.RAKUTEN_ACCESS_KEY || ''
const AFFILIATE_ID = process.env.NEXT_PUBLIC_RAKUTEN_AFFILIATE_ID || ''

const API_BASE = 'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404'
const SITE_URL = process.env.RAKUTEN_REFERRER_URL || 'https://gleaming-jelly-a83f4c.netlify.app'

const FETCH_HEADERS: Record<string, string> = {
  'Referer': SITE_URL,
  'Origin': SITE_URL,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
}

const KATAKANA_TO_ENGLISH: Record<string, string> = {
  'ブルージャイアント': 'BLUE GIANT',
  'ワンピース': 'ONE PIECE',
  'ナルト': 'NARUTO',
  'ドラゴンボール': 'DRAGON BALL',
  'ブリーチ': 'BLEACH',
  'デスノート': 'DEATH NOTE',
  'フェアリーテイル': 'FAIRY TAIL',
  'ハンターハンター': 'HUNTER×HUNTER',
  'バガボンド': 'VAGABOND',
  'ガンツ': 'GANTZ',
  'ベルセルク': 'BERSERK',
  'バクマン': 'BAKUMAN',
  'ビンランドサガ': 'VINLAND SAGA',
  'ブラッククローバー': 'BLACK CLOVER',
  'ブラックラグーン': 'BLACK LAGOON',
  'ソウルイーター': 'SOUL EATER',
  'フルメタルアルケミスト': 'FULLMETAL ALCHEMIST',
  'アイシールド21': 'EYESHIELD 21',
  'ブルーエクソシスト': 'BLUE EXORCIST',
  'ファイアパンチ': 'FIRE PUNCH',
}

// --- ヘルパー ---

function buildAffiliateUrl(itemUrl: string): string {
  if (!AFFILIATE_ID || !itemUrl) return itemUrl
  return `https://hb.afl.rakuten.co.jp/ichiba/${AFFILIATE_ID}/?pc=${encodeURIComponent(itemUrl)}`
}

// コミックジャンル付き
function buildParams(extra: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams({
    applicationId: APP_ID,
    hits: '10',
    format: 'json',
    booksGenreId: '001001',
    ...extra,
  })
  if (ACCESS_KEY) params.set('accessKey', ACCESS_KEY)
  return params
}

// ジャンル指定なし（フォールバック用）
function buildParamsNoGenre(extra: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams({
    applicationId: APP_ID,
    hits: '10',
    format: 'json',
    ...extra,
  })
  if (ACCESS_KEY) params.set('accessKey', ACCESS_KEY)
  return params
}

// 算用数字→漢数字（「4月」→「四月」等）
function toKanjiNumerals(s: string): string {
  const map: Record<string, string> = {
    '0': '〇', '1': '一', '2': '二', '3': '三', '4': '四',
    '5': '五', '6': '六', '7': '七', '8': '八', '9': '九',
  }
  return s.replace(/[0-9]/g, d => map[d])
}

// 記号・スペースを除いた正規化
function stripForMatch(s: string): string {
  return s.replace(/[\s　\-－・（）\(\)「」『』【】♡♥★☆!！?？]/g, '')
}

// keyword フォールバック結果がクエリに関連するか判定（誤ヒット排除）
function itemMatchesQuery(itemTitle: string, query: string): boolean {
  const a = stripForMatch(itemTitle)
  const q = stripForMatch(query)
  if (q.length === 0) return false
  // クエリの文字列が item タイトルに部分一致すれば OK
  if (a.includes(q)) return true
  // 4文字以上のクエリは前半4文字が含まれるか
  if (q.length >= 4 && a.includes(q.substring(0, 4))) return true
  return false
}

// 生 fetch（Items 配列を返す）
async function doFetch(params: URLSearchParams): Promise<any[]> {
  try {
    const r = await fetch(`${API_BASE}?${params}`, { headers: FETCH_HEADERS })
    const d = await r.json()
    return d.Items || []
  } catch { return [] }
}

/**
 * 複数戦略フォールバック検索
 * 1. title + genre
 * 2. 漢数字変換 title + genre
 * 3. keyword + genre（関連フィルタ付き）
 * 4. keyword + ジャンルなし（関連フィルタ付き）← suggest モードでは省略
 */
async function searchWithFallback(
  query: string,
  hits = '10',
  skipNoGenre = false,
): Promise<any[]> {
  // 1. title + genre
  let items = await doFetch(buildParams({ title: query, hits }))
  if (items.length) return items

  // 2. 漢数字変換
  const kanjiQuery = toKanjiNumerals(query)
  if (kanjiQuery !== query) {
    items = await doFetch(buildParams({ title: kanjiQuery, hits }))
    if (items.length) return items
  }

  // 3. keyword + genre（フィルタ）
  items = await doFetch(buildParams({ keyword: query, hits }))
  let filtered = items.filter(({ Item }: any) => itemMatchesQuery(Item.title || '', query))
  if (filtered.length) return filtered

  // 4. keyword + ジャンルなし（フィルタ）
  if (!skipNoGenre) {
    items = await doFetch(buildParamsNoGenre({ keyword: query, hits }))
    filtered = items.filter(({ Item }: any) => itemMatchesQuery(Item.title || '', query))
    return filtered
  }

  return []
}

// 巻タイトル末尾の巻数表記を除去
function stripVolumeSuffix(title: string): string {
  return (title || '')
    .replace(/[\s　]*[（(]?第?[\d０-９]+[巻冊号]?[）)]?[\s　]*$/, '')
    .trim() || title || ''
}

export async function GET(req: NextRequest) {
  const title = req.nextUrl.searchParams.get('title')
  const author = req.nextUrl.searchParams.get('author')
  const mode = req.nextUrl.searchParams.get('mode') || 'title'

  // ---- Author search mode (for recommendations) ----
  if (mode === 'author' && author) {
    const params = buildParams({ author, hits: '30', sort: '-releaseDate' })
    try {
      const response = await fetch(`${API_BASE}?${params}`, { headers: FETCH_HEADERS })
      const data = await response.json()

      if (!data.Items?.length) {
        return NextResponse.json({ found: false })
      }

      const books = data.Items.map(({ Item }: any) => ({
        title: Item.title || '',
        author: Item.author || '',
        coverUrl: Item.largeImageUrl || Item.mediumImageUrl || '',
        itemUrl: Item.itemUrl || '',
        affiliateUrl: Item.affiliateUrl || buildAffiliateUrl(Item.itemUrl || ''),
      }))

      return NextResponse.json({ found: true, books })
    } catch (e) {
      return NextResponse.json({ error: 'API error', detail: String(e) }, { status: 500 })
    }
  }

  // ---- Suggest mode (autocomplete) ----
  if (mode === 'suggest' && title) {
    try {
      // suggest は速度重視 → skipNoGenre=true で3段階まで
      const items = await searchWithFallback(title, '10', true)

      if (!items.length) return NextResponse.json({ found: false, suggestions: [] })

      const seen = new Set<string>()
      const suggestions: Array<{ title: string; author: string; coverUrl: string; affiliateUrl: string }> = []

      for (const { Item } of items) {
        const baseTitle = stripVolumeSuffix(Item.title)
        if (!baseTitle || seen.has(baseTitle)) continue
        seen.add(baseTitle)
        suggestions.push({
          title: baseTitle,
          author: Item.author || '',
          coverUrl: Item.largeImageUrl || Item.mediumImageUrl || '',
          affiliateUrl: buildAffiliateUrl(Item.itemUrl || ''),
        })
        if (suggestions.length >= 5) break
      }

      return NextResponse.json({ found: suggestions.length > 0, suggestions })
    } catch (e) {
      return NextResponse.json({ error: 'API error', detail: String(e) }, { status: 500 })
    }
  }

  // ---- Search mode (search screen - returns grouped result cards) ----
  if (mode === 'search' && title) {
    const englishTitle = KATAKANA_TO_ENGLISH[title] || null

    try {
      // メインクエリ + カタカナ→英語変換も並列で検索
      const [mainItems, enItems] = await Promise.all([
        searchWithFallback(title, '10'),
        englishTitle ? searchWithFallback(englishTitle, '10') : Promise.resolve([]),
      ])
      const items = [...mainItems, ...enItems]

      if (!items.length) return NextResponse.json({ found: false, results: [] })

      const seen = new Map<string, { title: string; author: string; coverUrl: string; latestVol: number | null; affiliateUrl: string }>()

      for (const { Item } of items) {
        const baseTitle = stripVolumeSuffix(Item.title)
        if (!baseTitle) continue

        const volMatch = (Item.title as string)?.match(/(\d+)/)
        const vol = volMatch ? parseInt(volMatch[1]) : null

        if (!seen.has(baseTitle)) {
          seen.set(baseTitle, {
            title: baseTitle,
            author: Item.author || '',
            coverUrl: Item.largeImageUrl || Item.mediumImageUrl || '',
            latestVol: vol,
            affiliateUrl: buildAffiliateUrl(Item.itemUrl || ''),
          })
        } else {
          const existing = seen.get(baseTitle)!
          if (vol && (!existing.latestVol || vol > existing.latestVol)) {
            existing.latestVol = vol
            existing.affiliateUrl = buildAffiliateUrl(Item.itemUrl || '')
          }
          if (!existing.coverUrl) {
            existing.coverUrl = Item.largeImageUrl || Item.mediumImageUrl || ''
          }
        }
      }

      const results = Array.from(seen.values()).slice(0, 10)
      return NextResponse.json({ found: results.length > 0, results })
    } catch (e) {
      return NextResponse.json({ error: 'API error', detail: String(e) }, { status: 500 })
    }
  }

  // ---- Title search mode (shelf refresh / single register) ----
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  try {
    const items = await searchWithFallback(title, '10')

    if (!items.length) {
      return NextResponse.json({ found: false })
    }

    let latestVol = 0
    let releaseDate = ''
    let coverUrl = ''
    let author = ''
    let latestItemUrl = ''

    // 1巻の表紙を優先取得
    for (const { Item } of items) {
      if (!author && Item.author) author = Item.author
      const volMatch = Item.title?.match(/(\d+)/)
      if (volMatch && parseInt(volMatch[1]) === 1) {
        coverUrl = Item.largeImageUrl || Item.mediumImageUrl || ''
        break
      }
    }

    // 最新巻を探す
    for (const { Item } of items) {
      if (!author && Item.author) author = Item.author
      const volMatch = Item.title?.match(/(\d+)/)
      if (volMatch) {
        const v = parseInt(volMatch[1])
        if (v > latestVol) {
          latestVol = v
          releaseDate = Item.salesDate || ''
          latestItemUrl = Item.itemUrl || ''
          if (!coverUrl) coverUrl = Item.largeImageUrl || Item.mediumImageUrl || ''
        }
      }
    }

    // 巻数が見つからない場合も最初のヒットから
    if (items.length > 0) {
      const first = items[0].Item
      if (!author) author = first.author || ''
      if (!coverUrl) coverUrl = first.largeImageUrl || first.mediumImageUrl || ''
      if (!latestItemUrl) latestItemUrl = first.itemUrl || ''
    }

    const today = new Date()
    const rel = releaseDate
      ? new Date(releaseDate.replace(/年|月/g, '-').replace(/日.*/, ''))
      : null
    const isFuture = rel ? rel > today : false

    return NextResponse.json({
      found: true,
      latestVol: latestVol || null,
      releaseDate,
      isFuture,
      coverUrl,
      author,
      affiliateUrl: buildAffiliateUrl(latestItemUrl),
    })
  } catch (e) {
    return NextResponse.json({ error: 'API error', detail: String(e) }, { status: 500 })
  }
}
