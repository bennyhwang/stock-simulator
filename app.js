/* ===== State ===== */
const API_BASE = 'https://fuuwjceawowojecaqfru.supabase.co/rest/v1'
const ANON_KEY = 'sb_publishable_M3lmOrr1QDDkkKE3r9q7qQ_mVnLlYtQ'
const HEADERS = { apikey: ANON_KEY, 'Content-Type': 'application/json' }

let currentUser = null
let portfolioCache = []

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
    name === 'dashboard' ? '儀表板' : name === 'trade' ? '交易' : name === 'portfolio' ? '持倉' : '交易紀錄'
  ))
  if (btn) btn.classList.add('active')
  document.getElementById('sec' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('active')
  if (name === 'portfolio') renderPortfolio()
  if (name === 'history') loadHistory()
}

/* ===== Dashboard ===== */
async function initApp() {
  await Promise.all([loadSummary(), loadPortfolio(), loadQuickStocks()])
  // Re-run summary after portfolio loads (in case real prices arrived later)
  loadSummary()
}

async function loadSummary() {
  try {
    const res = await fetch(API_BASE + '/rpc/get_trader_summary', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ p_username: currentUser.username })
    })
    if (res.ok) {
      const data = await res.json()
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
        return
      }
    }
    // Fallback
    const fb = await fetch(API_BASE + '/traders?select=cash_balance&username=eq.' + encodeURIComponent(currentUser.username), { headers: HEADERS })
    if (fb.ok) {
      const fd = await fb.json()
      if (fd && fd.length) { document.getElementById('statCash').textContent = '$' + fmt(fd[0].cash_balance); return }
      document.getElementById('statCash').textContent = 'FB_EMPTY'
    } else {
      document.getElementById('statCash').textContent = 'FB_' + fb.status
    }
  } catch (ex) { document.getElementById('statCash').textContent = 'JS_' + ex.message }
}

async function loadPortfolio() {
  try {
    const res = await fetch(API_BASE + '/rpc/get_trader_portfolio', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ p_username: currentUser.username })
    })
    if (!res.ok) { portfolioCache = []; return }
    portfolioCache = (await res.json()) || []
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
    const res = await fetch(API_BASE + '/rpc/execute_trade', {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({
        p_username: currentUser.username,
        p_symbol: currentStockData.symbol,
        p_name: currentStockData.name || '',
        p_price: currentStockData.price,
        p_quantity: qty,
        p_type: type
      })
    })
    if (res.ok) {
      alert(type === 'buy' ? '買入成功！' : '賣出成功！')
      document.getElementById('stockResult').style.display = 'none'
      document.getElementById('stockSearch').value = ''
      await Promise.all([loadSummary(), loadPortfolio()])
      switchTab('dashboard')
    } else {
      const txt = await res.text()
      err.textContent = '交易失敗: ' + (txt.includes('insufficient') ? '資金不足' : txt.includes('no_shares') ? '持股不足' : txt)
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
        p_type: type
      })
    })
    if (tradeRes.ok) {
      alert(type === 'buy' ? '買入成功！' : '賣出成功！')
      await Promise.all([loadSummary(), loadPortfolio()])
      switchTab('dashboard')
    } else {
      const txt = await tradeRes.text()
      alert('交易失敗: ' + (txt.includes('insufficient') ? '資金不足' : txt.includes('no_shares') ? '持股不足' : txt))
    }
  } catch (ex) {
    alert('錯誤: ' + ex.message)
  }
}

/* ===== Portfolio Detail ===== */
function renderPortfolio() {
  const tbody = document.getElementById('portfolioDetail')
  if (!portfolioCache.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#8b949e;padding:2rem;">暫無持倉</td></tr>'
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
      <td><button onclick="quickSell('${p.symbol}','${esc(p.name)}',${p.quantity})" style="padding:0.3rem 0.8rem;background:#da3633;border:none;color:#fff;border-radius:6px;cursor:pointer;">賣出</button></td>
    </tr>`
  }).join('')
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
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#8b949e;padding:2rem;">暫無交易紀錄</td></tr>'
      return
    }
    tbody.innerHTML = data.map(t => {
      const isBuy = t.type === 'buy'
      return `<tr>
        <td style="white-space:nowrap;font-size:0.85rem;">${new Date(t.created_at).toLocaleString('zh-HK')}</td>
        <td><strong>${esc(t.symbol)}</strong></td>
        <td>${esc(t.name || '')}</td>
        <td class="${isBuy ? 'green' : 'red'}">${isBuy ? '買入' : '賣出'}</td>
        <td>${t.quantity}</td>
        <td>$${fmt(t.price)}</td>
        <td class="${isBuy ? 'red' : 'green'}">${isBuy ? '-' : '+'}$${fmt(t.price * t.quantity)}</td>
      </tr>`
    }).join('')
  } catch (_) {}
}

/* ===== Helpers ===== */
function fmt(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }

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

/* ===== Session Restore ===== */
;(function() {
  try {
    const s = localStorage.getItem('trader_session')
    if (s) { const d = JSON.parse(s); if (d && d.username) { currentUser = d; onLoginSuccess() } }
  } catch(_) { localStorage.removeItem('trader_session') }
})()
