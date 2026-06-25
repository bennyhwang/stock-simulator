import "https://deno.land/x/xhr@0.1.0/mod.ts"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function toYahooSymbol(sym: string): string {
  if (sym.endsWith(".HK")) return sym
  if (/^[A-Z]+$/.test(sym)) return sym
  if (/^6\d{5}$/.test(sym)) return sym + ".SS"
  if (/^[03]\d{5}$/.test(sym)) return sym + ".SZ"
  return sym
}

function parseYahooPrice(data: any): number | null {
  try {
    const result = data?.chart?.result?.[0]
    if (!result) return null
    const meta = result.meta
    if (meta?.regularMarketPrice) return meta.regularMarketPrice
    const close = result.indicators?.quote?.[0]?.close
    if (close) {
      const vals = close.filter((v: number | null) => v !== null)
      if (vals.length) return vals[vals.length - 1]
    }
    return null
  } catch {
    return null
  }
}

function parseYahooName(data: any): string | null {
  try {
    return data?.chart?.result?.[0]?.meta?.symbol || null
  } catch {
    return null
  }
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

    const result: Record<string, { price: number; name: string }> = {}

    for (const sym of symbols) {
      try {
        const yahooSym = toYahooSymbol(sym)
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=1d`
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) continue
        const data = await res.json()
        const price = parseYahooPrice(data)
        if (price && price > 0) {
          result[sym] = { price, name: sym }
        }
      } catch {
        // skip failed symbols
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
