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

function buildAffiliateUrl(itemUrl: string): string {
  if (!AFFILIATE_ID || !itemUrl) return itemUrl
  return `https://hb.afl.rakuten.co.jp/ichiba/${AFFILIATE_ID}/?pc=${encodeURIComponent(itemUrl)}`
}

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
      const params = buildParams({ title })
      const response = await fetch(`${API_BASE}?${params}`, { headers: FETCH_HEADERS })
      const data = await response.json()

      if (!data.Items?.length) return NextResponse.json({ found: false, suggestions: [] })

      const seen = new Set<string>()
      const suggestions: Array<{ title: string; author: string; coverUrl: string; affiliateUrl: string }> = []

      for (const { Item } of data.Items) {
        const baseTitle = (Item.title as string || '')
          .replace(/[\s　]*[（(]?第?[\d０-９]+[巻冊号]?[）)]?[\s　]*$/, '')
          .trim() || (Item.title as string) || ''
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

  // ---- Title search mode ----
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const params = buildParams({ title })

  try {
    const response = await fetch(`${API_BASE}?${params}`, { headers: FETCH_HEADERS })
    const data = await response.json()

    if (!data.Items?.length) {
      return NextResponse.json({ found: false, debug: data })
    }

    let latestVol = 0
    let releaseDate = ''
    let coverUrl = ''
    let author = ''
    let latestItemUrl = ''

    // 1巻の表紙を優先取得
    for (const { Item } of data.Items) {
      if (!author && Item.author) author = Item.author
      const volMatch = Item.title?.match(/(\d+)/)
      if (volMatch && parseInt(volMatch[1]) === 1) {
        coverUrl = Item.largeImageUrl || Item.mediumImageUrl || ''
        break
      }
    }

    // 最新巻を探す
    for (const { Item } of data.Items) {
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

    // 巻数が見つからない場合も最初のヒットから表紙・URLを取得
    if (data.Items.length > 0) {
      const first = data.Items[0].Item
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
