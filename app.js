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
    name === 'dashboard' ? '儀表板' : name === 'trade' ? '交易' : name === 'portfolio' ? '持倉' : name === 'plans' ? '投資組合' : name === 'index' ? '大盤走勢' : name === 'strategies' ? '量化策略' : '交易紀錄'
  ))
  if (btn) btn.classList.add('active')
  document.getElementById('sec' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active')
  if (name === 'portfolio') renderPortfolio()
  if (name === 'plans') renderPlans()
  if (name === 'history') loadHistory()
  if (name === 'index') { if (!indexLoaded) loadIndexChart(); else drawIndexChart() }
  if (name === 'strategies') renderStrategies()
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

/* ===== Quant Strategies ===== */
const STRATEGIES = [
  // ── 一、基础技术择时策略 ──
  { id:'s1', cat:'technique', name:'均线趋势跟踪', sub:'单标的波段', desc:'双均线/单均线突破、多均线排列、EMA趋势跟踪。金叉买入死叉卖出，内置完整回测代码', prompt:
'实现一个均线趋势跟踪策略：\n1. 可选双均线（快线5日/10日+慢线20日/30日/60日），金叉买入、死叉卖出\n2. 可选单均线（如20日均线）：上穿买入、下穿卖出\n3. 可选EMA替代SMA，EMA对近期价格更敏感\n4. 多均线排列：短>中>长为多头排列（买入信号），短<中<长为空头排列（卖出信号）\n5. 参数可调：快线周期N1、慢线周期N2、是否用EMA、止损比例\n6. 内置回测：计算累计收益率、年化收益、最大回撤、夏普比率、胜率\n7. 画图：显示价格曲线+均线+买卖信号标记' },
  { id:'s2', cat:'technique', name:'震荡均值回归（RSI）', sub:'单标的波段', desc:'RSI超买超卖反转，高抛低吸震荡行情专用', prompt:
'实现RSI均值回归策略：\n1. 计算RSI（默认14日）：RSI=100-100/(1+平均涨幅/平均跌幅)\n2. 超卖区（默认RSI<30）买入，超买区（默认RSI>70）卖出\n3. 可选加入背离检测：价格创新低但RSI底部抬升=底背离（买入信号）\n4. 参数：RSI周期N、超卖阈值、超买阈值、持仓天数上限\n5. 过滤：只在震荡行情中启用（可用ATR或布林带宽度判断）\n6. 回测指标：累计收益、胜率、盈亏比、最大回撤' },
  { id:'s3', cat:'technique', name:'震荡均值回归（布林带）', sub:'单标的波段', desc:'布林带通道高抛低吸，触碰上下轨反向交易', prompt:
'实现布林带均值回归策略：\n1. 计算布林带：中轨=SMA(20)，上轨=中轨+K*标准差，下轨=中轨-K*标准差\n2. 默认K=2，周期=20\n3. 价格触碰/跌破下轨买入，触碰/突破上轨卖出\n4. 可选：喇叭口扩张（波动率放大）时暂停交易，收紧时恢复\n5. 可选：配合RSI/KDJ过滤假突破\n6. 参数：周期、标准差倍数K、是否使用EMA中轨\n7. 回测：收益率曲线、交易记录、胜率' },
  { id:'s4', cat:'technique', name:'震荡均值回归（KDJ）', sub:'单标的波段', desc:'KDJ随机指标超买超卖，短线震荡高抛低吸', prompt:
'实现KDJ均值回归策略：\n1. 计算KDJ：K值、D值（K的均线）、J值（3K-2D）\n2. K值<20超卖（买入信号），K值>80超买（卖出信号）\n3. K线上穿D线（金叉）买入，K线下穿D线（死叉）卖出\n4. 参数：RSV天数（默认9）、K平滑（默认3）、D平滑（默认3）\n5. 可选日线/周线/月线多周期共振\n6. 回测：胜率、盈亏比、最大连续亏损' },
  { id:'s5', cat:'technique', name:'震荡均值回归（CCI）', sub:'单标的波段', desc:'CCI顺势指标超买超卖，判断股价与统计均值的偏离', prompt:
'实现CCI均值回归策略：\n1. 计算CCI = (TP - SMA(TP)) / (0.015 * 平均偏差)，TP=(高+低+收)/3\n2. CCI>+100超买（卖出），CCI<-100超卖（买入）\n3. CCI从+100上方回落卖出，从-100下方回升买入\n4. 参数：周期（默认14）、超买阈值（默认100）、超卖阈值（默认-100）\n5. 回测：累计收益、胜率、最大回撤' },
  { id:'s6', cat:'technique', name:'动量突破（海龟交易法则）', sub:'单标的趋势', desc:'ATR通道突破、海龟交易法则完整实现', prompt:
'实现海龟交易法则（唐奇安通道突破）：\n1. 入场：价格突破过去N日最高价（N=20）做多，突破过去N日最低价做空\n2. 加仓：每上涨0.5ATR加仓一次，最多加仓4次\n3. 止损：-2ATR硬止损，或价格跌破过去10日最低价\n4. ATR计算：真实波幅=max(当前高-当前低, |当前高-前收|, |当前低-前收|)，ATR=SMA(真实波幅, 14)\n5. 出场：价格跌破过去M日最低价（M=10）平多，突破过去M日最高价平空\n6. 参数：入场周期N、出场周期M、ATR周期、加仓步长、最大加仓次数\n7. 回测：完整资金曲线、胜率、盈亏比、夏普比率' },
  { id:'s7', cat:'technique', name:'动量突破（ATR通道）', sub:'单标的趋势', desc:'ATR自适应通道突破，根据波动率动态调整入场信号', prompt:
'实现ATR通道突破策略：\n1. 中轨=EMA(收盘价, 20)\n2. 上轨=中轨 + K*ATR(14)，下轨=中轨 - K*ATR(14)\n3. 价格突破上轨做多，跌破下轨做空\n4. K默认=2.5，可调\n5. ATR周期可调\n6. 可选：趋势过滤（价格在EMA之上只做多，之下只做空）\n7. 回测：收益率、胜率、夏普比率、最大回撤' },
  { id:'s8', cat:'technique', name:'日内回转T+0', sub:'单标的波段', desc:'可转债/ETF/融资融券日内做T，分时高低点自动做差价', prompt:
'实现日内T+0回转策略：\n1. 适用品种：可转债、ETF、融资融券标的（A股底仓做T）\n2. 开盘前参考昨日持仓作为底仓\n3. 分时低点买入、高点卖出（当天同数量反向平仓）\n4. 分时低点判断：价格跌破VWAP（成交量加权均价）-X%或RSI<30\n5. 分时高点判断：价格突破VWAP+X%或RSI>70\n6. 参数：X%（默认0.5%）、单笔最小差价收益（默认0.1%）、最大持仓时间（默认至收盘）\n7. 风控：日内敞口不超过底仓数量，收盘前强制平仓所有日内仓位\n8. 回测：统计T+0收益贡献、胜率、日均周转率' },
  { id:'s9', cat:'technique', name:'涨跌停监控', sub:'单标的特殊', desc:'实时封单量监控、开板信号自动买卖、打板/排板量化自动化', prompt:
'实现涨跌停监控策略：\n1. 监控全市场涨幅接近涨停（≥9.5%）的股票\n2. 封板检测：封单量/流通市值比值决定封板强度（比值>1%为强势封板）\n3. 开板检测：涨停价卖单突然减少或大量成交，触发卖出信号\n4. 打板买入条件：首次封板且封单强度>阈值，排板买入\n5. 排板撤单：封单强度减弱或大盘走弱时撤单\n6. 次日卖出：高开>3%立即卖出，低开< -2%开盘卖出止损\n7. 参数：封单强度阈值、排板超时时间、次日卖出规则\n8. 风控：单票仓位上限、每日最多打板次数' },
  // ── 二、多标的选股 & 轮动策略 ──
  { id:'s10', cat:'rotation', name:'多因子选股模型', sub:'选股', desc:'价值/成长/质量/流动性/波动率因子打分，月频调仓，支持行业中性处理', prompt:
'实现多因子选股模型：\n1. 因子库：\n   - 价值因子：PE倒数、PB倒数、PS倒数、股息率\n   - 成长因子：营收增长率、净利润增长率、ROE增长率\n   - 质量因子：ROE、毛利率、资产负债率、经营现金流/营收\n   - 流动性因子：日均换手率、日均成交额\n   - 波动率因子：过去60日收益率标准差、Beta\n2. 打分方式：行业内排序打分（Z-score），各因子加权求和\n3. 选股范围：全市场剔除ST、*ST、上市<60天、停牌、高质押（>50%）\n4. 风控：行业中性（每个行业选股数与行业市值占比匹配）、市值中性\n5. 调仓频率：每周或每月定期调仓\n6. 回测：比较等权基准、超额收益、信息比率、行业偏离度' },
  { id:'s11', cat:'rotation', name:'ETF动量轮动（二八轮动）', sub:'轮动', desc:'大盘/小盘ETF动量轮动，经典二八策略', prompt:
'实现ETF二八轮动策略：\n1. 标的：沪深300ETF（大盘代表）和创业板ETF或中证500ETF（小盘代表）\n2. 动量信号：比较过去N日涨幅（默认20日），选择涨幅大的持有\n3. 如果两者都为负收益，则空仓（持有货币基金/债券ETF）\n4. 调仓频率：每日检查信号，信号变化时调仓\n5. 仓位管理：满仓轮动，不多空\n6. 可选扩展：加入第3个标的（如国债ETF形成股债轮动）\n7. 参数：动量窗口N、是否使用均线过滤噪音\n8. 回测：对比基准（沪深300持有不动）、年化收益、夏普比率、最大回撤' },
  { id:'s12', cat:'rotation', name:'行业ETF轮动', sub:'轮动', desc:'按行业板块动量切换持仓行业，捕捉板块轮动收益', prompt:
'实现行业ETF轮动策略：\n1. 标的池：主要行业ETF（消费、医药、科技、金融、新能源、军工、有色、煤炭等）\n2. 动量信号：计算各行业ETF过去N日涨幅（默认20日），取排名前K名持有\n3. 每月/双周调仓一次\n4. 持仓数量K=3-5个行业，等权配置\n5. 可选：加入成交量确认（动量需配合放量）\n6. 可选：加入行业景气度辅助判断（如PMI、工业增加值）\n7. 参数：动量周期N、持仓数量K、调仓频率\n8. 回测：对比行业等权基准、超额收益、换手率' },
  { id:'s13', cat:'rotation', name:'指数增强策略', sub:'选股', desc:'对标沪深300/中证500，因子选股超额收益，控制行业风格偏离', prompt:
'实现指数增强策略：\n1. 对标指数：沪深300、中证500、中证1000可选\n2. 选股：多因子打分（见s10），选前M只股票\n3. 约束条件：\n   - 行业偏离度不超过±5%（相对基准指数）\n   - 市值风格暴露控制在0.5个标准差以内\n   - 单股权重不超过5%\n4. 优化目标：最大化预期收益（因子综合得分），最小化跟踪误差\n5. 调仓频率：月度调仓\n6. 回测指标：超额收益、跟踪误差、信息比率、T统计量\n7. 可选：加入事件驱动因素（业绩预告、机构调研等）' },
  { id:'s14', cat:'rotation', name:'低波动/红利策略', sub:'选股', desc:'高股息+低波动优选，长期持有类量化价值模型', prompt:
'实现低波动红利策略：\n1. 选股池：全市场剔除ST、剔除金融行业（可选）\n2. 因子排序：\n   - 股息率（权重40%）：过去12个月股息率\n   - 低波动（权重30%）：过去60日收益率标准差，越低越好\n   - 质量（权重30%）：ROE、经营现金流为正、负债率<50%\n3. 选前20-30只股票，等权配置\n4. 季度调仓\n5. 可选：加入分红连续年限过滤（至少连续分红5年）\n6. 回测：对比中证红利指数、沪深300，看超额收益、回撤控制' },
  // ── 三、套利 & 市场中性对冲策略 ──
  { id:'s15', cat:'arbitrage', name:'ETF申赎套利', sub:'套利', desc:'场内价格与IOPV净值偏离瞬时套利，一二级市场价差捕捉', prompt:
'实现ETF申赎套利策略：\n1. 监控ETF实时价格 vs IOPV（实时净值估算）的价差\n2. 折价套利：场内折价时（价格<IOPV-手续费），买入ETF+赎回获得一篮子股票卖出\n3. 溢价套利：场内溢价时（价格>IOPV+手续费），买入一篮子股票+申购ETF卖出\n4. 计算套利成本：买卖佣金、印花税、申赎费用、冲击成本\n5. 仅当预期收益>套利成本时才执行\n6. 高频轮询（秒级），一旦窗口消失立即撤单\n7. 可选：统计套利（价差回归均值而非瞬时套利）\n8. 回测：统计套利机会次数、单笔收益、总收益、胜率' },
  { id:'s16', cat:'arbitrage', name:'期现套利（股指期货对冲）', sub:'套利', desc:'IF/IC/IM期货与对应ETF一篮子现货对冲，捕捉基差收敛收益', prompt:
'实现期现套利策略：\n1. 标的：IF（沪深300）、IC（中证500）、IM（中证1000）对应期货及ETF现\n2. 计算基差 = 期货价格 / 现货指数价格 - 1\n2. 正向套利：基差>阈值时，买入现货（一篮子ETF/股票）+ 做空期货\n3. 反向套利：基差<-阈值时，卖出现货 + 做多期货\n4. 持仓至到期或基差回归，双边平仓\n5. 参数：开仓基差阈值、平仓基差阈值、合约选择（主力/次主力）\n6. 保证金管理：期货保证金+现货占用资金，总杠杆控制\n7. 回测：统计套利机会频率、单笔收益率、年化收益率' },
  { id:'s17', cat:'arbitrage', name:'跨品种/跨期套利', sub:'套利', desc:'同产业链商品套利（螺纹-铁矿、豆油-棕榈油）；远月近月价差回归', prompt:
'实现跨品种套利策略：\n1. 跨品种对：螺纹-热卷、豆油-棕榈油、焦煤-焦炭、豆粕-菜粕等\n2. 计算价差/价比 = 品种A价格 - 品种B价格 * 系数\n3. 价差突破上下轨（均值±K倍标准差）时开仓\n4. 价差回归至均值时平仓\n5. 跨期套利：同一品种近月-远月，计算持仓成本（仓储+利息+保险）\n6. 价差超出持仓成本时开仓，回归平仓\n7. 参数：回溯窗口N、开仓标准差倍数K、止损倍数\n8. 回测：累计收益、夏普比率、最大回撤、资金曲线' },
  { id:'s18', cat:'arbitrage', name:'市场中性多空对冲', sub:'对冲', desc:'融资融券做多优质股、做空弱势股，对冲大盘系统性风险', prompt:
'实现市场中性多空策略：\n1. 多因子打分（见s10），选得分最高的前N只做多，得分最低的前N只做空\n2. 多空市值匹配，实现Beta中性\n3. 可选：行业中性（同一行业内多空匹配，消除行业暴露）\n4. 融券来源：可融券标的、ETF融券替代个股融券\n5. 调仓频率：月度\n6. 参数：多空各持有数量N、因子权重、调仓频率\n7. 风控：单票做空仓位上限、整体杠杆率控制\n8. 回测：收益来源分解（选股Alpha vs 市场Beta剥离）、超额收益稳定性' },
  { id:'s19', cat:'arbitrage', name:'可转债套利', sub:'套利', desc:'转股溢价套利、双底埋伏、强赎预警自动卖出', prompt:
'实现可转债套利策略：\n1. 转股溢价套利：转股溢价率<0且可融券正股时，买入转债+融券卖空正股\n2. 双底策略：价格<面值（100）+溢价率<20%，到期收益率>3%的债性保护品种\n3. 强赎预警：正股已触发强赎条件（连续30日有15日>转股价130%），预警卖出持仓\n4. 回售套利：接近回售期、价格低于回售价的转债，博弈回售收益\n5. 下修博弈：正股跌幅大、转股价有望下修、价格在面值附近的转债\n6. 参数：溢价率阈值、到期收益率阈值、持仓周期\n7. 风控：单只转债持仓不超过总仓位10%\n8. 回测：分策略统计胜率、年化收益、最大回撤' },
  { id:'s20', cat:'arbitrage', name:'期权套利 & 波动率交易', sub:'套利', desc:'跨式/宽跨式/备兑/Deta中性对冲/波动率曲面交易', prompt:
'实现期权套利策略：\n1. 跨式（Straddle）：同时买入平值看涨+平值看跌，赌大幅波动\n2. 宽跨式（Strangle）：买入虚值看涨+虚值看跌，低成本博波动\n3. 备兑（Covered Call）：持有正股+卖出虚值看涨，收权利金增强收益\n4. 保护性看跌（Protective Put）：持有正股+买入虚值看跌，下行保险\n5. Delta中性：调整期权+现货组合使整体Delta≈0，做多波动率或时间价值\n6. 波动率曲面：比较隐含波动率与历史波动率，做多低估/做空高估的期限结构\n7. 参数：合约选择、行权价、到期日、Delta目标值\n8. 风控：Greeks监控（Delta/Gamma/Vega/Theta），压力测试极端行情\n9. 回测：希腊字母归因分析、波动率锥、收益分布' },
  // ── 四、网格 & 自动化条件单 ──
  { id:'s21', cat:'grid', name:'标准网格交易', sub:'网格', desc:'固定价差分档挂单，下跌分批买、上涨分批卖，支持单票/ETF/可转债', prompt:
'实现标准网格交易策略：\n1. 设定网格区间（上界、下界）和网格层数N\n2. 每层等差价格：步长=(上界-下界)/N\n3. 初始持仓：在当前位置建立50%仓位\n4. 价格每下跌一层买入一层，每上涨一层卖出一层\n5. 每层买卖数量=总资金/N/标的单价\n6. 风控：单标的总仓位上限、网格突破上下界后暂停\n7. 参数：区间上下界、网格层数、单层资金量、是否等差/等比网格\n8. 回测：网格收益统计、资金利用效率、最大占用资金' },
  { id:'s22', cat:'grid', name:'动态网格（ATR浮动网格）', sub:'网格', desc:'根据波动率自动调整网格间距，波动大放大区间、波动小缩小', prompt:
'实现ATR动态网格策略：\n1. 基础网格参考s21\n2. 网格间距根据ATR动态调整：间距 = ATR(14) * K（K默认=1.5）\n3. ATR大时网格间距自动放大（适应高波动），ATR小时自动缩小\n4. 参考价格：网格中心价每天按最新收盘价重新定位\n5. 网格层数固定不变，间距变化\n6. 参数：ATR周期、ATR倍数K、网格层数\n7. 风控：波动率过高（ATR>阈值时）暂停网格\n8. 回测：对比固定网格，看适应性优势' },
  { id:'s23', cat:'grid', name:'止盈止损联动策略', sub:'风控', desc:'移动止盈、分批止盈、硬性止损、持仓回撤风控自动清仓', prompt:
'实现止盈止损联动风控策略：\n1. 固定止损：买入价下方X%设置止损单\n2. 移动止盈（Trailing Stop）：价格每上涨Y%，止盈线上移Y%，价格回落至止盈线卖出\n3. 分批止盈：达到目标价1卖出1/3，目标价2再卖1/3，目标价3清仓\n4. 持仓回撤风控：账户总资产从最高点回撤达Z%时，自动清仓所有持仓\n5. 参数：止损比例X、移动止盈步长Y、分批止盈目标价集、总回撤比例Z\n6. 适用：配合其他策略使用，作为风控模块插入\n7. 回测：统计止损次数、止盈次数、平均亏损/盈利、回撤控制效果' },
  { id:'s24', cat:'grid', name:'一篮子条件单', sub:'自动化', desc:'批量股票统一设置价格、指标触发自动交易', prompt:
'实现一篮子条件单系统：\n1. 创建条件单模板：价格触发/指标触发/时间触发\n2. 价格触发：价格>=目标价买入/卖出、价格<=目标价买入/卖出\n3. 指标触发：均线金叉、RSI超买超卖等（调用技术指标计算）\n4. 时间触发：定时（每天/每周X点）执行调仓信号\n5. 批量设置：选中多只股票统一应用条件单模板\n6. 条件单管理：列表查看、启用/禁用、修改、删除\n7. 历史记录：条件单触发记录\n8. 模拟执行：即使不真实下单，也记录触发的虚拟成交' },
]
const STRATEGY_CATS = {
  technique: { label:'基础技术择时', color:'#58a6ff' },
  rotation: { label:'多标的选股 & 轮动', color:'#3fb950' },
  arbitrage: { label:'套利 & 市场中性对冲', color:'#d29922' },
  grid: { label:'网格 & 自动化条件单', color:'#f85149' },
}

let stratFilter = 'all'
function filterStrategies(cat) {
  stratFilter = cat
  document.querySelectorAll('#stratFilters .tf-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.scat === cat) })
  renderStrategies()
}
function renderStrategies() {
  const el = document.getElementById('stratList')
  if (!el) return
  const filtered = stratFilter === 'all' ? STRATEGIES : STRATEGIES.filter(function(s) { return s.cat === stratFilter })
  const grouped = {}
  filtered.forEach(function(s) {
    if (!grouped[s.cat]) grouped[s.cat] = []
    grouped[s.cat].push(s)
  })
  let html = ''
  Object.keys(grouped).forEach(function(cat) {
    const info = STRATEGY_CATS[cat] || { label: cat, color: '#8b949e' }
    html += '<div style="margin-bottom:1rem;">'
    html += '<h3 style="color:' + info.color + ';margin-bottom:0.5rem;font-size:1.05rem;">' + info.label + '</h3>'
    grouped[cat].forEach(function(s) {
      html += '<div class="strat-card" style="padding:0.8rem 0;border-bottom:1px solid #21262d;cursor:pointer;" onclick="toggleStratPrompt(\'' + s.id + '\')">'
      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;">'
      html += '<div><strong style="color:#f0f6fc;font-size:0.95rem;">' + esc(s.name) + '</strong>'
      html += '<span style="color:#8b949e;font-size:0.8rem;margin-left:0.6rem;">' + esc(s.sub) + '</span></div>'
      html += '<span style="color:#484f58;font-size:0.8rem;">💡 点我查看提示词</span>'
      html += '</div>'
      html += '<p style="color:#8b949e;font-size:0.85rem;margin-top:0.3rem;">' + esc(s.desc) + '</p>'
      html += '<div id="sp_' + s.id + '" style="display:none;margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid #21262d;">'
      html += '<pre style="background:#0d1117;border-radius:4px;padding:0.6rem;font-size:0.78rem;color:#c9d1d9;line-height:1.5;white-space:pre-wrap;max-height:300px;overflow-y:auto;">' + esc(s.prompt) + '</pre>'
      html += '<button onclick="navigator.clipboard.writeText(document.getElementById(\'sp_' + s.id + '\').querySelector(\'pre\').textContent)" style="margin-top:0.3rem;padding:0.2rem 0.6rem;background:#21262d;border:none;color:#c9d1d9;border-radius:4px;cursor:pointer;font-size:0.75rem;">📋 复制提示词</button>'
      html += '</div></div>'
    })
    html += '</div>'
  })
  if (!html) html = '<div style="text-align:center;color:#8b949e;padding:3rem;font-size:0.9rem;">暫無策略</div>'
  el.innerHTML = html
}
function toggleStratPrompt(id) {
  const el = document.getElementById('sp_' + id)
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none'
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
