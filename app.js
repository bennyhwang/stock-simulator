/* ===== State ===== */
const API_BASE = 'https://fuuwjceawowojecaqfru.supabase.co/rest/v1'
const ANON_KEY = 'sb_publishable_M3lmOrr1QDDkkKE3r9q7qQ_mVnLlYtQ'
const HEADERS = { apikey: ANON_KEY, 'Content-Type': 'application/json' }

let currentUser = null
let portfolioCache = []
let plans = []
let currentPlanFilter = null // null=all, 0=no-plan, >0=plan_id
let editingPlanId = null
let ratesCache = { rates: null, ts: 0 }
const RATES_TTL = 300000 // 5 min

/* ===== Auth ===== */
async function handleLogin(e) {
  e.preventDefault()
  const username = document.getElementById('regUsername').value.trim()
  const password = document.getElementById('regPassword').value
  const err = document.getElementById('loginError')
  err.style.display = 'none'
  if (!username || !password) { err.textContent = '請輸入用戶名和密碼'; err.style.display = 'block'; return }

  try {
    let res = await fetch(API_BASE + '/rpc/login_trader', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ p_username: username, p_password: password })
    })
    if (res.ok) {
      const data = await res.json()
      if (data && data.length) {
        currentUser = { username: data[0].username, display_name: data[0].display_name || data[0].username }
        localStorage.setItem('trader_session', JSON.stringify(currentUser))
        onLoginSuccess()
        return
      }
    }
    res = await fetch(API_BASE + '/rpc/register_trader', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ p_username: username, p_password: password })
    })
    if (res.ok) {
      currentUser = { username, display_name: username }
      localStorage.setItem('trader_session', JSON.stringify(currentUser))
      onLoginSuccess()
    } else {
      const txt = await res.text()
      err.textContent = txt.includes('duplicate') ? '用戶名已存在，請直接登入' : '操作失敗: ' + txt
      err.style.display = 'block'
    }
  } catch (ex) {
    err.textContent = '網絡錯誤: ' + ex.message
    err.style.display = 'block'
  }
}

function onLoginSuccess() {
  document.getElementById('loginPage').style.display = 'none'
  document.getElementById('navBar').style.display = 'block'
  document.getElementById('appContent').style.display = 'block'
  document.getElementById('userDisplay').textContent = '\u{1F464} ' + (currentUser.display_name || currentUser.username)
  initApp()
}

function logout() {
  currentUser = null
  localStorage.removeItem('trader_session')
  document.getElementById('loginPage').style.display = 'flex'
  document.getElementById('navBar').style.display = 'none'
  document.getElementById('appContent').style.display = 'none'
}

/* ===== Tab Switching ===== */
function switchTab(name) {
  document.querySelectorAll('.nav-links button').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'))
  const btn = Array.from(document.querySelectorAll('.nav-links button')).find(b => b.textContent.includes(
    name === 'dashboard' ? '儀表板' : name === 'trade' ? '交易' : name === 'portfolio' ? '持倉' : name === 'plans' ? '投資組合' : name === 'index' ? '大盤走勢' : '交易紀錄'
  ))
  if (btn) btn.classList.add('active')
  document.getElementById('sec' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active')
  if (name === 'portfolio') renderPortfolio()
  if (name === 'plans') renderPlans()
  if (name === 'history') loadHistory()
  if (name === 'index') { if (!indexLoaded) loadIndexChart(); else drawIndexChart() }
}

/* ===== Dashboard ===== */
async function initApp() {
  await Promise.all([loadSummary(), loadPortfolio(), loadQuickStocks(), loadPlans(), loadHotSectors()])
  loadSummary()
  // Auto-refresh hot sectors every 5 minutes
  setInterval(function() { loadHotSectors(true) }, 300000)
}

async function loadSummary() {
  try {
    const res = await fetch(API_BASE + '/rpc/get_trader_summary', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ p_username: currentUser.username })
    })
    const txt = await res.text()
    if (res.ok) {
      const data = JSON.parse(txt || '[]')
      if (data && data.length) {
        const s = data[0]
        let mv = Number(s.market_value || 0)
        let pnl = Number(s.total_pnl || 0)
        if (portfolioCache.length) {
          const realMv = portfolioCache.reduce(function(sm, p) { return sm + (p.market_price || 0) * p.quantity }, 0)
          if (realMv > 0) { mv = realMv; pnl = realMv - portfolioCache.reduce(function(sm, p) { return sm + p.avg_cost * p.quantity }, 0) }
        }
        document.getElementById('statCash').textContent = CUR_HKD + ' ' + fmt(s.cash)
        document.getElementById('statValue').textContent = CUR_HKD + ' ' + fmt(mv)
        document.getElementById('statTotal').textContent = CUR_HKD + ' ' + fmt(Number(s.cash) + mv)
        const pnlEl = document.getElementById('statPnl')
        pnlEl.textContent = (pnl >= 0 ? '+' : '') + CUR_HKD + ' ' + fmt(pnl)
        pnlEl.className = 'value ' + (pnl >= 0 ? 'green' : 'red')
        // Load per-plan summary for dashboard plan breakdown
        await loadPlanSummaries()
        return
      }
    }
    // Fallback
    const fb = await fetch(API_BASE + '/traders?select=cash_balance&username=eq.' + encodeURIComponent(currentUser.username), { headers: HEADERS })
    if (fb.ok) {
      const fd = await fb.json()
      if (fd && fd.length) document.getElementById('statCash').textContent = CUR_HKD + ' ' + fmt(fd[0].cash_balance)
    }
  } catch (_) {}
}

async function loadPlanSummaries() {
  const el = document.getElementById('planSummaries')
  const card = document.getElementById('planSummaryCard')
  if (!el || !card) return
  if (!plans.length) { el.innerHTML = ''; card.style.display = 'none'; return }
  let rows = ''
  for (const p of plans) {
    const sr = await fetch(API_BASE + '/rpc/get_trader_summary', { method:'POST', headers:HEADERS, body:JSON.stringify({ p_username: currentUser.username, p_plan_id: p.id }) })
    if (sr.ok) {
      const sd = await sr.json()
      if (sd && sd.length) {
        const sv = sd[0]
        const smv = Number(sv.market_value || 0)
        const spnl = Number(sv.total_pnl || 0)
        rows += '<tr><td>' + esc(p.plan_name) + '</td><td>' + CUR_HKD + ' ' + fmt(smv) + '</td><td class="' + (spnl >= 0 ? 'green' : 'red') + '">' + (spnl >= 0 ? '+' : '') + CUR_HKD + ' ' + fmt(spnl) + '</td></tr>'
      }
    }
  }
  if (rows) { el.innerHTML = rows; card.style.display = 'block' }
  else card.style.display = 'none'
}

async function loadPortfolio() {
  try {
    const res = await fetch(API_BASE + '/rpc/get_trader_portfolio', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ p_username: currentUser.username })
    })
    const txt = await res.text()
    if (!res.ok) { portfolioCache = []; return }
    portfolioCache = (JSON.parse(txt || '[]')) || []
    // Try to enrich with real prices (Tencent + Yahoo Finance fallback)
    if (portfolioCache.length) {
      const syms = portfolioCache.map(function(p) { return p.symbol })
      const real = await getRealPricesMulti(syms)
      portfolioCache.forEach(function(p) {
        if (real[p.symbol]) p.market_price = real[p.symbol].price
      })
    }
  } catch (_) { portfolioCache = portfolioCache || [] }
  renderPortfolioSummary()
}

function renderPortfolioSummary() {
  const tbody = document.getElementById('portfolioSummary')
  if (!portfolioCache.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#8b949e;padding:2rem;">暫無持倉</td></tr>'
    return
  }
  tbody.innerHTML = portfolioCache.map(p => {
    const pnl = (p.market_price || 0) - (p.avg_cost || 0)
    const mv = (p.market_price || 0) * p.quantity
    const totalPnl = pnl * p.quantity
    const cur = getCurrency(p.symbol)
    return `<tr>
      <td><strong>${esc(p.symbol)}</strong></td>
      <td>${esc(p.name || '')}</td>
      <td>${p.quantity}</td>
      <td>${cur} ${fmt(p.avg_cost)}</td>
      <td class="${pnl >= 0 ? 'green' : 'red'}">${cur} ${fmt(p.market_price)}</td>
      <td>${cur} ${fmt(mv)}</td>
      <td class="${totalPnl >= 0 ? 'green' : 'red'}">${totalPnl >= 0 ? '+' : ''}${cur} ${fmt(totalPnl)}</td>
    </tr>`
  }).join('')
}

/* ===== Trade ===== */
let currentStockData = null

async function searchStock() {
  const q = document.getElementById('stockSearch').value.trim()
  const result = document.getElementById('stockResult')
  const err = document.getElementById('tradeError')
  err.style.display = 'none'
  if (!q) return

  try {
    const realData = await getRealPrice(q.toUpperCase())
    if (realData) {
      currentStockData = { symbol: q.toUpperCase(), name: realData.name, price: realData.price }
      showStockData(currentStockData)
      return
    }
    const res = await fetch(API_BASE + '/rpc/search_stock', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ p_query: q })
    })
    if (!res.ok) throw new Error('查詢失敗')
    const data = await res.json()
    if (!data || !data.length) {
      err.textContent = '找不到該股票，請檢查代碼'
      err.style.display = 'block'
      result.style.display = 'none'
      return
    }
    currentStockData = data[0]
    try {
      const realPrice = await getRealPrice(currentStockData.symbol)
      if (realPrice) { currentStockData.price = realPrice.price; currentStockData.name = realPrice.name || currentStockData.name }
    } catch(_) {}
    showStockData(currentStockData)
  } catch (ex) {
    err.textContent = '錯誤: ' + ex.message
    err.style.display = 'block'
  }
}

function showStockData(s) {
  document.getElementById('stockName').textContent = s.name || ''
  document.getElementById('stockSymbol').textContent = s.symbol
  const price = s.price || 0
  const priceEl = document.getElementById('stockPrice')
  const cur = getCurrency(s.symbol)
  let display = cur + ' ' + fmt(price)
  if (cur !== 'HKD') {
    const rate = ratesCache.rates ? ratesCache.rates[cur] : null
    if (rate) display += ' (\u2248 HKD ' + fmt(Math.round(price * rate * 100) / 100) + ')'
  }
  priceEl.textContent = display
  priceEl.style.color = price > 0 ? '#3fb950' : '#f85149'
  document.getElementById('tradeQty').value = 100
  document.getElementById('stockResult').style.display = 'block'
}

async function executeTrade() {
  const err = document.getElementById('tradeError')
  err.style.display = 'none'
  if (!currentStockData) { err.textContent = '請先搜尋股票'; err.style.display = 'block'; return }
  const qty = parseInt(document.getElementById('tradeQty').value)
  const type = document.getElementById('tradeType').value
  if (!qty || qty < 1) { err.textContent = '請輸入有效數量'; err.style.display = 'block'; return }

  try {
    const planId = document.getElementById('tradePlan') ? document.getElementById('tradePlan').value || null : null
    const rate = await getExchangeRate(getCurrency(currentStockData.symbol))
    const hkdPrice = Math.round(currentStockData.price * rate * 100) / 100
    const tradeBody = {
      p_username: currentUser.username,
      p_symbol: currentStockData.symbol,
      p_name: currentStockData.name || '',
      p_price: hkdPrice,
      p_quantity: qty,
      p_type: type,
      p_plan_id: planId
    }
    const res = await fetch(API_BASE + '/rpc/execute_trade', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify(tradeBody)
    })
    const tradeResult = await res.text()
    if (res.ok && tradeResult === '"ok"') {
      alert(type === 'buy' ? '買入成功！' : '賣出成功！')
      document.getElementById('stockResult').style.display = 'none'
      document.getElementById('stockSearch').value = ''
      await Promise.all([loadSummary(), loadPortfolio()])
      switchTab('dashboard')
    } else {
      const msg = tradeResult.includes('insufficient') ? '資金不足' : tradeResult.includes('no_shares') ? '持股不足' : tradeResult
      err.textContent = '交易失敗: ' + msg
      err.style.display = 'block'
    }
  } catch (ex) {
    err.textContent = '錯誤: ' + ex.message
    err.style.display = 'block'
  }
}

/* ===== Quick Stocks ===== */
async function loadQuickStocks() {
  // Populate with Hong Kong popular stocks
  const stocks = [
    // \u6E2F\u80A1
    { symbol: '0005.HK', name: '\u6EDE\u8C50\u63A7\u80A1' }, { symbol: '0700.HK', name: '\u9A30\u8A0A\u63A7\u80A1' },
    { symbol: '9988.HK', name: '\u963F\u91CC\u5DF4\u5DF4' }, { symbol: '0941.HK', name: '\u4E2D\u570B\u79FB\u52D5' },
    { symbol: '1299.HK', name: '\u53CB\u90A6\u4FDD\u96AA' }, { symbol: '3690.HK', name: '\u7F8E\u5718' },
    { symbol: '1810.HK', name: '\u5C0F\u7C73\u96C6\u5718' }, { symbol: '2388.HK', name: '\u4E2D\u9280\u9999\u6E2F' },
    { symbol: '0001.HK', name: '\u9577\u548C' }, { symbol: '0011.HK', name: '\u6052\u751F\u9280\u884C' },
    // \u7F8E\u80A1
    { symbol: 'AAPL', name: 'Apple' }, { symbol: 'GOOGL', name: 'Alphabet' },
    { symbol: 'MSFT', name: 'Microsoft' }, { symbol: 'TSLA', name: 'Tesla' },
    { symbol: 'AMZN', name: 'Amazon' }, { symbol: 'NVDA', name: 'NVIDIA' },
    // A\u80A1
    { symbol: '600519', name: '\u8D35\u5DDE\u8305\u53F0' },
    { symbol: '600036', name: '\u62DB\u5546\u94F6\u884C' },
    { symbol: '601318', name: '\u4E2D\u56FD\u5E73\u5B89' },
    { symbol: '000858', name: '\u4E94\u7CAE\u6DB2' },
    { symbol: '000333', name: '\u7F8E\u7684\u96C6\u56E2' },
    { symbol: '300750', name: '\u5B81\u5FB7\u65F6\u4EE3' },
    { symbol: '000002', name: '\u4E07\u79D1A' },
    { symbol: '600900', name: '\u957F\u6C5F\u7535\u529B' },
    { symbol: '601398', name: '\u5DE5\u5546\u94F6\u884C' },
    { symbol: '000001', name: '\u5E73\u5B89\u94F6\u884C' },
    { symbol: '002415', name: '\u6D77\u5EB7\u5A01\u89C6' },
    { symbol: '300760', name: '\u8302\u6E90\u533B\u7597' },
  ]
  const sel = document.getElementById('quickStock')
  sel.innerHTML = stocks.map(s => `<option value="${s.symbol}|${s.name}">${s.symbol} - ${s.name}</option>`).join('')
}

async function onQuickStockChange() {
  const val = document.getElementById('quickStock').value
  const priceEl = document.getElementById('quickPrice')
  if (!val) { priceEl.style.display = 'none'; return }
  const symbol = val.split('|')[0]
  priceEl.textContent = '\u23F3'
  priceEl.style.display = 'inline-block'
  try {
    const real = await getRealPrice(symbol)
    if (real && real.price > 0) {
      const cur = getCurrency(symbol)
      let display = cur + ' ' + fmt(real.price)
      if (cur !== 'HKD') {
        const rate = ratesCache.rates ? ratesCache.rates[cur] : null
        if (rate) display += ' (\u2248 HKD ' + fmt(Math.round(real.price * rate * 100) / 100) + ')'
      }
      priceEl.textContent = display
      priceEl.style.color = '#3fb950'
    } else {
      priceEl.textContent = 'N/A'
      priceEl.style.color = '#8b949e'
    }
  } catch (_) {
    priceEl.textContent = 'N/A'
    priceEl.style.color = '#8b949e'
  }
}

async function quickTrade(type, directSymbol, directName, directQty) {
  const symbol = directSymbol || document.getElementById('quickStock').value.split('|')[0] || ''
  const name = directName || document.getElementById('quickStock').value.split('|')[1] || ''
  const qty = directQty || parseInt(document.getElementById('quickQty').value)
  if (!qty || qty < 1) { alert('請輸入有效數量'); return }
  if (!symbol) { alert('請選擇股票'); return }

  try {
    let price = 0
    const realData = await getRealPrice(symbol)
    if (realData) {
      price = realData.price
    } else {
      const res = await fetch(API_BASE + '/rpc/search_stock', {
        method: 'POST', headers: HEADERS,
        body: JSON.stringify({ p_query: symbol })
      })
      if (!res.ok) { alert('無法獲取股價'); return }
      const data = await res.json()
      if (!data || !data.length) { alert('查詢股價失敗'); return }
      price = data[0].price
    }

    // Convert to HKD
    const rate = await getExchangeRate(getCurrency(symbol))
    const hkdPrice = Math.round(price * rate * 100) / 100

    const tradeRes = await fetch(API_BASE + '/rpc/execute_trade', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({
        p_username: currentUser.username,
        p_symbol: symbol,
        p_name: name,
        p_price: hkdPrice,
        p_quantity: qty,
        p_type: type,
        p_plan_id: document.getElementById('tradePlan') ? document.getElementById('tradePlan').value || null : null
      })
    })
    const tradeTxt = await tradeRes.text()
    if (tradeRes.ok && tradeTxt === '"ok"') {
      alert(type === 'buy' ? '買入成功！' : '賣出成功！')
      await Promise.all([loadSummary(), loadPortfolio()])
      switchTab('dashboard')
    } else {
      alert('交易失敗: ' + (tradeTxt.includes('insufficient') ? '資金不足' : tradeTxt.includes('no_shares') ? '持股不足' : tradeTxt))
    }
  } catch (ex) {
    alert('錯誤: ' + ex.message)
  }
}

/* ===== Portfolio Detail ===== */
function renderPortfolio() {
  renderPortfolioFilter()
  const tbody = document.getElementById('portfolioDetail')
  let items = portfolioCache
  // Filter by plan
  if (currentPlanFilter !== null) {
    if (currentPlanFilter === 0) items = items.filter(function(p) { return !p.plan_id })
    else items = items.filter(function(p) { return p.plan_id === currentPlanFilter })
  }
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#8b949e;padding:2rem;">暫無持倉</td></tr>'
    return
  }
  const planNames = {}
  plans.forEach(function(p) { planNames[p.id] = p.plan_name })
  tbody.innerHTML = items.map(function(p) {
    const pnl = (p.market_price || 0) - (p.avg_cost || 0)
    const mv = (p.market_price || 0) * p.quantity
    const totalPnl = pnl * p.quantity
    const cur = getCurrency(p.symbol)
    return '<tr>'
      + '<td><strong>' + esc(p.symbol) + '</strong></td>'
      + '<td>' + esc(p.name || '') + '</td>'
      + '<td style="color:#8b949e;font-size:0.85rem;">' + (p.plan_id ? esc(planNames[p.plan_id] || '組合#' + p.plan_id) : '<span style="color:#484f58;">不指定</span>') + '</td>'
      + '<td>' + p.quantity + '</td>'
      + '<td>' + cur + ' ' + fmt(p.avg_cost) + '</td>'
      + '<td class="' + (pnl >= 0 ? 'green' : 'red') + '">' + cur + ' ' + fmt(p.market_price) + '</td>'
      + '<td>' + cur + ' ' + fmt(mv) + '</td>'
      + '<td class="' + (totalPnl >= 0 ? 'green' : 'red') + '">' + (totalPnl >= 0 ? '+' : '') + cur + ' ' + fmt(totalPnl) + '</td>'
      + '<td><button onclick="quickSell(\'' + p.symbol + '\',\'' + esc(p.name) + '\',' + p.quantity + ')" style="padding:0.3rem 0.8rem;background:#da3633;border:none;color:#fff;border-radius:6px;cursor:pointer;">賣出</button></td>'
      + '</tr>'
  }).join('')
}

function renderPortfolioFilter() {
  const el = document.getElementById('planPortfolioFilter')
  if (!el) return
  let html = '<button onclick="setPlanFilter(null)" style="padding:0.3rem 0.8rem;border-radius:6px;cursor:pointer;border:1px solid #30363d;background:' + (currentPlanFilter === null ? '#238636' : '#21262d') + ';color:#c9d1d9;font-size:0.85rem;">全部</button>'
  html += '<button onclick="setPlanFilter(0)" style="padding:0.3rem 0.8rem;border-radius:6px;cursor:pointer;border:1px solid #30363d;background:' + (currentPlanFilter === 0 ? '#238636' : '#21262d') + ';color:#c9d1d9;font-size:0.85rem;">不指定</button>'
  plans.forEach(function(p) {
    html += '<button onclick="setPlanFilter(' + p.id + ')" style="padding:0.3rem 0.8rem;border-radius:6px;cursor:pointer;border:1px solid #30363d;background:' + (currentPlanFilter === p.id ? '#238636' : '#21262d') + ';color:#c9d1d9;font-size:0.85rem;">' + esc(p.plan_name) + '</button>'
  })
  el.innerHTML = html
}

function setPlanFilter(planId) {
  currentPlanFilter = planId
  renderPortfolio()
}

function quickSell(symbol, name, maxQty) {
  const qty = prompt(`賣出 ${symbol} (${name})\n最大可賣: ${maxQty} 股\n請輸入賣出數量:`, Math.min(maxQty, 100))
  if (!qty) return
  quickTrade('sell', symbol, name, parseInt(qty))
}

/* ===== History ===== */
async function loadHistory() {
  const search = document.getElementById('historySearch').value.trim()
  try {
    const res = await fetch(API_BASE + '/rpc/get_trader_history', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ p_username: currentUser.username, p_search: search || null })
    })
    const data = (res.ok ? (await res.json() || []) : [])
    const tbody = document.getElementById('historyTable')
    const planNames = {}
    plans.forEach(function(p) { planNames[p.id] = p.plan_name })
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#8b949e;padding:2rem;">暫無交易紀錄</td></tr>'
      return
    }
    tbody.innerHTML = data.map(function(t) {
      const isBuy = t.type === 'buy'
      return '<tr>'
        + '<td style="white-space:nowrap;font-size:0.85rem;">' + new Date(t.created_at).toLocaleString('zh-HK') + '</td>'
        + '<td><strong>' + esc(t.symbol) + '</strong></td>'
        + '<td>' + esc(t.name || '') + '</td>'
        + '<td class="' + (isBuy ? 'green' : 'red') + '">' + (isBuy ? '買入' : '賣出') + '</td>'
        + '<td>' + t.quantity + '</td>'
        + '<td>' + fmtPrice(t.symbol, t.price) + '</td>'
        + '<td class="' + (isBuy ? 'red' : 'green') + '">' + (isBuy ? '-' : '+') + fmtPrice(t.symbol, t.price * t.quantity) + '</td>'
        + '<td style="color:#8b949e;font-size:0.85rem;">' + (t.plan_id ? esc(planNames[t.plan_id] || '組合#' + t.plan_id) : '<span style="color:#484f58;">不指定</span>') + '</td>'
        + '</tr>'
    }).join('')
  } catch (_) {}
}

/* ===== Helpers ===== */
function fmt(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function getCurrency(sym) {
  if (sym && sym.endsWith('.HK')) return 'HKD'
  if (sym && /^[A-Z]+$/.test(sym)) return 'USD'
  return 'CNY'
}
function fmtPrice(sym, val) { return getCurrency(sym) + ' ' + fmt(val) }
const CUR_HKD = 'HKD'
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }

/* ===== Hot Sectors ===== */
let sectorData = { industries: [], concepts: [] }
let sectorTab = 'industry'

async function loadHotSectors(silent) {
  const el = document.getElementById('sectorList')
  if (!el) return
  if (!silent) el.innerHTML = '<div class="sector-loading">載入中...</div>'
  try {
    const res = await fetch('https://fuuwjceawowojecaqfru.supabase.co/functions/v1/get_hot_sectors', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: '{}'
    })
    const txt = await res.text()
    if (res.ok) {
      let data = JSON.parse(txt)
      sectorData.industries = data.industries || []
      sectorData.concepts = data.concepts || []
    } else {
      if (!silent) sectorData = { industries: [], concepts: [] }
    }
  } catch (_) {
    if (!silent) sectorData = { industries: [], concepts: [] }
  }
  renderSectors()
}

function renderSectors() {
  const el = document.getElementById('sectorList')
  if (!el) return
  const items = sectorTab === 'industry' ? sectorData.industries : sectorData.concepts
  if (!items || !items.length) {
    el.innerHTML = '<div class="sector-loading">暫無數據</div>'
    return
  }
  el.innerHTML = items.map(function(sec, i) {
    const stocksHtml = sec.stocks && sec.stocks.length
      ? '<div class="sector-stocks" id="sstocks' + i + '">' + sec.stocks.map(function(stk) {
          return '<div class="sector-stock"><span>' + esc(stk.name) + '</span><span class="' + (stk.changePct >= 0 ? 'green' : 'red') + '">' + (stk.changePct >= 0 ? '+' : '') + stk.changePct + '%</span></div>'
        }).join('') + '</div>'
      : ''
    return '<div class="sector-item" onclick="toggleSectorStocks(' + i + ')">'
      + '<span><span class="sector-name">' + esc(sec.name) + '</span>' + stocksHtml + '</span>'
      + '<span class="sector-change ' + (sec.changePct >= 0 ? 'green' : 'red') + '">' + (sec.changePct >= 0 ? '+' : '') + sec.changePct + '%</span>'
      + '</div>'
  }).join('')
  document.getElementById('tabIndustry').className = 'tab-btn' + (sectorTab === 'industry' ? ' active' : '')
  document.getElementById('tabConcept').className = 'tab-btn' + (sectorTab === 'concept' ? ' active' : '')
}

function toggleSectorStocks(i) {
  const el = document.getElementById('sstocks' + i)
  if (el) el.classList.toggle('open')
}

function switchSectorTab(tab) {
  sectorTab = tab
  renderSectors()
}

/* ===== Index Chart ===== */
let indexLoaded = false
let indexData = []
let indexType = 'intraday'
let indexName = 'sh'

function switchTimeframe(tf) {
  document.querySelectorAll('.tf-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.tf === tf) })
  indexType = tf
  loadIndexChart()
}

async function loadIndexChart() {
  indexName = document.getElementById('indexSelect').value
  document.getElementById('indexLoading').textContent = '載入中...'
  try {
    const res = await fetch('https://fuuwjceawowojecaqfru.supabase.co/functions/v1/get_index_data', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: indexName, type: indexType }),
      signal: AbortSignal.timeout(10000)
    })
    if (!res.ok) { document.getElementById('indexLoading').textContent = '載入失敗'; return }
    const data = await res.json()
    if (!data || !data.data) { document.getElementById('indexLoading').textContent = '暫無數據'; return }
    if (indexType === 'intraday') {
      parseIntradayData(data.data)
    } else {
      parseKlineData(data.data)
    }
    drawIndexChart()
    document.getElementById('indexLoading').textContent = indexData.length + ' 條數據'
  } catch (_) {
    document.getElementById('indexLoading').textContent = '載入失敗'
  }
}

function parseIntradayData(d) {
  indexData = []
  const trends = d.trends || []
  for (let i = 0; i < trends.length; i++) {
    const parts = trends[i].split(',')
    if (parts.length < 4) continue
    const raw = parts[0].trim()
    // Extract HHMM from various formats (HHMM, YYYYMMDDHHMM, etc.)
    const hhmm = raw.replace(/\D/g, '').slice(-4)
    if (hhmm.length !== 4) continue
    const p = parseFloat(parts[1])
    if (isNaN(p)) continue
    indexData.push({ time: hhmm, price: p, volume: parseFloat(parts[2]) || 0 })
  }
  // Update info from first (open) and last (current) price
  if (indexData.length) {
    const first = indexData[0].price
    const last = indexData[indexData.length - 1].price
    const change = last - first
    const pct = first ? (change / first * 100) : 0
    updateIndexInfo(last, change, pct, first, 0, 0)
  }
}

function intradayMinuteFromHHMM(hhmm) {
  const h = parseInt(hhmm.substring(0, 2), 10)
  const m = parseInt(hhmm.substring(2, 4), 10)
  const total = h * 60 + m
  if (total >= 570 && total <= 690) return total - 570        // 9:30-11:30
  if (total >= 780 && total <= 900) return total - 570 - 90   // 13:00-15:00
  return -1
}

function minutesToTimeStr(min) {
  const total = min + 570
  const h = Math.floor(total / 60)
  const m = total % 60
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m
}

function parseKlineData(d) {
  indexData = []
  const klines = d.klines || []
  for (let i = 0; i < klines.length; i++) {
    const parts = klines[i].split(',')
    if (parts.length < 6) continue
    indexData.push({
      time: parts[0].trim(),
      open: parseFloat(parts[1]),
      close: parseFloat(parts[2]),
      high: parseFloat(parts[3]),
      low: parseFloat(parts[4]),
      volume: parseFloat(parts[5]) || 0
    })
  }
  // Update info from last bar
  if (indexData.length) {
    const last = indexData[indexData.length - 1]
    const prev = indexData.length > 1 ? indexData[indexData.length - 2] : last
    const change = last.close - prev.close
    const pct = prev.close ? (change / prev.close * 100) : 0
    updateIndexInfo(last.close, change, pct, last.open, last.high, last.low)
  }
}

function updateIndexInfo(latest, change, pct, open, high, low) {
  document.getElementById('ciLatest').textContent = latest.toFixed(2)
  const changeEl = document.getElementById('ciChange')
  changeEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(2)
  changeEl.className = 'ci-value ' + (change >= 0 ? 'green' : 'red')
  const pctEl = document.getElementById('ciChangePct')
  pctEl.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'
  pctEl.className = 'ci-value ' + (pct >= 0 ? 'green' : 'red')
  if (open !== undefined) document.getElementById('ciOpen').textContent = open.toFixed(2)
  if (high !== undefined) document.getElementById('ciHigh').textContent = high.toFixed(2)
  if (low !== undefined) document.getElementById('ciLow').textContent = low.toFixed(2)
}

function drawIndexChart() {
  indexLoaded = true
  const canvas = document.getElementById('indexChart')
  if (!canvas || !indexData.length) return
  const ctx = canvas.getContext('2d')
  const rect = canvas.parentElement.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  canvas.style.width = rect.width + 'px'
  canvas.style.height = rect.height + 'px'
  ctx.scale(dpr, dpr)
  const W = rect.width
  const H = rect.height
  const pad = { top: 20, bottom: 28, left: 60, right: 60 }
  const cw = W - pad.left - pad.right
  const ch = H - pad.top - pad.bottom

  ctx.clearRect(0, 0, W, H)

  if (indexType === 'intraday') {
    drawLineChart(ctx, W, H, pad, cw, ch)
  } else {
    drawCandlestickChart(ctx, W, H, pad, cw, ch)
  }
}

function drawLineChart(ctx, W, H, pad, cw, ch) {
  const openPrice = indexData.length > 0 ? indexData[0].price : 0
  if (!openPrice) return

  // Calculate percentage changes and find range
  const pcts = indexData.map(function(d) { return (d.price - openPrice) / openPrice * 100 })
  let minPct = Math.min.apply(null, pcts)
  let maxPct = Math.max.apply(null, pcts)
  // Symmetric around 0, at least ±0.5%
  const absMax = Math.max(Math.abs(minPct), Math.abs(maxPct), 0.5)
  minPct = -Math.ceil(absMax * 2) / 2
  maxPct = Math.ceil(absMax * 2) / 2
  const pctRange = maxPct - minPct || 1
  const isUp = pcts.length > 1 && pcts[pcts.length - 1] >= 0

  // Define time labels: 9:30, 10:30, 11:30, 13:00, 14:00, 15:00
  const timeLabels = [570, 630, 690, 780, 840, 900] // minutes from midnight
  const labelTexts = ['09:30', '10:30', '11:30', '13:00', '14:00', '15:00']

  // Grid lines every 1%
  ctx.strokeStyle = '#21262d'
  ctx.lineWidth = 1
  for (let pct = Math.ceil(minPct); pct <= Math.floor(maxPct); pct++) {
    const y = pad.top + ch - ((pct - minPct) / pctRange) * ch
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke()
  }
  // Bold 0% line
  const yZero = pad.top + ch - ((0 - minPct) / pctRange) * ch
  ctx.strokeStyle = '#484f58'
  ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(pad.left, yZero); ctx.lineTo(W - pad.right, yZero); ctx.stroke()

  // Draw price line (only up to current time)
  ctx.strokeStyle = isUp ? '#3fb950' : '#f85149'
  ctx.lineWidth = 1.8
  ctx.beginPath()
  let started = false
  for (let i = 0; i < indexData.length; i++) {
    const d = indexData[i]
    const tmin = intradayMinuteFromHHMM(d.time)
    if (tmin < 0) continue
    const x = pad.left + (tmin / 240) * cw
    const y = pad.top + ch - ((pcts[i] - minPct) / pctRange) * ch
    if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // Fill under line
  if (started) {
    const lastD = indexData[indexData.length - 1]
    const lastMin = intradayMinuteFromHHMM(lastD.time)
    if (lastMin >= 0) {
      const lastX = pad.left + (lastMin / 240) * cw
      const lastY = pad.top + ch - ((pcts[pcts.length - 1] - minPct) / pctRange) * ch
      ctx.lineTo(lastX, pad.top + ch)
      ctx.lineTo(pad.left, pad.top + ch)
      ctx.closePath()
      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch)
      grad.addColorStop(0, isUp ? 'rgba(63,185,80,0.25)' : 'rgba(248,81,73,0.25)')
      grad.addColorStop(1, isUp ? 'rgba(63,185,80,0.02)' : 'rgba(248,81,73,0.02)')
      ctx.fillStyle = grad
      ctx.fill()
    }
  }

  // --- Left Y-axis: percentage ---
  ctx.fillStyle = '#8b949e'
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'right'
  for (let pct = Math.ceil(minPct); pct <= Math.floor(maxPct); pct++) {
    const y = pad.top + ch - ((pct - minPct) / pctRange) * ch
    ctx.fillText((pct > 0 ? '+' : '') + pct.toFixed(0) + '%', pad.left - 6, y + 4)
  }

  // --- Right Y-axis: index values ---
  ctx.textAlign = 'left'
  for (let pct = Math.ceil(minPct); pct <= Math.floor(maxPct); pct++) {
    const val = openPrice * (1 + pct / 100)
    const y = pad.top + ch - ((pct - minPct) / pctRange) * ch
    ctx.fillText(val.toFixed(2), W - pad.right + 6, y + 4)
  }

  // --- X-axis: time labels ---
  ctx.fillStyle = '#8b949e'
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'
  for (let i = 0; i < timeLabels.length; i++) {
    const tmin = timeLabels[i] - 570
    if (tmin < 0 || tmin > 240) continue
    const x = pad.left + (tmin / 240) * cw
    ctx.fillText(labelTexts[i], x, H - 6)
  }

  // Vertical line at noon break
  if (timeLabels[2] && timeLabels[3]) {
    const xNoon = pad.left + (120 / 240) * cw
    ctx.strokeStyle = '#30363d'
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.beginPath(); ctx.moveTo(xNoon, pad.top); ctx.lineTo(xNoon, pad.top + ch); ctx.stroke()
    ctx.setLineDash([])
  }

  // --- Last price label (right side, floating) ---
  const lastPct = pcts[pcts.length - 1]
  const ly = pad.top + ch - ((lastPct - minPct) / pctRange) * ch
  const lastVal = indexData[indexData.length - 1].price
  ctx.fillStyle = isUp ? '#3fb950' : '#f85149'
  ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'left'
  const label = lastVal.toFixed(2) + '  ' + (lastPct >= 0 ? '+' : '') + lastPct.toFixed(2) + '%'
  // Label background
  const tm = ctx.measureText(label)
  const lx2 = W - pad.right + 6
  ctx.fillStyle = 'rgba(13,17,23,0.7)'
  ctx.fillRect(lx2 - 2, ly - 8, tm.width + 4, 18)
  ctx.fillStyle = isUp ? '#3fb950' : '#f85149'
  ctx.fillText(label, lx2, ly + 4)
}

function drawCandlestickChart(ctx, W, H, pad, cw, ch) {
  // Calculate price range
  let minP = Infinity, maxP = -Infinity
  indexData.forEach(function(d) {
    if (d.low < minP) minP = d.low
    if (d.high > maxP) maxP = d.high
  })
  const range = maxP - minP || 1
  const ext = range * 0.05
  const yMin = minP - ext
  const yMax = maxP + ext
  const yRange = yMax - yMin || 1

  // Grid lines
  ctx.strokeStyle = '#21262d'
  ctx.lineWidth = 1
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (ch / 5) * i
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke()
    const val = yMax - (yRange / 5) * i
    ctx.fillStyle = '#8b949e'
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(val.toFixed(0), pad.left - 6, y + 4)
  }

  // Candlesticks
  const n = indexData.length
  const candleW = Math.max(2, cw / n - 1.5)
  const barW = Math.max(1, candleW * 0.35)

  for (let i = 0; i < n; i++) {
    const d = indexData[i]
    const x = pad.left + (cw / n) * i + (cw / n - candleW) / 2
    const isUp = d.close >= d.open
    const color = isUp ? '#3fb950' : '#f85149'

    // High-low line
    const yHigh = pad.top + ch - ((d.high - yMin) / yRange) * ch
    const yLow = pad.top + ch - ((d.low - yMin) / yRange) * ch
    const yOpen = pad.top + ch - ((d.open - yMin) / yRange) * ch
    const yClose = pad.top + ch - ((d.close - yMin) / yRange) * ch

    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x + candleW / 2, yHigh); ctx.lineTo(x + candleW / 2, yLow); ctx.stroke()

    // Body
    ctx.fillStyle = color
    const bodyTop = Math.min(yOpen, yClose)
    const bodyH = Math.max(1, Math.abs(yClose - yOpen))
    ctx.fillRect(x + (candleW - barW) / 2, bodyTop, barW, bodyH)
  }

  // Volume bars at bottom
  const volH = 40
  const volBaseY = pad.top + ch + 2
  let maxVol = 0
  indexData.forEach(function(d) { if (d.volume > maxVol) maxVol = d.volume })
  if (maxVol > 0) {
    for (let i = 0; i < n; i++) {
      const d = indexData[i]
      const x = pad.left + (cw / n) * i + (cw / n - candleW) / 2
      const vh = (d.volume / maxVol) * volH
      const isUp = d.close >= d.open
      ctx.fillStyle = isUp ? 'rgba(63,185,80,0.4)' : 'rgba(248,81,73,0.4)'
      ctx.fillRect(x + (candleW - barW) / 2, volBaseY + volH - vh, barW, vh)
    }
  }
}

/* ===== Real Stock Price (Tencent Finance API) ===== */
function symbolToTencentCode(sym) {
  if (sym.endsWith('.HK')) {
    const num = sym.replace('.HK', '')
    return 'hk' + num.padStart(5, '0')
  }
  if (/^[A-Z]+$/.test(sym)) return 'us' + sym
  if (/^6\d{5}$/.test(sym)) return 'sh' + sym
  if (/^[03]\d{5}$/.test(sym)) return 'sz' + sym
  return sym
}

async function fetchRealPrices(symbols) {
  if (!symbols || !symbols.length) return {}
  const codeToSymbol = {}
  const codes = symbols.map(function(s) {
    const c = symbolToTencentCode(s)
    if (c) codeToSymbol[c] = s
    return c
  }).filter(Boolean)
  if (!codes.length) return {}
  try {
    const res = await fetch('https://web.sqt.gtimg.cn/q=' + codes.join(','), { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return {}
    const buffer = await res.arrayBuffer()
    const text = new TextDecoder('gbk').decode(buffer)
    const result = {}
    text.split('\n').forEach(function(line) {
      line = line.trim()
      if (!line) return
      const m = line.match(/^v_([^=]+)="(.+)";?$/)
      if (!m) return
      const tencentCode = m[1]
      const parts = m[2].split('~')
      if (parts.length < 5) return
      const price = parseFloat(parts[3])
      if (isNaN(price)) return
      const origSymbol = codeToSymbol[tencentCode] || parts[2]
      result[origSymbol] = { price: price, name: parts[1] || '', open: parseFloat(parts[5]) || 0, high: parseFloat(parts[9]) || 0, low: parseFloat(parts[10]) || 0, volume: parts[6] || '0' }
    })
    return result
  } catch (_) { return {} }
}

async function fetchPricesFallback(symbols) {
  if (!symbols || !symbols.length) return {}
  try {
    const res = await fetch('https://fuuwjceawowojecaqfru.supabase.co/functions/v1/get_stock_prices', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: symbols }),
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return {}
    return await res.json()
  } catch (_) { return {} }
}

async function getExchangeRate(targetCurrency) {
  if (targetCurrency === 'HKD' || !targetCurrency) return 1
  const now = Date.now()
  if (ratesCache.rates && (now - ratesCache.ts) < RATES_TTL) {
    return ratesCache.rates[targetCurrency] || 1
  }
  try {
    const res = await fetch('https://fuuwjceawowojecaqfru.supabase.co/functions/v1/get_rates', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(5000)
    })
    if (res.ok) {
      ratesCache.rates = await res.json()
      ratesCache.ts = now
      return ratesCache.rates[targetCurrency] || 1
    }
  } catch (_) {}
  // Fallback hardcoded
  const fb = { USD: 7.8, CNY: 1.1 }
  ratesCache.rates = fb
  ratesCache.ts = now
  return fb[targetCurrency] || 1
}

async function getRealPrice(symbol) {
  const map = await fetchRealPrices([symbol])
  if (map[symbol]) return map[symbol]
  const fallback = await fetchPricesFallback([symbol])
  return fallback[symbol] || null
}

async function getRealPricesMulti(symbols) {
  const map = await fetchRealPrices(symbols)
  const missing = symbols.filter(function(s) { return !map[s] })
  if (missing.length) {
    const fallback = await fetchPricesFallback(missing)
    Object.assign(map, fallback)
  }
  return map
}

/* ===== Plan Management ===== */
async function loadPlans() {
  try {
    const res = await fetch(API_BASE + '/rpc/get_plans', { method:'POST', headers:HEADERS, body:JSON.stringify({ p_username: currentUser.username }) })
    const txt = await res.text()
    plans = (res.ok ? (JSON.parse(txt) || []) : [])
    renderPlanSelector()
  } catch(_) { plans = [] }
}

function renderPlanSelector() {
  const sel = document.getElementById('tradePlan')
  if (!sel) return
  sel.innerHTML = '<option value="">不指定組合</option>' + plans.map(function(p) { return '<option value="' + p.id + '">' + esc(p.plan_name) + '</option>' }).join('')
}

async function renderPlans() {
  const el = document.getElementById('plansList')
  if (!plans.length) { el.innerHTML = '<div class="empty-state" style="text-align:center;color:#8b949e;padding:2rem;">暫無投資組合，點擊右上角新建</div>'; return }
  let html = '<div class="card-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;">'
  for (const p of plans) {
    const stocksRes = await fetch(API_BASE + '/rpc/get_plan_stocks', { method:'POST', headers:HEADERS, body:JSON.stringify({ p_plan_id: p.id }) })
    const stocks = (stocksRes.ok ? (await stocksRes.json() || []) : [])
    html += '<div class="card" style="background:#161b22;border:1px solid #30363d;border-radius:10px;padding:1.2rem;cursor:pointer;" onclick="showPlanDetail(' + p.id + ')">'
    html += '<h3 style="color:#f0f6fc;margin-bottom:0.3rem;">' + esc(p.plan_name) + '</h3>'
    if (p.strategy) html += '<p style="color:#8b949e;font-size:0.85rem;margin-bottom:0.5rem;">' + esc(p.strategy) + '</p>'
    html += '<div style="color:#8b949e;font-size:0.8rem;">📅 ' + new Date(p.created_at).toLocaleDateString('zh-HK') + '</div>'
    html += '<div style="margin-top:0.5rem;font-size:0.85rem;color:#c9d1d9;">成分股: ' + (stocks.length ? stocks.map(function(s) { return s.symbol }).join(', ') : '<span style="color:#8b949e;">暫無</span>') + '</div>'
    html += '</div>'
  }
  html += '</div>'
  el.innerHTML = html
}

function showCreatePlan() {
  const name = prompt('請輸入組合名稱:', '')
  if (!name) return
  const strategy = prompt('請輸入投資策略（可選）:', '')
  createPlan(name, strategy || null)
}

async function createPlan(name, strategy) {
  const res = await fetch(API_BASE + '/rpc/create_plan', { method:'POST', headers:HEADERS, body:JSON.stringify({ p_username: currentUser.username, p_plan_name: name, p_strategy: strategy }) })
  const txt = await res.text()
  let data = []
  try { data = JSON.parse(txt) } catch(_) {}
  if (res.ok && data && data.length) { await loadPlans(); renderPlans() }
  else alert('創建失敗: ' + (txt || '未知錯誤'))
}

async function showPlanDetail(planId) {
  editingPlanId = planId
  const p = plans.find(function(p) { return p.id === planId })
  if (!p) return
  const stocksRes = await fetch(API_BASE + '/rpc/get_plan_stocks', { method:'POST', headers:HEADERS, body:JSON.stringify({ p_plan_id: planId }) })
  const stocks = (stocksRes.ok ? (await stocksRes.json() || []) : [])
  let html = '<div class="card" style="background:#161b22;border:1px solid #30363d;border-radius:10px;padding:1.5rem;">'
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;"><h3 style="color:#f0f6fc;">' + esc(p.plan_name) + '</h3><button onclick="document.getElementById(\'planDetail\').style.display=\'none\';editingPlanId=null" style="padding:0.3rem 0.8rem;background:#21262d;border:1px solid #30363d;color:#c9d1d9;border-radius:6px;cursor:pointer;">關閉</button></div>'
  if (p.strategy) html += '<p style="color:#8b949e;font-size:0.9rem;margin-bottom:1rem;">策略: ' + esc(p.strategy) + '</p>'
  html += '<h4 style="color:#c9d1d9;margin-bottom:0.5rem;">成分股</h4>'
  if (stocks.length) {
    html += '<div class="table-wrap" style="margin-bottom:1rem;"><table><thead><tr><th>代碼</th><th>名稱</th><th>操作</th></tr></thead><tbody>'
    stocks.forEach(function(s) {
      html += '<tr><td>' + esc(s.symbol) + '</td><td>' + esc(s.name || '') + '</td><td><button onclick="removePlanStock(' + planId + ',\'' + s.symbol + '\')" style="padding:0.2rem 0.6rem;background:#da3633;border:none;color:#fff;border-radius:4px;cursor:pointer;font-size:0.8rem;">移除</button></td></tr>'
    })
    html += '</tbody></table></div>'
  } else {
    html += '<p style="color:#8b949e;font-size:0.85rem;margin-bottom:1rem;">暫無成分股</p>'
  }
  html += '<div style="display:flex;gap:0.5rem;"><input type="text" id="addStockSymbol" placeholder="輸入股票代碼搜尋" style="flex:1;padding:0.5rem 0.8rem;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#c9d1d9;font-size:0.9rem;outline:none;" onkeydown="if(event.key===\'Enter\')addPlanStock(' + planId + ')"><button onclick="addPlanStock(' + planId + ')" style="padding:0.5rem 1rem;background:#238636;border:none;color:#fff;border-radius:8px;cursor:pointer;">加入</button></div>'
  html += '<div class="error" id="addStockError" style="color:#f85149;font-size:0.85rem;margin-top:0.3rem;display:none;"></div>'
  html += '</div>'
  document.getElementById('planDetail').innerHTML = html
  document.getElementById('planDetail').style.display = 'block'
  document.getElementById('plansList').scrollIntoView({ behavior: 'smooth' })
}

async function addPlanStock(planId) {
  const q = document.getElementById('addStockSymbol').value.trim()
  const err = document.getElementById('addStockError')
  err.style.display = 'none'
  if (!q) return
  const real = await getRealPrice(q.toUpperCase())
  if (real) {
    await fetch(API_BASE + '/rpc/add_plan_stock', { method:'POST', headers:HEADERS, body:JSON.stringify({ p_plan_id: planId, p_symbol: q.toUpperCase(), p_name: real.name }) })
    showPlanDetail(planId)
    return
  }
  const res = await fetch(API_BASE + '/rpc/search_stock', { method:'POST', headers:HEADERS, body:JSON.stringify({ p_query: q }) })
  if (res.ok) {
    const data = await res.json()
    if (data && data.length) {
      await fetch(API_BASE + '/rpc/add_plan_stock', { method:'POST', headers:HEADERS, body:JSON.stringify({ p_plan_id: planId, p_symbol: data[0].symbol, p_name: data[0].name }) })
      showPlanDetail(planId)
      return
    }
  }
  err.textContent = '找不到該股票'
  err.style.display = 'block'
}

async function removePlanStock(planId, symbol) {
  await fetch(API_BASE + '/rpc/remove_plan_stock', { method:'POST', headers:HEADERS, body:JSON.stringify({ p_plan_id: planId, p_symbol: symbol }) })
  showPlanDetail(planId)
}

async function getPlansMap() {
  const m = {}
  plans.forEach(function(p) { m[p.id] = p.plan_name })
  return m
}

/* ===== Session Restore ===== */
;(function() {
  try {
    const s = localStorage.getItem('trader_session')
    if (s) { const d = JSON.parse(s); if (d && d.username) { currentUser = d; onLoginSuccess() } }
  } catch(_) { localStorage.removeItem('trader_session') }
})()
