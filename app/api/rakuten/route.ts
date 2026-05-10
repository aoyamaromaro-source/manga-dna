import { NextRequest, NextResponse } from 'next/server'

const APP_ID = process.env.RAKUTEN_APP_ID!

export async function GET(req: NextRequest) {
  const title = req.nextUrl.searchParams.get('title')
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const url = new URL('https://app.rakuten.co.jp/services/api/BooksBook/Search/20170404')
  url.searchParams.set('format', 'json')
  url.searchParams.set('applicationId', APP_ID)
  url.searchParams.set('title', title)
  url.searchParams.set('hits', '5')
  url.searchParams.set('sort', '-releaseDate')
  url.searchParams.set('outOfStockFlag', '1')
  url.searchParams.set('booksGenreId', '001001')

  try {
    const response = await fetch(url.toString())
    const data = await response.json()

    if (!data.Items?.length) {
      return NextResponse.json({ found: false })
    }

    let latestVol = 0
    let latestItem = data.Items[0].Item
    let releaseDate = ''

    for (const { Item } of data.Items) {
      const volMatch = Item.title?.match(/(\d+)/)
      if (volMatch) {
        const v = parseInt(volMatch[1])
        if (v > latestVol) {
          latestVol = v
          latestItem = Item
          releaseDate = Item.salesDate || Item.publishDate || ''
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
      itemTitle: latestItem.title,
      cover: latestItem.largeImageUrl || latestItem.mediumImageUrl || null,
    })
  } catch (e) {
    return NextResponse.json({ error: 'Rakuten API error' }, { status: 500 })
  }
}