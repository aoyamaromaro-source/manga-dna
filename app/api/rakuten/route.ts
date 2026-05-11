import { NextRequest, NextResponse } from 'next/server'

const APP_ID = process.env.RAKUTEN_APP_ID!

export async function GET(req: NextRequest) {
  const title = req.nextUrl.searchParams.get('title')
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const params = new URLSearchParams({
    applicationId: APP_ID,
    title: title,
    hits: '5',
    format: 'json',
    booksGenreId: '001001',
  })

  const url = `https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404?${params}`

  try {
    const response = await fetch(url)
    const data = await response.json()

    if (!data.Items?.length) {
      return NextResponse.json({ found: false, debug: data })
    }

    let latestVol = 0
    let releaseDate = ''

    for (const { Item } of data.Items) {
      const volMatch = Item.title?.match(/(\d+)/)
      if (volMatch) {
        const v = parseInt(volMatch[1])
        if (v > latestVol) {
          latestVol = v
          releaseDate = Item.salesDate || ''
        }
      }
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
    })
  } catch (e) {
    return NextResponse.json({ error: 'API error', detail: String(e) }, { status: 500 })
  }
}