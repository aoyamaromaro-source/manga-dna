import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const title = req.nextUrl.searchParams.get('title')
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(title + ' 漫画')}&langRestrict=ja&maxResults=10&orderBy=newest`

  try {
    const response = await fetch(url)
    const data = await response.json()

    if (!data.items?.length) {
      return NextResponse.json({ found: false })
    }

    let latestVol = 0
    let releaseDate = ''

    for (const item of data.items) {
      const t = item.volumeInfo?.title || ''
      // タイトルに含まれる数字を巻数として取得
      const volMatch = t.match(/[（(]?(\d+)[）)]?[巻冊]?$/) || t.match(/(\d+)$/) || t.match(/(\d+)/)
      if (volMatch) {
        const v = parseInt(volMatch[1])
        if (v > latestVol && v < 200) { // 200巻以上は誤検知とみなす
          latestVol = v
          releaseDate = item.volumeInfo?.publishedDate || ''
        }
      }
    }

    const today = new Date()
    const rel = releaseDate ? new Date(releaseDate) : null
    const isFuture = rel ? rel > today : false

    return NextResponse.json({
      found: latestVol > 0,
      latestVol: latestVol || null,
      releaseDate,
      isFuture,
    })
  } catch (e) {
    return NextResponse.json({ error: 'API error' }, { status: 500 })
  }
}