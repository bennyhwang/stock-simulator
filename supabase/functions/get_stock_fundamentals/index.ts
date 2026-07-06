import "https://deno.land/x/xhr@0.1.0/mod.ts"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const EASTMONEY = "https://push2.eastmoney.com/api/qt/stock/get"
const YAHOO = "https://query1.finance.yahoo.com/v7/finance/quote"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

// f20=总市值, f168=换手率, f9=动态市盈率, f23=市净率, f167=每股净资产, f37=60日最高, f38=60日最低
const FIELDS = "f20,f168,f9,f23,f167,f37,f38"

function isAShare(sym: string): boolean {
  return /^6\d{5}$/.test(sym) || /^[03]\d{5}$/.test(sym)
}

function toSecid(sym: string): string | null {
  if (/^6\d{5}$/.test(sym)) return "1." + sym
  if (/^[03]\d{5}$/.test(sym)) return "0." + sym
  if (sym.endsWith(".HK")) {
    const num = sym.replace(".HK", "")
    return "116." + num.padStart(5, "0")
  }
  return null
}

async function fetchEastMoney(sym: string): Promise<Record<string, any>> {
  const secid = toSecid(sym)
  if (!secid) return {}
  try {
    const url = `${EASTMONEY}?secid=${secid}&fields=${FIELDS}`
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Referer": "https://quote.eastmoney.com/" },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return {}
    const data = await res.json()
    if (!data?.data) return {}
    const d = data.data
    return {
      marketCap: d.f20 || null,
      turnoverRate: d.f168 != null ? d.f168 / 100 : null,
      pe: d.f9 || null,
      pb: d.f23 || null,
      navPerShare: d.f167 || null,
      high60: d.f37 || null,
      low60: d.f38 || null,
    }
  } catch {
    return {}
  }
}

async function fetchYahooFinance(symbols: string[]): Promise<Record<string, Record<string, any>>> {
  const result: Record<string, Record<string, any>> = {}
  if (!symbols.length) return result

  // Build Yahoo symbol list
  const yahooSyms = symbols.map(s => {
    if (isAShare(s)) {
      // A-shares on Yahoo: Shanghai -> .SS, Shenzhen -> .SZ
      return /^6\d{5}$/.test(s) ? s + ".SS" : s + ".SZ"
    }
    return s // US and HK symbols stay as-is
  })

  try {
    const url = `${YAHOO}?symbols=${yahooSyms.join(",")}`
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Referer": "https://finance.yahoo.com/",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return result
    const data = await res.json()
    const quotes = data?.quoteResponse?.result || []
    for (const q of quotes) {
      const origSym = symbols.find(s => {
        const ys = isAShare(s) ? (/^6\d{5}$/.test(s) ? s + ".SS" : s + ".SZ") : s
        return ys === q.symbol
      })
      if (!origSym) continue
      result[origSym] = {
        marketCap: q.marketCap || null,
        turnoverRate: (q.regularMarketVolume && q.sharesOutstanding)
          ? parseFloat(((q.regularMarketVolume / q.sharesOutstanding) * 100).toFixed(4))
          : null,
        pe: q.trailingPE || null,
        pb: q.priceToBook || null,
        navPerShare: q.bookValue || null,
        high60: q.fiftyTwoWeekHigh || null,
        low60: q.fiftyTwoWeekLow || null,
      }
    }
  } catch {
    // Yahoo failed, return empty
  }
  return result
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
    const nonAShares: string[] = []

    // Phase 1: East Money for A-shares, collect non-A-shares for Yahoo
    for (const sym of symbols) {
      if (isAShare(sym)) {
        result[sym] = await fetchEastMoney(sym)
      } else {
        nonAShares.push(sym)
      }
    }

    // Phase 2: Yahoo Finance for non-A-shares (batch)
    if (nonAShares.length) {
      const yahooData = await fetchYahooFinance(nonAShares)
      for (const sym of nonAShares) {
        result[sym] = yahooData[sym] || {}
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
