/* ===== State ===== */
const API_BASE = 'https://fuuwjceawowojecaqfru.supabase.co/rest/v1'
const ANON_KEY = 'sb_publishable_M3lmOrr1QDDkkKE3r9q7qQ_mVnLlYtQ'
const HEADERS = { apikey: ANON_KEY, 'Content-Type': 'application/json' }

let currentUser = null
let portfolioCache = []
let plans = []
let currentPlanFilter = null // null=all, 0=no-plan, >0=plan_id
let editingPlanId = null

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
    name === 'dashboard' ? '儀表板' : name === 'trade' ? '交易' : name === 'portfolio' ? '持倉' : name === 'plans' ? '投資組合' : '交易紀錄'
  ))
  if (btn) btn.classList.add('active')
  document.getElementById('sec' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active')
  if (name === 'portfolio') renderPortfolio()
  if (name === 'plans') renderPlans()
  if (name === 'history') loadHistory()
}

/* ===== Dashboard ===== */
async function initApp() {
  await Promise.all([loadSummary(), loadPortfolio(), loadQuickStocks(), loadPlans(), loadHotSectors()])
  loadSummary()
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
        document.getElementById('statCash').textContent = '$' + fmt(s.cash)
        document.getElementById('statValue').textContent = '$' + fmt(mv)
        document.getElementById('statTotal').textContent = '$' + fmt(Number(s.cash) + mv)
        const pnlEl = document.getElementById('statPnl')
        pnlEl.textContent = (pnl >= 0 ? '+' : '') + '$' + fmt(pnl)
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
      if (fd && fd.length) document.getElementById('statCash').textContent = '$' + fmt(fd[0].cash_balance)
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
        rows += '<tr><td>' + esc(p.plan_name) + '</td><td>$' + fmt(smv) + '</td><td class="' + (spnl >= 0 ? 'green' : 'red') + '">' + (spnl >= 0 ? '+' : '') + '$' + fmt(spnl) + '</td></tr>'
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
    // Try to enrich with real prices
    if (portfolioCache.length) {
      const syms = portfolioCache.map(function(p) { return p.symbol })
      const real = await fetchRealPrices(syms)
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
    return `<tr>
      <td><strong>${esc(p.symbol)}</strong></td>
      <td>${esc(p.name || '')}</td>
      <td>${p.quantity}</td>
      <td>$${fmt(p.avg_cost)}</td>
      <td class="${pnl >= 0 ? 'green' : 'red'}">$${fmt(p.market_price)}</td>
      <td>$${fmt(mv)}</td>
      <td class="${totalPnl >= 0 ? 'green' : 'red'}">${totalPnl >= 0 ? '+' : ''}$${fmt(totalPnl)}</td>
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
  priceEl.textContent = '$' + fmt(price)
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
    const tradeBody = {
      p_username: currentUser.username,
      p_symbol: currentStockData.symbol,
      p_name: currentStockData.name || '',
      p_price: currentStockData.price,
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

async function quickTrade(type) {
  const [symbol, name] = document.getElementById('quickStock').value.split('|')
  const qty = parseInt(document.getElementById('quickQty').value)
  if (!qty || qty < 1) { alert('請輸入有效數量'); return }

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

    const tradeRes = await fetch(API_BASE + '/rpc/execute_trade', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({
        p_username: currentUser.username,
        p_symbol: symbol,
        p_name: name,
        p_price: price,
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
    return '<tr>'
      + '<td><strong>' + esc(p.symbol) + '</strong></td>'
      + '<td>' + esc(p.name || '') + '</td>'
      + '<td style="color:#8b949e;font-size:0.85rem;">' + (p.plan_id ? esc(planNames[p.plan_id] || '組合#' + p.plan_id) : '<span style="color:#484f58;">不指定</span>') + '</td>'
      + '<td>' + p.quantity + '</td>'
      + '<td>$' + fmt(p.avg_cost) + '</td>'
      + '<td class="' + (pnl >= 0 ? 'green' : 'red') + '">$' + fmt(p.market_price) + '</td>'
      + '<td>$' + fmt(mv) + '</td>'
      + '<td class="' + (totalPnl >= 0 ? 'green' : 'red') + '">' + (totalPnl >= 0 ? '+' : '') + '$' + fmt(totalPnl) + '</td>'
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
  document.getElementById('quickStock').value = symbol + '|' + name
  document.getElementById('quickQty').value = qty
  quickTrade('sell')
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
        + '<td>$' + fmt(t.price) + '</td>'
        + '<td class="' + (isBuy ? 'red' : 'green') + '">' + (isBuy ? '-' : '+') + '$' + fmt(t.price * t.quantity) + '</td>'
        + '<td style="color:#8b949e;font-size:0.85rem;">' + (t.plan_id ? esc(planNames[t.plan_id] || '組合#' + t.plan_id) : '<span style="color:#484f58;">不指定</span>') + '</td>'
        + '</tr>'
    }).join('')
  } catch (_) {}
}

/* ===== Helpers ===== */
function fmt(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }

/* ===== Hot Sectors ===== */
let sectorData = { industries: [], concepts: [] }
let sectorTab = 'industry'

async function loadHotSectors() {
  const el = document.getElementById('sectorList')
  if (!el) return
  el.innerHTML = '<div class="sector-loading">載入中...</div>'
  try {
    const res = await fetch('https://fuuwjceawowojecaqfru.supabase.co/functions/v1/get_hot_sectors', {
      headers: { Authorization: 'Bearer ' + ANON_KEY }
    })
    const txt = await res.text()
    if (res.ok) {
      let data = JSON.parse(txt)
      sectorData.industries = data.industries || []
      sectorData.concepts = data.concepts || []
    } else {
      sectorData = { industries: [], concepts: [] }
    }
  } catch (_) {
    sectorData = { industries: [], concepts: [] }
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
  const codes = symbols.map(symbolToTencentCode).filter(Boolean)
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
      const m = line.match(/^v_[^=]+="(.+)";?$/)
      if (!m) return
      const parts = m[1].split('~')
      if (parts.length < 5) return
      const price = parseFloat(parts[3])
      if (isNaN(price)) return
      result[parts[2]] = { price: price, name: parts[1] || '', open: parseFloat(parts[5]) || 0, high: parseFloat(parts[9]) || 0, low: parseFloat(parts[10]) || 0, volume: parts[6] || '0' }
    })
    return result
  } catch (_) { return {} }
}

async function getRealPrice(symbol) {
  const map = await fetchRealPrices([symbol])
  return map[symbol] || null
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
