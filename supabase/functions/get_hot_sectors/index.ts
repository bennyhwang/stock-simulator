import "https://deno.land/x/xhr@0.1.0/mod.ts"

const EASTMONEY = "https://push2.eastmoney.com/api/qt/clist/get"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Referer": "https://quote.eastmoney.com/" } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function parseSectors(data: any): { code: string; name: string; changePct: number }[] {
  if (!data?.data?.diff) return []
  return data.data.diff.slice(0, 5).map((item: any) => ({
    code: item.f12,
    name: item.f14,
    changePct: item.f3 ?? 0,
  }))
}

function parseStocks(data: any): { symbol: string; name: string; changePct: number; price: number }[] {
  if (!data?.data?.diff) return []
  return data.data.diff.slice(0, 5).map((item: any) => ({
    symbol: item.f12,
    name: item.f14,
    changePct: item.f3 ?? 0,
    price: item.f2 ?? 0,
  }))
}

async function fetchEtfs(): Promise<any[]> {
  const params = "pn=1&pz=10&po=1&np=1&fltt=2&invt=2&fields=f2,f3,f4,f12,f14&fid=f3"
  try {
    const data = await fetchJson(`${EASTMONEY}?${params}&fs=b:MK0021`)
    if (!data?.data?.diff?.length) return []
    return data.data.diff.map((item: any) => ({
      symbol: item.f12,
      name: item.f14,
      changePct: item.f3 ?? 0,
      price: item.f2 ?? 0,
    }))
  } catch {
    return []
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  try {
    const params = "pn=1&pz=5&po=1&np=1&fltt=2&invt=2&fields=f2,f3,f4,f12,f14&fid=f3"

    const indRes = await fetchJson(`${EASTMONEY}?${params}&fs=m:90+t:2`)
    const industries = parseSectors(indRes)

    const conRes = await fetchJson(`${EASTMONEY}?${params}&fs=m:90+t:3`)
    const concepts = parseSectors(conRes)

    const sectors = [...industries, ...concepts]
    const sectorWithStocks = await Promise.all(sectors.map(async (sec) => {
      try {
        const stkRes = await fetchJson(`${EASTMONEY}?${params}&fs=b:${sec.code}`)
        return { ...sec, stocks: parseStocks(stkRes) }
      } catch {
        return { ...sec, stocks: [] }
      }
    }))

    // ETF: fetch from fund center board codes
    const etfs = await fetchEtfs()
    const sortedEtfs = etfs.sort((a, b) => b.changePct - a.changePct).slice(0, 5)

    return new Response(JSON.stringify({
      industries: sectorWithStocks.slice(0, 5),
      concepts: sectorWithStocks.slice(5),
      etfs: sortedEtfs,
    }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    })
  }
})
