(function() {
  var input = document.getElementById('ticker-input');
  var suggestionsList = document.getElementById('suggestions');
  var stockListEl = document.getElementById('stock-list');
  var emptyState = document.getElementById('empty-state');
  var detailView = document.getElementById('detail-view');
  var statusBar = document.getElementById('status-bar');
  var banner = document.getElementById('api-key-banner');
  var keyInput = document.getElementById('api-key-input');
  var groqKeyInput = document.getElementById('groq-key-input');
  var avKeyInput = document.getElementById('av-key-input');
  var saveKeyBtn = document.getElementById('save-key-btn');
  var settingsBtn = document.getElementById('settings-btn');

  var trackedStocks = JSON.parse(localStorage.getItem('tracked_stocks') || '[]');
  if (trackedStocks.length && typeof trackedStocks[0] === 'string') {
    trackedStocks = trackedStocks.map(function(s) { return { symbol: s, type: 'Equity' }; });
    saveTracked();
  }
  var selectedSymbol = null;
  var peChart = null;
  var searchTimeout = null;
  var highlightIndex = -1;
  var refreshTimer = null;
  var cache = {};

  StockAPI.onStatus(function(msg) { statusBar.textContent = msg; statusBar.classList.toggle('hidden', !msg); });

  // --- API Keys ---
  saveKeyBtn.addEventListener('click', function() {
    var fk = keyInput.value.trim(), gk = groqKeyInput.value.trim(), ak = avKeyInput.value.trim();
    if (fk && fk.indexOf('\u2022') !== 0) StockAPI.setKey(fk);
    if (gk && gk.indexOf('\u2022') !== 0) NewsAI.setKey(gk);
    if (ak && ak.indexOf('\u2022') !== 0) AlphaAPI.setKey(ak);
    if (StockAPI.hasKey()) banner.classList.add('hidden');
    keyInput.value = StockAPI.hasKey() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    groqKeyInput.value = NewsAI.hasKey() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    avKeyInput.value = AlphaAPI.hasKey() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    if (StockAPI.hasKey()) refreshAll();
  });
  if (settingsBtn) settingsBtn.addEventListener('click', function() {
    banner.classList.toggle('hidden');
    keyInput.value = StockAPI.hasKey() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    groqKeyInput.value = NewsAI.hasKey() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    avKeyInput.value = AlphaAPI.hasKey() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
  });
  var aboutBtn = document.getElementById('about-btn');
  var aboutModal = document.getElementById('about-modal');
  var aboutClose = document.getElementById('about-close');
  if (aboutBtn) aboutBtn.addEventListener('click', function() { aboutModal.classList.remove('hidden'); });
  if (aboutClose) aboutClose.addEventListener('click', function() { aboutModal.classList.add('hidden'); });
  if (aboutModal) aboutModal.addEventListener('click', function(e) { if (e.target === aboutModal) aboutModal.classList.add('hidden'); });
  keyInput.addEventListener('focus', function() { if (keyInput.value.indexOf('\u2022') === 0) keyInput.value = ''; });
  groqKeyInput.addEventListener('focus', function() { if (groqKeyInput.value.indexOf('\u2022') === 0) groqKeyInput.value = ''; });
  avKeyInput.addEventListener('focus', function() { if (avKeyInput.value.indexOf('\u2022') === 0) avKeyInput.value = ''; });
  function saveTracked() { localStorage.setItem('tracked_stocks', JSON.stringify(trackedStocks)); }

  // --- Search ---
  input.addEventListener('input', function() {
    var q = input.value.trim(); highlightIndex = -1;
    if (q.length < 1) { closeSuggestions(); return; }
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function() { doSearch(q); }, 300);
  });
  input.addEventListener('keydown', function(e) {
    var items = suggestionsList.querySelectorAll('li');
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlightIndex = Math.min(highlightIndex + 1, items.length - 1); updateHL(items); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlightIndex = Math.max(highlightIndex - 1, 0); updateHL(items); }
    else if (e.key === 'Enter' && highlightIndex >= 0) { e.preventDefault(); items[highlightIndex].click(); }
    else if (e.key === 'Escape') closeSuggestions();
  });
  function updateHL(items) {
    items.forEach(function(li, i) { li.classList.toggle('highlighted', i === highlightIndex); });
    if (items[highlightIndex]) items[highlightIndex].scrollIntoView({ block: 'nearest' });
  }
  async function doSearch(q) {
    if (!StockAPI.hasKey()) { banner.classList.remove('hidden'); return; }
    try { showSuggestions(await StockAPI.searchTicker(q)); } catch(e) { closeSuggestions(); }
  }
  function showSuggestions(results) {
    suggestionsList.innerHTML = '';
    if (!results.length) { closeSuggestions(); return; }
    results.slice(0, 8).forEach(function(r) {
      var li = document.createElement('li'); li.setAttribute('role', 'option');
      var badge = r.type === 'ETF' ? ' <span class="type-badge">ETF</span>' : '';
      li.innerHTML = '<span class="symbol">' + r.symbol + badge + '</span><span class="name">' + r.name + '</span>';
      li.addEventListener('click', function() { addStock(r.symbol, r.name, r.type); });
      suggestionsList.appendChild(li);
    });
    suggestionsList.classList.add('active');
  }
  function closeSuggestions() { suggestionsList.classList.remove('active'); suggestionsList.innerHTML = ''; highlightIndex = -1; }
  document.addEventListener('click', function(e) { if (!e.target.closest('.search-container')) closeSuggestions(); });

  // --- Add / Remove / Select ---
  function addStock(symbol, name, type) {
    closeSuggestions(); input.value = '';
    symbol = symbol.toUpperCase(); type = type || 'Equity';
    if (trackedStocks.find(function(s) { return s.symbol === symbol; })) { selectStock(symbol); return; }
    trackedStocks.push({ symbol: symbol, name: name || '', type: type });
    saveTracked(); renderSidebar(); loadStockData(symbol, type);
    selectStock(symbol); startAutoRefresh();
  }
  function removeStock(symbol, evt) {
    if (evt) { evt.stopPropagation(); evt.preventDefault(); }
    trackedStocks = trackedStocks.filter(function(s) { return s.symbol !== symbol; });
    saveTracked(); delete cache[symbol]; renderSidebar();
    if (selectedSymbol === symbol) {
      selectedSymbol = null;
      if (trackedStocks.length) selectStock(trackedStocks[0].symbol); else showEmpty();
    }
    if (!trackedStocks.length) stopAutoRefresh();
  }
  function selectStock(symbol) {
    selectedSymbol = symbol;
    emptyState.classList.add('hidden'); detailView.classList.remove('hidden');
    stockListEl.querySelectorAll('.stock-item').forEach(function(el) { el.classList.toggle('active', el.dataset.symbol === symbol); });
    renderDetail(symbol);
    loadTradingViewWidget(symbol);
  }
  function showEmpty() { emptyState.classList.remove('hidden'); detailView.classList.add('hidden'); }

  // --- Sidebar ---
  function renderSidebar() {
    stockListEl.innerHTML = '';
    trackedStocks.forEach(function(s) {
      var el = document.createElement('div');
      el.className = 'stock-item' + (s.symbol === selectedSymbol ? ' active' : '');
      el.dataset.symbol = s.symbol;
      var c = cache[s.symbol] || {}, q = c.quote;
      var name = (c.profile && c.profile.name) || s.name || '';
      var badge = s.type === 'ETF' ? '<span class="type-badge">ETF</span>' : '';
      var priceStr = q ? ('$' + q.price.toFixed(2)) : '--';
      var changeStr = q ? ((q.change >= 0 ? '+' : '') + q.change.toFixed(2) + ' (' + q.changePct.toFixed(2) + '%)') : '';
      var changeClass = q ? (q.change >= 0 ? 'up' : 'down') : '';
      el.innerHTML =
        '<div class="stock-item-info"><div class="stock-item-symbol">' + s.symbol + ' ' + badge + '</div><div class="stock-item-name">' + name + '</div></div>'
        + '<div class="stock-item-price"><div class="stock-item-price-val">' + priceStr + '</div><div class="stock-item-change ' + changeClass + '">' + changeStr + '</div></div>'
        + '<button class="stock-item-remove" title="Remove">&times;</button>';
      el.addEventListener('click', function() { selectStock(s.symbol); });
      el.querySelector('.stock-item-remove').addEventListener('click', function(e) { removeStock(s.symbol, e); });
      stockListEl.appendChild(el);
    });
  }

  // --- Detail panel ---
  function renderDetail(symbol) {
    var c = cache[symbol] || {};
    var s = trackedStocks.find(function(t) { return t.symbol === symbol; }) || {};
    renderDetailHeader(symbol, c, s);
    renderDetailVerdict(symbol, c);
    renderDetailKPIs(symbol, c, s);
    renderDetailPE(symbol, c, s);
    renderDetailETFHoldings(symbol, c, s);
    renderDetailRevenue(symbol, c, s);
    renderDetailEarnings(symbol, c, s);
    renderDetailFundamentals(symbol, c, s);
    renderDetailInsider(symbol, c, s);
    renderDetailAI(symbol, c);
    renderDetailAnalyst(symbol, c);
    renderDetailMacro(symbol, c);
    renderDetailTranscript(symbol, c);
    renderDetailPeers(symbol, c);
    renderDetailNews(symbol, c);
  }
  function renderDetailHeader(symbol, c, s) {
    var el = document.getElementById('detail-header');
    var q = c.quote, name = (c.profile && c.profile.name) || s.name || '';
    var badge = s.type === 'ETF' ? ' <span class="type-badge">ETF</span>' : '';
    var priceStr = q ? ('$' + q.price.toFixed(2)) : '--';
    var changeStr = '', changeClass = '';
    if (q) { changeStr = (q.change >= 0 ? '+' : '') + q.change.toFixed(2) + ' (' + q.changePct.toFixed(2) + '%)'; changeClass = q.change >= 0 ? 'up' : 'down'; }
    el.innerHTML = '<div class="detail-header-left"><div><div class="detail-ticker">' + symbol + badge + '</div><div class="detail-company">' + name + '</div></div></div>'
      + '<div><div class="detail-price">' + priceStr + '</div><div class="detail-change ' + changeClass + '">' + changeStr + '</div></div>';
  }
  // --- AI Verdict ---
  function renderDetailVerdict(symbol, c) {
    var contentEl = document.getElementById('detail-verdict-content');
    var btn = document.getElementById('detail-verdict-btn');
    btn.onclick = function() { runVerdict(symbol); };

    if (c.verdictResult) {
      renderVerdictHTML(contentEl, c.verdictResult);
      btn.disabled = false; btn.textContent = 'Regenerate';
      return;
    }
    if (!NewsAI.hasKey()) { contentEl.innerHTML = '<div class="tile-loading">Add a Groq API key to enable.</div>'; btn.disabled = true; return; }
    // Need at least quote + some other data
    if (!c.quote) { contentEl.innerHTML = '<div class="tile-loading">Waiting for data to load...</div>'; btn.disabled = true; return; }
    btn.disabled = false; btn.textContent = 'Generate Verdict';
    contentEl.innerHTML = '<div class="tile-loading">Click Generate Verdict after other tiles have loaded for the most comprehensive analysis.</div>';
  }

  async function runVerdict(symbol) {
    var contentEl = document.getElementById('detail-verdict-content');
    var btn = document.getElementById('detail-verdict-btn');
    var c = cache[symbol];
    if (!NewsAI.hasKey() || !c) return;
    btn.disabled = true; btn.textContent = 'Analyzing\u2026';
    contentEl.innerHTML = '<div class="tile-loading">\uD83C\uDFAF Senior analyst is reviewing all data for ' + symbol + '...</div>';
    try {
      c.verdictResult = await NewsAI.generateVerdict(
        symbol,
        c.profile ? c.profile.name : symbol,
        c
      );
      renderVerdictHTML(contentEl, c.verdictResult);
    } catch (err) { contentEl.innerHTML = '<div class="error-msg">' + err.message + '</div>'; }
    finally { btn.textContent = 'Regenerate'; btn.disabled = false; }
  }

  function renderVerdictHTML(el, v) {
    var verdictClass = (v.verdict || '').replace(/\s+/g, '-');
    var upsideNum = parseFloat(v.upside || 0);
    var upsideClass = upsideNum >= 0 ? 'positive' : 'negative';
    var upsideStr = upsideNum >= 0 ? '+' + v.upside + '%' : v.upside + '%';

    var h = '<div class="verdict-header">';
    h += '<span class="verdict-badge ' + verdictClass + '">' + (v.verdict || 'N/A') + '</span>';
    h += '<div class="verdict-price-target"><span class="verdict-pt-label">12-Mo Price Target</span><span class="verdict-pt-value">$' + (v.priceTarget || 0).toFixed(2) + '</span></div>';
    if (v.currentPrice) {
      h += '<div class="verdict-price-target"><span class="verdict-pt-label">Current</span><span class="verdict-pt-value" style="font-size:1rem;color:var(--muted);">$' + v.currentPrice.toFixed(2) + '</span></div>';
    }
    h += '<span class="verdict-upside ' + upsideClass + '">' + upsideStr + ' upside</span>';
    h += '<span class="verdict-confidence ' + (v.confidence || '') + '">Confidence: ' + (v.confidence || 'N/A') + '</span>';
    h += '</div>';

    h += '<div class="verdict-thesis">' + (v.summary || '') + '</div>';
    if (v.verdictReason) {
      h += '<div class="verdict-reason">' + v.verdictReason + '</div>';
    }

    // Bull / Bear cases
    if ((v.bull && v.bull.length) || (v.bear && v.bear.length)) {
      h += '<div class="verdict-cases">';
      if (v.bull && v.bull.length) {
        h += '<div class="verdict-case"><div class="verdict-case-title bull">\uD83D\uDCC8 Bull Case</div>';
        v.bull.forEach(function(b) { h += '<div class="verdict-case-item">' + b + '</div>'; });
        h += '</div>';
      }
      if (v.bear && v.bear.length) {
        h += '<div class="verdict-case"><div class="verdict-case-title bear">\uD83D\uDCC9 Bear Case</div>';
        v.bear.forEach(function(b) { h += '<div class="verdict-case-item">' + b + '</div>'; });
        h += '</div>';
      }
      h += '</div>';
    }

    // Catalysts
    if (v.catalysts && v.catalysts.length) {
      h += '<div class="ai-table-title">\u26A1 Upcoming Catalysts</div><table class="ai-table"><thead><tr><th>Event</th><th>Timeline</th><th>Impact</th></tr></thead><tbody>';
      v.catalysts.forEach(function(c) {
        h += '<tr><td class="ai-table-factor">' + c.event + '</td><td>' + c.timeline + '</td><td><span class="ai-impact-badge ' + c.impact + '">' + c.impact + '</span></td></tr>';
      });
      h += '</tbody></table>';
    }

    // Risks
    if (v.risks && v.risks.length) {
      h += '<div class="ai-table-title">\u26A0\uFE0F Key Risks</div><table class="ai-table"><thead><tr><th>Risk</th><th>Severity</th><th>Mitigation</th></tr></thead><tbody>';
      v.risks.forEach(function(r) {
        h += '<tr><td class="ai-table-factor">' + r.risk + '</td><td><span class="ai-impact-badge ' + r.severity + '">' + r.severity + '</span></td><td class="ai-table-detail">' + r.mitigation + '</td></tr>';
      });
      h += '</tbody></table>';
    }

    h += '<div class="verdict-disclaimer">This is AI-generated analysis for informational purposes only. Not financial advice. Always do your own research before making investment decisions.</div>';
    el.innerHTML = h;
  }

  function renderDetailKPIs(symbol, c, s) {
    var el = document.getElementById('detail-kpis');
    var f = c.financials || {}, p = c.profile || {};
    var kpis = s.type === 'ETF' ? [
      {l:'52W High',v:f.week52High||'N/A'},{l:'52W Low',v:f.week52Low||'N/A'},{l:'Beta',v:f.beta||'N/A'},
      {l:'Div Yield',v:f.dividendYield||'N/A'},{l:'Sector',v:p.sector||'ETF'},{l:'Exchange',v:p.exchange||'N/A'},
    ] : [
      {l:'Market Cap',v:fmtNum(p.marketCap)},{l:'P/E Ratio',v:f.peRatio||'N/A'},{l:'Fwd P/E',v:f.forwardPE||'N/A'},
      {l:'EPS',v:f.eps||'N/A'},{l:'Div Yield',v:f.dividendYield||'N/A'},{l:'52W High',v:f.week52High||'N/A'},
      {l:'52W Low',v:f.week52Low||'N/A'},{l:'Beta',v:f.beta||'N/A'},{l:'Sector',v:p.sector||'N/A'},
    ];
    if (!f.peRatio && !p.marketCap) { el.innerHTML = '<div class="tile-loading">Loading...</div>'; return; }
    el.innerHTML = kpis.map(function(k) { return '<div class="kpi"><div class="label">' + k.l + '</div><div class="value">' + k.v + '</div></div>'; }).join('');
  }

  // --- TradingView Widget ---
  function loadTradingViewWidget(symbol) {
    var container = document.getElementById('tradingview-widget');
    if (!container) return;
    container.innerHTML = '';
    var script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.textContent = JSON.stringify({
      symbol: symbol,
      width: '100%',
      height: '100%',
      autosize: true,
      interval: 'D',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: '#1a1d27',
      gridColor: '#2a2d3a',
      allow_symbol_change: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      calendar: false,
      support_host: 'https://www.tradingview.com'
    });
    container.appendChild(script);
  }

  // --- PE Chart ---
  function renderDetailPE(symbol, c, s) {
    var tile = document.getElementById('tile-pe');
    if (s.type === 'ETF') { tile.style.display = 'none'; return; }
    tile.style.display = '';
    if (!c.financials || !c.financials.annualSeries) return;
    var peData = StockAPI.computePEHistory(c.financials.annualSeries);
    var container = tile.querySelector('.chart-container');
    if (peData.length < 2) { container.innerHTML = '<div class="tile-loading">Insufficient P/E data.</div>'; return; }
    container.innerHTML = '<canvas id="detail-pe-chart"></canvas>';
    var canvas = document.getElementById('detail-pe-chart');
    if (peChart) peChart.destroy();
    var labels = peData.map(function(p) { return p.date; });
    var data = peData.map(function(p) { return p.pe; });
    var avg = data.reduce(function(a,b) { return a+b; }, 0) / data.length;
    peChart = new Chart(canvas, {
      type: 'line',
      data: { labels: labels, datasets: [
        { label: 'P/E', data: data, borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2 },
        { label: 'Avg', data: data.map(function() { return avg; }), borderColor: '#f59e0b', borderDash: [6,3], borderWidth: 1.5, pointRadius: 0, fill: false },
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, labels: { color: '#8b8fa3', font: { size: 10 }, boxWidth: 12 } } },
        scales: {
          x: { ticks: { maxTicksLimit: 6, color: '#8b8fa3', font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: '#8b8fa3', font: { size: 10 }, callback: function(v) { return v + 'x'; } }, grid: { color: '#2a2d3a' } },
        },
      },
    });
  }

  // --- Earnings ---
  var earningsChart = null;
  function renderDetailEarnings(symbol, c, s) {
    var tile = document.getElementById('tile-earnings');
    var el = document.getElementById('detail-earnings-content');
    if (s.type === 'ETF') { tile.style.display = 'none'; return; }
    tile.style.display = '';
    if (!c.earnings) { el.innerHTML = '<div class="tile-loading">Loading earnings...</div>'; return; }
    if (!c.earnings.length) { el.innerHTML = '<div class="tile-loading">No earnings data available.</div>'; return; }

    var h = '';

    // Upcoming earnings
    if (c.earningsCalendar) {
      var ec = c.earningsCalendar;
      var daysUntil = Math.ceil((new Date(ec.date) - new Date()) / 86400000);
      var countdownText = daysUntil <= 0 ? 'Today' : (daysUntil === 1 ? 'Tomorrow' : daysUntil + ' days');
      var estStr = ec.epsEstimate != null ? ('EPS Est: $' + ec.epsEstimate.toFixed(2)) : '';
      h += '<div class="earnings-upcoming">'
        + '<div><div class="earnings-upcoming-date">' + ec.date + '</div><div class="earnings-upcoming-label">Next Earnings' + (ec.quarter ? ' (Q' + ec.quarter + ' ' + ec.year + ')' : '') + '</div></div>'
        + '<div class="earnings-upcoming-est">' + estStr + '</div>'
        + '<span class="earnings-countdown">' + countdownText + '</span>'
        + '</div>';
    }

    // Beat/miss record
    var earnings = c.earnings;
    var beats = 0, misses = 0, meets = 0;
    earnings.forEach(function(e) {
      if (e.actual == null || e.estimate == null) return;
      if (e.actual > e.estimate) beats++;
      else if (e.actual < e.estimate) misses++;
      else meets++;
    });
    var total = beats + misses + meets;
    var beatPct = total > 0 ? Math.round(beats / total * 100) : 0;
    h += '<div class="earnings-record">'
      + '<div class="earnings-record-box"><div class="earnings-record-val beat">' + beats + '</div><div class="earnings-record-label">Beats</div></div>'
      + '<div class="earnings-record-box"><div class="earnings-record-val meet">' + meets + '</div><div class="earnings-record-label">Meets</div></div>'
      + '<div class="earnings-record-box"><div class="earnings-record-val miss">' + misses + '</div><div class="earnings-record-label">Misses</div></div>'
      + '<div class="earnings-record-box"><div class="earnings-record-val" style="color:var(--accent);">' + beatPct + '%</div><div class="earnings-record-label">Beat Rate</div></div>'
      + '</div>';

    // EPS surprise chart
    h += '<div class="earnings-chart-container"><canvas id="earnings-surprise-chart"></canvas></div>';

    // Detailed table
    h += '<table class="earnings-table"><thead><tr><th>Quarter</th><th>Actual</th><th>Estimate</th><th>Surprise</th><th>Surprise %</th><th>Result</th></tr></thead><tbody>';
    earnings.forEach(function(e) {
      var resultClass = '', resultText = '--';
      if (e.actual != null && e.estimate != null) {
        if (e.actual > e.estimate) { resultClass = 'earnings-beat'; resultText = 'BEAT'; }
        else if (e.actual < e.estimate) { resultClass = 'earnings-miss'; resultText = 'MISS'; }
        else { resultClass = 'earnings-meet'; resultText = 'MET'; }
      }
      var actualStr = e.actual != null ? '$' + e.actual.toFixed(2) : '--';
      var estStr = e.estimate != null ? '$' + e.estimate.toFixed(2) : '--';
      var surpStr = e.surprise != null ? ((e.surprise >= 0 ? '+$' : '-$') + Math.abs(e.surprise).toFixed(2)) : '--';
      var surpPctStr = e.surprisePct != null ? ((e.surprisePct >= 0 ? '+' : '') + e.surprisePct.toFixed(1) + '%') : '--';
      h += '<tr><td>' + e.period + '</td><td>' + actualStr + '</td><td>' + estStr + '</td>'
        + '<td class="' + resultClass + '">' + surpStr + '</td>'
        + '<td class="' + resultClass + '">' + surpPctStr + '</td>'
        + '<td class="' + resultClass + '">' + resultText + '</td></tr>';
    });
    h += '</tbody></table>';

    el.innerHTML = h;

    // Render the surprise chart
    renderEarningsSurpriseChart(earnings);
  }

  function renderEarningsSurpriseChart(earnings) {
    var canvas = document.getElementById('earnings-surprise-chart');
    if (!canvas) return;
    if (earningsChart) earningsChart.destroy();

    var sorted = earnings.slice().reverse();
    var labels = sorted.map(function(e) { return e.period; });
    var actuals = sorted.map(function(e) { return e.actual; });
    var estimates = sorted.map(function(e) { return e.estimate; });
    var surprises = sorted.map(function(e) { return e.surprisePct != null ? e.surprisePct : 0; });
    var barColors = surprises.map(function(s) { return s >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)'; });

    earningsChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            type: 'line', label: 'Actual EPS', data: actuals,
            borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)',
            borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#6366f1',
            tension: 0.3, yAxisID: 'y', order: 1,
          },
          {
            type: 'line', label: 'Estimate', data: estimates,
            borderColor: '#8b8fa3', borderDash: [4, 3],
            borderWidth: 1.5, pointRadius: 3, pointBackgroundColor: '#8b8fa3',
            tension: 0.3, yAxisID: 'y', order: 2,
          },
          {
            type: 'bar', label: 'Surprise %', data: surprises,
            backgroundColor: barColors, borderRadius: 3,
            yAxisID: 'y1', order: 3,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: '#8b8fa3', font: { size: 9 }, boxWidth: 10 } },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                if (ctx.dataset.label === 'Surprise %') return 'Surprise: ' + ctx.raw.toFixed(1) + '%';
                return ctx.dataset.label + ': $' + (ctx.raw != null ? ctx.raw.toFixed(2) : '--');
              }
            }
          }
        },
        scales: {
          x: { ticks: { color: '#8b8fa3', font: { size: 9 } }, grid: { display: false } },
          y: {
            position: 'left',
            ticks: { color: '#8b8fa3', font: { size: 9 }, callback: function(v) { return '$' + v.toFixed(2); } },
            grid: { color: '#2a2d3a' },
            title: { display: true, text: 'EPS ($)', color: '#8b8fa3', font: { size: 9 } },
          },
          y1: {
            position: 'right',
            ticks: { color: '#8b8fa3', font: { size: 9 }, callback: function(v) { return v.toFixed(0) + '%'; } },
            grid: { display: false },
            title: { display: true, text: 'Surprise %', color: '#8b8fa3', font: { size: 9 } },
          },
        },
      },
    });
  }

  // --- ETF Holdings ---
  function renderDetailETFHoldings(symbol, c, s) {
    var tile = document.getElementById('tile-etf-holdings');
    var el = document.getElementById('detail-etf-holdings');
    if (!s || s.type !== 'ETF') { tile.style.display = 'none'; return; }
    tile.style.display = '';
    if (!c.etfHoldings) { el.innerHTML = '<div class="tile-loading">Loading holdings...</div>'; return; }
    if (!c.etfHoldings.holdings || !c.etfHoldings.holdings.length) { el.innerHTML = '<div class="tile-loading">No holdings data available.</div>'; return; }

    var holdings = c.etfHoldings.holdings;
    var colors = ['#6366f1','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6','#f97316','#64748b'];
    var h = '';
    if (c.etfHoldings.atDate) h += '<div style="font-size:0.62rem;color:var(--muted);margin-bottom:0.4rem;">As of ' + c.etfHoldings.atDate + '</div>';

    // Top 10 bar
    var top10 = holdings.slice(0, 10).filter(function(x) { return x.percent != null; });
    if (top10.length) {
      h += '<div class="etf-holdings-bar">';
      top10.forEach(function(x, i) {
        var pct = (x.percent * 100).toFixed(1);
        h += '<div style="width:' + pct + '%;background:' + colors[i % colors.length] + ';" title="' + x.symbol + ' ' + pct + '%"></div>';
      });
      h += '</div>';
    }

    h += '<table class="etf-holdings-table"><thead><tr><th>#</th><th>Symbol</th><th>Name</th><th>Weight</th></tr></thead><tbody>';
    holdings.slice(0, 15).forEach(function(x, i) {
      var pctStr = x.percent != null ? (x.percent * 100).toFixed(2) + '%' : 'N/A';
      h += '<tr><td>' + (i + 1) + '</td><td style="font-weight:600;">' + (x.symbol || '--') + '</td><td style="color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (x.name || '--') + '</td><td class="etf-holding-pct">' + pctStr + '</td></tr>';
    });
    h += '</tbody></table>';
    if (holdings.length > 15) h += '<div style="font-size:0.62rem;color:var(--muted);margin-top:0.3rem;">Showing top 15 of ' + holdings.length + ' holdings.</div>';
    el.innerHTML = h;
  }

  // --- Revenue & Income Trend ---
  var revenueChart = null;
  function renderDetailRevenue(symbol, c, s) {
    var tile = document.getElementById('tile-revenue');
    var contentEl = document.getElementById('detail-revenue-content');
    var btn = document.getElementById('detail-revenue-btn');
    if (s && s.type === 'ETF') { tile.style.display = 'none'; return; }
    tile.style.display = '';
    btn.onclick = function() { loadRevenueData(symbol); };

    if (c.incomeData && c.incomeData.length) {
      renderRevenueChart(contentEl, c.incomeData);
      btn.disabled = false; btn.textContent = 'Reload';
      return;
    }
    if (!AlphaAPI.hasKey()) {
      contentEl.innerHTML = '<div class="tile-loading">Add an Alpha Vantage key to view quarterly revenue & income trend.</div>';
      btn.disabled = true;
      return;
    }
    btn.disabled = false; btn.textContent = 'Load';
    contentEl.innerHTML = '<div class="tile-loading">Click Load to fetch quarterly income data (1 AV call).</div>';
  }

  async function loadRevenueData(symbol) {
    var contentEl = document.getElementById('detail-revenue-content');
    var btn = document.getElementById('detail-revenue-btn');
    if (!AlphaAPI.hasKey() || !symbol) return;
    btn.disabled = true; btn.textContent = 'Loading\u2026';
    contentEl.innerHTML = '<div class="tile-loading">Fetching income statement...</div>';
    try {
      if (!cache[symbol]) cache[symbol] = {};
      var result = await AlphaAPI.getIncomeStatement(symbol);
      cache[symbol].incomeData = result;
      if (selectedSymbol === symbol) {
        if (!result || !result.length) {
          contentEl.innerHTML = '<div class="tile-loading">No quarterly income data returned by Alpha Vantage for ' + symbol + '. This ticker may not be covered.</div>';
        } else {
          renderRevenueChart(contentEl, result);
        }
      }
    } catch (e) {
      contentEl.innerHTML = '<div class="error-msg">' + e.message + '</div>';
    }
    btn.disabled = false; btn.textContent = 'Reload';
  }

  function renderRevenueChart(el, data) {
    if (!data || !data.length) { el.innerHTML = '<div class="tile-loading">No income data available.</div>'; return; }
    var sorted = data.slice().reverse().filter(function(d) { return d.revenue != null; });
    if (sorted.length < 2) { el.innerHTML = '<div class="tile-loading">Insufficient data.</div>'; return; }

    el.innerHTML = '<div class="revenue-chart-container"><canvas id="revenue-income-chart"></canvas></div>';
    var canvas = document.getElementById('revenue-income-chart');
    if (!canvas) return;
    if (revenueChart) revenueChart.destroy();

    var labels = sorted.map(function(d) {
      var dt = new Date(d.date);
      if (d.isAnnual) {
        return 'FY ' + dt.getFullYear();
      }
      var q = Math.ceil((dt.getMonth() + 1) / 3);
      return 'Q' + q + ' ' + dt.getFullYear();
    });
    var revenues = sorted.map(function(d) { return d.revenue ? d.revenue / 1e9 : null; });
    var netIncomes = sorted.map(function(d) { return d.netIncome ? d.netIncome / 1e9 : null; });
    var barColors = netIncomes.map(function(v) { return v != null && v >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)'; });

    revenueChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            type: 'bar', label: 'Revenue ($B)', data: revenues,
            backgroundColor: 'rgba(99,102,241,0.6)', borderRadius: 3,
            yAxisID: 'y', order: 2,
          },
          {
            type: 'line', label: 'Net Income ($B)', data: netIncomes,
            borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)',
            borderWidth: 2, pointRadius: 3, pointBackgroundColor: barColors,
            tension: 0.3, yAxisID: 'y', order: 1, fill: false,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: '#8b8fa3', font: { size: 9 }, boxWidth: 10 } },
          tooltip: {
            callbacks: {
              label: function(ctx) { return ctx.dataset.label + ': $' + (ctx.raw != null ? ctx.raw.toFixed(2) : '--') + 'B'; }
            }
          }
        },
        scales: {
          x: { ticks: { color: '#8b8fa3', font: { size: 9 } }, grid: { display: false } },
          y: {
            ticks: { color: '#8b8fa3', font: { size: 9 }, callback: function(v) { return '$' + v.toFixed(1) + 'B'; } },
            grid: { color: '#2a2d3a' },
          },
        },
      },
    });
  }

  // --- Insider Trading ---
  function renderDetailInsider(symbol, c, s) {
    var tile = document.getElementById('tile-insider');
    var el = document.getElementById('detail-insider-content');
    if (s && s.type === 'ETF') { tile.style.display = 'none'; return; }
    tile.style.display = '';
    if (!c.insiderTrades) { el.innerHTML = '<div class="tile-loading">Loading insider data...</div>'; return; }
    if (!c.insiderTrades.length) { el.innerHTML = '<div class="tile-loading">No insider transactions found.</div>'; return; }

    var trades = c.insiderTrades;
    // Aggregate buys vs sells (last 6 months)
    var totalBuys = 0, totalSells = 0, buyValue = 0, sellValue = 0, buyCount = 0, sellCount = 0;
    trades.forEach(function(t) {
      // P = Purchase, S = Sale, A = Grant/Award, M = Exercise
      if (t.code === 'P' || t.code === 'A') {
        buyCount++;
        totalBuys += Math.abs(t.change);
        if (t.price) buyValue += Math.abs(t.change) * t.price;
      } else if (t.code === 'S') {
        sellCount++;
        totalSells += Math.abs(t.change);
        if (t.price) sellValue += Math.abs(t.change) * t.price;
      }
    });

    var signal = 'NEUTRAL', signalClass = 'signal-neutral';
    if (buyCount > 0 && sellCount === 0) { signal = 'BULLISH'; signalClass = 'signal-bullish'; }
    else if (buyCount > sellCount * 1.5) { signal = 'BULLISH'; signalClass = 'signal-bullish'; }
    else if (sellCount > buyCount * 1.5) { signal = 'BEARISH'; signalClass = 'signal-bearish'; }
    else if (sellCount > 0 && buyCount === 0) { signal = 'BEARISH'; signalClass = 'signal-bearish'; }

    var h = '<div class="insider-summary">';
    h += '<div class="insider-summary-box"><div class="insider-summary-val buy">' + buyCount + '</div><div class="insider-summary-label">Buys</div></div>';
    h += '<div class="insider-summary-box"><div class="insider-summary-val sell">' + sellCount + '</div><div class="insider-summary-label">Sells</div></div>';
    h += '<div class="insider-summary-box"><div class="insider-summary-val buy">' + fmtNum(buyValue) + '</div><div class="insider-summary-label">Buy Value</div></div>';
    h += '<div class="insider-summary-box"><div class="insider-summary-val sell">' + fmtNum(sellValue) + '</div><div class="insider-summary-label">Sell Value</div></div>';
    h += '<div class="insider-summary-box"><div class="insider-summary-val ' + signalClass + '">' + signal + '</div><div class="insider-summary-label">Signal</div></div>';
    h += '</div>';

    // Transaction table
    h += '<table class="insider-table"><thead><tr><th>Date</th><th>Insider</th><th>Type</th><th>Shares</th><th>Price</th></tr></thead><tbody>';
    trades.slice(0, 15).forEach(function(t) {
      var typeLabel = t.code === 'P' ? 'BUY' : t.code === 'S' ? 'SELL' : t.code === 'A' ? 'AWARD' : t.code === 'M' ? 'EXERCISE' : t.code || '?';
      var typeClass = (t.code === 'P' || t.code === 'A') ? 'insider-buy' : t.code === 'S' ? 'insider-sell' : '';
      var sharesStr = Math.abs(t.change).toLocaleString();
      var priceStr = t.price ? ('$' + t.price.toFixed(2)) : '--';
      h += '<tr><td>' + (t.transactionDate || t.filingDate) + '</td><td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + t.name + '</td><td class="' + typeClass + '">' + typeLabel + '</td><td>' + sharesStr + '</td><td>' + priceStr + '</td></tr>';
    });
    h += '</tbody></table>';
    if (trades.length > 15) h += '<div style="font-size:0.62rem;color:var(--muted);margin-top:0.3rem;">Showing 15 of ' + trades.length + ' transactions.</div>';
    el.innerHTML = h;
  }

  // --- Company Fundamentals & Sentiment ---
  function renderDetailFundamentals(symbol, c, s) {
    var contentEl = document.getElementById('detail-fundamentals-content');
    var btn = document.getElementById('detail-fundamentals-btn');
    var tile = document.getElementById('tile-fundamentals');
    if (s && s.type === 'ETF') { tile.style.display = 'none'; return; }
    tile.style.display = '';
    btn.onclick = function() { loadFundamentalsData(symbol); };

    if (c.fundamentalsResult) {
      renderFundamentalsHTML(contentEl, c, symbol);
      btn.disabled = false; btn.textContent = 'Reload';
      return;
    }
    // Show raw metrics if we have financials already
    if (c.financials && (c.financials.grossMargin != null || c.financials.roeTTM != null)) {
      renderFundamentalsRaw(contentEl, c);
      btn.disabled = false; btn.textContent = 'Load & Analyze';
    } else {
      btn.disabled = false; btn.textContent = 'Load & Analyze';
      contentEl.innerHTML = '<div class="tile-loading">Click Load & Analyze to view growth, margins, financial health, and sentiment.' + (AlphaAPI.hasKey() ? '' : ' Add an Alpha Vantage key for employee count & sentiment data.') + '</div>';
    }
  }

  function renderFundamentalsRaw(el, c) {
    var f = c.financials || {};
    var h = '<div class="fundamentals-sections">';
    // Growth
    h += '<div class="fundamentals-section"><div class="fundamentals-section-title">Revenue Growth</div>';
    h += fmtMetricRow('1-Year', f.revenueGrowth1Y, '%');
    h += fmtMetricRow('3-Year', f.revenueGrowth3Y, '%');
    h += fmtMetricRow('5-Year', f.revenueGrowth5Y, '%');
    h += '</div>';
    // Margins
    h += '<div class="fundamentals-section"><div class="fundamentals-section-title">Margin Stack</div>';
    h += fmtMetricRow('Gross', f.grossMargin, '%');
    h += fmtMetricRow('Operating', f.operatingMargin, '%');
    h += fmtMetricRow('Net', f.netMargin, '%');
    h += '</div>';
    h += '</div>';
    h += '<div style="font-size:0.68rem;color:var(--muted);">Click Load & Analyze for AI synthesis, returns, health metrics, and sentiment.</div>';
    el.innerHTML = h;
  }

  function fmtMetricRow(label, val, suffix) {
    var display = val != null ? val.toFixed(1) + (suffix || '') : 'N/A';
    var color = '';
    if (val != null && suffix === '%') {
      if (val > 0) color = ' style="color:var(--green);"';
      else if (val < 0) color = ' style="color:var(--red);"';
    }
    return '<div class="fundamentals-metric"><span class="fundamentals-metric-label">' + label + '</span><span class="fundamentals-metric-value"' + color + '>' + display + '</span></div>';
  }

  async function loadFundamentalsData(symbol) {
    var contentEl = document.getElementById('detail-fundamentals-content');
    var btn = document.getElementById('detail-fundamentals-btn');
    if (!symbol) return;
    btn.disabled = true; btn.textContent = 'Loading\u2026';
    contentEl.innerHTML = '<div class="tile-loading">Loading fundamentals data...</div>';
    try {
      if (!cache[symbol]) cache[symbol] = {};
      var c = cache[symbol];

      // Fetch AV data if key available
      if (AlphaAPI.hasKey()) {
        if (!c.avOverview) {
          contentEl.innerHTML = '<div class="tile-loading">Fetching company overview (Alpha Vantage)...</div>';
          c.avOverview = await AlphaAPI.getOverview(symbol);
        }
        if (!c.avSentiment) {
          contentEl.innerHTML = '<div class="tile-loading">Fetching news sentiment (Alpha Vantage)...</div>';
          c.avSentiment = await AlphaAPI.getNewsSentiment(symbol);
        }
      }

      // Run AI analysis if Groq key available
      if (NewsAI.hasKey()) {
        contentEl.innerHTML = '<div class="tile-loading">\uD83E\uDD16 AI analyzing fundamentals...</div>';
        c.fundamentalsResult = await NewsAI.analyzeFundamentals(
          symbol,
          c.profile ? c.profile.name : symbol,
          c.financials || null,
          c.avOverview || null,
          c.avSentiment || null,
          c.profile || null
        );
      }

      if (selectedSymbol === symbol) renderFundamentalsHTML(contentEl, c, symbol);
    } catch (e) {
      contentEl.innerHTML = '<div class="error-msg">' + e.message + '</div>';
    }
    btn.disabled = false; btn.textContent = 'Reload';
  }

  function renderFundamentalsHTML(el, c, symbol) {
    var f = c.financials || {};
    var ai = c.fundamentalsResult;
    var ov = c.avOverview;
    var sent = c.avSentiment;
    var h = '';

    // AI badges row
    if (ai) {
      h += '<div class="fundamentals-badges">';
      h += '<div class="fundamentals-badge ' + (ai.growthOutlook || '') + '">\uD83D\uDCC8 Growth: ' + (ai.growthOutlook || 'N/A') + '</div>';
      h += '<div class="fundamentals-badge ' + (ai.marginTrend || '') + '">\uD83D\uDCCA Margins: ' + (ai.marginTrend || 'N/A') + '</div>';
      h += '<div class="fundamentals-badge ' + (ai.healthScore || '') + '">\uD83C\uDFE6 Health: ' + (ai.healthScore || 'N/A') + '</div>';
      h += '<div class="fundamentals-badge ' + (ai.sentimentLabel || '') + '">\uD83D\uDCE1 Sentiment: ' + (ai.sentimentLabel || 'N/A') + '</div>';
      h += '</div>';
      h += '<div class="ai-summary">' + (ai.summary || '') + '</div>';
    }

    // Metrics grid
    h += '<div class="fundamentals-sections">';

    // Growth section
    h += '<div class="fundamentals-section"><div class="fundamentals-section-title">\uD83D\uDCC8 Revenue Growth</div>';
    h += fmtMetricRow('1-Year', f.revenueGrowth1Y, '%');
    h += fmtMetricRow('3-Year', f.revenueGrowth3Y, '%');
    h += fmtMetricRow('5-Year', f.revenueGrowth5Y, '%');
    h += '<div class="fundamentals-section-title" style="margin-top:0.4rem;">EPS Growth</div>';
    h += fmtMetricRow('1-Year', f.epsGrowth, '%');
    h += fmtMetricRow('3-Year', f.epsGrowth3Y, '%');
    h += fmtMetricRow('5-Year', f.epsGrowth5Y, '%');
    if (ai && ai.growthReason) h += '<div style="font-size:0.65rem;color:var(--muted);margin-top:0.3rem;">' + ai.growthReason + '</div>';
    h += '</div>';

    // Margins section
    h += '<div class="fundamentals-section"><div class="fundamentals-section-title">\uD83D\uDCCA Margin Stack</div>';
    h += fmtMarginBar('Gross', f.grossMargin);
    h += fmtMarginBar('Operating', f.operatingMargin);
    h += fmtMarginBar('Net', f.netMargin);
    if (ai && ai.marginReason) h += '<div style="font-size:0.65rem;color:var(--muted);margin-top:0.3rem;">' + ai.marginReason + '</div>';
    h += '</div>';

    // Returns section
    h += '<div class="fundamentals-section"><div class="fundamentals-section-title">\uD83C\uDFAF Returns & Efficiency</div>';
    h += fmtMetricRow('ROE', f.roeTTM, '%');
    h += fmtMetricRow('ROA', f.roaTTM, '%');
    h += fmtMetricRow('ROIC', f.roicTTM, '%');
    h += '</div>';

    // Health section
    h += '<div class="fundamentals-section"><div class="fundamentals-section-title">\uD83C\uDFE6 Financial Health</div>';
    h += fmtMetricRow('Current Ratio', f.currentRatio, '');
    h += fmtMetricRow('Quick Ratio', f.quickRatio, '');
    h += fmtMetricRow('Debt/Equity', f.debtEquity, '');
    if (ov && ov.FullTimeEmployees) {
      h += '<div class="fundamentals-section-title" style="margin-top:0.4rem;">\uD83D\uDC65 Workforce</div>';
      h += fmtMetricRow('Employees', null, '');
      // Override with formatted number
      h = h.replace('N/A</span></div>', parseInt(ov.FullTimeEmployees).toLocaleString() + '</span></div>');
    }
    if (ai && ai.healthReason) h += '<div style="font-size:0.65rem;color:var(--muted);margin-top:0.3rem;">' + ai.healthReason + '</div>';
    h += '</div>';

    h += '</div>'; // close fundamentals-sections

    // Sentiment gauge
    if (sent && sent.length) {
      var bullish = 0, bearish = 0, neutral = 0;
      sent.forEach(function(s) {
        if (s.tickerSentiment) {
          var label = s.tickerSentiment.label.toLowerCase();
          if (label.indexOf('bullish') !== -1) bullish++;
          else if (label.indexOf('bearish') !== -1) bearish++;
          else neutral++;
        }
      });
      var total = bullish + bearish + neutral;
      if (total > 0) {
        var bullPct = Math.round(bullish / total * 100);
        var neutPct = Math.round(neutral / total * 100);
        var bearPct = Math.round(bearish / total * 100);
        h += '<div class="ai-table-title">\uD83D\uDCE1 News Sentiment (' + total + ' articles)</div>';
        h += '<div class="sentiment-gauge">';
        h += '<span class="sentiment-gauge-label" style="color:var(--green);">\uD83D\uDCC8 ' + bullPct + '%</span>';
        h += '<div class="sentiment-gauge-bar">';
        h += '<div class="sentiment-gauge-fill-bull" style="width:' + bullPct + '%;"></div>';
        h += '<div class="sentiment-gauge-fill-neutral" style="width:' + neutPct + '%;"></div>';
        h += '<div class="sentiment-gauge-fill-bear" style="width:' + bearPct + '%;"></div>';
        h += '</div>';
        h += '<span class="sentiment-gauge-label" style="color:var(--red);">' + bearPct + '% \uD83D\uDCC9</span>';
        h += '</div>';
      }
      if (ai && ai.sentimentReason) {
        h += '<div style="font-size:0.72rem;color:var(--muted);margin-bottom:0.5rem;">' + ai.sentimentReason + '</div>';
      }
    }

    // AI strengths/weaknesses
    if (ai && ((ai.strengths && ai.strengths.length) || (ai.weaknesses && ai.weaknesses.length))) {
      h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:0.5rem;">';
      if (ai.strengths && ai.strengths.length) {
        h += '<div class="fundamentals-section"><div class="fundamentals-section-title" style="color:var(--green);">\u2705 Strengths</div>';
        ai.strengths.forEach(function(s) {
          h += '<div style="font-size:0.72rem;margin-bottom:0.3rem;"><span style="font-weight:600;">' + s.area + ':</span> <span style="color:var(--muted);">' + s.detail + '</span></div>';
        });
        h += '</div>';
      }
      if (ai.weaknesses && ai.weaknesses.length) {
        h += '<div class="fundamentals-section"><div class="fundamentals-section-title" style="color:var(--red);">\u26A0\uFE0F Weaknesses</div>';
        ai.weaknesses.forEach(function(w) {
          h += '<div style="font-size:0.72rem;margin-bottom:0.3rem;"><span style="font-weight:600;">' + w.area + ':</span> <span style="color:var(--muted);">' + w.detail + '</span></div>';
        });
        h += '</div>';
      }
      h += '</div>';
    }

    // Key insights
    if (ai && ai.keyInsights && ai.keyInsights.length) {
      h += '<div class="ai-table-title">\uD83D\uDCA1 Key Insights</div><table class="ai-table"><thead><tr><th>Insight</th><th>Detail</th></tr></thead><tbody>';
      ai.keyInsights.forEach(function(k) {
        h += '<tr><td class="ai-table-factor">' + k.insight + '</td><td class="ai-table-detail">' + k.detail + '</td></tr>';
      });
      h += '</tbody></table>';
    }

    // AV data note
    var avNote = '';
    if (!AlphaAPI.hasKey()) avNote = 'Add an Alpha Vantage key for employee count & sentiment data.';
    if (!NewsAI.hasKey()) avNote += (avNote ? ' ' : '') + 'Add a Groq key for AI analysis.';
    if (avNote) h += '<div style="font-size:0.58rem;color:var(--muted);margin-top:0.4rem;">' + avNote + '</div>';

    el.innerHTML = h;
  }

  function fmtMarginBar(label, val) {
    var display = val != null ? val.toFixed(1) + '%' : 'N/A';
    var color = 'var(--muted)';
    if (val != null) {
      if (val > 20) color = 'var(--green)';
      else if (val > 0) color = '#f59e0b';
      else color = 'var(--red)';
    }
    var barWidth = val != null ? Math.min(Math.max(val, 0), 100) : 0;
    var h = '<div class="fundamentals-metric"><span class="fundamentals-metric-label">' + label + '</span><span class="fundamentals-metric-value" style="color:' + color + ';">' + display + '</span></div>';
    h += '<div class="fundamentals-bar-container"><div class="fundamentals-bar" style="width:' + barWidth + '%;background:' + color + ';"></div></div>';
    return h;
  }

  // --- AI ---
  function renderDetailAI(symbol, c) {
    var contentEl = document.getElementById('detail-ai-content');
    var btn = document.getElementById('detail-ai-btn');
    btn.onclick = function() { runAIAnalysis(symbol); };
    if (c.aiResult) { renderAIHTML(contentEl, c.aiResult); btn.disabled = false; btn.textContent = 'Re-analyze'; return; }
    if (!NewsAI.hasKey()) { contentEl.innerHTML = '<div class="tile-loading">Add a Groq API key to enable.</div>'; btn.disabled = true; return; }
    if (!c.articles || !c.articles.length) { contentEl.innerHTML = '<div class="tile-loading">Waiting for news...</div>'; btn.disabled = true; return; }
    btn.disabled = false; btn.textContent = 'Analyze';
    contentEl.innerHTML = '<div class="tile-loading">Click Analyze to run AI.</div>';
  }
  async function runAIAnalysis(symbol) {
    var contentEl = document.getElementById('detail-ai-content');
    var btn = document.getElementById('detail-ai-btn');
    if (!NewsAI.hasKey() || !cache[symbol] || !cache[symbol].articles || !cache[symbol].articles.length) return;
    btn.disabled = true; btn.textContent = 'Analyzing\u2026';
    contentEl.innerHTML = '<div class="tile-loading">\uD83E\uDD16 Analyzing...</div>';
    try {
      var c = cache[symbol];
      c.aiResult = await NewsAI.analyzeNews(symbol, c.profile ? c.profile.name : symbol, c.articles, c.financials || null);
      renderAIHTML(contentEl, c.aiResult);
    } catch (err) { contentEl.innerHTML = '<div class="error-msg">' + err.message + '</div>'; }
    finally { btn.textContent = 'Re-analyze'; btn.disabled = false; }
  }
  function renderAIHTML(el, ai) {
    var icon = ai.longTermOutlook === 'BULLISH' ? '\uD83D\uDCC8' : ai.longTermOutlook === 'BEARISH' ? '\uD83D\uDCC9' : '\u27A1\uFE0F';
    var h = '<div class="ai-summary">' + (ai.summary || '') + '</div>';
    h += '<div class="ai-outlook ' + ai.longTermOutlook + '">' + icon + ' Long-term: ' + ai.longTermOutlook + '</div>';
    h += '<div class="ai-outlook-reason">' + (ai.outlookReason || '') + '</div>';
    if (ai.valuationImpact && ai.valuationImpact.length) {
      h += '<div class="ai-table-title">Valuation Impact Factors</div><table class="ai-table"><thead><tr><th>Factor</th><th>Direction</th><th>Detail</th></tr></thead><tbody>';
      ai.valuationImpact.forEach(function(f) { h += '<tr><td class="ai-table-factor">' + f.factor + '</td><td><span class="ai-direction ' + f.direction + '">' + f.direction + '</span></td><td class="ai-table-detail">' + f.detail + '</td></tr>'; });
      h += '</tbody></table>';
    }
    if (ai.keyTriggers && ai.keyTriggers.length) {
      h += '<div class="ai-table-title">\u26A1 Key Triggers</div><table class="ai-table"><thead><tr><th>Event</th><th>Impact</th><th>Why It Matters</th></tr></thead><tbody>';
      ai.keyTriggers.forEach(function(t) { h += '<tr><td class="ai-table-factor">' + t.event + '</td><td><span class="ai-impact-badge ' + t.impact + '">' + t.impact + '</span></td><td class="ai-table-detail">' + t.explanation + '</td></tr>'; });
      h += '</tbody></table>';
    }
    el.innerHTML = h;
  }

  // --- Analyst Ratings ---
  function renderDetailAnalyst(symbol, c) {
    var contentEl = document.getElementById('detail-analyst-content');
    var btn = document.getElementById('detail-analyst-btn');
    btn.onclick = function() { runAnalystAnalysis(symbol); };
    if (c.analystAIResult) {
      renderAnalystHTML(contentEl, c.analystAIResult, c.upgrades || [], symbol);
      btn.disabled = false; btn.textContent = 'Re-summarize';
      return;
    }
    if (!NewsAI.hasKey()) { contentEl.innerHTML = '<div class="tile-loading">Add a Groq API key to enable AI summary.</div>'; btn.disabled = true; return; }
    if (!c.recommendations && !c.upgrades) { contentEl.innerHTML = '<div class="tile-loading">Loading analyst data...</div>'; btn.disabled = true; return; }
    if ((!c.recommendations || !c.recommendations.length) && (!c.upgrades || !c.upgrades.length)) {
      contentEl.innerHTML = '<div class="tile-loading">No analyst data available.</div>'; btn.disabled = true; return;
    }
    // Show raw data while waiting for AI
    renderAnalystRaw(contentEl, c.upgrades || [], c.recommendations || []);
    btn.disabled = false; btn.textContent = 'Summarize';
  }

  function renderAnalystRaw(el, upgrades, recommendations) {
    var h = '';
    if (recommendations && recommendations.length) {
      var latest = recommendations[0];
      var totalBuy = (latest.strongBuy || 0) + (latest.buy || 0);
      var totalSell = (latest.sell || 0) + (latest.strongSell || 0);
      var totalHold = latest.hold || 0;
      var total = totalBuy + totalSell + totalHold;
      h += '<div style="margin-bottom:0.5rem;">';
      h += '<div style="font-size:0.8rem;font-weight:600;margin-bottom:0.3rem;">Consensus (' + latest.period + ')</div>';
      h += '<div style="display:flex;gap:0.5rem;font-size:0.75rem;">';
      h += '<span style="color:var(--green);font-weight:600;">Strong Buy ' + (latest.strongBuy || 0) + '</span> · ';
      h += '<span style="color:var(--green);">Buy ' + (latest.buy || 0) + '</span> · ';
      h += '<span>Hold ' + totalHold + '</span> · ';
      h += '<span style="color:var(--red);">Sell ' + (latest.sell || 0) + '</span> · ';
      h += '<span style="color:var(--red);font-weight:600;">Strong Sell ' + (latest.strongSell || 0) + '</span>';
      h += '</div>';
      if (total > 0) {
        var buyPct = Math.round(totalBuy / total * 100);
        var holdPct = Math.round(totalHold / total * 100);
        var sellPct = Math.round(totalSell / total * 100);
        h += '<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;margin-top:0.4rem;background:var(--bg);">';
        h += '<div style="width:' + buyPct + '%;background:var(--green);"></div>';
        h += '<div style="width:' + holdPct + '%;background:var(--muted);"></div>';
        h += '<div style="width:' + sellPct + '%;background:var(--red);"></div>';
        h += '</div>';
        h += '<div style="display:flex;justify-content:space-between;font-size:0.6rem;color:var(--muted);margin-top:0.15rem;">';
        h += '<span>Buy ' + buyPct + '%</span><span>Hold ' + holdPct + '%</span><span>Sell ' + sellPct + '%</span>';
        h += '</div>';
      }
      h += '</div>';
      // Show trend if multiple periods
      if (recommendations.length > 1) {
        h += '<div style="font-size:0.68rem;color:var(--muted);margin-top:0.3rem;">Trend (last ' + recommendations.length + ' periods):</div>';
        h += '<div style="display:flex;flex-direction:column;gap:0.15rem;margin-top:0.2rem;">';
        recommendations.slice(0, 4).forEach(function(r) {
          h += '<div style="font-size:0.68rem;color:var(--muted);">' + r.period + ': '
            + '<span style="color:var(--green);">Buy ' + ((r.strongBuy || 0) + (r.buy || 0)) + '</span> · '
            + 'Hold ' + (r.hold || 0) + ' · '
            + '<span style="color:var(--red);">Sell ' + ((r.sell || 0) + (r.strongSell || 0)) + '</span>'
            + '</div>';
        });
        h += '</div>';
      }
    }
    if (upgrades && upgrades.length) {
      h += '<div class="analyst-actions" style="margin-top:0.5rem;">';
      upgrades.forEach(function(u) {
        var actionClass = (u.action || '').toLowerCase().replace(/\s/g, '');
        if (actionClass === 'up') actionClass = 'upgrade';
        if (actionClass === 'down') actionClass = 'downgrade';
        var gradeStr = u.fromGrade ? (u.fromGrade + ' \u2192 ' + u.toGrade) : u.toGrade;
        h += '<div class="analyst-action-item">'
          + '<span class="analyst-firm">' + u.company + '</span>'
          + '<span class="analyst-action-badge ' + actionClass + '">' + u.action + '</span>'
          + '<span class="analyst-grade">' + gradeStr + '</span>'
          + '<span class="analyst-date">' + u.date + '</span>'
          + '</div>';
      });
      h += '</div>';
    }
    el.innerHTML = h || '<div class="tile-loading">No analyst data.</div>';
  }

  async function runAnalystAnalysis(symbol) {
    var contentEl = document.getElementById('detail-analyst-content');
    var btn = document.getElementById('detail-analyst-btn');
    var c = cache[symbol];
    if (!NewsAI.hasKey() || !c) return;
    btn.disabled = true; btn.textContent = 'Summarizing\u2026';
    contentEl.innerHTML = '<div class="tile-loading">\uD83E\uDD16 Analyzing analyst ratings...</div>';
    try {
      c.analystAIResult = await NewsAI.analyzeAnalysts(
        symbol,
        c.profile ? c.profile.name : symbol,
        c.recommendations || [],
        c.upgrades || [],
        c.financials || null
      );
      renderAnalystHTML(contentEl, c.analystAIResult, c.upgrades || [], symbol);
    } catch (err) { contentEl.innerHTML = '<div class="error-msg">' + err.message + '</div>'; }
    finally { btn.textContent = 'Re-summarize'; btn.disabled = false; }
  }

  function renderAnalystHTML(el, ai, upgrades, symbol) {
    var icon = ai.consensus === 'BULLISH' ? '\uD83D\uDCC8' : ai.consensus === 'BEARISH' ? '\uD83D\uDCC9' : '\u27A1\uFE0F';
    var h = '<div class="ai-summary">' + (ai.summary || '') + '</div>';
    h += '<div class="ai-outlook ' + ai.consensus + '">' + icon + ' Consensus: ' + ai.consensus + '</div>';
    h += '<div class="ai-outlook-reason">' + (ai.consensusReason || '') + '</div>';
    if (ai.keyTakeaways && ai.keyTakeaways.length) {
      h += '<div class="ai-table-title">Key Takeaways</div><table class="ai-table"><thead><tr><th>Point</th><th>Detail</th></tr></thead><tbody>';
      ai.keyTakeaways.forEach(function(t) {
        h += '<tr><td class="ai-table-factor">' + t.point + '</td><td class="ai-table-detail">' + t.detail + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    // Show recommendation consensus bar if we have cached data
    var c = cache[symbol];
    if (c && c.recommendations && c.recommendations.length) {
      var latest = c.recommendations[0];
      var totalBuy = (latest.strongBuy || 0) + (latest.buy || 0);
      var totalSell = (latest.sell || 0) + (latest.strongSell || 0);
      var totalHold = latest.hold || 0;
      var total = totalBuy + totalSell + totalHold;
      if (total > 0) {
        var buyPct = Math.round(totalBuy / total * 100);
        var holdPct = Math.round(totalHold / total * 100);
        var sellPct = Math.round(totalSell / total * 100);
        h += '<div class="ai-table-title">Analyst Distribution (' + latest.period + ')</div>';
        h += '<div style="display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--bg);margin-bottom:0.3rem;">';
        h += '<div style="width:' + buyPct + '%;background:var(--green);"></div>';
        h += '<div style="width:' + holdPct + '%;background:var(--muted);"></div>';
        h += '<div style="width:' + sellPct + '%;background:var(--red);"></div>';
        h += '</div>';
        h += '<div style="display:flex;justify-content:space-between;font-size:0.62rem;color:var(--muted);">';
        h += '<span>Buy ' + buyPct + '% (' + totalBuy + ')</span><span>Hold ' + holdPct + '% (' + totalHold + ')</span><span>Sell ' + sellPct + '% (' + totalSell + ')</span>';
        h += '</div>';
      }
    }
    // Show individual analyst actions if available
    if (upgrades && upgrades.length) {
      h += '<div class="ai-table-title">Individual Analyst Actions</div>';
      h += '<div class="analyst-actions">';
      upgrades.forEach(function(u) {
        var actionClass = (u.action || '').toLowerCase().replace(/\s/g, '');
        if (actionClass === 'up') actionClass = 'upgrade';
        if (actionClass === 'down') actionClass = 'downgrade';
        var gradeStr = u.fromGrade ? (u.fromGrade + ' \u2192 ' + u.toGrade) : u.toGrade;
        h += '<div class="analyst-action-item">'
          + '<span class="analyst-firm">' + u.company + '</span>'
          + '<span class="analyst-action-badge ' + actionClass + '">' + u.action + '</span>'
          + '<span class="analyst-grade">' + gradeStr + '</span>'
          + '<span class="analyst-date">' + u.date + '</span>'
          + '</div>';
      });
      h += '</div>';
    }
    // Links to external analyst pages
    var s = encodeURIComponent(symbol || '');
    h += '<div class="analyst-links">'
      + '<a href="https://finance.yahoo.com/quote/' + s + '/analysis/" target="_blank" rel="noopener">\uD83D\uDD17 Yahoo Finance Analysis</a>'
      + '<a href="https://www.tipranks.com/stocks/' + s + '/forecast" target="_blank" rel="noopener">\uD83D\uDD17 TipRanks Forecast</a>'
      + '<a href="https://www.marketbeat.com/stocks/NYSE/' + s + '/forecast/" target="_blank" rel="noopener">\uD83D\uDD17 MarketBeat Forecast</a>'
      + '</div>';
    el.innerHTML = h;
  }

  // --- Macro & Economy ---
  function renderDetailMacro(symbol, c) {
    var contentEl = document.getElementById('detail-macro-content');
    var btn = document.getElementById('detail-macro-btn');
    btn.onclick = function() { runMacroAnalysis(symbol); };
    if (c.macroAIResult) {
      renderMacroHTML(contentEl, c.macroAIResult, c.macroArticles || []);
      btn.disabled = false; btn.textContent = 'Re-analyze';
      return;
    }
    if (!NewsAI.hasKey()) { contentEl.innerHTML = '<div class="tile-loading">Add a Groq API key to enable.</div>'; btn.disabled = true; return; }
    if (!c.macroArticles) { contentEl.innerHTML = '<div class="tile-loading">Loading macro news...</div>'; btn.disabled = true; return; }
    if (!c.macroArticles.length) { contentEl.innerHTML = '<div class="tile-loading">No macro news available.</div>'; btn.disabled = true; return; }
    // Show raw headlines while waiting
    renderMacroRaw(contentEl, c.macroArticles);
    btn.disabled = false; btn.textContent = 'Analyze';
  }

  function renderMacroRaw(el, articles) {
    var h = '<div style="font-size:0.72rem;color:var(--muted);margin-bottom:0.3rem;">Latest macro & economy headlines (' + articles.length + '):</div>';
    h += '<div class="macro-news-list">';
    articles.slice(0, 10).forEach(function(a) {
      h += '<a class="macro-news-item" href="' + a.url + '" target="_blank" rel="noopener">' + a.title + '<span class="macro-news-meta">' + a.publisher + ' · ' + a.date + '</span></a>';
    });
    h += '</div>';
    el.innerHTML = h;
  }

  async function runMacroAnalysis(symbol) {
    var contentEl = document.getElementById('detail-macro-content');
    var btn = document.getElementById('detail-macro-btn');
    var c = cache[symbol];
    if (!NewsAI.hasKey() || !c || !c.macroArticles || !c.macroArticles.length) return;
    btn.disabled = true; btn.textContent = 'Analyzing\u2026';
    contentEl.innerHTML = '<div class="tile-loading">\uD83E\uDD16 Analyzing macro impact on ' + symbol + '...</div>';
    try {
      var sector = (c.profile && c.profile.sector) || '';
      c.macroAIResult = await NewsAI.analyzeMacro(
        symbol,
        c.profile ? c.profile.name : symbol,
        c.macroArticles,
        c.financials || null,
        sector
      );
      renderMacroHTML(contentEl, c.macroAIResult, c.macroArticles);
    } catch (err) { contentEl.innerHTML = '<div class="error-msg">' + err.message + '</div>'; }
    finally { btn.textContent = 'Re-analyze'; btn.disabled = false; }
  }

  function renderMacroHTML(el, ai, articles) {
    var icon = ai.impact === 'POSITIVE' ? '\uD83D\uDCC8' : ai.impact === 'NEGATIVE' ? '\uD83D\uDCC9' : '\u2194\uFE0F';
    var impactClass = ai.impact === 'POSITIVE' ? 'BULLISH' : ai.impact === 'NEGATIVE' ? 'BEARISH' : 'NEUTRAL';
    var h = '<div class="ai-summary">' + (ai.summary || '') + '</div>';
    h += '<div class="ai-outlook ' + impactClass + '">' + icon + ' Macro Impact: ' + ai.impact + '</div>';
    h += '<div class="ai-outlook-reason">' + (ai.impactReason || '') + '</div>';
    if (ai.macroFactors && ai.macroFactors.length) {
      h += '<div class="ai-table-title">Macro Factors</div>';
      ai.macroFactors.forEach(function(f) {
        h += '<div class="macro-factor-item">'
          + '<span class="macro-factor-label">' + f.factor + '</span>'
          + '<span class="macro-factor-badge ' + f.direction + '">' + f.direction + '</span>'
          + '<span class="macro-factor-detail">' + f.detail + '</span>'
          + '</div>';
      });
    }
    if (ai.risks && ai.risks.length) {
      h += '<div class="ai-table-title">\u26A0\uFE0F Macro Risks</div><table class="ai-table"><thead><tr><th>Risk</th><th>Severity</th><th>Detail</th></tr></thead><tbody>';
      ai.risks.forEach(function(r) {
        h += '<tr><td class="ai-table-factor">' + r.risk + '</td><td><span class="ai-impact-badge ' + r.severity + '">' + r.severity + '</span></td><td class="ai-table-detail">' + r.detail + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    // Show source headlines
    if (articles && articles.length) {
      h += '<div class="ai-table-title">Source Headlines</div>';
      h += '<div class="macro-news-list">';
      articles.slice(0, 8).forEach(function(a) {
        h += '<a class="macro-news-item" href="' + a.url + '" target="_blank" rel="noopener">' + a.title + '<span class="macro-news-meta">' + a.publisher + '</span></a>';
      });
      h += '</div>';
    }
    el.innerHTML = h;
  }

  // --- Earnings Call Summary ---
  function renderDetailTranscript(symbol, c) {
    var contentEl = document.getElementById('detail-transcript-content');
    var btn = document.getElementById('detail-transcript-btn');
    var tile = document.getElementById('tile-transcript');
    var s = trackedStocks.find(function(t) { return t.symbol === symbol; }) || {};
    if (s.type === 'ETF') { tile.style.display = 'none'; return; }
    tile.style.display = '';
    btn.onclick = function() { runTranscriptSummary(symbol); };

    if (c.transcriptAIResult) {
      // Check if transcript is still valid for current earnings period
      var currentPeriod = (c.earnings && c.earnings.length) ? c.earnings[0].period : null;
      if (c.transcriptCachedPeriod && c.transcriptCachedPeriod === currentPeriod) {
        renderTranscriptHTML(contentEl, c.transcriptAIResult, c.earnings, symbol, c.avTranscript);
        btn.disabled = false; btn.textContent = 'Re-summarize';
        return;
      } else if (!currentPeriod) {
        // No earnings data yet, show cached result anyway
        renderTranscriptHTML(contentEl, c.transcriptAIResult, c.earnings, symbol, c.avTranscript);
        btn.disabled = false; btn.textContent = 'Re-summarize';
        return;
      }
      // Earnings period changed — clear stale transcript
      delete c.transcriptAIResult;
      delete c.transcriptCachedPeriod;
      delete c.avTranscript;
    }
    if (!NewsAI.hasKey()) { contentEl.innerHTML = '<div class="tile-loading">Add a Groq API key to enable.</div>'; btn.disabled = true; return; }
    var hasEarnings = c.earnings && c.earnings.length;
    var hasArticles = c.articles && c.articles.length;
    if (!hasEarnings && !hasArticles) { contentEl.innerHTML = '<div class="tile-loading">Waiting for earnings & news data...</div>'; btn.disabled = true; return; }
    var h = '';
    if (hasEarnings) {
      var latest = c.earnings[0];
      var result = '';
      if (latest.actual != null && latest.estimate != null) {
        result = latest.actual > latest.estimate ? ' \u2705 BEAT' : (latest.actual < latest.estimate ? ' \u274C MISS' : ' \u2796 MET');
      }
      h += '<div class="transcript-meta">'
        + '<div><div class="transcript-meta-title">Last Earnings: ' + latest.period + '</div>'
        + '<div class="transcript-meta-date">EPS: $' + (latest.actual != null ? latest.actual.toFixed(2) : 'N/A') + ' vs Est $' + (latest.estimate != null ? latest.estimate.toFixed(2) : 'N/A') + result + '</div></div>'
        + '</div>';
    }
    var avNote = AlphaAPI.hasKey() ? 'Will use Alpha Vantage transcript + news for a richer summary.' : 'Add an Alpha Vantage key for real earnings call transcript data.';
    h += '<div style="font-size:0.68rem;color:var(--muted);">' + avNote + '</div>';
    contentEl.innerHTML = h;
    btn.disabled = false; btn.textContent = 'Summarize';
  }

  async function runTranscriptSummary(symbol) {
    var contentEl = document.getElementById('detail-transcript-content');
    var btn = document.getElementById('detail-transcript-btn');
    var c = cache[symbol];
    if (!NewsAI.hasKey() || !c) return;
    btn.disabled = true; btn.textContent = 'Loading\u2026';
    contentEl.innerHTML = '<div class="tile-loading">\uD83C\uDFA4 Loading earnings call data...</div>';
    try {
      // Try Alpha Vantage transcript first
      if (AlphaAPI.hasKey() && !c.avTranscript) {
        var quarter = AlphaAPI.guessLatestQuarter(c.earnings);
        contentEl.innerHTML = '<div class="tile-loading">\uD83C\uDFA4 Fetching transcript for ' + quarter + '...</div>';
        c.avTranscript = await AlphaAPI.getEarningsTranscript(symbol, quarter);
        // If that quarter returned nothing, try the previous quarter
        if (!c.avTranscript) {
          var parts = quarter.match(/(\d{4})Q(\d)/);
          if (parts) {
            var prevQ = parseInt(parts[2]) - 1;
            var prevY = parseInt(parts[1]);
            if (prevQ < 1) { prevQ = 4; prevY--; }
            var prevQuarter = prevY + 'Q' + prevQ;
            contentEl.innerHTML = '<div class="tile-loading">\uD83C\uDFA4 Trying ' + prevQuarter + '...</div>';
            c.avTranscript = await AlphaAPI.getEarningsTranscript(symbol, prevQuarter);
          }
        }
      }
      btn.textContent = 'Summarizing\u2026';
      contentEl.innerHTML = '<div class="tile-loading">\uD83E\uDD16 AI is summarizing...</div>';
      // Use AV transcript if available, otherwise fall back to earnings + news
      if (c.avTranscript && c.avTranscript.transcript && c.avTranscript.transcript.length) {
        c.transcriptAIResult = await NewsAI.summarizeTranscript(
          symbol,
          c.profile ? c.profile.name : symbol,
          c.earnings || [],
          c.articles || [],
          c.financials || null,
          c.avTranscript
        );
      } else {
        c.transcriptAIResult = await NewsAI.summarizeTranscript(
          symbol,
          c.profile ? c.profile.name : symbol,
          c.earnings || [],
          c.articles || [],
          c.financials || null,
          null
        );
      }
      // Store the earnings period this transcript was based on
      c.transcriptCachedPeriod = (c.earnings && c.earnings.length) ? c.earnings[0].period : null;
      renderTranscriptHTML(contentEl, c.transcriptAIResult, c.earnings, symbol, c.avTranscript);
    } catch (err) { contentEl.innerHTML = '<div class="error-msg">' + err.message + '</div>'; }
    finally { btn.textContent = 'Re-summarize'; btn.disabled = false; }
  }

  function renderTranscriptHTML(el, ai, earnings, symbol, avTranscript) {
    var sentIcon = ai.sentiment === 'POSITIVE' || ai.sentiment === 'CONFIDENT' ? '\uD83D\uDCC8' : ai.sentiment === 'NEGATIVE' ? '\uD83D\uDCC9' : '\u26A0\uFE0F';
    var h = '';
    // Source badge
    var sourceLabel = avTranscript ? '\uD83C\uDFA4 From Alpha Vantage transcript' : '\uD83D\uDCF0 From earnings data + news';
    h += '<div style="font-size:0.58rem;color:var(--accent);margin-bottom:0.4rem;">' + sourceLabel + '</div>';
    // Show latest earnings result header
    if (earnings && earnings.length) {
      var latest = earnings[0];
      var result = '', resultClass = '';
      if (latest.actual != null && latest.estimate != null) {
        if (latest.actual > latest.estimate) { result = 'BEAT'; resultClass = 'earnings-beat'; }
        else if (latest.actual < latest.estimate) { result = 'MISS'; resultClass = 'earnings-miss'; }
        else { result = 'MET'; resultClass = 'earnings-meet'; }
      }
      h += '<div class="transcript-meta">'
        + '<div><div class="transcript-meta-title">Earnings: ' + latest.period + (avTranscript ? ' (' + avTranscript.quarter + ')' : '') + '</div>'
        + '<div class="transcript-meta-date">EPS $' + (latest.actual != null ? latest.actual.toFixed(2) : 'N/A') + ' vs Est $' + (latest.estimate != null ? latest.estimate.toFixed(2) : 'N/A')
        + (latest.surprisePct != null ? ' (' + (latest.surprisePct >= 0 ? '+' : '') + latest.surprisePct.toFixed(1) + '%)' : '')
        + ' <span class="' + resultClass + '">' + result + '</span></div></div>'
        + '<span class="transcript-sentiment-badge ' + ai.sentiment + '">' + sentIcon + ' ' + ai.sentiment + '</span>'
        + '</div>';
    }
    h += '<div class="ai-summary">' + (ai.summary || '') + '</div>';
    if (ai.sentimentReason) {
      h += '<div class="ai-outlook-reason">' + ai.sentimentReason + '</div>';
    }
    if (ai.keyHighlights && ai.keyHighlights.length) {
      h += '<div class="ai-table-title">Key Highlights</div><table class="ai-table"><thead><tr><th>Topic</th><th>Detail</th></tr></thead><tbody>';
      ai.keyHighlights.forEach(function(k) {
        h += '<tr><td class="ai-table-factor">' + k.topic + '</td><td class="ai-table-detail">' + k.detail + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    if (ai.guidance && ai.guidance.length) {
      h += '<div class="ai-table-title">Forward Guidance</div>';
      ai.guidance.forEach(function(g) {
        h += '<div class="guidance-item">'
          + '<span class="guidance-metric">' + g.metric + '</span>'
          + '<span class="guidance-dir-badge ' + g.direction + '">' + g.direction + '</span>'
          + '<span class="guidance-detail">' + g.detail + '</span>'
          + '</div>';
      });
    }
    if (ai.risks && ai.risks.length) {
      h += '<div class="ai-table-title">\u26A0\uFE0F Risks & Concerns</div><table class="ai-table"><thead><tr><th>Risk</th><th>Detail</th></tr></thead><tbody>';
      ai.risks.forEach(function(r) {
        h += '<tr><td class="ai-table-factor">' + r.risk + '</td><td class="ai-table-detail">' + r.detail + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    var s = encodeURIComponent(symbol || '');
    h += '<div class="transcript-links">'
      + '<a href="https://seekingalpha.com/symbol/' + s + '/earnings/transcripts" target="_blank" rel="noopener">\uD83D\uDD17 Seeking Alpha Transcripts</a>'
      + '<a href="https://finance.yahoo.com/quote/' + s + '/" target="_blank" rel="noopener">\uD83D\uDD17 Yahoo Finance</a>'
      + '<a href="https://www.fool.com/quote/' + s + '/" target="_blank" rel="noopener">\uD83D\uDD17 Motley Fool Transcripts</a>'
      + '</div>';
    el.innerHTML = h;
  }

  // --- Peer Comparison ---
  function renderDetailPeers(symbol, c) {
    var contentEl = document.getElementById('detail-peers-content');
    var btn = document.getElementById('detail-peers-btn');
    var tile = document.getElementById('tile-peers');
    var s = trackedStocks.find(function(t) { return t.symbol === symbol; }) || {};
    if (s.type === 'ETF') { tile.style.display = 'none'; return; }
    tile.style.display = '';
    btn.onclick = function() { loadPeerData(symbol); };

    if (c.peers && c.peers.length) {
      renderPeersTable(contentEl, symbol, c);
      btn.disabled = false; btn.textContent = 'Reload Peers';
      return;
    }
    btn.disabled = false; btn.textContent = 'Load Peers';
    contentEl.innerHTML = '<div class="tile-loading">Click Load Peers to compare KPIs against sector peers. Uses ~10 API calls.</div>';
  }

  async function loadPeerData(symbol) {
    var contentEl = document.getElementById('detail-peers-content');
    var btn = document.getElementById('detail-peers-btn');
    if (!StockAPI.hasKey() || !symbol) return;
    btn.disabled = true; btn.textContent = 'Loading\u2026';
    contentEl.innerHTML = '<div class="tile-loading">Fetching peer list...</div>';
    try {
      if (!cache[symbol]) cache[symbol] = {};
      var peerSymbols = await StockAPI.getPeers(symbol);
      if (!peerSymbols || !peerSymbols.length) {
        contentEl.innerHTML = '<div class="tile-loading">No peers found for ' + symbol + '.</div>';
        btn.disabled = false; btn.textContent = 'Load Peers';
        return;
      }
      var peers = [];
      for (var i = 0; i < peerSymbols.length; i++) {
        var ps = peerSymbols[i];
        contentEl.innerHTML = '<div class="tile-loading">Loading ' + ps + ' (' + (i + 1) + '/' + peerSymbols.length + ')...</div>';
        try {
          var pQuote = await StockAPI.getQuote(ps);
          var pFin = await StockAPI.getBasicFinancials(ps);
          var pProfile = await StockAPI.getProfile(ps);
          peers.push({ symbol: ps, quote: pQuote, financials: pFin, profile: pProfile });
        } catch (e) {
          console.warn('Peer data error for ' + ps + ':', e.message);
        }
        // Small delay between peers to avoid rate limits
        if (i < peerSymbols.length - 1) await delay(300);
      }
      cache[symbol].peers = peers;
      if (selectedSymbol === symbol) renderPeersTable(contentEl, symbol, cache[symbol]);
    } catch (e) {
      contentEl.innerHTML = '<div class="error-msg">Failed to load peers: ' + e.message + '</div>';
    }
    btn.disabled = false; btn.textContent = 'Reload Peers';
  }

  function renderPeersTable(el, symbol, c) {
    var peers = c.peers || [];
    if (!peers.length) { el.innerHTML = '<div class="tile-loading">No peer data available.</div>'; return; }

    // Build rows: current stock first, then peers
    var rows = [];
    var myFin = c.financials || {};
    var myQ = c.quote || {};
    var myP = c.profile || {};
    rows.push({
      symbol: symbol,
      isCurrent: true,
      price: myQ.price || null,
      change: myQ.changePct || null,
      pe: parseFloat(myFin.peRatio) || null,
      fwdPE: parseFloat(myFin.forwardPE) || null,
      eps: parseFloat(myFin.eps) || null,
      mktCap: myP.marketCap || null,
      divYield: parseFloat(myFin.dividendYield) || null,
      beta: parseFloat(myFin.beta) || null,
      w52High: parseFloat(myFin.week52High) || null,
      w52Low: parseFloat(myFin.week52Low) || null,
      revGrowth: parseFloat(myFin.revenueGrowth) || null,
      profitMargin: parseFloat(myFin.profitMargin) || null,
    });
    peers.forEach(function(p) {
      var f = p.financials || {};
      var q = p.quote || {};
      var pr = p.profile || {};
      rows.push({
        symbol: p.symbol,
        isCurrent: false,
        price: q.price || null,
        change: q.changePct || null,
        pe: parseFloat(f.peRatio) || null,
        fwdPE: parseFloat(f.forwardPE) || null,
        eps: parseFloat(f.eps) || null,
        mktCap: pr.marketCap || null,
        divYield: parseFloat(f.dividendYield) || null,
        beta: parseFloat(f.beta) || null,
        w52High: parseFloat(f.week52High) || null,
        w52Low: parseFloat(f.week52Low) || null,
        revGrowth: parseFloat(f.revenueGrowth) || null,
        profitMargin: parseFloat(f.profitMargin) || null,
      });
    });

    // Determine best/worst per column (lower is better for PE, beta; higher is better for others)
    var cols = [
      { key: 'pe', lower: true },
      { key: 'fwdPE', lower: true },
      { key: 'eps', lower: false },
      { key: 'mktCap', lower: false },
      { key: 'divYield', lower: false },
      { key: 'beta', lower: true },
      { key: 'revGrowth', lower: false },
      { key: 'profitMargin', lower: false },
    ];
    var bestWorst = {};
    cols.forEach(function(col) {
      var vals = rows.map(function(r) { return r[col.key]; }).filter(function(v) { return v != null && !isNaN(v); });
      if (!vals.length) { bestWorst[col.key] = { best: null, worst: null }; return; }
      var sorted = vals.slice().sort(function(a, b) { return a - b; });
      if (col.lower) {
        bestWorst[col.key] = { best: sorted[0], worst: sorted[sorted.length - 1] };
      } else {
        bestWorst[col.key] = { best: sorted[sorted.length - 1], worst: sorted[0] };
      }
    });

    function cellClass(key, val) {
      if (val == null || isNaN(val)) return '';
      var bw = bestWorst[key];
      if (!bw || bw.best === bw.worst) return '';
      if (val === bw.best) return 'peer-best';
      if (val === bw.worst) return 'peer-worst';
      return '';
    }

    var h = '<table class="peers-table"><thead><tr>';
    h += '<th>Symbol</th><th>Price</th><th>Chg %</th><th>P/E</th><th>Fwd P/E</th><th>EPS</th><th>Mkt Cap</th><th>Div Yield</th><th>Beta</th><th>52W High</th><th>52W Low</th><th>Rev Growth</th><th>Margin</th>';
    h += '</tr></thead><tbody>';

    rows.forEach(function(r) {
      var cls = r.isCurrent ? ' class="peer-current"' : '';
      var chgClass = r.change != null ? (r.change >= 0 ? 'style="color:var(--green);"' : 'style="color:var(--red);"') : '';
      h += '<tr' + cls + '>';
      h += '<td>' + r.symbol + (r.isCurrent ? ' \u2B50' : '') + '</td>';
      h += '<td>' + (r.price != null ? '$' + r.price.toFixed(2) : '--') + '</td>';
      h += '<td ' + chgClass + '>' + (r.change != null ? (r.change >= 0 ? '+' : '') + r.change.toFixed(2) + '%' : '--') + '</td>';
      h += '<td class="' + cellClass('pe', r.pe) + '">' + (r.pe != null ? r.pe.toFixed(1) : '--') + '</td>';
      h += '<td class="' + cellClass('fwdPE', r.fwdPE) + '">' + (r.fwdPE != null ? r.fwdPE.toFixed(1) : '--') + '</td>';
      h += '<td class="' + cellClass('eps', r.eps) + '">' + (r.eps != null ? '$' + r.eps.toFixed(2) : '--') + '</td>';
      h += '<td class="' + cellClass('mktCap', r.mktCap) + '">' + fmtNum(r.mktCap) + '</td>';
      h += '<td class="' + cellClass('divYield', r.divYield) + '">' + (r.divYield != null ? r.divYield.toFixed(2) + '%' : '--') + '</td>';
      h += '<td class="' + cellClass('beta', r.beta) + '">' + (r.beta != null ? r.beta.toFixed(2) : '--') + '</td>';
      h += '<td>' + (r.w52High != null ? '$' + r.w52High.toFixed(2) : '--') + '</td>';
      h += '<td>' + (r.w52Low != null ? '$' + r.w52Low.toFixed(2) : '--') + '</td>';
      h += '<td class="' + cellClass('revGrowth', r.revGrowth) + '">' + (r.revGrowth != null ? r.revGrowth.toFixed(1) + '%' : '--') + '</td>';
      h += '<td class="' + cellClass('profitMargin', r.profitMargin) + '">' + (r.profitMargin != null ? r.profitMargin.toFixed(1) + '%' : '--') + '</td>';
      h += '</tr>';
    });

    h += '</tbody></table>';
    h += '<div style="font-size:0.58rem;color:var(--muted);margin-top:0.4rem;">\u2B50 = current stock. <span class="peer-best">Green</span> = best in group. <span class="peer-worst">Red</span> = worst in group.</div>';
    el.innerHTML = h;
  }

  // --- News ---
  function renderDetailNews(symbol, c) {
    var el = document.getElementById('detail-news');
    var btn = document.getElementById('detail-news-refresh-btn');
    btn.onclick = function() { refreshNews(symbol); };
    if (!c.articles) { el.innerHTML = '<div class="tile-loading">Loading...</div>'; return; }
    if (!c.articles.length) { el.innerHTML = '<div class="news-empty">No recent news.</div>'; return; }
    var h = '';
    if (c.newsUpdatedAt) {
      h += '<div class="news-updated">Updated: ' + c.newsUpdatedAt + '</div>';
    }
    h += c.articles.map(function(a) {
      var sm = a.summary ? '<div class="news-summary">' + (a.summary.length > 180 ? a.summary.slice(0,180) + '\u2026' : a.summary) + '</div>' : '';
      return '<a class="news-item" href="' + a.url + '" target="_blank" rel="noopener"><div class="news-title">' + a.title + '</div><div class="news-meta"><span class="news-source">' + a.publisher + '</span><span class="news-date">' + a.date + '</span></div>' + sm + '</a>';
    }).join('');
    el.innerHTML = h;
  }

  async function refreshNews(symbol) {
    var el = document.getElementById('detail-news');
    var btn = document.getElementById('detail-news-refresh-btn');
    if (!StockAPI.hasKey() || !symbol) return;
    btn.disabled = true; btn.textContent = 'Refreshing\u2026';
    el.innerHTML = '<div class="tile-loading">Fetching latest news...</div>';
    try {
      if (!cache[symbol]) cache[symbol] = {};
      cache[symbol].articles = await StockAPI.getNews(symbol);
      cache[symbol].newsUpdatedAt = new Date().toLocaleTimeString();
      // Invalidate stale AI results that depend on news
      delete cache[symbol].aiResult;
      delete cache[symbol].verdictResult;
      if (selectedSymbol === symbol) {
        renderDetailNews(symbol, cache[symbol]);
        renderDetailAI(symbol, cache[symbol]);
        renderDetailVerdict(symbol, cache[symbol]);
      }
      if (NewsAI.hasKey() && cache[symbol].articles && cache[symbol].articles.length) {
        runAIAnalysis(symbol);
      }
    } catch (e) {
      el.innerHTML = '<div class="error-msg">Failed to refresh: ' + e.message + '</div>';
    }
    btn.disabled = false; btn.textContent = 'Refresh';
  }

  // --- Data loading ---
  async function loadQuote(symbol) {
    try {
      var q = await StockAPI.getQuote(symbol);
      if (!cache[symbol]) cache[symbol] = {};
      cache[symbol].quote = q;
    } catch (e) { console.warn('Quote error for ' + symbol + ':', e.message); }
  }

  async function loadProfileAndFinancials(symbol, type) {
    if (!cache[symbol]) cache[symbol] = {};
    try {
      if (type !== 'ETF') {
        var results = await Promise.all([
          StockAPI.getProfile(symbol),
          StockAPI.getBasicFinancials(symbol)
        ]);
        if (results[0]) cache[symbol].profile = results[0];
        if (results[1]) cache[symbol].financials = results[1];
      } else {
        var profile = await StockAPI.getProfile(symbol);
        if (profile) cache[symbol].profile = profile;
        var fin = await StockAPI.getBasicFinancials(symbol);
        if (fin) cache[symbol].financials = fin;
      }
    } catch (e) { console.warn('Profile/financials error for ' + symbol + ':', e.message); }
  }

  async function loadNews(symbol) {
    if (!cache[symbol]) cache[symbol] = {};
    try {
      cache[symbol].articles = await StockAPI.getNews(symbol);
    } catch (e) {
      console.warn('News error for ' + symbol + ':', e.message);
      cache[symbol].articles = [];
    }
  }

  async function loadAnalystData(symbol) {
    if (!cache[symbol]) cache[symbol] = {};
    // Load independently — getUpgradeDowngrade is premium-only and will fail on free tier
    try {
      cache[symbol].recommendations = await StockAPI.getRecommendations(symbol) || [];
    } catch (e) {
      console.warn('Recommendations error for ' + symbol + ':', e.message);
      cache[symbol].recommendations = [];
    }
    try {
      cache[symbol].upgrades = await StockAPI.getUpgradeDowngrade(symbol) || [];
    } catch (e) {
      console.warn('Upgrades error (premium endpoint) for ' + symbol + ':', e.message);
      cache[symbol].upgrades = [];
    }
  }

  async function loadMacroNews(symbol) {
    if (!cache[symbol]) cache[symbol] = {};
    try {
      cache[symbol].macroArticles = await StockAPI.getMarketNews();
    } catch (e) {
      console.warn('Macro news error:', e.message);
      cache[symbol].macroArticles = [];
    }
  }

  async function loadEarningsData(symbol) {
    if (!cache[symbol]) cache[symbol] = {};
    try {
      cache[symbol].earnings = await StockAPI.getEarnings(symbol);
    } catch (e) {
      console.warn('Earnings error for ' + symbol + ':', e.message);
      cache[symbol].earnings = [];
    }
    try {
      cache[symbol].earningsCalendar = await StockAPI.getEarningsCalendar(symbol);
    } catch (e) {
      console.warn('Earnings calendar error for ' + symbol + ':', e.message);
      cache[symbol].earningsCalendar = null;
    }
  }

  async function loadInsiderData(symbol) {
    if (!cache[symbol]) cache[symbol] = {};
    try {
      cache[symbol].insiderTrades = await StockAPI.getInsiderTransactions(symbol);
    } catch (e) {
      console.warn('Insider trades error for ' + symbol + ':', e.message);
      cache[symbol].insiderTrades = [];
    }
  }

  async function loadETFHoldings(symbol) {
    if (!cache[symbol]) cache[symbol] = {};
    try {
      cache[symbol].etfHoldings = await StockAPI.getETFHoldings(symbol);
    } catch (e) {
      console.warn('ETF holdings error for ' + symbol + ':', e.message);
      cache[symbol].etfHoldings = null;
    }
  }

  async function loadStockData(symbol, type) {
    if (!StockAPI.hasKey()) return;
    type = type || 'Equity';

    // Snapshot old data fingerprints before refresh
    var c = cache[symbol] || {};
    var oldEarningsPeriod = (c.earnings && c.earnings.length) ? c.earnings[0].period : null;
    var oldArticleCount = c.articles ? c.articles.length : 0;
    var oldFirstArticle = (c.articles && c.articles.length) ? c.articles[0].title : null;

    await loadQuote(symbol);
    renderSidebar();
    if (selectedSymbol === symbol) renderDetail(symbol);

    await loadProfileAndFinancials(symbol, type);
    if (selectedSymbol === symbol) renderDetail(symbol);

    var dataLoaders = [loadNews(symbol), loadAnalystData(symbol), loadMacroNews(symbol), loadEarningsData(symbol)];
    if (type === 'ETF') {
      dataLoaders.push(loadETFHoldings(symbol));
    } else {
      dataLoaders.push(loadInsiderData(symbol));
    }
    await Promise.all(dataLoaders);
    if (selectedSymbol === symbol) renderDetail(symbol);

    // Determine what changed to decide which AI results to invalidate
    var nc = cache[symbol] || {};
    var newEarningsPeriod = (nc.earnings && nc.earnings.length) ? nc.earnings[0].period : null;
    var newFirstArticle = (nc.articles && nc.articles.length) ? nc.articles[0].title : null;
    var newsChanged = newFirstArticle !== oldFirstArticle;
    var earningsChanged = newEarningsPeriod !== oldEarningsPeriod;

    // Invalidate AI results only if underlying data changed
    if (newsChanged) {
      delete nc.aiResult;
      delete nc.macroAIResult;
    }
    if (earningsChanged) {
      delete nc.transcriptAIResult;
      delete nc.transcriptCachedPeriod;
      delete nc.avTranscript;
    }
    // Always invalidate verdict on refresh so user regenerates with latest data
    delete nc.verdictResult;

    if (selectedSymbol === symbol) renderDetail(symbol);

    // Auto-run AI sequentially with delays to avoid Groq rate limits
    if (NewsAI.hasKey() && cache[symbol]) {
      autoRunAI(symbol);
    }
  }

  async function autoRunAI(symbol) {
    var c = cache[symbol];
    if (!c) return;
    try {
      if (c.articles && c.articles.length && !c.aiResult) {
        await runAIAnalysis(symbol);
        await delay(1500);
      }
      if (((c.recommendations && c.recommendations.length) || (c.upgrades && c.upgrades.length)) && !c.analystAIResult) {
        await runAnalystAnalysis(symbol);
        await delay(1500);
      }
      if (c.macroArticles && c.macroArticles.length && !c.macroAIResult) {
        await runMacroAnalysis(symbol);
      }
    } catch (e) {
      console.warn('Auto AI error:', e.message);
    }
  }

  function delay(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); }

  // --- Auto-refresh ---
  function refreshAll() {
    if (!StockAPI.hasKey() || !trackedStocks.length) return;
    trackedStocks.forEach(function(s) {
      loadStockData(s.symbol, s.type);
    });
  }

  function startAutoRefresh() {
    if (refreshTimer) return;
    refreshTimer = setInterval(refreshAll, 60000);
  }

  function stopAutoRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  }

  // --- Utility ---
  function fmtNum(num) {
    if (!num) return 'N/A';
    if (num >= 1e12) return '$' + (num / 1e12).toFixed(2) + 'T';
    if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
    return '$' + num.toLocaleString();
  }

  // --- Init ---
  function init() {
    if (!StockAPI.hasKey()) {
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
      keyInput.value = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
    }
    if (NewsAI.hasKey()) {
      groqKeyInput.value = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
    }
    if (AlphaAPI.hasKey()) {
      avKeyInput.value = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
    }
    renderSidebar();
    if (trackedStocks.length) {
      trackedStocks.forEach(function(s) { loadStockData(s.symbol, s.type); });
      selectStock(trackedStocks[0].symbol);
      startAutoRefresh();
    } else {
      showEmpty();
    }
  }

  init();
})();
