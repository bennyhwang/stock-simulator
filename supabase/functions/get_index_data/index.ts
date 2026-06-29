import "https://deno.land/x/xhr@0.1.0/mod.ts"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const EASTMONEY = "https://push2.eastmoney.com/api/qt/stock/kline/get"
const EASTMONEY_TRENDS = "https://push2.eastmoney.com/api/qt/stock/trends2/get"

// Index secid mappings
const INDEXES: Record<string, string> = {
  sh: "1.000001",  // 上证指数
  sz: "0.399001",  // 深证成指
}

// klt: 1=1min, 5=5min, 15=15min, 30=30min, 60=60min, 101=day, 102=week, 103=month
const KLT_MAP: Record<string, number> = {
  intraday: 1,
  daily: 101,
  weekly: 102,
  monthly: 103,
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  try {
    const { index = "sh", type = "daily" } = await req.json()
    const secid = INDEXES[index]
    if (!secid) {
      return new Response(JSON.stringify({ error: "invalid index" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      })
    }

    const klt = KLT_MAP[type] || 101
    const lmt = type === "intraday" ? 480 : type === "daily" ? 365 : type === "weekly" ? 200 : 60

    if (type === "intraday") {
      // 分时线: use trends2 API for today's ticks
      const url = `${EASTMONEY_TRENDS}?secid=${secid}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55&lmt=${lmt}&iscr=0`
      const res = await fetch(url, { headers: { "User-Agent": UA, "Referer": "https://quote.eastmoney.com/" } })
      if (!res.ok) throw new Error("HTTP " + res.status)
      const data = await res.json()
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      })
    }

    // K-line data
    const url = `${EASTMONEY}?secid=${secid}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57&klt=${klt}&fqt=1&end=20500101&lmt=${lmt}`
    const res = await fetch(url, { headers: { "User-Agent": UA, "Referer": "https://quote.eastmoney.com/" } })
    if (!res.ok) throw new Error("HTTP " + res.status)
    const data = await res.json()
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    })
  }
})
