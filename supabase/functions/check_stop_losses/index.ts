import "https://deno.land/x/xhr@0.1.0/mod.ts"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const YAHOO = "https://query1.finance.yahoo.com/v7/finance/quote"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

async function fetchJson(url: string, opts?: Record<string, any>) {
  const res = await fetch(url, opts || {})
  if (!res.ok) throw new Error("HTTP " + res.status)
  return res.json()
}

function supabaseFetch(path: string, opts?: Record<string, any>) {
  const url = SUPABASE_URL + "/rest/v1/" + path
  const headers = {
    "apikey": SERVICE_KEY,
    "Authorization": "Bearer " + SERVICE_KEY,
    "Content-Type": "application/json",
    ...(opts?.headers || {}),
  }
  return fetchJson(url, { ...opts, headers })
}

// Yahoo symbol mapping
function toYahooSymbol(sym: string): string {
  if (/^6\d{5}$/.test(sym)) return sym + ".SS"
  if (/^[03]\d{5}$/.test(sym)) return sym + ".SZ"
  return sym
}

function fromYahooSymbol(ys: string): string {
  return ys.replace(/\.(SS|SZ)$/, "")
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  try {
    // 1. Fetch all active stop-loss rules
    const rules: any[] = await supabaseFetch(
      "stop_losses?select=*&active=eq.true&order=id.asc"
    )
    if (!rules || !rules.length) {
      return new Response(JSON.stringify({ checked: 0, sold: 0 }), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      })
    }

    // 2. Group by symbol for batch price query
    const symbolSet = new Set(rules.map((r: any) => r.symbol))
    const symbols = [...symbolSet]

    // 3. Fetch current prices from Yahoo Finance
    const yahooSyms = symbols.map(toYahooSymbol).join(",")
    let priceMap: Record<string, number> = {}
    try {
      const quoteData = await fetchJson(YAHOO + "?symbols=" + yahooSyms, {
        headers: { "User-Agent": UA, "Referer": "https://finance.yahoo.com/" },
        signal: AbortSignal.timeout(10000),
      })
      const results = quoteData?.quoteResponse?.result || []
      for (const q of results) {
        const origSym = fromYahooSymbol(q.symbol)
        if (q.regularMarketPrice) priceMap[origSym] = q.regularMarketPrice
      }
    } catch {
      return new Response(JSON.stringify({ error: "price fetch failed" }), {
        status: 502, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      })
    }

    // 4. Check each rule
    let sold = 0
    const results: any[] = []

    for (const rule of rules) {
      const currentPrice = priceMap[rule.symbol]
      if (!currentPrice) {
        results.push({ symbol: rule.symbol, username: rule.username, status: "no_price" })
        continue
      }

      // Trigger: price <= trigger_price
      if (currentPrice > rule.trigger_price) {
        results.push({ symbol: rule.symbol, username: rule.username, status: "ok" })
        continue
      }

      // Get user's current position from portfolios table (via traders join)
      try {
        const traderData: any[] = await supabaseFetch(
          `traders?select=id&username=eq.${encodeURIComponent(rule.username)}&limit=1`
        )
        if (!traderData || !traderData.length) {
          results.push({ symbol: rule.symbol, username: rule.username, status: "trader_not_found" })
          continue
        }
        const traderId = traderData[0].id

        const portfolioData: any[] = await supabaseFetch(
          `portfolios?select=quantity,name&trader_id=eq.${traderId}&symbol=eq.${encodeURIComponent(rule.symbol)}&limit=1`
        )
        const qty = portfolioData?.length ? portfolioData[0].quantity : 0
        const stockName = portfolioData?.length ? (portfolioData[0].name || rule.symbol) : rule.symbol

        if (qty <= 0) {
          // No shares to sell, deactivate rule
          await supabaseFetch(
            `stop_losses?id=eq.${rule.id}`,
            { method: "PATCH", body: JSON.stringify({ active: false }) }
          )
          results.push({ symbol: rule.symbol, username: rule.username, status: "no_shares" })
          continue
        }

        // 5. Execute sell trade via RPC
        const tradeResult: any = await supabaseFetch("rpc/execute_trade", {
          method: "POST",
          body: JSON.stringify({
            p_username: rule.username,
            p_symbol: rule.symbol,
            p_name: stockName,
            p_price: currentPrice,
            p_quantity: qty,
            p_type: "sell",
          }),
        })
        const resultStr = typeof tradeResult === 'string' ? tradeResult : Array.isArray(tradeResult) ? tradeResult[0] : String(tradeResult)

        // 6. Deactivate the rule (avoid retriggering)
        await supabaseFetch(
          `stop_losses?id=eq.${rule.id}`,
          { method: "PATCH", body: JSON.stringify({ active: false }) }
        )

        if (resultStr === 'ok') {
          sold++
          results.push({ symbol: rule.symbol, username: rule.username, status: "sold", quantity: qty, price: currentPrice })
        } else {
          results.push({ symbol: rule.symbol, username: rule.username, status: "trade_failed", error: resultStr })
        }
      } catch (err) {
        results.push({ symbol: rule.symbol, username: rule.username, status: "error", error: String(err) })
      }
    }

    return new Response(JSON.stringify({ checked: rules.length, sold, results }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    })
  }
})
