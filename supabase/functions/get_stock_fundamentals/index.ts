import "https://deno.land/x/xhr@0.1.0/mod.ts"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const EASTMONEY = "https://push2.eastmoney.com/api/qt/stock/get"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

// f20=总市值, f168=换手率, f9=动态市盈率, f23=市净率, f167=每股净资产, f37=60日最高, f38=60日最低
const FIELDS = "f20,f168,f9,f23,f167,f37,f38"

function toSecid(sym: string): string | null {
  if (/^6\d{5}$/.test(sym)) return "1." + sym
  if (/^[03]\d{5}$/.test(sym)) return "0." + sym
  if (sym.endsWith(".HK")) {
    const num = sym.replace(".HK", "")
    const padded = num.padStart(5, "0")
    return "116." + padded
  }
  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  try {
    const { symbols } = await req.json()
    if (!symbols || !Array.isArray(symbols) || !symbols.length) {
      return new Response(JSON.stringify({ error: "symbols array required" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      })
    }

    const result: Record<string, Record<string, any>> = {}

    for (const sym of symbols) {
      const secid = toSecid(sym)
      if (!secid) { result[sym] = {}; continue }
      try {
        const url = `${EASTMONEY}?secid=${secid}&fields=${FIELDS}`
        const res = await fetch(url, { headers: { "User-Agent": UA, "Referer": "https://quote.eastmoney.com/" }, signal: AbortSignal.timeout(5000) })
        if (!res.ok) { result[sym] = {}; continue }
        const data = await res.json()
        if (!data?.data) { result[sym] = {}; continue }
        const d = data.data
        result[sym] = {
          marketCap: d.f20 || null,
          turnoverRate: d.f168 != null ? d.f168 / 100 : null,
          pe: d.f9 || null,
          pb: d.f23 || null,
          navPerShare: d.f167 || null,
          high60: d.f37 || null,
          low60: d.f38 || null,
        }
      } catch {
        result[sym] = {}
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    })
  }
})
