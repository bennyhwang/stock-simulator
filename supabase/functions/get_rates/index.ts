import "https://deno.land/x/xhr@0.1.0/mod.ts"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const FALLBACK_RATES = { USD: 7.8, CNY: 1.1 }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  try {
    // Try ExchangeRate-API first
    const res = await fetch("https://api.exchangerate-api.com/v4/latest/HKD", {
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const data = await res.json()
      const usdRate = data.rates?.USD ? (1 / data.rates.USD) : FALLBACK_RATES.USD
      const cnyRate = data.rates?.CNY ? (1 / data.rates.CNY) : FALLBACK_RATES.CNY
      return new Response(JSON.stringify({
        USD: Math.round(usdRate * 100) / 100,
        CNY: Math.round(cnyRate * 100) / 100,
        updated_at: new Date().toISOString(),
      }), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      })
    }

    // Fallback: try Frankfurter
    const fb = await fetch("https://api.frankfurter.app/latest?from=HKD&to=USD,CNY", {
      signal: AbortSignal.timeout(5000),
    })
    if (fb.ok) {
      const fbd = await fb.json()
      const usdRate = fbd.rates?.USD ? (1 / fbd.rates.USD) : FALLBACK_RATES.USD
      const cnyRate = fbd.rates?.CNY ? (1 / fbd.rates.CNY) : FALLBACK_RATES.CNY
      return new Response(JSON.stringify({
        USD: Math.round(usdRate * 100) / 100,
        CNY: Math.round(cnyRate * 100) / 100,
        updated_at: new Date().toISOString(),
      }), {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      })
    }

    // Ultimate fallback: hardcoded rates
    return new Response(JSON.stringify({
      USD: FALLBACK_RATES.USD,
      CNY: FALLBACK_RATES.CNY,
      updated_at: new Date().toISOString(),
      note: "fallback rates used",
    }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    })
  } catch (_) {
    return new Response(JSON.stringify({
      USD: FALLBACK_RATES.USD,
      CNY: FALLBACK_RATES.CNY,
      updated_at: new Date().toISOString(),
      note: "fallback rates used",
    }), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    })
  }
})
