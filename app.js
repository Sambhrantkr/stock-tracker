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
  var groqKey2Input = document.getElementById('groq-key2-input');
  var geminiKeyInput = document.getElementById('gemini-key-input');
  var avKeyInput = document.getElementById('av-key-input');
  var avKey2Input = document.getElementById('av-key2-input');
  var avKey3Input = document.getElementById('av-key3-input');
  var avKey4Input = document.getElementById('av-key4-input');
  var fhKey2Input = document.getElementById('fh-key2-input');
  var reportEmailInput = document.getElementById('report-email-input');
  var saveKeyBtn = document.getElementById('save-key-btn');
  var settingsBtn = document.getElementById('settings-btn');

  // --- User-scoped storage helpers ---
  function userGet(key, fallback) {
    var raw = Auth.isLoggedIn() ? Auth.getItem(key) : localStorage.getItem(key);
    if (raw == null) return fallback !== undefined ? fallback : null;
    try { return JSON.parse(raw); } catch(e) { return raw; }
  }
  function userSet(key, value) {
    var str = typeof value === 'string' ? value : JSON.stringify(value);
    if (Auth.isLoggedIn()) Auth.setItem(key, str); else localStorage.setItem(key, str);
  }

  var trackedStocks = [];
  function loadTrackedStocks() {
    trackedStocks = userGet('tracked_stocks', []);
    if (trackedStocks.length && typeof trackedStocks[0] === 'string') {
      trackedStocks = trackedStocks.map(function(s) { return { symbol: s, type: 'Equity' }; });
      saveTracked();
    }
  }
  var selectedSymbol = null;
  var peChart = null;
  var searchTimeout = null;
  var highlightIndex = -1;
  var refreshTimer = null;
  var cache = {};

  StockAPI.onStatus(function(msg) { statusBar.textContent = msg; statusBar.classList.toggle('hidden', !msg); });

  // --- Error toast notification system ---
  var toastContainer = null;
  var toastTimeout = null;
  function showError(msg, duration) {
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'error-toast-container';
      toastContainer.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:200;display:flex;flex-direction:column;gap:0.4rem;max-width:380px;';
      document.body.appendChild(toastContainer);
    }
    var toast = document.createElement('div');
    toast.style.cssText = 'background:#2a1215;border:1px solid var(--red,#ef4444);color:#fca5a5;padding:0.6rem 0.8rem;border-radius:8px;font-size:0.75rem;line-height:1.4;box-shadow:0 4px 12px rgba(0,0,0,0.4);display:flex;align-items:flex-start;gap:0.4rem;animation:slideIn 0.2s ease-out;';
    toast.innerHTML = '<span style="flex-shrink:0;">⚠️</span><span style="flex:1;">' + msg + '</span><button style="background:none;border:none;color:#fca5a5;cursor:pointer;font-size:1rem;padding:0;line-height:1;flex-shrink:0;" onclick="this.parentElement.remove()">&times;</button>';
    toastContainer.appendChild(toast);
    var removeTimer = setTimeout(function() { if (toast.parentElement) toast.remove(); }, duration || 6000);
    toast.querySelector('button').addEventListener('click', function() { clearTimeout(removeTimer); });
    // Limit to 4 visible toasts
    while (toastContainer.children.length > 4) { toastContainer.removeChild(toastContainer.firstChild); }
  }

  function showWarning(msg, duration) {
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'error-toast-container';
      toastContainer.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:200;display:flex;flex-direction:column;gap:0.4rem;max-width:380px;';
      document.body.appendChild(toastContainer);
    }
    var toast = document.createElement('div');
    toast.style.cssText = 'background:#2a2010;border:1px solid #f59e0b;color:#fcd34d;padding:0.6rem 0.8rem;border-radius:8px;font-size:0.75rem;line-height:1.4;box-shadow:0 4px 12px rgba(0,0,0,0.4);display:flex;align-items:flex-start;gap:0.4rem;animation:slideIn 0.2s ease-out;';
    toast.innerHTML = '<span style="flex-shrink:0;">⚡</span><span style="flex:1;">' + msg + '</span><button style="background:none;border:none;color:#fcd34d;cursor:pointer;font-size:1rem;padding:0;line-height:1;flex-shrink:0;" onclick="this.parentElement.remove()">&times;</button>';
    toastContainer.appendChild(toast);
    var removeTimer = setTimeout(function() { if (toast.parentElement) toast.remove(); }, duration || 5000);
    toast.querySelector('button').addEventListener('click', function() { clearTimeout(removeTimer); });
    while (toastContainer.children.length > 4) { toastContainer.removeChild(toastContainer.firstChild); }
  }

  // --- API Keys ---
  saveKeyBtn.addEventListener('click', function() {
    var fk = keyInput.value.trim(), gk = groqKeyInput.value.trim(), ak = avKeyInput.value.trim();
    var gk2 = groqKey2Input ? groqKey2Input.value.trim() : '';
    var gmk = geminiKeyInput ? geminiKeyInput.value.trim() : '';
    var em = reportEmailInput ? reportEmailInput.value.trim() : '';
    if (fk && fk.indexOf('\u2022') !== 0) StockAPI.setKey(fk);
    var fk2 = fhKey2Input ? fhKey2Input.value.trim() : '';
    if (fk2 && fk2.indexOf('\u2022') !== 0) StockAPI.setKey2(fk2);
    if (gk && gk.indexOf('\u2022') !== 0) NewsAI.setKey(gk);
    if (gk2 && gk2.indexOf('\u2022') !== 0) NewsAI.setKey2(gk2);
    if (gmk && gmk.indexOf('\u2022') !== 0) NewsAI.setGeminiKey(gmk);
    if (ak && ak.indexOf('\u2022') !== 0) AlphaAPI.setKey(ak);
    var ak2 = avKey2Input ? avKey2Input.value.trim() : '';
    if (ak2 && ak2.indexOf('\u2022') !== 0) AlphaAPI.setKey2(ak2);
    var ak3 = avKey3Input ? avKey3Input.value.trim() : '';
    if (ak3 && ak3.indexOf('\u2022') !== 0) AlphaAPI.setKey3(ak3);
    var ak4 = avKey4Input ? avKey4Input.value.trim() : '';
    if (ak4 && ak4.indexOf('\u2022') !== 0) AlphaAPI.setKey4(ak4);
    if (em) localStorage.setItem('report_email', em);
    else if (em === '') localStorage.removeItem('report_email');
    if (StockAPI.hasKey()) banner.classList.add('hidden');
    keyInput.value = StockAPI.hasKey() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    if (fhKey2Input) fhKey2Input.value = StockAPI.hasKey2() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    groqKeyInput.value = NewsAI.hasKey() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    if (groqKey2Input) groqKey2Input.value = NewsAI.hasKey2() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    if (geminiKeyInput) geminiKeyInput.value = NewsAI.hasGeminiKey() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    avKeyInput.value = AlphaAPI.hasKey() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    if (avKey2Input) avKey2Input.value = AlphaAPI.hasKey2() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    if (avKey3Input) avKey3Input.value = AlphaAPI.hasKey3() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    if (avKey4Input) avKey4Input.value = AlphaAPI.hasKey4() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    if (reportEmailInput) reportEmailInput.value = localStorage.getItem('report_email') || '';
    if (StockAPI.hasKey()) refreshAll();
  });
  if (settingsBtn) settingsBtn.addEventListener('click', function() {
    banner.classList.toggle('hidden');
    keyInput.value = StockAPI.hasKey() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    if (fhKey2Input) fhKey2Input.value = StockAPI.hasKey2() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    groqKeyInput.value = NewsAI.hasKey() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    if (groqKey2Input) groqKey2Input.value = NewsAI.hasKey2() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    if (geminiKeyInput) geminiKeyInput.value = NewsAI.hasGeminiKey() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    avKeyInput.value = AlphaAPI.hasKey() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    if (avKey2Input) avKey2Input.value = AlphaAPI.hasKey2() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    if (avKey3Input) avKey3Input.value = AlphaAPI.hasKey3() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    if (avKey4Input) avKey4Input.value = AlphaAPI.hasKey4() ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '';
    if (reportEmailInput) reportEmailInput.value = localStorage.getItem('report_email') || '';
  });
  var aboutBtn = document.getElementById('about-btn');
  var aboutModal = document.getElementById('about-modal');
  var aboutClose = document.getElementById('about-close');
  if (aboutBtn) aboutBtn.addEventListener('click', function() { aboutModal.classList.remove('hidden'); });
  if (aboutClose) aboutClose.addEventListener('click', function() { aboutModal.classList.add('hidden'); });
  if (aboutModal) aboutModal.addEventListener('click', function(e) { if (e.target === aboutModal) aboutModal.classList.add('hidden'); });
  var portfolioBriefModal = document.getElementById('portfolio-brief-modal');
  var portfolioBriefContent = document.getElementById('portfolio-brief-content');
  var portfolioBriefClose = document.getElementById('portfolio-brief-close');
  if (portfolioBriefClose) portfolioBriefClose.addEventListener('click', function() { portfolioBriefModal.classList.add('hidden'); });
  if (portfolioBriefModal) portfolioBriefModal.addEventListener('click', function(e) { if (e.target === portfolioBriefModal) portfolioBriefModal.classList.add('hidden'); });
  var guideModal = document.getElementById('guide-modal');
  var guideClose = document.getElementById('guide-close');
  var guideBtn = document.getElementById('guide-btn');
  var loginGuideBtn = document.getElementById('login-guide-btn');
  function openGuide() { if (guideModal) guideModal.classList.remove('hidden'); }
  function closeGuide() { if (guideModal) guideModal.classList.add('hidden'); }
  if (guideBtn) guideBtn.addEventListener('click', openGuide);
  if (loginGuideBtn) loginGuideBtn.addEventListener('click', openGuide);
  if (guideClose) guideClose.addEventListener('click', closeGuide);
  if (guideModal) guideModal.addEventListener('click', function(e) { if (e.target === guideModal) closeGuide(); });
  keyInput.addEventListener('focus', function() { if (keyInput.value.indexOf('\u2022') === 0) keyInput.value = ''; });
  groqKeyInput.addEventListener('focus', function() { if (groqKeyInput.value.indexOf('\u2022') === 0) groqKeyInput.value = ''; });
  if (groqKey2Input) groqKey2Input.addEventListener('focus', function() { if (groqKey2Input.value.indexOf('\u2022') === 0) groqKey2Input.value = ''; });
  if (geminiKeyInput) geminiKeyInput.addEventListener('focus', function() { if (geminiKeyInput.value.indexOf('\u2022') === 0) geminiKeyInput.value = ''; });
  avKeyInput.addEventListener('focus', function() { if (avKeyInput.value.indexOf('\u2022') === 0) avKeyInput.value = ''; });
  if (avKey2Input) avKey2Input.addEventListener('focus', function() { if (avKey2Input.value.indexOf('\u2022') === 0) avKey2Input.value = ''; });
  if (avKey3Input) avKey3Input.addEventListener('focus', function() { if (avKey3Input.value.indexOf('\u2022') === 0) avKey3Input.value = ''; });
  if (avKey4Input) avKey4Input.addEventListener('focus', function() { if (avKey4Input.value.indexOf('\u2022') === 0) avKey4Input.value = ''; });
  if (fhKey2Input) fhKey2Input.addEventListener('focus', function() { if (fhKey2Input.value.indexOf('\u2022') === 0) fhKey2Input.value = ''; });
  function saveTracked() { userSet('tracked_stocks', trackedStocks); }

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
    try {
      showSuggestions(await StockAPI.searchTicker(q));
    } catch(e) {
      closeSuggestions();
      if (e.message && e.message.indexOf('Rate limit') !== -1) {
        showWarning('Search rate limited. Wait a moment.');
      } else if (e.message && e.message.indexOf('Network') !== -1) {
        showError('Network error — check your internet connection.');
      }
    }
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
    saveTracked(); renderSidebar();
    loadStockData(symbol, type).catch(function(e) {
      showError('Failed to load ' + symbol + ': ' + e.message);
    });
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
    activeAutoRunSymbol = null; // abort any running autoRunAI for the old stock
    emptyState.classList.add('hidden'); detailView.classList.remove('hidden');
    stockListEl.querySelectorAll('.stock-item').forEach(function(el) { el.classList.toggle('active', el.dataset.symbol === symbol); });
    // Scroll main panel to top so user sees fresh header
    var mainPanel = document.getElementById('main-panel');
    if (mainPanel) mainPanel.scrollTop = 0;
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
    // Clear all render-hidden flags before re-rendering (each render function will re-set as needed)
    var grid = document.getElementById('tiles-grid');
    if (grid) {
      grid.querySelectorAll('.tile[data-render-hidden]').forEach(function(t) {
        t.removeAttribute('data-render-hidden');
      });
    }
    var renders = [
      function() { renderDetailHeader(symbol, c, s); },
      function() { renderDetailVerdict(symbol, c); },
      function() { renderDetailAboutCompany(symbol, c, s); },
      function() { renderDetailKPIs(symbol, c, s); },
      function() { renderDetailPE(symbol, c, s); },
      function() { renderDetailTechnicals(symbol, c, s); },
      function() { renderDetailETFHoldings(symbol, c, s); },
      function() { renderDetailRevenue(symbol, c, s); },
      function() { renderDetailEarnings(symbol, c, s); },
      function() { renderDetailCashFlow(symbol, c, s); },
      function() { renderDetailBalanceSheet(symbol, c, s); },
      function() { renderDetailDividends(symbol, c, s); },
      function() { renderDetailFundamentals(symbol, c, s); },
      function() { renderDetailInsider(symbol, c, s); },
      function() { renderDetailAI(symbol, c); },
      function() { renderDetailAnalyst(symbol, c); },
      function() { renderDetailMacro(symbol, c); },
      function() { renderDetailTranscript(symbol, c); },
      function() { renderDetailPeers(symbol, c); },
      function() { renderDetailAlerts(symbol, c); },
      function() { renderDetailNews(symbol, c); },
      function() { renderDetailSectorStrength(symbol, c, s); },
      function() { renderDetailValScorecard(symbol, c, s); },
      function() { renderDetailEPSEstimates(symbol, c, s); },
      function() { renderDetailOptionsFlow(symbol, c, s); },
      function() { renderDetailCorrelation(symbol, c, s); },
      function() { renderDetailFairValue(symbol, c, s); },
    ];
    renders.forEach(function(fn) {
      try { fn(); } catch (e) { console.warn('Render error:', e.message); }
    });
    applyTileOrder();
    updateAVBudgetIndicator();
  }

  // Show remaining AV calls on AV-dependent buttons
  function updateAVBudgetIndicator() {
    if (!AlphaAPI.hasKey()) return;
    var remaining = AlphaAPI.getAVCallsRemaining();
    var avBtns = ['detail-revenue-btn','detail-cashflow-btn','detail-balancesheet-btn','detail-technicals-btn'];
    avBtns.forEach(function(id) {
      var btn = document.getElementById(id);
      if (!btn || btn.disabled) return;
      var base = btn.textContent.replace(/\s*\(\d+\)$/, '');
      btn.textContent = base + ' (' + remaining + ')';
      if (remaining <= 0) { btn.title = 'Alpha Vantage daily limit reached. Cached data may still load.'; }
    });
    // Show/update the AV budget bar in settings if it exists
    var budgetEl = document.getElementById('av-budget-display');
    if (budgetEl) {
      var numKeys = 1 + (AlphaAPI.hasKey2() ? 1 : 0) + (AlphaAPI.hasKey3() ? 1 : 0) + (AlphaAPI.hasKey4() ? 1 : 0);
      var total = numKeys * 25;
      var used = total - remaining;
      var keyLabel = numKeys > 1 ? ' (' + numKeys + ' keys)' : '';
      budgetEl.innerHTML = 'AV calls: ' + remaining + '/' + total + ' remaining' + keyLabel + ' (resets midnight EST)'
        + ' <button id="av-reset-btn" style="font-size:0.6rem;padding:0.1rem 0.4rem;margin-left:0.3rem;cursor:pointer;background:none;border:1px solid var(--border);color:var(--muted);border-radius:3px;">Reset</button>';
      var resetBtn = document.getElementById('av-reset-btn');
      if (resetBtn) {
        resetBtn.onclick = function() {
          if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) Auth.removeItem('av_call_log');
          else localStorage.removeItem('av_call_log');
          updateAVBudgetIndicator();
          if (selectedSymbol) renderDetail(selectedSymbol);
        };
      }
    }
  }
  // --- Tile drag-and-drop reordering ---
  var DEFAULT_TILE_ORDER = [
    'tile-verdict','tile-chart',
    'tile-kpis','tile-pe','tile-revenue',
    'tile-about-company','tile-dividends',
    'tile-earnings','tile-insider',
    'tile-technicals',
    'tile-cashflow','tile-alerts',
    'tile-balancesheet','tile-ai',
    'tile-sector-strength','tile-val-scorecard','tile-eps-estimates',
    'tile-fundamentals',
    'tile-analyst','tile-macro','tile-transcript',
    'tile-options-flow','tile-fair-value',
    'tile-correlation',
    'tile-peers','tile-etf-holdings','tile-news'
  ];
  var dragSrcEl = null;

  function getSavedTileOrder() {
    var saved = userGet('tile_order', null);
    if (!saved || !Array.isArray(saved) || !saved.length) return null;
    return saved;
  }

  function saveTileOrder(order) {
    userSet('tile_order', order);
  }

  function getCurrentTileOrder() {
    var grid = document.getElementById('tiles-grid');
    if (!grid) return DEFAULT_TILE_ORDER.slice();
    var order = [];
    var children = grid.children;
    for (var i = 0; i < children.length; i++) {
      if (children[i].id && children[i].classList.contains('tile')) {
        order.push(children[i].id);
      }
    }
    return order;
  }

  function applyTileOrder() {
    var grid = document.getElementById('tiles-grid');
    if (!grid) return;
    var order = getSavedTileOrder() || DEFAULT_TILE_ORDER;
    var hidden = getHiddenTiles();
    // Collect all tile elements
    var tiles = {};
    var children = Array.prototype.slice.call(grid.children);
    children.forEach(function(el) {
      if (el.id && el.classList.contains('tile')) tiles[el.id] = el;
    });
    // Build ordered list: user order first, then any new tiles
    var orderedIds = [];
    order.forEach(function(id) { if (tiles[id]) orderedIds.push(id); });
    Object.keys(tiles).forEach(function(id) { if (orderedIds.indexOf(id) === -1) orderedIds.push(id); });

    // Separate visible tiles into full-width, multi-col, and single-col for optimal packing
    var fullWidth = []; // 3 cols (1/-1)
    var multiCol = [];  // 2 cols (span 2)
    var singleCol = []; // 1 col (span 1)
    var FULL_TILES = ['tile-verdict','tile-chart','tile-fundamentals','tile-news','tile-peers','tile-correlation','tile-etf-holdings'];
    var MULTI_TILES = ['tile-about-company','tile-earnings','tile-technicals','tile-cashflow','tile-balancesheet','tile-fair-value','tile-revenue'];

    orderedIds.forEach(function(id) {
      if (hidden.indexOf(id) !== -1) return; // skip hidden
      var el = tiles[id];
      if (!el) return;
      if (el.style.display === 'none') return; // skip ETF-hidden tiles
      if (FULL_TILES.indexOf(id) !== -1) fullWidth.push(id);
      else if (MULTI_TILES.indexOf(id) !== -1) multiCol.push(id);
      else singleCol.push(id);
    });

    // Repack: interleave multi-col and single-col tiles to fill rows
    // Strategy: place tiles row by row, 3 cols per row
    var packed = [];
    var mi = 0, si = 0;
    // First, add full-width tiles that should be at the top (verdict, chart)
    var topFull = ['tile-verdict', 'tile-chart'];
    topFull.forEach(function(id) {
      if (fullWidth.indexOf(id) !== -1) {
        packed.push(id);
        fullWidth.splice(fullWidth.indexOf(id), 1);
      }
    });

    // Pull news tile out — it always goes last
    var newsIdx = fullWidth.indexOf('tile-news');
    var hasNews = newsIdx !== -1;
    if (hasNews) fullWidth.splice(newsIdx, 1);

    // Now pack remaining tiles row by row
    var colsLeft = 3;
    while (mi < multiCol.length || si < singleCol.length || fullWidth.length) {
      if (colsLeft === 3 && fullWidth.length) {
        // Full-width tile fills entire row
        packed.push(fullWidth.shift());
        colsLeft = 3;
        continue;
      }
      if (colsLeft >= 2 && mi < multiCol.length) {
        packed.push(multiCol[mi++]);
        colsLeft -= 2;
      } else if (colsLeft >= 1 && si < singleCol.length) {
        packed.push(singleCol[si++]);
        colsLeft -= 1;
      } else {
        // Row is full or can't fit anything, start new row
        if (colsLeft === 3) {
          // Nothing fits — shouldn't happen, but break to avoid infinite loop
          if (mi < multiCol.length) { packed.push(multiCol[mi++]); colsLeft = 1; }
          else break;
        }
        colsLeft = 3;
      }
      if (colsLeft === 0) colsLeft = 3;
    }
    // Add any remaining full-width tiles at the end
    fullWidth.forEach(function(id) { packed.push(id); });
    // News tile always goes last
    if (hasNews) packed.push('tile-news');

    // Also add hidden tiles at the end (they won't display but need to stay in DOM)
    orderedIds.forEach(function(id) {
      if (packed.indexOf(id) === -1 && tiles[id]) packed.push(id);
    });

    // Apply the packed order to the DOM
    packed.forEach(function(id) {
      if (tiles[id]) grid.appendChild(tiles[id]);
    });

    // Ensure drag handles and minimize buttons exist
    initDragHandles();
    applyCollapsedState();
    applyTileVisibility();
  }

  function getCollapsedTiles() {
    return userGet('collapsed_tiles', []);
  }
  function saveCollapsedTiles(arr) {
    userSet('collapsed_tiles', arr);
  }
  function toggleCollapse(tile) {
    var collapsed = getCollapsedTiles();
    var id = tile.id;
    var idx = collapsed.indexOf(id);
    if (idx >= 0) {
      collapsed.splice(idx, 1);
      tile.classList.remove('collapsed');
    } else {
      collapsed.push(id);
      tile.classList.add('collapsed');
    }
    saveCollapsedTiles(collapsed);
    // Update button text
    var btn = tile.querySelector('.tile-minimize-btn');
    if (btn) btn.textContent = tile.classList.contains('collapsed') ? '▼' : '▲';
  }
  function applyCollapsedState() {
    var grid = document.getElementById('tiles-grid');
    if (!grid) return;
    var collapsed = getCollapsedTiles();
    var tiles = grid.querySelectorAll('.tile');
    tiles.forEach(function(tile) {
      if (collapsed.indexOf(tile.id) >= 0) {
        tile.classList.add('collapsed');
      } else {
        tile.classList.remove('collapsed');
      }
      var btn = tile.querySelector('.tile-minimize-btn');
      if (btn) btn.textContent = tile.classList.contains('collapsed') ? '▼' : '▲';
    });
  }

  function initDragHandles() {
    var grid = document.getElementById('tiles-grid');
    if (!grid) return;
    var tiles = grid.querySelectorAll('.tile');
    tiles.forEach(function(tile) {
      if (tile.querySelector('.tile-drag-handle')) return; // already has handle
      var handle = document.createElement('span');
      handle.className = 'tile-drag-handle';
      handle.textContent = '⠿';
      handle.title = 'Drag to reorder';
      handle.setAttribute('aria-label', 'Drag to reorder tile');
      tile.insertBefore(handle, tile.firstChild);

      var minBtn = document.createElement('button');
      minBtn.className = 'tile-minimize-btn';
      minBtn.textContent = tile.classList.contains('collapsed') ? '▼' : '▲';
      minBtn.title = 'Collapse / Expand';
      minBtn.setAttribute('aria-label', 'Collapse or expand tile');
      minBtn.addEventListener('click', function(e) { e.stopPropagation(); toggleCollapse(tile); });
      tile.insertBefore(minBtn, tile.firstChild);

      tile.setAttribute('draggable', 'false');

      // Drag starts from handle only
      handle.addEventListener('mousedown', function() { tile.setAttribute('draggable', 'true'); });
      handle.addEventListener('touchstart', function() { tile.setAttribute('draggable', 'true'); }, { passive: true });

      tile.addEventListener('dragstart', function(e) {
        dragSrcEl = tile;
        tile.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tile.id);
      });
      tile.addEventListener('dragend', function() {
        tile.classList.remove('dragging');
        tile.setAttribute('draggable', 'false');
        dragSrcEl = null;
        // Remove all drag-over states
        grid.querySelectorAll('.drag-over').forEach(function(el) { el.classList.remove('drag-over'); });
      });
      tile.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragSrcEl && dragSrcEl !== tile) tile.classList.add('drag-over');
      });
      tile.addEventListener('dragleave', function() {
        tile.classList.remove('drag-over');
      });
      tile.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        tile.classList.remove('drag-over');
        if (!dragSrcEl || dragSrcEl === tile) return;
        // Determine drop position: before or after target
        var rect = tile.getBoundingClientRect();
        var midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          grid.insertBefore(dragSrcEl, tile);
        } else {
          grid.insertBefore(dragSrcEl, tile.nextSibling);
        }
        saveTileOrder(getCurrentTileOrder());
      });
    });
  }

  // Reset layout button
  var resetLayoutBtn = document.getElementById('reset-layout-btn');
  if (resetLayoutBtn) {
    resetLayoutBtn.addEventListener('click', function() {
      userSet('tile_order', DEFAULT_TILE_ORDER);
      saveCollapsedTiles([]);
      saveHiddenTiles([]);
      if (selectedSymbol) applyTileOrder();
    });
  }
  var collapseAllBtn = document.getElementById('collapse-all-btn');
  if (collapseAllBtn) {
    collapseAllBtn.addEventListener('click', function() {
      var grid = document.getElementById('tiles-grid');
      if (!grid) return;
      var all = [];
      grid.querySelectorAll('.tile').forEach(function(t) { all.push(t.id); t.classList.add('collapsed'); var b = t.querySelector('.tile-minimize-btn'); if (b) b.textContent = '▼'; });
      saveCollapsedTiles(all);
    });
  }
  var expandAllBtn = document.getElementById('expand-all-btn');
  if (expandAllBtn) {
    expandAllBtn.addEventListener('click', function() {
      var grid = document.getElementById('tiles-grid');
      if (!grid) return;
      grid.querySelectorAll('.tile').forEach(function(t) { t.classList.remove('collapsed'); var b = t.querySelector('.tile-minimize-btn'); if (b) b.textContent = '▲'; });
      saveCollapsedTiles([]);
    });
  }

  // --- Download PDF ---
  var downloadPdfBtn = document.getElementById('download-pdf-btn');
  if (downloadPdfBtn) {
    downloadPdfBtn.addEventListener('click', async function() {
      if (!selectedSymbol) { showWarning('Select a stock first.'); return; }
      var btn = downloadPdfBtn;
      btn.disabled = true;
      btn.textContent = 'Generating PDF…';

      try {
        // Expand all tiles temporarily so PDF captures everything
        var grid = document.getElementById('tiles-grid');
        var wasCollapsed = [];
        if (grid) {
          grid.querySelectorAll('.tile.collapsed').forEach(function(t) {
            wasCollapsed.push(t.id);
            t.classList.remove('collapsed');
          });
        }

        // Small delay for DOM to settle
        await new Promise(function(r) { setTimeout(r, 300); });

        var jsPDF = window.jspdf.jsPDF;
        var pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        var pageW = pdf.internal.pageSize.getWidth();
        var pageH = pdf.internal.pageSize.getHeight();
        var margin = 8;
        var usableW = pageW - margin * 2;
        var cursorY = margin;

        // Capture helper
        async function captureToPDF(el) {
          if (!el || el.offsetHeight === 0 || el.style.display === 'none') return;
          var canvas = await html2canvas(el, {
            backgroundColor: '#0f1117',
            scale: 2,
            useCORS: true,
            logging: false,
            windowWidth: el.scrollWidth,
            removeContainer: true
          });
          var imgData = canvas.toDataURL('image/jpeg', 0.92);
          var imgW = usableW;
          var imgH = (canvas.height / canvas.width) * imgW;

          // If single tile is taller than a full page, scale it down
          if (imgH > pageH - margin * 2) {
            imgH = pageH - margin * 2;
            imgW = (canvas.width / canvas.height) * imgH;
          }

          // New page if it won't fit
          if (cursorY + imgH > pageH - margin) {
            pdf.addPage();
            cursorY = margin;
          }
          pdf.addImage(imgData, 'JPEG', margin, cursorY, imgW, imgH);
          cursorY += imgH + 3;
        }

        // 1. Capture header
        var header = document.getElementById('detail-header');
        await captureToPDF(header);

        // 2. Capture each visible tile in order
        if (grid) {
          var tiles = grid.querySelectorAll('.tile');
          for (var i = 0; i < tiles.length; i++) {
            var tile = tiles[i];
            if (tile.style.display === 'none' || tile.getAttribute('data-render-hidden') === 'true') continue;
            if (tile.offsetHeight === 0) continue;
            btn.textContent = 'Capturing ' + (i + 1) + '/' + tiles.length + '…';
            await captureToPDF(tile);
          }
        }

        // Footer on last page
        pdf.setFontSize(8);
        pdf.setTextColor(100);
        pdf.text('Stock Tracker Dashboard — ' + selectedSymbol + ' — ' + new Date().toLocaleString(), margin, pageH - 4);

        // Restore collapsed state
        wasCollapsed.forEach(function(id) {
          var t = document.getElementById(id);
          if (t) { t.classList.add('collapsed'); var b = t.querySelector('.tile-minimize-btn'); if (b) b.textContent = '▼'; }
        });

        // Save
        var c = cache[selectedSymbol];
        var name = (c && c.profile && c.profile.name) ? c.profile.name.replace(/[^a-zA-Z0-9]/g, '_') : selectedSymbol;
        var dateStr = new Date().toISOString().slice(0, 10);
        pdf.save(selectedSymbol + '_' + name + '_' + dateStr + '.pdf');

      } catch (err) {
        console.error('PDF generation failed:', err);
        showError('PDF generation failed: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '📄 Download PDF';
      }
    });
  }

  // --- Tile Visibility Manager ---
  var TILE_NAMES = {
    'tile-verdict': '🎯 AI Analyst Verdict',
    'tile-chart': '📈 TradingView Chart',
    'tile-kpis': '📋 Key Metrics',
    'tile-pe': '📊 P/E Ratio History',
    'tile-revenue': '💰 Revenue & Income',
    'tile-about-company': '🏢 About the Company',
    'tile-dividends': '💎 Dividends',
    'tile-earnings': '📅 Earnings & EPS Surprise',
    'tile-insider': '🕵️ Insider Trading',
    'tile-technicals': '📐 Technical Indicators',
    'tile-cashflow': '💵 Cash Flow Analysis',
    'tile-alerts': '🔔 Price Alerts',
    'tile-balancesheet': '🏦 Balance Sheet',
    'tile-ai': '🤖 AI News Impact',
    'tile-sector-strength': '📊 Sector Relative Strength',
    'tile-val-scorecard': '🏷️ Valuation Scorecard',
    'tile-eps-estimates': '📈 EPS Estimate Revisions',
    'tile-fundamentals': '📊 Fundamentals & Sentiment',
    'tile-analyst': '🏦 Analyst Ratings',
    'tile-macro': '🌍 Macro Impact',
    'tile-transcript': '🎙️ Earnings Call',
    'tile-options-flow': '📉 Options & Volatility',
    'tile-fair-value': '💎 Fair Value Range',
    'tile-correlation': '🔗 Watchlist Correlation',
    'tile-peers': '👥 Peer Comparison',
    'tile-etf-holdings': '🏗️ ETF Holdings',
    'tile-news': '📰 Latest News'
  };

  function getHiddenTiles() {
    return userGet('hidden_tiles', []);
  }
  function saveHiddenTiles(arr) {
    userSet('hidden_tiles', arr);
  }
  function applyTileVisibility() {
    var hidden = getHiddenTiles();
    DEFAULT_TILE_ORDER.forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      // Don't override tiles hidden by render functions (e.g. ETF-specific logic)
      if (el.getAttribute('data-render-hidden') === 'true') return;
      if (hidden.indexOf(id) !== -1) {
        el.style.display = 'none';
      } else {
        el.style.display = '';
      }
    });
  }
  function buildVisibilityPanel() {
    var panel = document.getElementById('tile-visibility-panel');
    if (!panel) return;
    var hidden = getHiddenTiles();
    var h = '<div class="tvp-header"><span>Show / Hide Tiles</span>';
    h += '<button id="tvp-show-all">Show All</button></div>';
    DEFAULT_TILE_ORDER.forEach(function(id) {
      var name = TILE_NAMES[id] || id;
      var checked = hidden.indexOf(id) === -1 ? ' checked' : '';
      h += '<label><input type="checkbox" data-tile="' + id + '"' + checked + '>' + name + '</label>';
    });
    panel.innerHTML = h;
    // Show All button
    var showAllBtn = document.getElementById('tvp-show-all');
    if (showAllBtn) {
      showAllBtn.addEventListener('click', function() {
        saveHiddenTiles([]);
        panel.querySelectorAll('input[type="checkbox"]').forEach(function(cb) { cb.checked = true; });
        applyTileVisibility();
      });
    }
    // Checkbox change handlers
    panel.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
      cb.addEventListener('change', function() {
        var tileId = cb.getAttribute('data-tile');
        var hidden = getHiddenTiles();
        if (cb.checked) {
          hidden = hidden.filter(function(h) { return h !== tileId; });
        } else {
          if (hidden.indexOf(tileId) === -1) hidden.push(tileId);
        }
        saveHiddenTiles(hidden);
        applyTileVisibility();
      });
    });
  }

  var manageTilesBtn = document.getElementById('manage-tiles-btn');
  var tileVisPanel = document.getElementById('tile-visibility-panel');
  if (manageTilesBtn && tileVisPanel) {
    manageTilesBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var isOpen = tileVisPanel.classList.contains('open');
      if (isOpen) {
        tileVisPanel.classList.remove('open');
      } else {
        buildVisibilityPanel();
        tileVisPanel.classList.add('open');
      }
    });
    document.addEventListener('click', function(e) {
      if (!tileVisPanel.contains(e.target) && e.target !== manageTilesBtn) {
        tileVisPanel.classList.remove('open');
      }
    });
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
  // --- About Company ---
  function renderDetailAboutCompany(symbol, c, s) {
    var tile = document.getElementById('tile-about-company');
    var el = document.getElementById('detail-about-company');
    if (!tile || !el) return;
    if (s && s.type === 'ETF') { tile.style.display = 'none'; tile.setAttribute('data-render-hidden', 'true'); return; }
    tile.style.display = '';
    var desc = (c.avOverview && c.avOverview.Description) ? c.avOverview.Description : null;
    var p = c.profile || {};
    if (!desc && !p.name) { el.innerHTML = '<div class="tile-loading">Loading company info...</div>'; return; }
    var h = '';
    if (desc) {
      h += '<div class="about-company-desc" id="about-desc-text">' + desc + '</div>';
      h += '<button class="about-company-toggle" id="about-desc-toggle">Show more</button>';
    } else {
      h += '<div style="font-size:0.72rem;color:var(--muted);">Add an Alpha Vantage key for full company description.</div>';
    }
    h += '<div class="about-company-meta">';
    if (p.sector) h += '<span class="about-company-tag">Sector: ' + p.sector + '</span>';
    if (p.exchange) h += '<span class="about-company-tag">' + p.exchange + '</span>';
    if (p.ipo) h += '<span class="about-company-tag">IPO: ' + p.ipo + '</span>';
    if (p.weburl) h += '<a class="about-company-tag" href="' + p.weburl + '" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;">' + p.weburl.replace(/^https?:\/\//, '') + '</a>';
    if (c.avOverview && c.avOverview.FullTimeEmployees) h += '<span class="about-company-tag">Employees: ' + parseInt(c.avOverview.FullTimeEmployees).toLocaleString() + '</span>';
    if (c.avOverview && c.avOverview.Country) h += '<span class="about-company-tag">' + c.avOverview.Country + '</span>';
    h += '</div>';
    el.innerHTML = h;
    var toggle = document.getElementById('about-desc-toggle');
    var descEl = document.getElementById('about-desc-text');
    if (toggle && descEl) {
      toggle.onclick = function() {
        descEl.classList.toggle('expanded');
        toggle.textContent = descEl.classList.contains('expanded') ? 'Show less' : 'Show more';
      };
    }
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
    // Show in-progress status if verdict is running for this stock
    if (_verdictInProgress[symbol]) {
      contentEl.innerHTML = '<div class="tile-loading">\uD83C\uDFAF ' + _verdictInProgress[symbol] + '</div>';
      btn.disabled = true; btn.textContent = 'Running\u2026';
      return;
    }
    if (!NewsAI.hasKey()) { contentEl.innerHTML = '<div class="tile-loading">Add a Groq API key to enable.</div>'; btn.disabled = true; return; }
    // Need at least quote + some other data
    if (!c.quote) { contentEl.innerHTML = '<div class="tile-loading">Waiting for data to load...</div>'; btn.disabled = true; return; }
    btn.disabled = false; btn.textContent = 'Generate Verdict';
    var freshNote = '';
    if (c._dataLoadedAt) {
      var ageMin = Math.round((Date.now() - c._dataLoadedAt) / 60000);
      freshNote = '<div style="font-size:0.6rem;color:var(--muted);margin-top:0.3rem;">Data last refreshed: ' + (ageMin < 1 ? 'just now' : ageMin + ' min ago') + '. Verdict will auto-refresh if data is older than 10 min.</div>';
    }
    var inv = buildDataInventory(c);
    var invNote = '<div style="font-size:0.6rem;color:var(--muted);margin-top:0.3rem;">' + inv.available.length + ' data sources loaded.';
    if (inv.missing.length) invNote += ' Missing: ' + inv.missing.slice(0, 5).join(', ') + (inv.missing.length > 5 ? '...' : '') + '.';
    invNote += '</div>';
    contentEl.innerHTML = '<div class="tile-loading">Click Generate Verdict. The senior analyst will auto-refresh stale data and run all AI tiles first.</div>' + freshNote + invNote;
  }

  function buildDataInventory(c) {
    var available = [];
    var missing = [];
    var stale = [];
    var ageMin = c._dataLoadedAt ? Math.round((Date.now() - c._dataLoadedAt) / 60000) : -1;
    // Detect ETF from etfHoldings presence or check trackedStocks
    var isETFData = !!(c.etfHoldings);

    // Core data
    if (c.quote) available.push('Quote'); else missing.push('Quote');
    if (c.profile && c.profile.name) available.push('Profile'); else missing.push('Profile');
    if (!isETFData) {
      if (c.financials && c.financials.peRatio) available.push('Financials'); else missing.push('Financials');
    }
    if (c.articles && c.articles.length) available.push('News (' + c.articles.length + ')'); else missing.push('News');
    if (c.recommendations && c.recommendations.length) available.push('Analyst Ratings'); else missing.push('Analyst Ratings');
    if (!isETFData) {
      if (c.earnings && c.earnings.length) available.push('Earnings (' + c.earnings.length + 'Q)'); else missing.push('Earnings');
    }
    if (c.macroArticles && c.macroArticles.length) available.push('Macro News'); else missing.push('Macro News');
    if (!isETFData) {
      if (c.insiderTrades && c.insiderTrades.length) available.push('Insider Trades'); else missing.push('Insider Trades');
    }

    // ETF-specific
    if (isETFData) {
      if (c.etfHoldings && c.etfHoldings.holdings && c.etfHoldings.holdings.length) available.push('ETF Holdings (' + c.etfHoldings.holdings.length + ')'); else missing.push('ETF Holdings');
    }

    // Optional data
    if (c.avOverview && c.avOverview.Description) available.push('Company Overview');
    if (c.avSentiment && c.avSentiment.length) available.push('Sentiment');
    if (c.rsiData && c.rsiData.length) available.push('RSI');
    if (c.macdData && c.macdData.length) available.push('MACD');
    if (c.sma50Data && c.sma50Data.length) available.push('SMA');
    if (!isETFData) {
      if (c.peers && c.peers.length) available.push('Peers (' + c.peers.length + ')');
      if (c.cashFlowData && c.cashFlowData.length) available.push('Cash Flow');
      if (c.balanceSheetData && c.balanceSheetData.length) available.push('Balance Sheet');
      if (c.epsEstimates && c.epsEstimates.quarterly && c.epsEstimates.quarterly.length) available.push('EPS Estimates');
      if (c.incomeData && c.incomeData.length) available.push('Revenue & Income');
    }

    // AI analyses
    if (c.aiResult) available.push('AI News'); else if (c.articles && c.articles.length) stale.push('AI News');
    if (c.analystAIResult) available.push('AI Analyst'); else if (c.recommendations && c.recommendations.length) stale.push('AI Analyst');
    if (c.macroAIResult) available.push('AI Macro'); else if (c.macroArticles && c.macroArticles.length) stale.push('AI Macro');
    if (!isETFData) {
      if (c.transcriptAIResult) available.push('AI Transcript');
    }
    if (c.fundamentalsResult) available.push('AI Fundamentals');
    if (c.technicalsResult) available.push('AI Technicals');

    var freshness = ageMin < 0 ? 'unknown' : ageMin < 1 ? 'just now' : ageMin + ' min ago';
    var summary = 'Data: ' + freshness + ' | ' + available.length + ' sources loaded';
    if (missing.length) summary += ' | Missing: ' + missing.join(', ');

    return { available: available, missing: missing, stale: stale, ageMin: ageMin, summary: summary };
  }

  // Track in-progress verdicts so the tile can show status when switching back
  var _verdictInProgress = {}; // symbol → step message

  async function runVerdict(symbol) {
    var contentEl = document.getElementById('detail-verdict-content');
    var btn = document.getElementById('detail-verdict-btn');
    var c = cache[symbol];
    if (!NewsAI.hasKey() || !c) return null;
    var stockInfo = trackedStocks.find(function(t) { return t.symbol === symbol; }) || {};
    var isETF = stockInfo.type === 'ETF';
    _verdictInProgress[symbol] = 'Preparing...';
    if (selectedSymbol === symbol) { btn.disabled = true; btn.textContent = 'Preparing\u2026'; }
    var step = 0;
    var totalSteps = isETF ? 8 : 14;
    function progress(msg) {
      step++;
      _verdictInProgress[symbol] = msg + ' (Step ' + step + '/' + totalSteps + ')';
      if (selectedSymbol === symbol) contentEl.innerHTML = '<div class="tile-loading">' + msg + '<br><span style="font-size:0.6rem;color:var(--muted);">Step ' + step + '/' + totalSteps + '</span></div>';
    }

    // Check data freshness — refresh if older than 10 minutes
    var staleMs = 10 * 60 * 1000;
    var dataAge = c._dataLoadedAt ? (Date.now() - c._dataLoadedAt) : Infinity;
    if (dataAge > staleMs) {
      progress('\uD83D\uDD04 Data is ' + (dataAge === Infinity ? 'not loaded' : Math.round(dataAge / 60000) + ' min old') + '. Refreshing all data first...');
      var s = trackedStocks.find(function(t) { return t.symbol === symbol; }) || {};
      try {
        await loadStockData(symbol, s.type || 'Equity');
      } catch (e) {
        if (selectedSymbol === symbol) showWarning('Data refresh had issues: ' + e.message + '. Proceeding with available data.');
      }
      c = cache[symbol];
      if (!c) return null;
    }

    // ── PHASE 1: Load all on-demand data tiles ──
    if (selectedSymbol === symbol) btn.textContent = 'Loading data\u2026';

    // Technicals (RSI, MACD, SMA + AI)
    if (AlphaAPI.hasKey() && (!c.rsiData || !c.rsiData.length)) {
      progress('\uD83D\uDCC0 Loading technical indicators (RSI, MACD, SMA)...');
      try { await loadTechnicalsData(symbol); } catch(e) { console.warn('Technicals:', e.message); }
      c = cache[symbol];
    }

    // Cash flow (stocks only)
    if (!isETF && AlphaAPI.hasKey() && (!c.cashFlowData || !c.cashFlowData.length)) {
      progress('\uD83D\uDCB5 Loading cash flow data...');
      try { await loadCashFlowData(symbol); } catch(e) { console.warn('Cash flow:', e.message); }
      c = cache[symbol];
    }

    // Balance sheet (stocks only)
    if (!isETF && AlphaAPI.hasKey() && (!c.balanceSheetData || !c.balanceSheetData.length)) {
      progress('\uD83C\uDFE6 Loading balance sheet...');
      try { await loadBalanceSheetData(symbol); } catch(e) { console.warn('Balance sheet:', e.message); }
      c = cache[symbol];
    }

    // Revenue & income (stocks only)
    if (!isETF && AlphaAPI.hasKey() && (!c.incomeData || !c.incomeData.length)) {
      progress('\uD83D\uDCB0 Loading revenue & income data...');
      try { await loadRevenueData(symbol); } catch(e) { console.warn('Revenue:', e.message); }
      c = cache[symbol];
    }

    // EPS estimates (stocks only)
    if (!isETF && StockAPI.hasKey() && (!c.epsEstimates || !c.epsEstimates.quarterly || !c.epsEstimates.quarterly.length)) {
      progress('\uD83D\uDCC8 Loading EPS estimates...');
      try { await loadEPSEstimates(symbol); } catch(e) { console.warn('EPS estimates:', e.message); }
      c = cache[symbol];
    }

    // Peer comparison (stocks only)
    if (!isETF && StockAPI.hasKey() && (!c.peers || !c.peers.length)) {
      progress('\uD83D\uDC65 Loading peer comparison...');
      try { await loadPeerData(symbol); } catch(e) { console.warn('Peers:', e.message); }
      c = cache[symbol];
    }

    // ── PHASE 2: Run all pending AI analyses ──
    if (selectedSymbol === symbol) btn.textContent = 'Running AI tiles\u2026';

    // News AI
    if (c.articles && c.articles.length && !c.aiResult && NewsAI.hasKey()) {
      progress('\uD83E\uDD16 AI analyzing news...');
      try { await runAIAnalysis(symbol); } catch(e) { console.warn('AI News:', e.message); }
      c = cache[symbol];
    }

    // Analyst AI
    if (((c.recommendations && c.recommendations.length) || (c.upgrades && c.upgrades.length)) && !c.analystAIResult && NewsAI.hasKey()) {
      progress('\uD83E\uDD16 AI analyzing analyst ratings...');
      try { await runAnalystAnalysis(symbol); } catch(e) { console.warn('AI Analyst:', e.message); }
      c = cache[symbol];
    }

    // Macro AI
    if (c.macroArticles && c.macroArticles.length && !c.macroAIResult && NewsAI.hasKey()) {
      progress('\uD83E\uDD16 AI analyzing macro impact...');
      try { await runMacroAnalysis(symbol); } catch(e) { console.warn('AI Macro:', e.message); }
      c = cache[symbol];
    }

    // Transcript AI (stocks only)
    if (!isETF && !c.transcriptAIResult && NewsAI.hasKey()) {
      progress('\uD83E\uDD16 AI analyzing earnings call...');
      try { await runTranscriptSummary(symbol); } catch(e) { console.warn('Transcript AI:', e.message); }
      c = cache[symbol];
    }

    // Fundamentals AI
    if (!c.fundamentalsResult && NewsAI.hasKey()) {
      progress('\uD83E\uDD16 AI analyzing fundamentals...');
      try { await loadFundamentalsData(symbol); } catch(e) { console.warn('Fundamentals AI:', e.message); }
      c = cache[symbol];
    }

    // ── PHASE 3: Senior Analyst deep analysis ──
    if (selectedSymbol === symbol) btn.textContent = 'Deep analysis\u2026';
    var inventory = buildDataInventory(c);
    _verdictInProgress[symbol] = '\uD83C\uDFAF Deep analysis in progress...';
    if (selectedSymbol === symbol) contentEl.innerHTML = '<div class="tile-loading">\uD83C\uDFAF Senior analyst performing deep analysis on ' + symbol + '...<br><span style="font-size:0.65rem;color:var(--muted);">Groq 70b' + (NewsAI.hasGeminiKey() ? ' (Gemini fallback)' : '') + ' \u2022 ' + inventory.summary + '</span></div>';
    try {
      c.verdictResult = await NewsAI.generateVerdict(
        symbol,
        c.profile ? c.profile.name : symbol,
        c,
        isETF
      );
      delete _verdictInProgress[symbol];
      if (selectedSymbol === symbol) renderVerdictHTML(contentEl, c.verdictResult);
      return c.verdictResult;
    } catch (err) {
      delete _verdictInProgress[symbol];
      if (selectedSymbol === symbol) contentEl.innerHTML = '<div class="error-msg">' + err.message + '</div>';
      throw err;
    }
    finally { if (selectedSymbol === symbol) { btn.textContent = 'Regenerate'; btn.disabled = false; } }
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

    // Thinking Process (collapsible)
    if (v.thinkingProcess) {
      h += '<details class="verdict-thinking">';
      h += '<summary class="verdict-thinking-toggle">\uD83E\uDDE0 Analyst Reasoning Chain</summary>';
      h += '<div class="verdict-thinking-content">' + v.thinkingProcess + '</div>';
      h += '</details>';
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

    if (v.dataQuality) {
      h += '<div class="verdict-data-quality">\uD83D\uDCCA Data Quality: ' + v.dataQuality + '</div>';
    }

    // ETF-specific: Holdings Analysis & Sector Exposure
    if (v._isETF || v.holdingsAnalysis || v.sectorExposure) {
      if (v.holdingsAnalysis) {
        h += '<div class="verdict-dcf">';
        h += '<div class="verdict-dcf-title">\uD83C\uDFE6 Holdings Analysis</div>';
        h += '<div class="verdict-dcf-assumptions">' + v.holdingsAnalysis + '</div>';
        h += '</div>';
      }
      if (v.sectorExposure) {
        h += '<div class="verdict-dcf">';
        h += '<div class="verdict-dcf-title">\uD83C\uDF10 Sector Exposure</div>';
        h += '<div class="verdict-dcf-assumptions">' + v.sectorExposure + '</div>';
        h += '</div>';
      }
    }

    // DCF / Intrinsic Value (stocks only — skip for ETFs)
    if (v.intrinsicValue != null && !v._isETF) {
      var ivNum = parseFloat(v.intrinsicValue);
      var curPrice = v.currentPrice || 0;
      var ivDiff = curPrice > 0 ? ((ivNum - curPrice) / curPrice * 100).toFixed(1) : '0';
      var ivClass = parseFloat(ivDiff) >= 0 ? 'positive' : 'negative';
      var ivSign = parseFloat(ivDiff) >= 0 ? '+' : '';
      h += '<div class="verdict-dcf">';
      h += '<div class="verdict-dcf-title">\uD83E\uDDEE DCF Intrinsic Value</div>';
      h += '<div class="verdict-dcf-row">';
      h += '<div class="verdict-dcf-item"><span class="verdict-dcf-label">Intrinsic Value</span><span class="verdict-dcf-value">$' + ivNum.toFixed(2) + '</span></div>';
      h += '<div class="verdict-dcf-item"><span class="verdict-dcf-label">Current Price</span><span class="verdict-dcf-value">$' + curPrice.toFixed(2) + '</span></div>';
      h += '<div class="verdict-dcf-item"><span class="verdict-dcf-label">Margin of Safety</span><span class="verdict-dcf-value ' + ivClass + '">' + ivSign + ivDiff + '%</span></div>';
      h += '</div>';
      if (v.dcfAssumptions) {
        h += '<div class="verdict-dcf-assumptions">' + v.dcfAssumptions + '</div>';
      }
      h += '</div>';
    }

    h += '<div class="verdict-disclaimer">This is AI-generated analysis for informational purposes only. Not financial advice. Always do your own research before making investment decisions.</div>';
    el.innerHTML = h;
  }

  function getForwardPE(c) {
    // Best source: Alpha Vantage overview
    if (c.avOverview && c.avOverview.ForwardPE && c.avOverview.ForwardPE !== 'None' && c.avOverview.ForwardPE !== '-') {
      var avFwd = parseFloat(c.avOverview.ForwardPE);
      if (avFwd > 0 && avFwd < 500) return avFwd.toFixed(1);
    }
    // Fallback: price / next year EPS estimate
    if (c.quote && c.quote.price && c.epsEstimates && c.epsEstimates.quarterly) {
      var estimates = c.epsEstimates.quarterly;
      var totalEst = 0, count = 0;
      for (var i = 0; i < Math.min(4, estimates.length); i++) {
        if (estimates[i].avg != null) { totalEst += estimates[i].avg; count++; }
      }
      if (count >= 2 && totalEst > 0) {
        var annualizedEst = totalEst * (4 / count);
        return (c.quote.price / annualizedEst).toFixed(1);
      }
    }
    return 'N/A';
  }

  function renderDetailKPIs(symbol, c, s) {
    var el = document.getElementById('detail-kpis');
    var f = c.financials || {}, p = c.profile || {};
    var kpis = s.type === 'ETF' ? [
      {l:'52W High',v:f.week52High||'N/A'},{l:'52W Low',v:f.week52Low||'N/A'},{l:'Beta',v:f.beta||'N/A'},
      {l:'Div Yield',v:f.dividendYield||'N/A'},{l:'Sector',v:p.sector||'ETF'},{l:'Exchange',v:p.exchange||'N/A'},
    ] : [
      {l:'Market Cap',v:fmtNum(p.marketCap)},{l:'P/E Ratio',v:f.peRatio||'N/A'},{l:'Fwd P/E',v:getForwardPE(c)},
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
    if (s.type === 'ETF') { tile.style.display = 'none'; tile.setAttribute('data-render-hidden', 'true'); return; }
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

  // --- Technical Indicators ---
  function renderDetailTechnicals(symbol, c, s) {
    var tile = document.getElementById('tile-technicals');
    var contentEl = document.getElementById('detail-technicals-content');
    var btn = document.getElementById('detail-technicals-btn');
    if (!tile || !contentEl || !btn) return;
    tile.style.display = '';
    tile.removeAttribute('data-render-hidden');
    btn.onclick = function() { loadTechnicalsData(symbol); };

    if (c.technicalsResult) {
      renderTechnicalsHTML(contentEl, c);
      btn.disabled = false; btn.textContent = 'Reload';
      return;
    }
    if (!AlphaAPI.hasKey()) {
      contentEl.innerHTML = '<div class="tile-loading">Add an Alpha Vantage key to view RSI, MACD, and moving averages.</div>';
      btn.disabled = true;
      return;
    }
    btn.disabled = false; btn.textContent = 'Load & Analyze';
    contentEl.innerHTML = '<div class="tile-loading">Click Load & Analyze to fetch RSI, MACD, SMA (3 AV calls).</div>';
  }

  async function loadTechnicalsData(symbol) {
    var contentEl = document.getElementById('detail-technicals-content');
    var btn = document.getElementById('detail-technicals-btn');
    if (!AlphaAPI.hasKey() || !symbol) return;
    if (symbol === selectedSymbol) {
      btn.disabled = true; btn.textContent = 'Loading\u2026';
      contentEl.innerHTML = '<div class="tile-loading">Fetching RSI...</div>';
    }
    try {
      if (!cache[symbol]) cache[symbol] = {};
      var c = cache[symbol];
      c.rsiData = await AlphaAPI.getRSI(symbol);
      if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="tile-loading">Fetching MACD...</div>';
      c.macdData = await AlphaAPI.getMACD(symbol);
      if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="tile-loading">Fetching SMA 50...</div>';
      c.sma50Data = await AlphaAPI.getSMA(symbol, 50);
      if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="tile-loading">Fetching SMA 200...</div>';
      c.sma200Data = await AlphaAPI.getSMA(symbol, 200);

      if (NewsAI.hasKey()) {
        if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="tile-loading">\uD83E\uDD16 AI analyzing technicals...</div>';
        var stockInfo = trackedStocks.find(function(t) { return t.symbol === symbol; }) || {};
        var isETF = stockInfo.type === 'ETF';
        c.technicalsResult = await NewsAI.analyzeTechnicals(
          symbol, c.profile ? c.profile.name : symbol,
          c.rsiData, c.macdData, c.sma50Data, c.sma200Data, c.quote, isETF
        );
      }
      if (selectedSymbol === symbol) renderTechnicalsHTML(contentEl, c);
    } catch (e) {
      if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="error-msg">' + e.message + '</div>';
    }
    if (symbol === selectedSymbol) { btn.disabled = false; btn.textContent = 'Reload'; }
  }

  function renderTechnicalsHTML(el, c) {
    var ai = c.technicalsResult;
    var h = '';
    if (ai) {
      h += '<div class="technicals-signal-row">';
      h += '<span class="technicals-signal-badge ' + (ai.signal || '') + '">' + (ai.signal || 'N/A') + '</span>';
      if (ai.signalStrength) h += '<span class="ai-impact-badge ' + (ai.signalStrength === 'STRONG' ? 'HIGH' : ai.signalStrength === 'WEAK' ? 'LOW' : 'MEDIUM') + '" style="font-size:0.6rem;margin-left:0.3rem;">' + ai.signalStrength + '</span>';
      h += '<span style="font-size:0.72rem;color:var(--muted);">' + (ai.signalReason || '') + '</span>';
      h += '</div>';
      h += '<div class="ai-summary">' + (ai.summary || '') + '</div>';
    }
    h += '<div class="technicals-gauges">';
    if (c.rsiData && c.rsiData.length) {
      var rsiVal = c.rsiData[0].rsi;
      var rsiColor = rsiVal > 70 ? 'var(--red)' : rsiVal < 30 ? 'var(--green)' : 'var(--muted)';
      var rsiLabel = rsiVal > 70 ? 'Overbought' : rsiVal < 30 ? 'Oversold' : 'Neutral';
      h += '<div class="technicals-gauge"><div class="technicals-gauge-label">RSI (14)</div><div class="technicals-gauge-val" style="color:' + rsiColor + ';">' + rsiVal.toFixed(1) + '</div><div class="technicals-gauge-interp">' + rsiLabel + '</div></div>';
    }
    if (c.macdData && c.macdData.length) {
      var m = c.macdData[0];
      var macdColor = m.histogram >= 0 ? 'var(--green)' : 'var(--red)';
      h += '<div class="technicals-gauge"><div class="technicals-gauge-label">MACD Hist</div><div class="technicals-gauge-val" style="color:' + macdColor + ';">' + m.histogram.toFixed(3) + '</div><div class="technicals-gauge-interp">' + (m.histogram >= 0 ? 'Bullish' : 'Bearish') + '</div></div>';
    }
    if (c.sma50Data && c.sma50Data.length && c.sma200Data && c.sma200Data.length) {
      var golden = c.sma50Data[0].sma > c.sma200Data[0].sma;
      h += '<div class="technicals-gauge"><div class="technicals-gauge-label">SMA Cross</div><div class="technicals-gauge-val" style="color:' + (golden ? 'var(--green)' : 'var(--red)') + ';">' + (golden ? 'Golden' : 'Death') + '</div><div class="technicals-gauge-interp">50 vs 200 day</div></div>';
    }
    h += '</div>';
    // Support/Resistance
    if (ai && (ai.support || ai.resistance)) {
      h += '<div class="technicals-levels">';
      if (ai.support) h += '<div class="technicals-level"><div class="technicals-level-label">Support</div><div class="technicals-level-val" style="color:var(--green);">' + ai.support + '</div></div>';
      if (ai.resistance) h += '<div class="technicals-level"><div class="technicals-level-label">Resistance</div><div class="technicals-level-val" style="color:var(--red);">' + ai.resistance + '</div></div>';
      h += '</div>';
    }
    if (ai && ai.keyLevels) {
      h += '<div style="font-size:0.72rem;color:var(--accent);margin-top:0.3rem;padding:0.3rem 0.5rem;background:var(--card-bg);border-radius:4px;border-left:2px solid var(--accent);"><span style="font-weight:600;">Key Levels:</span> ' + ai.keyLevels + '</div>';
    }
    // SMA values
    if (c.sma50Data && c.sma50Data.length) {
      h += '<div style="font-size:0.68rem;color:var(--muted);">SMA 50: ' + c.sma50Data[0].sma.toFixed(2);
      if (c.sma200Data && c.sma200Data.length) h += ' | SMA 200: ' + c.sma200Data[0].sma.toFixed(2);
      if (c.quote) h += ' | Price: $' + c.quote.price.toFixed(2) + ' (' + (c.quote.price > (c.sma50Data[0].sma) ? 'above' : 'below') + ' SMA50)';
      h += '</div>';
    }
    if (ai && ai.recommendation) {
      h += '<div style="font-size:0.72rem;color:var(--accent);margin-top:0.4rem;font-weight:600;">' + ai.recommendation + '</div>';
    }
    if (!AlphaAPI.hasKey()) h += '<div style="font-size:0.58rem;color:var(--muted);margin-top:0.3rem;">Add Alpha Vantage key for technical data.</div>';
    el.innerHTML = h;
  }

  // --- Earnings ---
  var earningsChart = null;
  function renderDetailEarnings(symbol, c, s) {
    var tile = document.getElementById('tile-earnings');
    var el = document.getElementById('detail-earnings-content');
    if (s.type === 'ETF') { tile.style.display = 'none'; tile.setAttribute('data-render-hidden', 'true'); return; }
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

  // --- Cash Flow ---
  var cashFlowChart = null;
  function renderDetailCashFlow(symbol, c, s) {
    var tile = document.getElementById('tile-cashflow');
    var contentEl = document.getElementById('detail-cashflow-content');
    var btn = document.getElementById('detail-cashflow-btn');
    if (!tile || !contentEl || !btn) return;
    if (s && s.type === 'ETF') { tile.style.display = 'none'; tile.setAttribute('data-render-hidden', 'true'); return; }
    tile.style.display = '';
    btn.onclick = function() { loadCashFlowData(symbol); };

    if (c.cashFlowData && c.cashFlowData.length) {
      renderCashFlowHTML(contentEl, c.cashFlowData);
      btn.disabled = false; btn.textContent = 'Reload';
      return;
    }
    if (!AlphaAPI.hasKey()) {
      contentEl.innerHTML = '<div class="tile-loading">Add an Alpha Vantage key to view cash flow trends.</div>';
      btn.disabled = true; return;
    }
    btn.disabled = false; btn.textContent = 'Load';
    contentEl.innerHTML = '<div class="tile-loading">Click Load to fetch cash flow data (1 AV call).</div>';
  }

  async function loadCashFlowData(symbol) {
    var contentEl = document.getElementById('detail-cashflow-content');
    var btn = document.getElementById('detail-cashflow-btn');
    if (!AlphaAPI.hasKey()) return;
    if (symbol === selectedSymbol) { btn.disabled = true; btn.textContent = 'Loading\u2026'; }
    try {
      if (!cache[symbol]) cache[symbol] = {};
      cache[symbol].cashFlowData = await AlphaAPI.getCashFlow(symbol);
      if (symbol === selectedSymbol) {
        if (!cache[symbol].cashFlowData || !cache[symbol].cashFlowData.length) {
          contentEl.innerHTML = '<div class="tile-loading">No cash flow data available.</div>';
        } else {
          renderCashFlowHTML(contentEl, cache[symbol].cashFlowData);
        }
      }
    } catch(e) {
      if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="error-msg">' + e.message + '</div>';
    }
    if (symbol === selectedSymbol) { btn.disabled = false; btn.textContent = 'Reload'; }
  }

  function renderCashFlowHTML(el, data) {
    var recent = data[0] || {};
    var h = '<div class="cashflow-kpis">';
    h += cfKpi('Operating CF', recent.operatingCashFlow);
    h += cfKpi('Free Cash Flow', recent.freeCashFlow);
    h += cfKpi('CapEx', recent.capitalExpenditure);
    h += cfKpi('Dividends Paid', recent.dividendPayout);
    h += cfKpi('Net Income', recent.netIncome);
    if (recent.operatingCashFlow && recent.netIncome && recent.netIncome !== 0) {
      var quality = (recent.operatingCashFlow / recent.netIncome).toFixed(2);
      h += '<div class="cashflow-kpi"><div class="label">CF/NI Quality</div><div class="value ' + (parseFloat(quality) >= 1 ? 'positive' : 'negative') + '">' + quality + 'x</div></div>';
    }
    h += '</div>';
    h += '<div class="cashflow-chart-container"><canvas id="cashflow-chart"></canvas></div>';
    // Trend table
    h += '<table style="width:100%;border-collapse:collapse;font-size:0.68rem;"><thead><tr><th style="text-align:left;padding:0.3rem;border-bottom:1px solid var(--border);color:var(--muted);">Quarter</th><th style="text-align:right;padding:0.3rem;border-bottom:1px solid var(--border);color:var(--muted);">Operating CF</th><th style="text-align:right;padding:0.3rem;border-bottom:1px solid var(--border);color:var(--muted);">FCF</th><th style="text-align:right;padding:0.3rem;border-bottom:1px solid var(--border);color:var(--muted);">CapEx</th></tr></thead><tbody>';
    data.slice(0, 8).forEach(function(r) {
      h += '<tr><td style="padding:0.25rem 0.3rem;border-bottom:1px solid var(--border);">' + r.date + '</td>';
      h += '<td style="text-align:right;padding:0.25rem 0.3rem;border-bottom:1px solid var(--border);">' + fmtCF(r.operatingCashFlow) + '</td>';
      h += '<td style="text-align:right;padding:0.25rem 0.3rem;border-bottom:1px solid var(--border);">' + fmtCF(r.freeCashFlow) + '</td>';
      h += '<td style="text-align:right;padding:0.25rem 0.3rem;border-bottom:1px solid var(--border);">' + fmtCF(r.capitalExpenditure) + '</td></tr>';
    });
    h += '</tbody></table>';
    el.innerHTML = h;

    // Draw chart
    var chartData = data.slice(0, 8).reverse();
    var canvas = document.getElementById('cashflow-chart');
    if (!canvas) return;
    if (cashFlowChart) cashFlowChart.destroy();
    cashFlowChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: chartData.map(function(r) { return r.date; }),
        datasets: [
          { label: 'Operating CF', data: chartData.map(function(r) { return r.operatingCashFlow ? r.operatingCashFlow / 1e6 : 0; }), backgroundColor: 'rgba(99,102,241,0.7)', borderRadius: 3 },
          { label: 'Free Cash Flow', data: chartData.map(function(r) { return r.freeCashFlow ? r.freeCashFlow / 1e6 : 0; }), backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 3 },
          { label: 'CapEx', data: chartData.map(function(r) { return r.capitalExpenditure ? -Math.abs(r.capitalExpenditure) / 1e6 : 0; }), backgroundColor: 'rgba(239,68,68,0.5)', borderRadius: 3 },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, labels: { color: '#8b8fa3', font: { size: 10 }, boxWidth: 10 } } },
        scales: {
          x: { ticks: { color: '#8b8fa3', font: { size: 9 }, maxRotation: 45 }, grid: { display: false } },
          y: { ticks: { color: '#8b8fa3', font: { size: 9 }, callback: function(v) { return v >= 0 ? '$' + v + 'M' : '-$' + Math.abs(v) + 'M'; } }, grid: { color: '#2a2d3a' } },
        }
      }
    });
  }

  function cfKpi(label, val) {
    if (val == null) return '';
    var cls = val >= 0 ? 'positive' : 'negative';
    return '<div class="cashflow-kpi"><div class="label">' + label + '</div><div class="value ' + cls + '">' + fmtCF(val) + '</div></div>';
  }
  function fmtCF(val) {
    if (val == null) return 'N/A';
    var abs = Math.abs(val);
    var sign = val < 0 ? '-' : '';
    if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(0) + 'K';
    return sign + '$' + abs.toFixed(0);
  }

  // --- Balance Sheet ---
  function renderDetailBalanceSheet(symbol, c, s) {
    var tile = document.getElementById('tile-balancesheet');
    var contentEl = document.getElementById('detail-balancesheet-content');
    var btn = document.getElementById('detail-balancesheet-btn');
    if (!tile || !contentEl || !btn) return;
    if (s && s.type === 'ETF') { tile.style.display = 'none'; tile.setAttribute('data-render-hidden', 'true'); return; }
    tile.style.display = '';
    btn.onclick = function() { loadBalanceSheetData(symbol); };

    if (c.balanceSheetData && c.balanceSheetData.length) {
      renderBalanceSheetHTML(contentEl, c.balanceSheetData, c);
      btn.disabled = false; btn.textContent = 'Reload';
      return;
    }
    if (!AlphaAPI.hasKey()) {
      contentEl.innerHTML = '<div class="tile-loading">Add an Alpha Vantage key to view balance sheet.</div>';
      btn.disabled = true; return;
    }
    btn.disabled = false; btn.textContent = 'Load';
    contentEl.innerHTML = '<div class="tile-loading">Click Load to fetch balance sheet (1 AV call).</div>';
  }

  async function loadBalanceSheetData(symbol) {
    var contentEl = document.getElementById('detail-balancesheet-content');
    var btn = document.getElementById('detail-balancesheet-btn');
    if (!AlphaAPI.hasKey()) return;
    if (symbol === selectedSymbol) { btn.disabled = true; btn.textContent = 'Loading\u2026'; }
    try {
      if (!cache[symbol]) cache[symbol] = {};
      cache[symbol].balanceSheetData = await AlphaAPI.getBalanceSheet(symbol);
      if (symbol === selectedSymbol) {
        if (!cache[symbol].balanceSheetData || !cache[symbol].balanceSheetData.length) {
          contentEl.innerHTML = '<div class="tile-loading">No balance sheet data available.</div>';
        } else {
          renderBalanceSheetHTML(contentEl, cache[symbol].balanceSheetData, cache[symbol]);
        }
      }
    } catch(e) {
      if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="error-msg">' + e.message + '</div>';
    }
    if (symbol === selectedSymbol) { btn.disabled = false; btn.textContent = 'Reload'; }
  }

  function renderBalanceSheetHTML(el, data, c) {
    var r = data[0] || {};
    var prev = data[1] || {};
    var h = '<div class="bs-grid">';
    h += bsCard('Total Assets', r.totalAssets, prev.totalAssets);
    h += bsCard('Total Liabilities', r.totalLiabilities, prev.totalLiabilities);
    h += bsCard('Total Debt', r.totalDebt, prev.totalDebt);
    h += bsCard('Cash & Equivalents', r.cash, prev.cash);
    h += bsCard('Book Value', r.bookValue, prev.bookValue);
    // Net debt
    if (r.totalDebt != null && r.cash != null) {
      var netDebt = r.totalDebt - r.cash;
      h += '<div class="bs-card"><div class="label">Net Debt</div><div class="value" style="color:' + (netDebt > 0 ? 'var(--red)' : 'var(--green)') + ';">' + fmtCF(netDebt) + '</div><div class="sub">' + (netDebt > 0 ? 'Debt exceeds cash' : 'Net cash position') + '</div></div>';
    }
    // Book value per share
    if (r.bookValue != null && r.sharesOutstanding) {
      var bvps = r.bookValue / r.sharesOutstanding;
      var priceToBook = (c && c.quote && c.quote.price) ? (c.quote.price / bvps).toFixed(2) : null;
      h += '<div class="bs-card"><div class="label">Book Value/Share</div><div class="value">$' + bvps.toFixed(2) + '</div>' + (priceToBook ? '<div class="sub">P/B: ' + priceToBook + 'x</div>' : '') + '</div>';
    }
    // Debt-to-equity
    if (r.totalDebt != null && r.bookValue != null && r.bookValue > 0) {
      var de = (r.totalDebt / r.bookValue).toFixed(2);
      h += '<div class="bs-card"><div class="label">Debt/Equity</div><div class="value" style="color:' + (parseFloat(de) > 2 ? 'var(--red)' : parseFloat(de) > 1 ? '#f59e0b' : 'var(--green)') + ';">' + de + 'x</div><div class="sub">' + (parseFloat(de) > 2 ? 'High leverage' : parseFloat(de) > 1 ? 'Moderate' : 'Conservative') + '</div></div>';
    }
    h += '</div>';
    // Assets vs Liabilities bar
    if (r.totalAssets && r.totalLiabilities) {
      var assetPct = Math.round(r.totalAssets / (r.totalAssets + r.totalLiabilities) * 100);
      h += '<div style="font-size:0.65rem;color:var(--muted);margin:0.3rem 0 0.15rem;">Assets vs Liabilities</div>';
      h += '<div class="bs-bar"><div class="bs-bar-assets" style="width:' + assetPct + '%;"></div><div class="bs-bar-liabilities" style="width:' + (100 - assetPct) + '%;"></div></div>';
      h += '<div style="display:flex;justify-content:space-between;font-size:0.6rem;color:var(--muted);margin-top:0.15rem;"><span>Assets ' + fmtCF(r.totalAssets) + '</span><span>Liabilities ' + fmtCF(r.totalLiabilities) + '</span></div>';
    }
    // Trend table
    if (data.length > 1) {
      h += '<table style="width:100%;border-collapse:collapse;font-size:0.68rem;margin-top:0.5rem;"><thead><tr><th style="text-align:left;padding:0.3rem;border-bottom:1px solid var(--border);color:var(--muted);">Quarter</th><th style="text-align:right;padding:0.3rem;border-bottom:1px solid var(--border);color:var(--muted);">Assets</th><th style="text-align:right;padding:0.3rem;border-bottom:1px solid var(--border);color:var(--muted);">Debt</th><th style="text-align:right;padding:0.3rem;border-bottom:1px solid var(--border);color:var(--muted);">Cash</th><th style="text-align:right;padding:0.3rem;border-bottom:1px solid var(--border);color:var(--muted);">Book Value</th></tr></thead><tbody>';
      data.slice(0, 6).forEach(function(q) {
        h += '<tr><td style="padding:0.25rem 0.3rem;border-bottom:1px solid var(--border);">' + q.date + '</td>';
        h += '<td style="text-align:right;padding:0.25rem 0.3rem;border-bottom:1px solid var(--border);">' + fmtCF(q.totalAssets) + '</td>';
        h += '<td style="text-align:right;padding:0.25rem 0.3rem;border-bottom:1px solid var(--border);">' + fmtCF(q.totalDebt) + '</td>';
        h += '<td style="text-align:right;padding:0.25rem 0.3rem;border-bottom:1px solid var(--border);">' + fmtCF(q.cash) + '</td>';
        h += '<td style="text-align:right;padding:0.25rem 0.3rem;border-bottom:1px solid var(--border);">' + fmtCF(q.bookValue) + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    el.innerHTML = h;
  }

  function bsCard(label, val, prevVal) {
    if (val == null) return '';
    var change = '';
    if (prevVal != null && prevVal !== 0) {
      var pct = ((val - prevVal) / Math.abs(prevVal) * 100).toFixed(1);
      var arrow = parseFloat(pct) >= 0 ? '\u25B2' : '\u25BC';
      var color = parseFloat(pct) >= 0 ? 'var(--green)' : 'var(--red)';
      change = '<div class="sub" style="color:' + color + ';">' + arrow + ' ' + pct + '% QoQ</div>';
    }
    return '<div class="bs-card"><div class="label">' + label + '</div><div class="value">' + fmtCF(val) + '</div>' + change + '</div>';
  }

  // --- Dividends ---
  function renderDetailDividends(symbol, c, s) {
    var tile = document.getElementById('tile-dividends');
    var el = document.getElementById('detail-dividends-content');
    if (!tile || !el) return;
    if (s && s.type === 'ETF') { tile.style.display = 'none'; tile.setAttribute('data-render-hidden', 'true'); return; }
    tile.style.display = '';
    var f = c.financials || {};
    var ov = c.avOverview || {};
    var hasDivData = f.dividendYield || ov.DividendPerShare || ov.DividendYield || ov.ExDividendDate;
    if (!hasDivData) { el.innerHTML = '<div class="tile-loading">No dividend data available for this stock.</div>'; return; }

    var h = '<div class="dividends-summary">';
    var divYield = ov.DividendYield ? (parseFloat(ov.DividendYield) * 100).toFixed(2) + '%' : (f.dividendYield || 'N/A');
    var divPerShare = ov.DividendPerShare && ov.DividendPerShare !== 'None' ? '$' + parseFloat(ov.DividendPerShare).toFixed(2) : 'N/A';
    var payoutRatio = ov.PayoutRatio && ov.PayoutRatio !== 'None' ? (parseFloat(ov.PayoutRatio) * 100).toFixed(1) + '%' : 'N/A';
    var exDate = ov.ExDividendDate && ov.ExDividendDate !== 'None' ? ov.ExDividendDate : 'N/A';
    var divDate = ov.DividendDate && ov.DividendDate !== 'None' ? ov.DividendDate : null;

    h += '<div class="dividends-summary-box"><div class="dividends-summary-val" style="color:var(--green);">' + divYield + '</div><div class="dividends-summary-label">Yield</div></div>';
    h += '<div class="dividends-summary-box"><div class="dividends-summary-val">' + divPerShare + '</div><div class="dividends-summary-label">Per Share</div></div>';
    h += '<div class="dividends-summary-box"><div class="dividends-summary-val">' + payoutRatio + '</div><div class="dividends-summary-label">Payout Ratio</div></div>';
    h += '<div class="dividends-summary-box"><div class="dividends-summary-val" style="font-size:0.78rem;">' + exDate + '</div><div class="dividends-summary-label">Ex-Dividend</div></div>';
    if (divDate) {
      h += '<div class="dividends-summary-box"><div class="dividends-summary-val" style="font-size:0.78rem;">' + divDate + '</div><div class="dividends-summary-label">Pay Date</div></div>';
    }
    h += '</div>';

    // Payout health assessment
    var payoutNum = ov.PayoutRatio && ov.PayoutRatio !== 'None' ? parseFloat(ov.PayoutRatio) * 100 : null;
    if (payoutNum != null) {
      var payoutColor = payoutNum < 50 ? 'var(--green)' : payoutNum < 75 ? '#f59e0b' : 'var(--red)';
      var payoutLabel = payoutNum < 50 ? 'Healthy — room to grow' : payoutNum < 75 ? 'Moderate — sustainable' : 'High — may be at risk';
      h += '<div style="font-size:0.72rem;margin-top:0.3rem;"><span style="color:' + payoutColor + ';font-weight:600;">Payout: ' + payoutNum.toFixed(0) + '%</span> — ' + payoutLabel + '</div>';
    }

    // Dividend growth from AV overview
    var qRevGrowth = ov.QuarterlyRevenueGrowthYOY && ov.QuarterlyRevenueGrowthYOY !== 'None' ? ov.QuarterlyRevenueGrowthYOY : null;
    if (qRevGrowth) {
      h += '<div style="font-size:0.65rem;color:var(--muted);margin-top:0.3rem;">Quarterly Revenue Growth YoY: ' + (parseFloat(qRevGrowth) * 100).toFixed(1) + '% (supports dividend sustainability)</div>';
    }

    if (!ov.DividendPerShare) {
      h += '<div style="font-size:0.58rem;color:var(--muted);margin-top:0.3rem;">Add an Alpha Vantage key for detailed dividend data (payout ratio, ex-date, pay date).</div>';
    }
    el.innerHTML = h;
  }

  // --- ETF Holdings ---
  function renderDetailETFHoldings(symbol, c, s) {
    var tile = document.getElementById('tile-etf-holdings');
    var el = document.getElementById('detail-etf-holdings');
    if (!s || s.type !== 'ETF') { tile.style.display = 'none'; tile.setAttribute('data-render-hidden', 'true'); return; }
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
    if (s && s.type === 'ETF') { tile.style.display = 'none'; tile.setAttribute('data-render-hidden', 'true'); return; }
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
    if (symbol === selectedSymbol) {
      btn.disabled = true; btn.textContent = 'Loading\u2026';
      contentEl.innerHTML = '<div class="tile-loading">Fetching income statement...</div>';
    }
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
      if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="error-msg">' + e.message + '</div>';
    }
    if (symbol === selectedSymbol) { btn.disabled = false; btn.textContent = 'Reload'; }
  }

  function renderRevenueChart(el, data) {
    if (!data || !data.length) { el.innerHTML = '<div class="tile-loading">No income data available.</div>'; return; }
    var sorted = data.slice().reverse().filter(function(d) { return d.revenue != null; });
    if (!sorted.length) { el.innerHTML = '<div class="tile-loading">No revenue data in response.</div>'; return; }

    // Build KPI summary from latest quarter
    var latest = sorted[sorted.length - 1] || {};
    var prev = sorted.length > 4 ? sorted[sorted.length - 5] : (sorted.length > 1 ? sorted[sorted.length - 2] : null);
    var h = '<div class="cashflow-kpis">';
    if (latest.revenue != null) h += cfKpi('Revenue', latest.revenue);
    if (latest.grossProfit != null) h += cfKpi('Gross Profit', latest.grossProfit);
    if (latest.operatingIncome != null) h += cfKpi('Operating Income', latest.operatingIncome);
    if (latest.netIncome != null) h += cfKpi('Net Income', latest.netIncome);
    if (latest.revenue && latest.grossProfit) {
      var gm = (latest.grossProfit / latest.revenue * 100).toFixed(1);
      h += '<div class="cashflow-kpi"><div class="label">Gross Margin</div><div class="value">' + gm + '%</div></div>';
    }
    if (latest.revenue && latest.netIncome) {
      var nm = (latest.netIncome / latest.revenue * 100).toFixed(1);
      h += '<div class="cashflow-kpi"><div class="label">Net Margin</div><div class="value ' + (parseFloat(nm) >= 0 ? 'positive' : 'negative') + '">' + nm + '%</div></div>';
    }
    if (prev && prev.revenue && latest.revenue) {
      var yoy = ((latest.revenue - prev.revenue) / Math.abs(prev.revenue) * 100).toFixed(1);
      h += '<div class="cashflow-kpi"><div class="label">Rev Growth (YoY)</div><div class="value ' + (parseFloat(yoy) >= 0 ? 'positive' : 'negative') + '">' + (parseFloat(yoy) >= 0 ? '+' : '') + yoy + '%</div></div>';
    }
    h += '</div>';

    h += '<div class="revenue-chart-container"><canvas id="revenue-income-chart"></canvas></div>';

    // Trend table
    h += '<table style="width:100%;border-collapse:collapse;font-size:0.68rem;"><thead><tr>';
    h += '<th style="text-align:left;padding:0.3rem;border-bottom:1px solid var(--border);color:var(--muted);">Period</th>';
    h += '<th style="text-align:right;padding:0.3rem;border-bottom:1px solid var(--border);color:var(--muted);">Revenue</th>';
    h += '<th style="text-align:right;padding:0.3rem;border-bottom:1px solid var(--border);color:var(--muted);">Gross Profit</th>';
    h += '<th style="text-align:right;padding:0.3rem;border-bottom:1px solid var(--border);color:var(--muted);">Net Income</th>';
    h += '<th style="text-align:right;padding:0.3rem;border-bottom:1px solid var(--border);color:var(--muted);">Net Margin</th>';
    h += '</tr></thead><tbody>';
    sorted.slice().reverse().slice(0, 8).forEach(function(r) {
      var margin = (r.revenue && r.netIncome) ? (r.netIncome / r.revenue * 100).toFixed(1) + '%' : 'N/A';
      h += '<tr><td style="padding:0.25rem 0.3rem;border-bottom:1px solid var(--border);">' + r.date + '</td>';
      h += '<td style="text-align:right;padding:0.25rem 0.3rem;border-bottom:1px solid var(--border);">' + fmtCF(r.revenue) + '</td>';
      h += '<td style="text-align:right;padding:0.25rem 0.3rem;border-bottom:1px solid var(--border);">' + fmtCF(r.grossProfit) + '</td>';
      h += '<td style="text-align:right;padding:0.25rem 0.3rem;border-bottom:1px solid var(--border);">' + fmtCF(r.netIncome) + '</td>';
      h += '<td style="text-align:right;padding:0.25rem 0.3rem;border-bottom:1px solid var(--border);">' + margin + '</td></tr>';
    });
    h += '</tbody></table>';
    el.innerHTML = h;

    // Draw chart
    var canvas = document.getElementById('revenue-income-chart');
    if (!canvas) return;
    if (revenueChart) revenueChart.destroy();

    var labels = sorted.map(function(d) {
      var dt = new Date(d.date);
      if (d.isAnnual) return 'FY ' + dt.getFullYear();
      var q = Math.ceil((dt.getMonth() + 1) / 3);
      return 'Q' + q + ' ' + dt.getFullYear();
    });
    var revenues = sorted.map(function(d) { return d.revenue != null ? d.revenue / 1e9 : null; });
    var netIncomes = sorted.map(function(d) { return d.netIncome != null ? d.netIncome / 1e9 : null; });
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
    if (s && s.type === 'ETF') { tile.style.display = 'none'; tile.setAttribute('data-render-hidden', 'true'); return; }
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
    tile.style.display = '';
    tile.removeAttribute('data-render-hidden');
    var isETF = s && s.type === 'ETF';
    btn.onclick = function() { loadFundamentalsData(symbol); };

    if (c.fundamentalsResult) {
      renderFundamentalsHTML(contentEl, c, symbol);
      btn.disabled = false; btn.textContent = 'Reload';
      return;
    }
    // Show raw metrics if we have financials already (stocks only)
    if (!isETF && c.financials && (c.financials.grossMargin != null || c.financials.roeTTM != null)) {
      renderFundamentalsRaw(contentEl, c);
      btn.disabled = false; btn.textContent = 'Load & Analyze';
    } else {
      btn.disabled = false; btn.textContent = 'Load & Analyze';
      var desc = isETF ? 'Click Load & Analyze to view ETF fundamentals, expense analysis, and sentiment.' : 'Click Load & Analyze to view growth, margins, financial health, and sentiment.';
      contentEl.innerHTML = '<div class="tile-loading">' + desc + (AlphaAPI.hasKey() ? '' : ' Add an Alpha Vantage key for additional data.') + '</div>';
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
    if (symbol === selectedSymbol) {
      btn.disabled = true; btn.textContent = 'Loading\u2026';
      contentEl.innerHTML = '<div class="tile-loading">Loading fundamentals data...</div>';
    }
    try {
      if (!cache[symbol]) cache[symbol] = {};
      var c = cache[symbol];

      // Fetch AV data if key available
      if (AlphaAPI.hasKey()) {
        if (!c.avOverview) {
          if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="tile-loading">Fetching company overview (Alpha Vantage)...</div>';
          c.avOverview = await AlphaAPI.getOverview(symbol);
        }
        if (!c.avSentiment) {
          if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="tile-loading">Fetching news sentiment (Alpha Vantage)...</div>';
          c.avSentiment = await AlphaAPI.getNewsSentiment(symbol);
        }
      }

      // Run AI analysis if Groq key available
      if (NewsAI.hasKey()) {
        if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="tile-loading">\uD83E\uDD16 AI analyzing fundamentals...</div>';
        var stockInfo = trackedStocks.find(function(t) { return t.symbol === symbol; }) || {};
        var isETF = stockInfo.type === 'ETF';
        c.fundamentalsResult = await NewsAI.analyzeFundamentals(
          symbol,
          c.profile ? c.profile.name : symbol,
          c.financials || null,
          c.avOverview || null,
          c.avSentiment || null,
          c.profile || null,
          isETF
        );
      }

      if (selectedSymbol === symbol) renderFundamentalsHTML(contentEl, c, symbol);
    } catch (e) {
      if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="error-msg">' + e.message + '</div>';
    }
    if (symbol === selectedSymbol) { btn.disabled = false; btn.textContent = 'Reload'; }
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
      if (ai.overallAssessment) h += '<div class="fundamentals-badge ' + (ai.overallAssessment || '') + '">\uD83C\uDFAF Overall: ' + (ai.overallAssessment || 'N/A') + '</div>';
      h += '<div class="fundamentals-badge ' + (ai.growthOutlook || '') + '">\uD83D\uDCC8 Growth: ' + (ai.growthOutlook || 'N/A') + '</div>';
      h += '<div class="fundamentals-badge ' + (ai.marginTrend || '') + '">\uD83D\uDCCA Margins: ' + (ai.marginTrend || 'N/A') + '</div>';
      h += '<div class="fundamentals-badge ' + (ai.healthScore || '') + '">\uD83C\uDFE6 Health: ' + (ai.healthScore || 'N/A') + '</div>';
      if (ai.capitalAllocation) h += '<div class="fundamentals-badge ' + (ai.capitalAllocation || '') + '">\uD83D\uDCB0 Capital: ' + (ai.capitalAllocation || 'N/A') + '</div>';
      h += '<div class="fundamentals-badge ' + (ai.sentimentLabel || '') + '">\uD83D\uDCE1 Sentiment: ' + (ai.sentimentLabel || 'N/A') + '</div>';
      h += '</div>';
      h += '<div class="ai-summary">' + (ai.summary || '') + '</div>';
      if (ai.capitalAllocationReason) h += '<div style="font-size:0.7rem;color:var(--muted);margin-bottom:0.4rem;"><span style="font-weight:600;">Capital Allocation:</span> ' + ai.capitalAllocationReason + '</div>';
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
    if (symbol === selectedSymbol) {
      btn.disabled = true; btn.textContent = 'Analyzing\u2026';
      contentEl.innerHTML = '<div class="tile-loading">\uD83E\uDD16 Analyzing...</div>';
    }
    try {
      var c = cache[symbol];
      var stockInfo = trackedStocks.find(function(t) { return t.symbol === symbol; }) || {};
      var isETF = stockInfo.type === 'ETF';
      c.aiResult = await NewsAI.analyzeNews(symbol, c.profile ? c.profile.name : symbol, c.articles, c.financials || null, isETF);
      if (symbol === selectedSymbol) renderAIHTML(contentEl, c.aiResult);
    } catch (err) { if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="error-msg">' + err.message + '</div>'; }
    finally { if (symbol === selectedSymbol) { btn.textContent = 'Re-analyze'; btn.disabled = false; } }
  }
  function renderAIHTML(el, ai) {
    var icon = ai.longTermOutlook === 'BULLISH' ? '\uD83D\uDCC8' : ai.longTermOutlook === 'BEARISH' ? '\uD83D\uDCC9' : '\u27A1\uFE0F';
    var h = '<div class="ai-summary">' + (ai.summary || '') + '</div>';
    h += '<div class="ai-outlook ' + ai.longTermOutlook + '">' + icon + ' Long-term: ' + ai.longTermOutlook + '</div>';
    h += '<div class="ai-outlook-reason">' + (ai.outlookReason || '') + '</div>';
    if (ai.valuationImpact && ai.valuationImpact.length) {
      h += '<div class="ai-table-title">Valuation Impact Factors</div><table class="ai-table"><thead><tr><th>Factor</th><th>Direction</th><th>Magnitude</th><th>Detail</th></tr></thead><tbody>';
      ai.valuationImpact.forEach(function(f) { h += '<tr><td class="ai-table-factor">' + f.factor + '</td><td><span class="ai-direction ' + f.direction + '">' + f.direction + '</span></td><td><span class="ai-impact-badge ' + (f.magnitude || 'MEDIUM') + '">' + (f.magnitude || '') + '</span></td><td class="ai-table-detail">' + f.detail + '</td></tr>'; });
      h += '</tbody></table>';
    }
    if (ai.keyTriggers && ai.keyTriggers.length) {
      h += '<div class="ai-table-title">\u26A1 Key Triggers</div><table class="ai-table"><thead><tr><th>Event</th><th>Impact</th><th>Timeline</th><th>Why It Matters</th></tr></thead><tbody>';
      ai.keyTriggers.forEach(function(t) { h += '<tr><td class="ai-table-factor">' + t.event + '</td><td><span class="ai-impact-badge ' + t.impact + '">' + t.impact + '</span></td><td style="font-size:0.7rem;color:var(--muted);">' + (t.timeline || '') + '</td><td class="ai-table-detail">' + t.explanation + '</td></tr>'; });
      h += '</tbody></table>';
    }
    if (ai.narrativeShift) {
      h += '<div style="margin-top:0.5rem;padding:0.4rem 0.6rem;background:var(--card-bg);border-left:3px solid var(--accent);border-radius:4px;font-size:0.75rem;color:var(--text-secondary);"><span style="color:var(--accent);font-weight:600;">Narrative Shift:</span> ' + ai.narrativeShift + '</div>';
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
    if (symbol === selectedSymbol) {
      btn.disabled = true; btn.textContent = 'Summarizing\u2026';
      contentEl.innerHTML = '<div class="tile-loading">\uD83E\uDD16 Analyzing analyst ratings...</div>';
    }
    try {
      var stockInfo = trackedStocks.find(function(t) { return t.symbol === symbol; }) || {};
      var isETF = stockInfo.type === 'ETF';
      c.analystAIResult = await NewsAI.analyzeAnalysts(
        symbol,
        c.profile ? c.profile.name : symbol,
        c.recommendations || [],
        c.upgrades || [],
        c.financials || null,
        isETF
      );
      if (symbol === selectedSymbol) renderAnalystHTML(contentEl, c.analystAIResult, c.upgrades || [], symbol);
    } catch (err) { if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="error-msg">' + err.message + '</div>'; }
    finally { if (symbol === selectedSymbol) { btn.textContent = 'Re-summarize'; btn.disabled = false; } }
  }

  function renderAnalystHTML(el, ai, upgrades, symbol) {
    var icon = ai.consensus === 'BULLISH' ? '\uD83D\uDCC8' : ai.consensus === 'BEARISH' ? '\uD83D\uDCC9' : '\u27A1\uFE0F';
    var h = '<div class="ai-summary">' + (ai.summary || '') + '</div>';
    h += '<div class="ai-outlook ' + ai.consensus + '">' + icon + ' Consensus: ' + ai.consensus + '</div>';
    h += '<div class="ai-outlook-reason">' + (ai.consensusReason || '') + '</div>';
    if (ai.contrarian) {
      h += '<div style="margin:0.4rem 0;padding:0.4rem 0.6rem;background:#1a1a2e;border-left:3px solid #f59e0b;border-radius:4px;font-size:0.75rem;color:#fbbf24;"><span style="font-weight:600;">Contrarian View:</span> ' + ai.contrarian + '</div>';
    }
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
    if (symbol === selectedSymbol) {
      btn.disabled = true; btn.textContent = 'Analyzing\u2026';
      contentEl.innerHTML = '<div class="tile-loading">\uD83E\uDD16 Analyzing macro impact on ' + symbol + '...</div>';
    }
    try {
      var sector = (c.profile && c.profile.sector) || '';
      var stockInfo = trackedStocks.find(function(t) { return t.symbol === symbol; }) || {};
      var isETF = stockInfo.type === 'ETF';
      c.macroAIResult = await NewsAI.analyzeMacro(
        symbol,
        c.profile ? c.profile.name : symbol,
        c.macroArticles,
        c.financials || null,
        sector,
        isETF
      );
      if (symbol === selectedSymbol) renderMacroHTML(contentEl, c.macroAIResult, c.macroArticles);
    } catch (err) { if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="error-msg">' + err.message + '</div>'; }
    finally { if (symbol === selectedSymbol) { btn.textContent = 'Re-analyze'; btn.disabled = false; } }
  }

  function renderMacroHTML(el, ai, articles) {
    var icon = ai.impact === 'POSITIVE' ? '\uD83D\uDCC8' : ai.impact === 'NEGATIVE' ? '\uD83D\uDCC9' : '\u2194\uFE0F';
    var impactClass = ai.impact === 'POSITIVE' ? 'BULLISH' : ai.impact === 'NEGATIVE' ? 'BEARISH' : 'NEUTRAL';
    var h = '';
    if (ai.macroRegime) {
      h += '<div class="ai-outlook-reason" style="margin-bottom:0.5rem;font-style:italic;">\uD83C\uDF0D ' + ai.macroRegime + '</div>';
    }
    h += '<div class="ai-summary">' + (ai.summary || '') + '</div>';
    h += '<div class="ai-outlook ' + impactClass + '">' + icon + ' Macro Impact: ' + ai.impact + '</div>';
    h += '<div class="ai-outlook-reason">' + (ai.impactReason || '') + '</div>';
    if (ai.macroFactors && ai.macroFactors.length) {
      h += '<div class="ai-table-title">Macro Factors</div>';
      ai.macroFactors.forEach(function(f) {
        h += '<div class="macro-factor-item">'
          + '<span class="macro-factor-label">' + f.factor + '</span>'
          + '<span class="macro-factor-badge ' + f.direction + '">' + f.direction + '</span>'
          + (f.magnitude ? '<span class="ai-impact-badge ' + f.magnitude + '" style="font-size:0.6rem;margin-left:0.3rem;">' + f.magnitude + '</span>' : '')
          + '<span class="macro-factor-detail">' + f.detail + '</span>'
          + '</div>';
      });
    }
    if (ai.risks && ai.risks.length) {
      h += '<div class="ai-table-title">\u26A0\uFE0F Macro Risks</div><table class="ai-table"><thead><tr><th>Risk</th><th>Severity</th><th>Prob.</th><th>Detail</th></tr></thead><tbody>';
      ai.risks.forEach(function(r) {
        h += '<tr><td class="ai-table-factor">' + r.risk + '</td><td><span class="ai-impact-badge ' + r.severity + '">' + r.severity + '</span></td><td><span class="ai-impact-badge ' + (r.probability || 'MEDIUM') + '">' + (r.probability || '') + '</span></td><td class="ai-table-detail">' + r.detail + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    if (ai.sectorImpact) {
      h += '<div style="margin-top:0.5rem;padding:0.4rem 0.6rem;background:var(--card-bg);border-left:3px solid var(--accent);border-radius:4px;font-size:0.75rem;color:var(--text-secondary);"><span style="color:var(--accent);font-weight:600;">Sector Impact:</span> ' + ai.sectorImpact + '</div>';
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
    if (s.type === 'ETF') { tile.style.display = 'none'; tile.setAttribute('data-render-hidden', 'true'); return; }
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
    if (symbol === selectedSymbol) {
      btn.disabled = true; btn.textContent = 'Loading\u2026';
      contentEl.innerHTML = '<div class="tile-loading">\uD83C\uDFA4 Loading earnings call data...</div>';
    }
    try {
      // Try Alpha Vantage transcript first
      if (AlphaAPI.hasKey() && !c.avTranscript) {
        var quarter = AlphaAPI.guessLatestQuarter(c.earnings);
        if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="tile-loading">\uD83C\uDFA4 Fetching transcript for ' + quarter + '...</div>';
        c.avTranscript = await AlphaAPI.getEarningsTranscript(symbol, quarter);
        // If that quarter returned nothing, try the previous quarter
        if (!c.avTranscript) {
          var parts = quarter.match(/(\d{4})Q(\d)/);
          if (parts) {
            var prevQ = parseInt(parts[2]) - 1;
            var prevY = parseInt(parts[1]);
            if (prevQ < 1) { prevQ = 4; prevY--; }
            var prevQuarter = prevY + 'Q' + prevQ;
            if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="tile-loading">\uD83C\uDFA4 Trying ' + prevQuarter + '...</div>';
            c.avTranscript = await AlphaAPI.getEarningsTranscript(symbol, prevQuarter);
          }
        }
      }
      if (symbol === selectedSymbol) {
        btn.textContent = 'Summarizing\u2026';
        contentEl.innerHTML = '<div class="tile-loading">\uD83E\uDD16 AI is summarizing...</div>';
      }
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
      if (symbol === selectedSymbol) renderTranscriptHTML(contentEl, c.transcriptAIResult, c.earnings, symbol, c.avTranscript);
    } catch (err) { if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="error-msg">' + err.message + '</div>'; }
    finally { if (symbol === selectedSymbol) { btn.textContent = 'Re-summarize'; btn.disabled = false; } }
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
    if (ai.earningsQuality || ai.managementCredibility) {
      h += '<div style="display:flex;gap:0.5rem;margin:0.4rem 0;flex-wrap:wrap;">';
      if (ai.earningsQuality) {
        var eqColor = ai.earningsQuality === 'HIGH' ? 'var(--green)' : ai.earningsQuality === 'LOW' ? 'var(--red)' : 'var(--muted)';
        h += '<div style="flex:1;min-width:180px;padding:0.4rem 0.6rem;background:var(--card-bg);border-radius:4px;font-size:0.72rem;"><span style="color:' + eqColor + ';font-weight:600;">Earnings Quality: ' + ai.earningsQuality + '</span><br><span style="color:var(--text-secondary);">' + (ai.earningsQualityReason || '') + '</span></div>';
      }
      if (ai.managementCredibility) {
        h += '<div style="flex:1;min-width:180px;padding:0.4rem 0.6rem;background:var(--card-bg);border-radius:4px;font-size:0.72rem;color:var(--text-secondary);"><span style="color:var(--accent);font-weight:600;">Mgmt Credibility:</span> ' + ai.managementCredibility + '</div>';
      }
      h += '</div>';
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
    if (s.type === 'ETF') { tile.style.display = 'none'; tile.setAttribute('data-render-hidden', 'true'); return; }
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
    if (symbol === selectedSymbol) {
      btn.disabled = true; btn.textContent = 'Loading\u2026';
      contentEl.innerHTML = '<div class="tile-loading">Fetching peer list...</div>';
    }
    try {
      if (!cache[symbol]) cache[symbol] = {};
      var peerSymbols = await StockAPI.getPeers(symbol);
      if (!peerSymbols || !peerSymbols.length) {
        if (symbol === selectedSymbol) {
          contentEl.innerHTML = '<div class="tile-loading">No peers found for ' + symbol + '.</div>';
          btn.disabled = false; btn.textContent = 'Load Peers';
        }
        return;
      }
      var peers = [];
      for (var i = 0; i < peerSymbols.length; i++) {
        var ps = peerSymbols[i];
        if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="tile-loading">Loading ' + ps + ' (' + (i + 1) + '/' + peerSymbols.length + ')...</div>';
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
      if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="error-msg">Failed to load peers: ' + e.message + '</div>';
    }
    if (symbol === selectedSymbol) { btn.disabled = false; btn.textContent = 'Reload Peers'; }
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
      fwdPE: parseFloat(getForwardPE(c)) || null,
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
        fwdPE: parseFloat(f.peBasicExclExtraTTM) || null,
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

    // Sector/Industry Comparison — compute peer group medians
    var peerOnly = rows.filter(function(r) { return !r.isCurrent; });
    if (peerOnly.length >= 2) {
      var me = rows[0];
      function median(arr) {
        var sorted = arr.slice().sort(function(a, b) { return a - b; });
        var mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      }
      var metrics = [
        { label: 'P/E Ratio', key: 'pe', suffix: 'x', lower: true },
        { label: 'Fwd P/E', key: 'fwdPE', suffix: 'x', lower: true },
        { label: 'Rev Growth', key: 'revGrowth', suffix: '%', lower: false },
        { label: 'Profit Margin', key: 'profitMargin', suffix: '%', lower: false },
        { label: 'Div Yield', key: 'divYield', suffix: '%', lower: false },
        { label: 'Beta', key: 'beta', suffix: '', lower: true },
      ];
      h += '<div style="margin-top:0.75rem;"><div style="font-size:0.62rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:0.4rem;">Sector Comparison (vs Peer Median)</div>';
      h += '<div style="display:flex;flex-wrap:wrap;gap:0.4rem;">';
      metrics.forEach(function(m) {
        var vals = peerOnly.map(function(r) { return r[m.key]; }).filter(function(v) { return v != null && !isNaN(v); });
        if (!vals.length || me[m.key] == null) return;
        var med = median(vals);
        var myVal = me[m.key];
        var diff = myVal - med;
        var better = m.lower ? diff < 0 : diff > 0;
        var color = better ? 'var(--green)' : 'var(--red)';
        var arrow = better ? '\u25B2' : '\u25BC';
        h += '<div style="flex:1;min-width:120px;background:var(--bg);border-radius:6px;padding:0.4rem 0.5rem;text-align:center;">';
        h += '<div style="font-size:0.55rem;color:var(--muted);text-transform:uppercase;">' + m.label + '</div>';
        h += '<div style="font-size:0.85rem;font-weight:700;">' + myVal.toFixed(1) + m.suffix + '</div>';
        h += '<div style="font-size:0.6rem;color:' + color + ';">' + arrow + ' vs median ' + med.toFixed(1) + m.suffix + '</div>';
        h += '</div>';
      });
      h += '</div></div>';
    }

    el.innerHTML = h;
  }

  // --- Sector Relative Strength ---
  function renderDetailSectorStrength(symbol, c, s) {
    var tile = document.getElementById('tile-sector-strength');
    var el = document.getElementById('detail-sector-strength');
    if (!tile || !el) return;
    if (s && s.type === 'ETF') { tile.style.display = 'none'; tile.setAttribute('data-render-hidden', 'true'); return; }
    tile.style.display = '';
    var f = c.financials || {};
    var q = c.quote || {};
    if (!q.price || !f.week52High || !f.week52Low) {
      el.innerHTML = '<div class="tile-loading">Waiting for quote & financials...</div>';
      return;
    }
    var w52H = parseFloat(f.week52High) || 0;
    var w52L = parseFloat(f.week52Low) || 0;
    var price = q.price;
    var rangePct = (w52H > w52L) ? Math.round((price - w52L) / (w52H - w52L) * 100) : 50;
    rangePct = Math.max(0, Math.min(100, rangePct));
    var ytdProxy = q.changePct || 0;
    var h = '<div class="sector-strength-bars">';
    // 52-week position
    var posColor = rangePct > 70 ? 'var(--green)' : rangePct < 30 ? 'var(--red)' : '#f59e0b';
    h += '<div class="sector-bar-row"><span class="sector-bar-label">52W Pos</span>';
    h += '<div class="sector-bar-track"><div class="sector-bar-fill" style="width:' + rangePct + '%;background:' + posColor + ';">' + rangePct + '%</div></div></div>';
    // Day change
    var dayPct = Math.min(Math.abs(ytdProxy), 10);
    var dayColor = ytdProxy >= 0 ? 'var(--green)' : 'var(--red)';
    var dayWidth = Math.max(5, dayPct * 10);
    h += '<div class="sector-bar-row"><span class="sector-bar-label">Day Chg</span>';
    h += '<div class="sector-bar-track"><div class="sector-bar-fill" style="width:' + dayWidth + '%;background:' + dayColor + ';">' + (ytdProxy >= 0 ? '+' : '') + ytdProxy.toFixed(2) + '%</div></div></div>';
    h += '</div>';
    // Summary
    var strength = rangePct > 70 ? 'Strong' : rangePct > 40 ? 'Neutral' : 'Weak';
    var strengthColor = rangePct > 70 ? 'var(--green)' : rangePct > 40 ? '#f59e0b' : 'var(--red)';
    h += '<div style="text-align:center;margin-top:0.5rem;">';
    h += '<div style="font-size:0.65rem;color:var(--muted);">Relative Strength</div>';
    h += '<div style="font-size:1.2rem;font-weight:800;color:' + strengthColor + ';">' + strength + '</div>';
    h += '<div style="font-size:0.6rem;color:var(--muted);">Price at ' + rangePct + '% of 52-week range</div>';
    h += '</div>';
    // Price context
    h += '<div style="display:flex;justify-content:space-between;font-size:0.65rem;color:var(--muted);margin-top:0.4rem;">';
    h += '<span>52W Low: $' + w52L.toFixed(2) + '</span>';
    h += '<span style="font-weight:600;color:var(--text);">$' + price.toFixed(2) + '</span>';
    h += '<span>52W High: $' + w52H.toFixed(2) + '</span>';
    h += '</div>';
    el.innerHTML = h;
  }

  // --- Valuation Scorecard ---
  function renderDetailValScorecard(symbol, c, s) {
    var tile = document.getElementById('tile-val-scorecard');
    var el = document.getElementById('detail-val-scorecard');
    if (!tile || !el) return;
    if (s && s.type === 'ETF') { tile.style.display = 'none'; tile.setAttribute('data-render-hidden', 'true'); return; }
    tile.style.display = '';
    var f = c.financials || {};
    var av = c.avOverview || {};
    var pe = parseFloat(f.peRatio) || null;
    var pb = av.PriceToBookRatio ? parseFloat(av.PriceToBookRatio) : null;
    var ps = av.PriceToSalesRatioTTM ? parseFloat(av.PriceToSalesRatioTTM) : null;
    var epsGrowth = f.epsGrowth != null ? f.epsGrowth : null;
    var peg = (pe && epsGrowth && epsGrowth > 0) ? pe / epsGrowth : null;
    if (!pe && !pb && !ps) {
      el.innerHTML = '<div class="tile-loading">Waiting for valuation data...</div>';
      return;
    }
    // Score each metric 1-10 (lower valuation = higher score)
    var metrics = [];
    var totalScore = 0;
    var count = 0;
    function scoreMetric(label, val, thresholds, suffix) {
      if (val == null || isNaN(val)) return;
      // thresholds: [cheap, fair, expensive] — below cheap=10, above expensive=1
      var score;
      if (val <= thresholds[0]) score = 10;
      else if (val <= thresholds[1]) score = 7;
      else if (val <= thresholds[2]) score = 4;
      else score = 1;
      var cls = score >= 7 ? 'good' : score >= 4 ? 'neutral' : 'bad';
      metrics.push({ label: label, val: val.toFixed(1) + (suffix || ''), score: score, cls: cls });
      totalScore += score;
      count++;
    }
    scoreMetric('P/E Ratio', pe, [12, 20, 35], 'x');
    scoreMetric('P/B Ratio', pb, [1.5, 3, 6], 'x');
    scoreMetric('P/S Ratio', ps, [2, 5, 10], 'x');
    scoreMetric('PEG Ratio', peg, [0.8, 1.5, 2.5], 'x');
    var avgScore = count > 0 ? Math.round(totalScore / count) : 5;
    var badge = avgScore >= 7 ? 'cheap' : avgScore >= 4 ? 'fair' : 'expensive';
    var badgeLabel = avgScore >= 7 ? 'Cheap' : avgScore >= 4 ? 'Fair Value' : 'Expensive';
    var scoreColor = avgScore >= 7 ? 'var(--green)' : avgScore >= 4 ? '#f59e0b' : 'var(--red)';
    var h = '<div class="val-score-ring">';
    h += '<div class="val-score-num" style="color:' + scoreColor + ';">' + avgScore + '<span style="font-size:0.8rem;color:var(--muted);">/10</span></div>';
    h += '<span class="val-score-badge ' + badge + '">' + badgeLabel + '</span>';
    h += '</div>';
    h += '<div class="val-metrics">';
    metrics.forEach(function(m) {
      h += '<div class="val-metric-row"><span class="val-metric-label">' + m.label + '</span><span class="val-metric-val">' + m.val + '</span><span class="val-metric-score ' + m.cls + '">' + m.score + '/10</span></div>';
    });
    h += '</div>';
    if (count < 4) {
      h += '<div style="font-size:0.58rem;color:var(--muted);margin-top:0.3rem;">Add Alpha Vantage key for P/B and P/S data to improve accuracy.</div>';
    }
    el.innerHTML = h;
  }

  // --- EPS Estimate Revisions ---
  var epsEstChart = null;
  function renderDetailEPSEstimates(symbol, c, s) {
    var tile = document.getElementById('tile-eps-estimates');
    var contentEl = document.getElementById('detail-eps-estimates-content');
    var btn = document.getElementById('detail-eps-estimates-btn');
    if (!tile || !contentEl || !btn) return;
    if (s && s.type === 'ETF') { tile.style.display = 'none'; tile.setAttribute('data-render-hidden', 'true'); return; }
    tile.style.display = '';
    btn.onclick = function() { loadEPSEstimates(symbol); };
    if (c.epsEstimates && c.epsEstimates.quarterly && c.epsEstimates.quarterly.length) {
      renderEPSEstimatesHTML(contentEl, c.epsEstimates);
      btn.disabled = false; btn.textContent = 'Reload';
      return;
    }
    if (!StockAPI.hasKey()) { btn.disabled = true; return; }
    btn.disabled = false; btn.textContent = 'Load';
    contentEl.innerHTML = '<div class="tile-loading">Click Load to fetch analyst EPS estimates (1 API call).</div>';
  }

  async function loadEPSEstimates(symbol) {
    var contentEl = document.getElementById('detail-eps-estimates-content');
    var btn = document.getElementById('detail-eps-estimates-btn');
    if (!StockAPI.hasKey()) return;
    if (symbol === selectedSymbol) {
      btn.disabled = true; btn.textContent = 'Loading\u2026';
      contentEl.innerHTML = '<div class="tile-loading">Fetching EPS estimates...</div>';
    }
    try {
      if (!cache[symbol]) cache[symbol] = {};
      cache[symbol].epsEstimates = await StockAPI.getEPSEstimates(symbol);
      if (symbol === selectedSymbol) {
        if (!cache[symbol].epsEstimates || !cache[symbol].epsEstimates.quarterly || !cache[symbol].epsEstimates.quarterly.length) {
          contentEl.innerHTML = '<div class="tile-loading">No EPS estimate data available for ' + symbol + '.</div>';
        } else {
          renderEPSEstimatesHTML(contentEl, cache[symbol].epsEstimates);
        }
      }
    } catch(e) {
      if (symbol === selectedSymbol) contentEl.innerHTML = '<div class="error-msg">' + e.message + '</div>';
    }
    if (symbol === selectedSymbol) { btn.disabled = false; btn.textContent = 'Reload'; }
  }

  function renderEPSEstimatesHTML(el, data) {
    var q = data.quarterly || [];
    if (!q.length) { el.innerHTML = '<div class="tile-loading">No estimates available.</div>'; return; }
    var h = '';
    // Chart
    h += '<div class="eps-est-chart-container"><canvas id="eps-est-chart"></canvas></div>';
    // Table
    h += '<table class="eps-est-table"><thead><tr><th>Period</th><th>Avg Est</th><th>High</th><th>Low</th><th>Analysts</th></tr></thead><tbody>';
    q.forEach(function(e) {
      var avgStr = e.avg != null ? '$' + e.avg.toFixed(2) : '--';
      var highStr = e.high != null ? '$' + e.high.toFixed(2) : '--';
      var lowStr = e.low != null ? '$' + e.low.toFixed(2) : '--';
      h += '<tr><td>' + e.period + '</td><td style="font-weight:600;">' + avgStr + '</td><td style="color:var(--green);">' + highStr + '</td><td style="color:var(--red);">' + lowStr + '</td><td>' + (e.numAnalysts || '--') + '</td></tr>';
    });
    h += '</tbody></table>';
    // Trend indicator
    if (q.length >= 2 && q[0].avg != null && q[1].avg != null) {
      var trend = q[0].avg >= q[1].avg ? 'up' : 'down';
      var trendLabel = trend === 'up' ? 'Estimates Rising' : 'Estimates Falling';
      h += '<div style="text-align:center;margin-top:0.3rem;"><span class="eps-est-trend ' + trend + '">' + (trend === 'up' ? '\u25B2' : '\u25BC') + ' ' + trendLabel + '</span></div>';
    }
    el.innerHTML = h;
    // Draw chart
    var canvas = document.getElementById('eps-est-chart');
    if (!canvas) return;
    if (epsEstChart) epsEstChart.destroy();
    var sorted = q.slice().reverse();
    epsEstChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: sorted.map(function(e) { return e.period; }),
        datasets: [
          { label: 'Avg EPS Est', data: sorted.map(function(e) { return e.avg; }), backgroundColor: 'rgba(99,102,241,0.7)', borderRadius: 3 },
          { type: 'line', label: 'High', data: sorted.map(function(e) { return e.high; }), borderColor: 'var(--green)', borderWidth: 1.5, pointRadius: 3, fill: false, tension: 0.3 },
          { type: 'line', label: 'Low', data: sorted.map(function(e) { return e.low; }), borderColor: 'var(--red)', borderWidth: 1.5, pointRadius: 3, fill: false, tension: 0.3 },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, labels: { color: '#8b8fa3', font: { size: 9 }, boxWidth: 10 } } },
        scales: {
          x: { ticks: { color: '#8b8fa3', font: { size: 9 } }, grid: { display: false } },
          y: { ticks: { color: '#8b8fa3', font: { size: 9 }, callback: function(v) { return '$' + v.toFixed(2); } }, grid: { color: '#2a2d3a' } },
        }
      }
    });
  }

  // --- Options & Volatility ---
  function renderDetailOptionsFlow(symbol, c, s) {
    var tile = document.getElementById('tile-options-flow');
    var el = document.getElementById('detail-options-flow');
    if (!tile || !el) return;
    if (s && s.type === 'ETF') { tile.style.display = 'none'; tile.setAttribute('data-render-hidden', 'true'); return; }
    tile.style.display = '';
    var f = c.financials || {};
    var q = c.quote || {};
    var beta = parseFloat(f.beta) || null;
    var w52H = parseFloat(f.week52High) || 0;
    var w52L = parseFloat(f.week52Low) || 0;
    var price = q.price || 0;
    if (!beta && !w52H) {
      el.innerHTML = '<div class="tile-loading">Waiting for quote data...</div>';
      return;
    }
    // Implied volatility proxy from 52-week range
    var ivProxy = (w52H > 0 && w52L > 0) ? ((w52H - w52L) / ((w52H + w52L) / 2) * 100) : null;
    var volLabel = 'N/A';
    var volClass = 'moderate';
    if (ivProxy != null) {
      if (ivProxy < 25) { volLabel = 'Low'; volClass = 'low'; }
      else if (ivProxy < 50) { volLabel = 'Moderate'; volClass = 'moderate'; }
      else { volLabel = 'High'; volClass = 'high'; }
    }
    var h = '<div class="vol-gauge">';
    h += '<div class="vol-gauge-label">Implied Volatility (52W proxy)</div>';
    if (ivProxy != null) {
      h += '<div class="vol-gauge-val" style="color:' + (volClass === 'low' ? 'var(--green)' : volClass === 'high' ? 'var(--red)' : '#f59e0b') + ';">' + ivProxy.toFixed(1) + '%</div>';
    }
    h += '<span class="vol-gauge-badge ' + volClass + '">' + volLabel + ' Volatility</span>';
    h += '</div>';
    // Expected move range (simplified: price +/- IV proxy / sqrt(12) for 1 month)
    if (ivProxy != null && price > 0) {
      var monthlyMove = price * (ivProxy / 100) / Math.sqrt(12);
      h += '<div class="vol-range">';
      h += '<div class="vol-range-item"><div class="vol-range-label">1-Mo Low</div><div class="vol-range-val" style="color:var(--red);">$' + (price - monthlyMove).toFixed(2) + '</div></div>';
      h += '<div class="vol-range-item"><div class="vol-range-label">Current</div><div class="vol-range-val">$' + price.toFixed(2) + '</div></div>';
      h += '<div class="vol-range-item"><div class="vol-range-label">1-Mo High</div><div class="vol-range-val" style="color:var(--green);">$' + (price + monthlyMove).toFixed(2) + '</div></div>';
      h += '</div>';
    }
    // Beta context
    if (beta != null) {
      var betaColor = beta > 1.3 ? 'var(--red)' : beta < 0.8 ? 'var(--green)' : '#f59e0b';
      var betaLabel = beta > 1.3 ? 'High Beta (more volatile than market)' : beta < 0.8 ? 'Low Beta (less volatile than market)' : 'Market-like volatility';
      h += '<div style="text-align:center;margin-top:0.5rem;font-size:0.72rem;">';
      h += '<span style="font-weight:700;color:' + betaColor + ';">Beta: ' + beta.toFixed(2) + '</span>';
      h += '<div style="font-size:0.6rem;color:var(--muted);">' + betaLabel + '</div>';
      h += '</div>';
    }
    h += '<div style="font-size:0.55rem;color:var(--muted);margin-top:0.4rem;text-align:center;">IV proxy derived from 52-week range. Real options data requires premium feed.</div>';
    el.innerHTML = h;
  }

  // --- Watchlist Correlation Matrix ---
  function renderDetailCorrelation(symbol, c, s) {
    var tile = document.getElementById('tile-correlation');
    var el = document.getElementById('detail-correlation');
    if (!tile || !el) return;
    // Need at least 2 tracked stocks with quotes
    var stocksWithQuotes = trackedStocks.filter(function(st) {
      var cc = cache[st.symbol];
      return cc && cc.quote && cc.quote.changePct != null;
    });
    if (stocksWithQuotes.length < 2) {
      el.innerHTML = '<div class="tile-loading">Track 2+ stocks with loaded quotes to see correlation matrix.</div>';
      return;
    }
    // Use daily change % as a proxy for correlation
    // Since we only have current day data, show a simplified "same direction" matrix
    var symbols = stocksWithQuotes.map(function(st) { return st.symbol; });
    var changes = {};
    symbols.forEach(function(sym) {
      changes[sym] = cache[sym].quote.changePct;
    });
    var n = symbols.length;
    var gridCols = n + 1;
    var h = '<div class="corr-matrix" style="grid-template-columns: 60px repeat(' + n + ', 1fr);">';
    // Header row
    h += '<div class="corr-cell corr-header"></div>';
    symbols.forEach(function(sym) {
      h += '<div class="corr-cell corr-header">' + sym + '</div>';
    });
    // Data rows
    for (var i = 0; i < n; i++) {
      h += '<div class="corr-cell corr-header">' + symbols[i] + '</div>';
      for (var j = 0; j < n; j++) {
        if (i === j) {
          h += '<div class="corr-cell" style="background:rgba(99,102,241,0.3);color:var(--text);">1.00</div>';
        } else {
          // Simple correlation proxy: same direction = positive, opposite = negative
          var ci = changes[symbols[i]];
          var cj = changes[symbols[j]];
          var sameDir = (ci >= 0 && cj >= 0) || (ci < 0 && cj < 0);
          var magnitude = 1 - Math.abs(Math.abs(ci) - Math.abs(cj)) / Math.max(Math.abs(ci), Math.abs(cj), 0.01);
          var corr = sameDir ? magnitude : -magnitude;
          corr = Math.max(-1, Math.min(1, corr));
          var bg, textColor;
          if (corr > 0.5) { bg = 'rgba(34,197,94,' + (corr * 0.4).toFixed(2) + ')'; textColor = 'var(--green)'; }
          else if (corr < -0.5) { bg = 'rgba(239,68,68,' + (Math.abs(corr) * 0.4).toFixed(2) + ')'; textColor = 'var(--red)'; }
          else { bg = 'rgba(139,143,163,' + (Math.abs(corr) * 0.2).toFixed(2) + ')'; textColor = 'var(--muted)'; }
          h += '<div class="corr-cell" style="background:' + bg + ';color:' + textColor + ';">' + corr.toFixed(2) + '</div>';
        }
      }
    }
    h += '</div>';
    h += '<div style="font-size:0.55rem;color:var(--muted);margin-top:0.4rem;">Correlation proxy based on current day price changes. Green = moving together, Red = moving apart. For true correlation, historical data is needed.</div>';
    el.innerHTML = h;
  }

  // --- Fair Value Range ---
  var fairValueChart = null;
  function renderDetailFairValue(symbol, c, s) {
    var tile = document.getElementById('tile-fair-value');
    var el = document.getElementById('detail-fair-value');
    if (!tile || !el) return;
    if (s && s.type === 'ETF') { tile.style.display = 'none'; tile.setAttribute('data-render-hidden', 'true'); return; }
    tile.style.display = '';
    var f = c.financials || {};
    var q = c.quote || {};
    var annualSeries = f.annualSeries || {};
    var peHistory = StockAPI.computePEHistory(annualSeries);
    var eps = parseFloat(f.eps) || null;
    var price = q.price || 0;
    if (!eps || peHistory.length < 2 || !price) {
      el.innerHTML = '<div class="tile-loading">Need P/E history + EPS data. Waiting for financials...</div>';
      return;
    }
    // Compute fair value band: historical PE range × current EPS
    var peValues = peHistory.map(function(p) { return p.pe; });
    var peAvg = peValues.reduce(function(a, b) { return a + b; }, 0) / peValues.length;
    var peSorted = peValues.slice().sort(function(a, b) { return a - b; });
    var peLow = peSorted[Math.floor(peSorted.length * 0.25)]; // 25th percentile
    var peHigh = peSorted[Math.floor(peSorted.length * 0.75)]; // 75th percentile
    var fairLow = peLow * eps;
    var fairMid = peAvg * eps;
    var fairHigh = peHigh * eps;
    var currentPE = parseFloat(f.peTTM) || (price / eps);
    // Summary boxes
    var h = '<div class="fair-value-summary">';
    h += '<div class="fair-value-box"><div class="label">Fair Low</div><div class="value" style="color:var(--red);">$' + fairLow.toFixed(2) + '</div></div>';
    h += '<div class="fair-value-box"><div class="label">Fair Mid</div><div class="value" style="color:#f59e0b;">$' + fairMid.toFixed(2) + '</div></div>';
    h += '<div class="fair-value-box"><div class="label">Fair High</div><div class="value" style="color:var(--green);">$' + fairHigh.toFixed(2) + '</div></div>';
    h += '<div class="fair-value-box"><div class="label">Current</div><div class="value">$' + price.toFixed(2) + '</div></div>';
    h += '</div>';
    // Assessment
    var assessment, assessColor;
    if (price < fairLow) { assessment = 'Undervalued — below fair value range'; assessColor = 'var(--green)'; }
    else if (price > fairHigh) { assessment = 'Overvalued — above fair value range'; assessColor = 'var(--red)'; }
    else { assessment = 'Within fair value range'; assessColor = '#f59e0b'; }
    h += '<div style="text-align:center;font-size:0.75rem;font-weight:600;color:' + assessColor + ';margin-bottom:0.4rem;">' + assessment + '</div>';
    // Chart
    h += '<div class="fair-value-chart-container"><canvas id="fair-value-chart"></canvas></div>';
    h += '<div style="font-size:0.55rem;color:var(--muted);">Fair value band = Historical P/E (25th-75th percentile) x Current EPS ($' + eps.toFixed(2) + '). Avg P/E: ' + peAvg.toFixed(1) + 'x.</div>';
    el.innerHTML = h;
    // Draw chart
    var canvas = document.getElementById('fair-value-chart');
    if (!canvas) return;
    if (fairValueChart) fairValueChart.destroy();
    var labels = peHistory.map(function(p) { return p.date; });
    var fairLowLine = labels.map(function() { return fairLow; });
    var fairMidLine = labels.map(function() { return fairMid; });
    var fairHighLine = labels.map(function() { return fairHigh; });
    var priceLine = labels.map(function() { return price; });
    // Historical implied price from PE * current EPS
    var impliedPrices = peHistory.map(function(p) { return p.pe * eps; });
    fairValueChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          { label: 'Implied Price (PE x EPS)', data: impliedPrices, borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2 },
          { label: 'Current Price', data: priceLine, borderColor: '#fff', borderWidth: 2, borderDash: [6, 3], pointRadius: 0, fill: false },
          { label: 'Fair High', data: fairHighLine, borderColor: 'rgba(34,197,94,0.5)', borderWidth: 1, borderDash: [4, 2], pointRadius: 0, fill: false },
          { label: 'Fair Low', data: fairLowLine, borderColor: 'rgba(239,68,68,0.5)', borderWidth: 1, borderDash: [4, 2], pointRadius: 0, fill: false },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, labels: { color: '#8b8fa3', font: { size: 9 }, boxWidth: 10 } } },
        scales: {
          x: { ticks: { maxTicksLimit: 6, color: '#8b8fa3', font: { size: 9 } }, grid: { display: false } },
          y: { ticks: { color: '#8b8fa3', font: { size: 9 }, callback: function(v) { return '$' + v.toFixed(0); } }, grid: { color: '#2a2d3a' } },
        }
      }
    });
  }

  // --- Price Alerts ---
  var priceAlerts = [];
  function loadPriceAlerts() { priceAlerts = userGet('price_alerts', []); }
  function saveAlerts() { userSet('price_alerts', priceAlerts); }

  function renderDetailAlerts(symbol, c) {
    var tile = document.getElementById('tile-alerts');
    var contentEl = document.getElementById('detail-alerts-content');
    var addBtn = document.getElementById('detail-alerts-add-btn');
    if (!tile || !contentEl || !addBtn) return;

    var myAlerts = priceAlerts.filter(function(a) { return a.symbol === symbol; });
    var h = '';

    if (myAlerts.length) {
      h += '<div class="alerts-list">';
      myAlerts.forEach(function(a, idx) {
        var currentPrice = c.quote ? c.quote.price : null;
        var triggered = false;
        if (currentPrice != null) {
          if (a.type === 'above' && currentPrice >= a.price) triggered = true;
          if (a.type === 'below' && currentPrice <= a.price) triggered = true;
        }
        h += '<div class="alert-item">';
        h += '<span class="alert-item-type ' + a.type + '">' + a.type + '</span>';
        h += '<span class="alert-item-price">$' + a.price.toFixed(2) + '</span>';
        if (currentPrice != null) h += '<span class="alert-item-current">Current: $' + currentPrice.toFixed(2) + '</span>';
        if (triggered) h += '<span class="alert-triggered">TRIGGERED</span>';
        h += '<button class="alert-item-remove" data-alert-idx="' + idx + '">&times;</button>';
        h += '</div>';
      });
      h += '</div>';
    } else {
      h += '<div style="font-size:0.72rem;color:var(--muted);margin-bottom:0.4rem;">No alerts set for ' + symbol + '.</div>';
    }

    // Add alert form
    h += '<div class="alert-form" id="alert-form-' + symbol + '">';
    h += '<select id="alert-type-select"><option value="above">Above</option><option value="below">Below</option></select>';
    h += '<input type="number" id="alert-price-input" placeholder="Price..." step="0.01" />';
    h += '<button id="alert-save-btn">Set Alert</button>';
    h += '</div>';

    contentEl.innerHTML = h;

    // Wire up save button
    var saveBtn = document.getElementById('alert-save-btn');
    var typeSelect = document.getElementById('alert-type-select');
    var priceInput = document.getElementById('alert-price-input');
    if (saveBtn) {
      saveBtn.onclick = function() {
        var price = parseFloat(priceInput.value);
        if (isNaN(price) || price <= 0) return;
        priceAlerts.push({ symbol: symbol, type: typeSelect.value, price: price, createdAt: Date.now() });
        saveAlerts();
        renderDetailAlerts(symbol, cache[symbol] || {});
      };
    }

    // Wire up remove buttons
    contentEl.querySelectorAll('.alert-item-remove').forEach(function(btn) {
      btn.onclick = function() {
        var globalIdx = findAlertGlobalIndex(symbol, parseInt(btn.dataset.alertIdx));
        if (globalIdx >= 0) {
          priceAlerts.splice(globalIdx, 1);
          saveAlerts();
          renderDetailAlerts(symbol, cache[symbol] || {});
        }
      };
    });

    // Set add button to focus the price input
    addBtn.onclick = function() {
      if (priceInput) priceInput.focus();
    };
  }

  function findAlertGlobalIndex(symbol, localIdx) {
    var count = 0;
    for (var i = 0; i < priceAlerts.length; i++) {
      if (priceAlerts[i].symbol === symbol) {
        if (count === localIdx) return i;
        count++;
      }
    }
    return -1;
  }

  function checkPriceAlerts() {
    if (!priceAlerts.length) return;
    var notified = false;
    priceAlerts.forEach(function(a) {
      var c = cache[a.symbol];
      if (!c || !c.quote) return;
      var price = c.quote.price;
      var triggered = false;
      if (a.type === 'above' && price >= a.price && !a.notified) triggered = true;
      if (a.type === 'below' && price <= a.price && !a.notified) triggered = true;
      if (triggered) {
        a.notified = true;
        notified = true;
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Price Alert: ' + a.symbol, {
            body: a.symbol + ' is now $' + price.toFixed(2) + ' (' + a.type + ' $' + a.price.toFixed(2) + ')',
            icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><text y="32" font-size="32">📈</text></svg>'
          });
        }
      }
    });
    if (notified) {
      saveAlerts();
      if (selectedSymbol) renderDetailAlerts(selectedSymbol, cache[selectedSymbol] || {});
    }
  }

  // Request notification permission on first alert
  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
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
      el.innerHTML = '<div class="error-msg">Failed to refresh news: ' + e.message + '</div>';
      showError(symbol + ' news refresh failed: ' + e.message);
    }
    btn.disabled = false; btn.textContent = 'Refresh';
  }

  // --- Data loading ---
  async function loadQuote(symbol) {
    if (!cache[symbol]) cache[symbol] = {};
    var q = await StockAPI.getQuote(symbol);
    cache[symbol].quote = q;
  }

  async function loadProfileAndFinancials(symbol, type) {
    if (!cache[symbol]) cache[symbol] = {};
    var results = await Promise.all([
      StockAPI.getProfile(symbol).catch(function(e) { console.warn('Profile error:', e.message); return null; }),
      StockAPI.getBasicFinancials(symbol).catch(function(e) { console.warn('Financials error:', e.message); return null; })
    ]);
    if (results[0]) cache[symbol].profile = results[0];
    if (results[1]) cache[symbol].financials = results[1];
  }

  async function loadNews(symbol) {
    if (!cache[symbol]) cache[symbol] = {};
    try {
      cache[symbol].articles = await StockAPI.getNews(symbol);
    } catch (e) {
      cache[symbol].articles = cache[symbol].articles || [];
      throw e;
    }
  }

  async function loadAnalystData(symbol) {
    if (!cache[symbol]) cache[symbol] = {};
    try {
      cache[symbol].recommendations = await StockAPI.getRecommendations(symbol) || [];
    } catch (e) {
      cache[symbol].recommendations = cache[symbol].recommendations || [];
    }
    // Note: /stock/upgrade-downgrade is premium-only, skip to save API calls
    if (!cache[symbol].upgrades) cache[symbol].upgrades = [];
  }

  // --- Shared macro news cache (same for all stocks, fetch once per cycle) ---
  var sharedMacroCache = { articles: null, fetchedAt: 0 };

  async function loadMacroNews(symbol) {
    if (!cache[symbol]) cache[symbol] = {};
    // Reuse shared macro cache if fresh (< 5 min)
    if (sharedMacroCache.articles && (Date.now() - sharedMacroCache.fetchedAt) < 300000) {
      cache[symbol].macroArticles = sharedMacroCache.articles;
      return;
    }
    try {
      var articles = await StockAPI.getMarketNews();
      sharedMacroCache.articles = articles;
      sharedMacroCache.fetchedAt = Date.now();
      cache[symbol].macroArticles = articles;
    } catch (e) {
      cache[symbol].macroArticles = cache[symbol].macroArticles || [];
      throw e;
    }
  }

  async function loadEarningsData(symbol) {
    if (!cache[symbol]) cache[symbol] = {};
    var results = await Promise.all([
      StockAPI.getEarnings(symbol).catch(function(e) { console.warn('Earnings error:', e.message); return cache[symbol].earnings || []; }),
      StockAPI.getEarningsCalendar(symbol).catch(function(e) { console.warn('Earnings calendar error:', e.message); return cache[symbol].earningsCalendar || null; })
    ]);
    cache[symbol].earnings = results[0];
    cache[symbol].earningsCalendar = results[1];
  }

  async function loadInsiderData(symbol) {
    if (!cache[symbol]) cache[symbol] = {};
    try {
      cache[symbol].insiderTrades = await StockAPI.getInsiderTransactions(symbol);
    } catch (e) {
      cache[symbol].insiderTrades = cache[symbol].insiderTrades || [];
      throw e;
    }
  }

  async function loadETFHoldings(symbol) {
    if (!cache[symbol]) cache[symbol] = {};
    try {
      cache[symbol].etfHoldings = await StockAPI.getETFHoldings(symbol);
    } catch (e) {
      cache[symbol].etfHoldings = cache[symbol].etfHoldings || null;
      throw e;
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
    var errors = [];

    try {
      await loadQuote(symbol);
    } catch (e) {
      errors.push('Quote: ' + e.message);
    }
    renderSidebar();
    if (selectedSymbol === symbol) renderDetail(symbol);

    // Profile & financials rarely change — skip if already cached
    if (!c.profile || !c.financials) {
      try {
        await loadProfileAndFinancials(symbol, type);
      } catch (e) {
        errors.push('Profile: ' + e.message);
      }
      if (selectedSymbol === symbol) renderDetail(symbol);
    }

    var dataLoaders = [];
    // Check Finnhub budget — if we're close to the limit, stagger calls
    var fhUsed = StockAPI.getFHCallsInLastMinute();
    if (fhUsed > 40) {
      // Near rate limit — wait proportionally longer as we approach 60
      await delay(Math.min((fhUsed - 40) * 1500, 20000));
    }
    dataLoaders.push(loadNews(symbol).catch(function(e) { errors.push('News: ' + e.message); }));
    dataLoaders.push(loadAnalystData(symbol).catch(function(e) { errors.push('Analyst: ' + e.message); }));
    dataLoaders.push(loadMacroNews(symbol).catch(function(e) { errors.push('Macro: ' + e.message); }));
    dataLoaders.push(loadEarningsData(symbol).catch(function(e) { errors.push('Earnings: ' + e.message); }));
    if (type === 'ETF') {
      dataLoaders.push(loadETFHoldings(symbol).catch(function(e) { errors.push('ETF: ' + e.message); }));
    } else {
      dataLoaders.push(loadInsiderData(symbol).catch(function(e) { errors.push('Insider: ' + e.message); }));
      // Fetch AV overview for About Company tile (1 AV call)
      if (AlphaAPI.hasKey() && (!cache[symbol] || !cache[symbol].avOverview)) {
        dataLoaders.push(
          AlphaAPI.getOverview(symbol).then(function(ov) {
            if (ov && ov.Symbol) { if (!cache[symbol]) cache[symbol] = {}; cache[symbol].avOverview = ov; }
          }).catch(function(e) { errors.push('AV Overview: ' + e.message); })
        );
      }
    }
    await Promise.all(dataLoaders);
    if (selectedSymbol === symbol) renderDetail(symbol);

    // Stamp data freshness timestamp
    if (!cache[symbol]) cache[symbol] = {};
    cache[symbol]._dataLoadedAt = Date.now();

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
    // Invalidate verdict on refresh — but preserve if morning report or verdict is in progress
    if (!morningReportRunning && !_verdictInProgress[symbol]) {
      delete nc.verdictResult;
    }

    if (selectedSymbol === symbol) renderDetail(symbol);

    // Check price alerts after data refresh
    checkPriceAlerts();

    // Report any errors that occurred during loading
    if (errors.length) {
      var rateErrors = errors.filter(function(e) { return e.indexOf('rate limit') !== -1 || e.indexOf('Rate limit') !== -1 || e.indexOf('429') !== -1; });
      var networkErrors = errors.filter(function(e) { return e.indexOf('Network') !== -1 || e.indexOf('timed out') !== -1; });
      if (rateErrors.length) {
        showWarning(symbol + ': Rate limited on ' + rateErrors.length + ' request(s). Data will refresh next cycle.');
      } else if (networkErrors.length) {
        showError(symbol + ': Network issues — ' + networkErrors.length + ' request(s) failed. Check your connection.');
      } else if (errors.length >= 3) {
        showError(symbol + ': Multiple data sources failed (' + errors.length + '). Some tiles may be incomplete.');
      }
    }
  }

  var activeAutoRunSymbol = null;
  var morningReportRunning = false;

  async function autoRunAI(symbol) {
    if (morningReportRunning) return; // Skip during morning report — it manages AI calls itself
    activeAutoRunSymbol = symbol;
    var c = cache[symbol];
    if (!c) return;
    var stockInfo = trackedStocks.find(function(t) { return t.symbol === symbol; }) || {};
    var isETF = stockInfo.type === 'ETF';
    // News AI
    if (selectedSymbol !== symbol || activeAutoRunSymbol !== symbol) return;
    if (c.articles && c.articles.length && !c.aiResult) {
      try {
        await runAIAnalysis(symbol);
      } catch (e) { console.warn('Auto AI news error:', e.message); }
    }
    // Analyst AI
    if (selectedSymbol !== symbol || activeAutoRunSymbol !== symbol) return;
    c = cache[symbol];
    if (c && ((c.recommendations && c.recommendations.length) || (c.upgrades && c.upgrades.length)) && !c.analystAIResult) {
      try {
        await runAnalystAnalysis(symbol);
      } catch (e) { console.warn('Auto AI analyst error:', e.message); }
    }
    // Macro AI
    if (selectedSymbol !== symbol || activeAutoRunSymbol !== symbol) return;
    c = cache[symbol];
    if (c && c.macroArticles && c.macroArticles.length && !c.macroAIResult) {
      try {
        await runMacroAnalysis(symbol);
      } catch (e) { console.warn('Auto AI macro error:', e.message); }
    }
    // Transcript / Earnings Call AI (stocks only)
    if (!isETF) {
    if (selectedSymbol !== symbol || activeAutoRunSymbol !== symbol) return;
    c = cache[symbol];
    if (c && !c.transcriptAIResult && NewsAI.hasKey()) {
      var hasEarnings = c.earnings && c.earnings.length;
      var hasArticles = c.articles && c.articles.length;
      if (hasEarnings || hasArticles) {
        try {
          await runTranscriptSummary(symbol);
        } catch (e) { console.warn('Auto AI transcript error:', e.message); }
      }
    }
    }
    // Technicals AI (loads RSI, MACD, SMA from AV then runs AI analysis)
    if (selectedSymbol !== symbol || activeAutoRunSymbol !== symbol) return;
    c = cache[symbol];
    if (c && AlphaAPI.hasKey() && !c.technicalsResult) {
      try {
        await loadTechnicalsData(symbol);
      } catch (e) { console.warn('Auto technicals error:', e.message); }
    }
    // Fundamentals & Sentiment AI
    if (selectedSymbol !== symbol || activeAutoRunSymbol !== symbol) return;
    c = cache[symbol];
    if (c && !c.fundamentalsResult) {
      try {
        await loadFundamentalsData(symbol);
      } catch (e) { console.warn('Auto fundamentals error:', e.message); }
    }

    // Revenue & Income (AV call, stocks only)
    if (!isETF) {
    if (selectedSymbol !== symbol || activeAutoRunSymbol !== symbol) return;
    c = cache[symbol];
    if (c && AlphaAPI.hasKey() && (!c.incomeData || !c.incomeData.length)) {
      try {
        await loadRevenueData(symbol);
      } catch (e) { console.warn('Auto revenue error:', e.message); }
    }
    }
    // Cash Flow (AV call, stocks only)
    if (!isETF) {
    if (selectedSymbol !== symbol || activeAutoRunSymbol !== symbol) return;
    c = cache[symbol];
    if (c && AlphaAPI.hasKey() && (!c.cashFlowData || !c.cashFlowData.length)) {
      try {
        await loadCashFlowData(symbol);
      } catch (e) { console.warn('Auto cash flow error:', e.message); }
    }
    }
    // Balance Sheet (AV call, stocks only)
    if (!isETF) {
    if (selectedSymbol !== symbol || activeAutoRunSymbol !== symbol) return;
    c = cache[symbol];
    if (c && AlphaAPI.hasKey() && (!c.balanceSheetData || !c.balanceSheetData.length)) {
      try {
        await loadBalanceSheetData(symbol);
      } catch (e) { console.warn('Auto balance sheet error:', e.message); }
    }
    }

    // Auto-load peer comparison (after AI tiles to avoid Finnhub rate limit contention)
    if (selectedSymbol !== symbol || activeAutoRunSymbol !== symbol) return;
    c = cache[symbol];
    if (c && StockAPI.hasKey() && (!c.peers || !c.peers.length)) {
      var s = trackedStocks.find(function(t) { return t.symbol === symbol; }) || {};
      if (s.type !== 'ETF') {
        try {
          await loadPeerData(symbol);
        } catch (e) { console.warn('Auto peers error:', e.message); }
      }
    }
  }

  function delay(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); }

  // --- Auto-refresh ---
  // Finnhub free tier: 60 calls/min — supports up to 40 stocks
  // Budget per cycle (60s):
  //   Fast (every 60s): quote only — 1 call/stock = 40 calls for 40 stocks (fits in 60/min)
  //   Medium (every 5 min): quote + news — 2 calls/stock = 80 calls → stagger over 2 min
  //   Full (every 15 min): batched — 4 stocks/cycle over 10 cycles = ~7 calls/stock × 4 = 28 calls/cycle
  var refreshInProgress = false;
  var refreshCycleCount = 0;
  var fullRefreshBatch = 0; // tracks which batch of stocks to full-refresh

  async function refreshAll() {
    if (!StockAPI.hasKey() || !trackedStocks.length || refreshInProgress) return;
    // Skip refresh when tab is hidden to save API calls
    if (document.hidden) return;
    refreshInProgress = true;
    refreshCycleCount++;
    var total = trackedStocks.length;
    var isFull = (refreshCycleCount % 15 === 0);
    var isMedium = !isFull && (refreshCycleCount % 5 === 0);
    var failedStocks = [];

    if (isFull) {
      // Full refresh — batch 4 stocks per cycle to stay under 60 calls/min
      // ~7 calls/stock × 4 = 28 calls, leaves headroom for ticker bar
      var batchSize = Math.min(4, total);
      var startIdx = (fullRefreshBatch * batchSize) % total;
      fullRefreshBatch++;
      var batch = [];
      for (var b = 0; b < Math.min(batchSize, total); b++) {
        batch.push(trackedStocks[(startIdx + b) % total]);
      }
      for (var i = 0; i < batch.length; i++) {
        try {
          await loadStockData(batch[i].symbol, batch[i].type);
        } catch (e) {
          failedStocks.push(batch[i].symbol);
        }
        if (i < batch.length - 1) await delay(1500);
      }
      // Fast-refresh the rest so sidebar prices stay current
      for (var j = 0; j < total; j++) {
        var sym = trackedStocks[j].symbol;
        if (batch.find(function(b) { return b.symbol === sym; })) continue;
        try {
          await loadQuote(sym).catch(function() {});
          renderSidebar();
          if (selectedSymbol === sym) {
            renderDetailHeader(sym, cache[sym] || {}, trackedStocks[j]);
            renderDetailKPIs(sym, cache[sym] || {}, trackedStocks[j]);
          }
        } catch(e) {}
        // Stagger quote calls — 500ms keeps us well under 60/min even with 40 stocks
        if (j < total - 1) await delay(500);
      }
    } else if (isMedium) {
      // Medium refresh — quote + news for all, macro once
      // 2 calls/stock × 40 = 80 calls → stagger at 1.5s/stock = ~60s total, safe under 60/min
      // Prefetch shared macro news (1 call)
      try { await loadMacroNews(trackedStocks[0].symbol); } catch(e) {}
      for (var i = 0; i < total; i++) {
        var s = trackedStocks[i];
        var sym = s.symbol;
        try {
          await loadQuote(sym).catch(function() {});
          await loadNews(sym).catch(function() {});
          if (!cache[sym]) cache[sym] = {};
          // Copy shared macro
          if (sharedMacroCache.articles) cache[sym].macroArticles = sharedMacroCache.articles;
          cache[sym]._dataLoadedAt = Date.now();
          renderSidebar();
          if (selectedSymbol === sym) renderDetail(sym);
        } catch (e) {
          failedStocks.push(sym);
        }
        if (i < total - 1) await delay(1500);
      }
      checkPriceAlerts();
    } else {
      // Fast refresh — quote only for all stocks
      for (var i = 0; i < total; i++) {
        var s = trackedStocks[i];
        var sym = s.symbol;
        try {
          await loadQuote(sym).catch(function() {});
          renderSidebar();
          if (selectedSymbol === sym) {
            renderDetailHeader(sym, cache[sym] || {}, s);
            renderDetailKPIs(sym, cache[sym] || {}, s);
          }
        } catch(e) {}
        // 1 call/stock × 40 = 40 calls; 800ms spacing = ~32s total, safe under 60/min
        if (i < total - 1) await delay(800);
      }
      checkPriceAlerts();
    }
    refreshInProgress = false;
    if (failedStocks.length) {
      showWarning('Refresh failed for: ' + failedStocks.join(', ') + '. Will retry next cycle.');
    }
  }

  function startAutoRefresh() {
    // Auto-refresh disabled — use Senior Analyst or Morning Report to refresh
    // Individual tile buttons still work for manual refresh
  }

  function stopAutoRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  }

  // --- Market Ticker Bar ---
  var TICKER_SYMBOLS = ['SPY','DIA','QQQ','IWM','TLT','GLD','USO','UUP'];
  var tickerTimer = null;

  async function refreshMarketTicker() {
    if (!StockAPI.hasKey()) return;
    // Skip if tab is hidden to save API calls
    if (document.hidden) return;
    // Skip if Finnhub is near rate limit (e.g. during initial load of 40 stocks)
    var fhUsed = StockAPI.getFHCallsInLastMinute();
    if (fhUsed > 45) return;
    // Parallel fetch all 8 ticker quotes
    var promises = TICKER_SYMBOLS.map(function(sym) {
      return StockAPI.getQuote(sym).then(function(q) {
        var priceEl = document.getElementById('tick-' + sym + '-price');
        var changeEl = document.getElementById('tick-' + sym + '-change');
        if (priceEl) priceEl.textContent = '$' + q.price.toFixed(2);
        if (changeEl) {
          var pct = q.changePct;
          var sign = pct >= 0 ? '+' : '';
          changeEl.textContent = sign + pct.toFixed(2) + '%';
          changeEl.className = 'ticker-change ' + (pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat');
        }
      }).catch(function() { /* skip failed ticker */ });
    });
    await Promise.all(promises);
  }

  function startTickerRefresh() {
    refreshMarketTicker();
    if (tickerTimer) clearInterval(tickerTimer);
    tickerTimer = setInterval(refreshMarketTicker, 90000);
  }

  // Ticker click to add/select stock
  (function() {
    var items = document.querySelectorAll('.ticker-item');
    for (var i = 0; i < items.length; i++) {
      items[i].addEventListener('click', function() {
        var sym = this.getAttribute('data-symbol');
        if (!sym || !StockAPI.hasKey()) return;
        var exists = trackedStocks.some(function(s) { return s.symbol === sym; });
        if (!exists) {
          addStock(sym, 'ETF');
        } else {
          selectStock(sym);
        }
      });
    }
  })();

  // --- Utility ---
  function fmtNum(num) {
    if (!num) return 'N/A';
    if (num >= 1e12) return '$' + (num / 1e12).toFixed(2) + 'T';
    if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
    return '$' + num.toLocaleString();
  }

  // --- Login screen ---
  function showLoginScreen() {
    var loginOverlay = document.getElementById('login-overlay');
    var appEl = document.getElementById('app');
    if (loginOverlay) loginOverlay.classList.remove('hidden');
    if (appEl) appEl.classList.add('hidden');

    // Render Google button if GSI is loaded
    var clientId = Auth.getClientId();
    var configSection = document.getElementById('login-config-section');
    if (!clientId) {
      // Show client ID input
      if (configSection) configSection.classList.remove('hidden');
      var saveClientBtn = document.getElementById('login-save-client-id');
      if (saveClientBtn) {
        saveClientBtn.onclick = function() {
          var inp = document.getElementById('login-client-id-input');
          if (inp && inp.value.trim()) {
            Auth.setClientId(inp.value.trim());
            location.reload();
          }
        };
      }
    } else {
      if (configSection) configSection.classList.add('hidden');
      // GSI script is async — wait for it to load before rendering button
      function tryInitGSI(attempts) {
        if (window.google && google.accounts && google.accounts.id) {
          Auth.initGSI();
          Auth.renderButton('google-signin-btn');
          Auth.prompt();
        } else if (attempts > 0) {
          setTimeout(function() { tryInitGSI(attempts - 1); }, 300);
        } else {
          var btnEl = document.getElementById('google-signin-btn');
          if (btnEl) btnEl.innerHTML = '<div style="font-size:0.75rem;color:#fca5a5;">Google Sign-In failed to load. Check your internet and refresh.</div>';
        }
      }
      tryInitGSI(30); // Try for ~9 seconds
    }
  }

  function hideLoginScreen() {
    var loginOverlay = document.getElementById('login-overlay');
    var appEl = document.getElementById('app');
    if (loginOverlay) loginOverlay.classList.add('hidden');
    if (appEl) appEl.classList.remove('hidden');
  }

  function updateUserUI() {
    var user = Auth.getUser();
    var userArea = document.getElementById('sidebar-user');
    if (!userArea) return;
    if (!user) {
      // Not logged in — show Google Sign-In button (if client ID configured)
      var btnContainer = document.getElementById('sidebar-google-btn');
      if (btnContainer) {
        var clientId = Auth.getClientId();
        if (clientId) {
          // Button rendered by _initSidebarGSI, just make sure container is visible
          btnContainer.style.display = '';
        } else {
          btnContainer.innerHTML = '<button class="sidebar-config-gsi-btn" id="sidebar-config-gsi-btn" title="Configure Google Sign-In">🔐 Set up Google Sign-In</button>';
          var cfgBtn = document.getElementById('sidebar-config-gsi-btn');
          if (cfgBtn) {
            cfgBtn.onclick = function() {
              var id = prompt('Enter your Google OAuth Client ID:');
              if (id && id.trim()) {
                Auth.setClientId(id.trim());
                location.reload();
              }
            };
          }
        }
      }
      return;
    }
    // Logged in — show user info + logout
    var btnContainer = document.getElementById('sidebar-google-btn');
    if (btnContainer) btnContainer.style.display = 'none';
    var pic = user.picture ? '<img src="' + user.picture + '" style="width:24px;height:24px;border-radius:50%;object-fit:cover;" referrerpolicy="no-referrer" alt="" />' : '<span style="font-size:1rem;">👤</span>';
    var nameStr = user.name || user.email || 'User';
    if (nameStr.length > 18) nameStr = nameStr.slice(0, 16) + '\u2026';
    userArea.innerHTML = '<div id="sidebar-google-btn" class="sidebar-google-btn" style="display:none;"></div><div class="user-info">' + pic + '<span class="user-name">' + nameStr + '</span></div><button class="user-logout-btn" id="logout-btn" title="Sign out">\u21AA</button>';
    var logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.onclick = function() {
        stopAutoRefresh();
        cache = {};
        trackedStocks = [];
        priceAlerts = [];
        selectedSymbol = null;
        stockListEl.innerHTML = '';
        showEmpty();
        Auth.logout();
        // Reload to go back to anonymous mode
        location.reload();
      };
    }
  }

  // --- Portfolio Brief renderer ---
  function showPortfolioBrief(brief, results, emailHTML) {
    if (!portfolioBriefModal || !portfolioBriefContent) return;

    // Fallback if AI returned a string instead of object
    if (typeof brief === 'string') {
      try { brief = JSON.parse(brief); } catch (e) {
        portfolioBriefContent.innerHTML = '<p style="color:#f87171;">Could not parse portfolio brief.</p><pre style="white-space:pre-wrap;color:#94a3b8;font-size:12px;">' + brief + '</pre>';
        portfolioBriefModal.classList.remove('hidden');
        return;
      }
    }

    var verdictColors = {
      'BULLISH': '#22c55e', 'BEARISH': '#ef4444', 'CAUTIOUS': '#f59e0b', 'NEUTRAL': '#60a5fa'
    };
    var riskColors = {
      'LOW': '#22c55e', 'MODERATE': '#f59e0b', 'ELEVATED': '#f97316', 'HIGH': '#ef4444'
    };
    var actionColors = {
      'BUY': '#22c55e', 'STRONG BUY': '#22c55e', 'ADD': '#4ade80',
      'SELL': '#ef4444', 'STRONG SELL': '#ef4444', 'TRIM': '#f97316', 'HOLD': '#f59e0b'
    };
    var urgencyBadge = {
      'NOW': 'background:#ef4444;color:#fff',
      'THIS WEEK': 'background:#f59e0b;color:#000',
      'MONITOR': 'background:#334155;color:#94a3b8'
    };

    var vc = verdictColors[brief.portfolioVerdict] || '#888';
    var rc = riskColors[brief.riskLevel] || '#888';
    var today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    var h = '';
    // Header
    h += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">';
    h += '<span style="font-size:20px;font-weight:700;color:' + vc + ';">' + (brief.portfolioVerdict || 'N/A') + '</span>';
    h += '<span style="padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;background:' + rc + '22;color:' + rc + ';border:1px solid ' + rc + '44;">Risk: ' + (brief.riskLevel || 'N/A') + '</span>';
    h += '<span style="margin-left:auto;font-size:12px;color:#64748b;">' + today + ' | ' + results.length + ' stocks</span>';
    h += '</div>';

    // Summary
    if (brief.summary) {
      h += '<p style="color:#cbd5e1;font-size:14px;line-height:1.5;margin:0 0 16px;padding:10px 12px;background:#1e293b;border-radius:6px;border-left:3px solid ' + vc + ';">' + brief.summary + '</p>';
    }

    // Top Pick & Top Risk
    h += '<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">';
    if (brief.topPick && brief.topPick.symbol) {
      h += '<div style="flex:1;min-width:200px;padding:10px 12px;background:#052e16;border:1px solid #166534;border-radius:6px;">';
      h += '<div style="font-size:11px;color:#4ade80;font-weight:600;margin-bottom:4px;">TOP PICK</div>';
      h += '<div style="font-size:16px;font-weight:700;color:#22c55e;">' + brief.topPick.symbol + '</div>';
      h += '<div style="font-size:12px;color:#86efac;margin-top:2px;">' + (brief.topPick.reason || '') + '</div>';
      h += '</div>';
    }
    if (brief.topRisk && brief.topRisk.symbol) {
      h += '<div style="flex:1;min-width:200px;padding:10px 12px;background:#2a0a0a;border:1px solid #7f1d1d;border-radius:6px;">';
      h += '<div style="font-size:11px;color:#f87171;font-weight:600;margin-bottom:4px;">TOP RISK</div>';
      h += '<div style="font-size:16px;font-weight:700;color:#ef4444;">' + brief.topRisk.symbol + '</div>';
      h += '<div style="font-size:12px;color:#fca5a5;margin-top:2px;">' + (brief.topRisk.reason || '') + '</div>';
      h += '</div>';
    }
    h += '</div>';

    // Actions table
    if (brief.actions && brief.actions.length) {
      h += '<div style="overflow-x:auto;margin-bottom:16px;">';
      h += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
      h += '<thead><tr style="background:#1e293b;">';
      h += '<th style="padding:8px 10px;text-align:left;color:#94a3b8;border-bottom:1px solid #334155;">Stock</th>';
      h += '<th style="padding:8px 10px;text-align:center;color:#94a3b8;border-bottom:1px solid #334155;">Action</th>';
      h += '<th style="padding:8px 10px;text-align:center;color:#94a3b8;border-bottom:1px solid #334155;">Urgency</th>';
      h += '<th style="padding:8px 10px;text-align:left;color:#94a3b8;border-bottom:1px solid #334155;">Reason</th>';
      h += '</tr></thead><tbody>';

      brief.actions.forEach(function(a, idx) {
        var bg = idx % 2 === 0 ? '#0f172a' : '#1e293b';
        var ac = actionColors[a.action] || '#888';
        var ub = urgencyBadge[a.urgency] || urgencyBadge['MONITOR'];
        h += '<tr style="background:' + bg + ';">';
        h += '<td style="padding:8px 10px;color:#e2e8f0;font-weight:600;border-bottom:1px solid #1e293b;">' + (a.symbol || '') + '</td>';
        h += '<td style="padding:8px 10px;text-align:center;border-bottom:1px solid #1e293b;"><span style="color:' + ac + ';font-weight:700;">' + (a.action || '') + '</span></td>';
        h += '<td style="padding:8px 10px;text-align:center;border-bottom:1px solid #1e293b;"><span style="padding:2px 8px;border-radius:3px;font-size:11px;font-weight:600;' + ub + '">' + (a.urgency || '') + '</span></td>';
        h += '<td style="padding:8px 10px;color:#94a3b8;border-bottom:1px solid #1e293b;font-size:12px;">' + (a.reason || '') + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table></div>';
    }

    // Sector Exposure
    if (brief.sectorExposure) {
      h += '<div style="padding:8px 12px;background:#1e293b;border-radius:6px;margin-bottom:10px;font-size:13px;">';
      h += '<span style="color:#60a5fa;font-weight:600;">Sector Exposure:</span> <span style="color:#cbd5e1;">' + brief.sectorExposure + '</span></div>';
    }

    // Portfolio Risks
    if (brief.portfolioRisks && brief.portfolioRisks.length) {
      h += '<div style="padding:8px 12px;background:#1a0a0a;border:1px solid #7f1d1d33;border-radius:6px;margin-bottom:10px;">';
      h += '<div style="color:#f87171;font-weight:600;font-size:12px;margin-bottom:4px;">Portfolio Risks</div>';
      brief.portfolioRisks.forEach(function(r) {
        h += '<div style="color:#fca5a5;font-size:13px;padding:2px 0;">- ' + r + '</div>';
      });
      h += '</div>';
    }

    // Week Ahead
    if (brief.weekAhead) {
      h += '<div style="padding:8px 12px;background:#172554;border:1px solid #1e40af33;border-radius:6px;margin-bottom:6px;">';
      h += '<div style="color:#60a5fa;font-weight:600;font-size:12px;margin-bottom:4px;">Week Ahead</div>';
      h += '<div style="color:#93c5fd;font-size:13px;line-height:1.5;">' + brief.weekAhead + '</div>';
      h += '</div>';
    }

    // Footer + action buttons
    h += '<div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:16px;flex-wrap:wrap;">';
    h += '<button id="portfolio-brief-email-btn" style="padding:8px 20px;background:#6366f1;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">✉ Send Email Report</button>';
    h += '<button id="portfolio-brief-download-btn" style="padding:8px 20px;background:#334155;color:#e2e8f0;border:1px solid #475569;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">📄 Download PDF</button>';
    h += '</div>';
    h += '<div style="text-align:center;margin-top:10px;font-size:11px;color:#475569;">Victoria Park — Senior Portfolio Strategist | Generated ' + new Date().toLocaleTimeString() + '</div>';

    portfolioBriefContent.innerHTML = h;
    portfolioBriefModal.classList.remove('hidden');

    // Wire email button — send the portfolio brief as the email (not the raw verdicts)
    var emailBtn = document.getElementById('portfolio-brief-email-btn');
    if (emailBtn) {
      emailBtn.addEventListener('click', function() {
        // Build email HTML from the portfolio brief content
        var today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        var eh = '';
        eh += '<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;background:#0f1117;color:#e2e8f0;padding:20px;">';
        eh += '<h2 style="color:#6366f1;margin:0 0 4px;">Portfolio Morning Brief</h2>';
        eh += '<p style="color:#888;font-size:13px;margin:0 0 16px;">' + today + ' | ' + results.length + ' stocks analyzed | Victoria Park, Senior Portfolio Strategist</p>';

        // Verdict + Risk
        eh += '<div style="margin-bottom:14px;">';
        eh += '<span style="font-size:18px;font-weight:700;color:' + vc + ';">' + (brief.portfolioVerdict || 'N/A') + '</span>';
        eh += ' &nbsp; <span style="padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;background:' + rc + '22;color:' + rc + ';border:1px solid ' + rc + '44;">Risk: ' + (brief.riskLevel || 'N/A') + '</span>';
        eh += '</div>';

        // Summary
        if (brief.summary) {
          eh += '<p style="color:#cbd5e1;font-size:14px;line-height:1.5;margin:0 0 16px;padding:10px 12px;background:#1e293b;border-radius:6px;border-left:3px solid ' + vc + ';">' + brief.summary + '</p>';
        }

        // Top Pick & Top Risk
        if ((brief.topPick && brief.topPick.symbol) || (brief.topRisk && brief.topRisk.symbol)) {
          eh += '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;"><tr>';
          if (brief.topPick && brief.topPick.symbol) {
            eh += '<td style="padding:10px 12px;background:#052e16;border:1px solid #166534;border-radius:6px;vertical-align:top;width:50%;">';
            eh += '<div style="font-size:11px;color:#4ade80;font-weight:600;">TOP PICK</div>';
            eh += '<div style="font-size:16px;font-weight:700;color:#22c55e;">' + brief.topPick.symbol + '</div>';
            eh += '<div style="font-size:12px;color:#86efac;">' + (brief.topPick.reason || '') + '</div></td>';
          }
          if (brief.topRisk && brief.topRisk.symbol) {
            eh += '<td style="padding:10px 12px;background:#2a0a0a;border:1px solid #7f1d1d;border-radius:6px;vertical-align:top;width:50%;">';
            eh += '<div style="font-size:11px;color:#f87171;font-weight:600;">TOP RISK</div>';
            eh += '<div style="font-size:16px;font-weight:700;color:#ef4444;">' + brief.topRisk.symbol + '</div>';
            eh += '<div style="font-size:12px;color:#fca5a5;">' + (brief.topRisk.reason || '') + '</div></td>';
          }
          eh += '</tr></table>';
        }

        // Actions table
        if (brief.actions && brief.actions.length) {
          eh += '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">';
          eh += '<thead><tr style="background:#1e293b;">';
          eh += '<th style="padding:8px 10px;text-align:left;color:#94a3b8;border:1px solid #333;">Stock</th>';
          eh += '<th style="padding:8px 10px;text-align:center;color:#94a3b8;border:1px solid #333;">Action</th>';
          eh += '<th style="padding:8px 10px;text-align:center;color:#94a3b8;border:1px solid #333;">Urgency</th>';
          eh += '<th style="padding:8px 10px;text-align:left;color:#94a3b8;border:1px solid #333;">Reason</th>';
          eh += '</tr></thead><tbody>';
          brief.actions.forEach(function(a, idx) {
            var bg = idx % 2 === 0 ? '#0f1117' : '#1e293b';
            var ac = actionColors[a.action] || '#888';
            eh += '<tr style="background:' + bg + ';color:#e2e8f0;">';
            eh += '<td style="padding:8px 10px;border:1px solid #333;font-weight:600;">' + (a.symbol || '') + '</td>';
            eh += '<td style="padding:8px 10px;border:1px solid #333;text-align:center;color:' + ac + ';font-weight:700;">' + (a.action || '') + '</td>';
            eh += '<td style="padding:8px 10px;border:1px solid #333;text-align:center;">' + (a.urgency || '') + '</td>';
            eh += '<td style="padding:8px 10px;border:1px solid #333;font-size:12px;">' + (a.reason || '') + '</td>';
            eh += '</tr>';
          });
          eh += '</tbody></table>';
        }

        // Sector Exposure
        if (brief.sectorExposure) {
          eh += '<div style="padding:8px 12px;background:#1e293b;border-radius:6px;margin-bottom:10px;font-size:13px;">';
          eh += '<span style="color:#60a5fa;font-weight:600;">Sector Exposure:</span> <span style="color:#cbd5e1;">' + brief.sectorExposure + '</span></div>';
        }

        // Portfolio Risks
        if (brief.portfolioRisks && brief.portfolioRisks.length) {
          eh += '<div style="padding:8px 12px;background:#1a0a0a;border:1px solid #7f1d1d33;border-radius:6px;margin-bottom:10px;">';
          eh += '<div style="color:#f87171;font-weight:600;font-size:12px;margin-bottom:4px;">Portfolio Risks</div>';
          brief.portfolioRisks.forEach(function(r) {
            eh += '<div style="color:#fca5a5;font-size:13px;padding:2px 0;">- ' + r + '</div>';
          });
          eh += '</div>';
        }

        // Week Ahead
        if (brief.weekAhead) {
          eh += '<div style="padding:8px 12px;background:#172554;border:1px solid #1e40af33;border-radius:6px;margin-bottom:10px;">';
          eh += '<div style="color:#60a5fa;font-weight:600;font-size:12px;margin-bottom:4px;">Week Ahead</div>';
          eh += '<div style="color:#93c5fd;font-size:13px;line-height:1.5;">' + brief.weekAhead + '</div>';
          eh += '</div>';
        }

        eh += '<p style="color:#64748b;font-size:11px;margin-top:16px;">Victoria Park, Senior Portfolio Strategist | Generated by Stock Tracker AI | Not financial advice</p>';
        eh += '</div>';

        // Build plain text for mailto
        var plainBody = 'PORTFOLIO MORNING BRIEF\n' + today + '\n';
        plainBody += '=======================================\n\n';
        plainBody += 'VERDICT: ' + (brief.portfolioVerdict || 'N/A') + ' | Risk: ' + (brief.riskLevel || 'N/A') + '\n\n';
        if (brief.summary) plainBody += brief.summary + '\n\n';
        if (brief.topPick && brief.topPick.symbol) plainBody += 'TOP PICK: ' + brief.topPick.symbol + ' — ' + (brief.topPick.reason || '') + '\n';
        if (brief.topRisk && brief.topRisk.symbol) plainBody += 'TOP RISK: ' + brief.topRisk.symbol + ' — ' + (brief.topRisk.reason || '') + '\n';
        if (brief.actions && brief.actions.length) {
          plainBody += '\nACTIONS:\n';
          brief.actions.forEach(function(a) {
            plainBody += '  ' + (a.symbol || '') + ': ' + (a.action || '') + ' (' + (a.urgency || '') + ') — ' + (a.reason || '') + '\n';
          });
        }
        if (brief.sectorExposure) plainBody += '\nSECTOR EXPOSURE: ' + brief.sectorExposure + '\n';
        if (brief.portfolioRisks && brief.portfolioRisks.length) {
          plainBody += '\nPORTFOLIO RISKS:\n';
          brief.portfolioRisks.forEach(function(r) { plainBody += '  - ' + r + '\n'; });
        }
        if (brief.weekAhead) plainBody += '\nWEEK AHEAD: ' + brief.weekAhead + '\n';
        plainBody += '\n---------------------------------------\n';
        plainBody += 'Victoria Park, Senior Portfolio Strategist | Not financial advice\n';

        openMorningReportEmail(eh, plainBody);
      });
    }

    // Wire PDF download button
    var dlBtn = document.getElementById('portfolio-brief-download-btn');
    if (dlBtn) {
      dlBtn.addEventListener('click', async function() {
        dlBtn.disabled = true;
        dlBtn.textContent = 'Generating…';
        try {
          var jsPDF = window.jspdf.jsPDF;
          var pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
          var pageW = pdf.internal.pageSize.getWidth();
          var pageH = pdf.internal.pageSize.getHeight();
          var m = 8;
          var canvas = await html2canvas(portfolioBriefContent, {
            backgroundColor: '#0f1117',
            scale: 2,
            useCORS: true,
            logging: false
          });
          var imgData = canvas.toDataURL('image/jpeg', 0.92);
          var usableW = pageW - m * 2;
          var imgH = (canvas.height / canvas.width) * usableW;
          var cursorY = m;
          // Split across pages if needed
          var pageImgH = pageH - m * 2;
          if (imgH <= pageImgH) {
            pdf.addImage(imgData, 'JPEG', m, cursorY, usableW, imgH);
          } else {
            // Tile the single canvas image across pages
            var srcPageH = Math.floor(canvas.height * (pageImgH / imgH));
            var yOff = 0;
            while (yOff < canvas.height) {
              var sliceH = Math.min(srcPageH, canvas.height - yOff);
              var sliceCanvas = document.createElement('canvas');
              sliceCanvas.width = canvas.width;
              sliceCanvas.height = sliceH;
              sliceCanvas.getContext('2d').drawImage(canvas, 0, yOff, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
              var sliceImg = sliceCanvas.toDataURL('image/jpeg', 0.92);
              var drawH = (sliceH / canvas.width) * usableW;
              if (yOff > 0) pdf.addPage();
              pdf.addImage(sliceImg, 'JPEG', m, m, usableW, drawH);
              yOff += sliceH;
            }
          }
          pdf.setFontSize(8);
          pdf.setTextColor(100);
          pdf.text('Portfolio Morning Brief — ' + new Date().toLocaleString(), m, pageH - 4);
          pdf.save('Portfolio_Brief_' + new Date().toISOString().slice(0, 10) + '.pdf');
        } catch (err) {
          console.error('PDF failed:', err);
          showError('PDF generation failed: ' + err.message);
        } finally {
          dlBtn.disabled = false;
          dlBtn.textContent = '📄 Download PDF';
        }
      });
    }
  }

  // --- Morning Report: batch Senior Analyst + email ---
  var morningReportBtn = document.getElementById('morning-report-btn');
  var morningReportProgress = document.getElementById('morning-report-progress');

  if (morningReportBtn) {
    morningReportBtn.addEventListener('click', runMorningReport);
  }

  async function runMorningReport() {
    if (!StockAPI.hasKey() || !NewsAI.hasKey()) {
      showError('Morning Report requires both Finnhub and Groq API keys.');
      return;
    }
    if (!trackedStocks.length) {
      showWarning('No stocks tracked. Add stocks first.');
      return;
    }

    morningReportBtn.disabled = true;
    morningReportBtn.textContent = 'Generating\u2026';
    morningReportProgress.classList.remove('hidden');
    stopAutoRefresh(); // Pause auto-refresh so it doesn't wipe verdicts mid-run
    morningReportRunning = true; // Suppress autoRunAI triggered by loadStockData
    var total = trackedStocks.length;
    var results = [];
    var failed = [];

    try {

    for (var i = 0; i < total; i++) {
      var s = trackedStocks[i];
      var sym = s.symbol;
      var step = (i + 1) + '/' + total;
      var pct = Math.round((i / total) * 100);

      morningReportProgress.innerHTML = '<div>\uD83C\uDFAF ' + step + ' — ' + sym + ': Running Senior Analyst\u2026</div><div class="mrp-bar" style="width:' + pct + '%"></div>';

      // Ensure basic data is loaded
      if (!cache[sym] || !cache[sym].quote) {
        try {
          await loadStockData(sym, s.type || 'Equity');
        } catch (e) {
          console.warn('Morning report data error for ' + sym + ':', e.message);
        }
      }

      var c = cache[sym];
      if (!c || !c.quote) {
        failed.push(sym + ' (no data)');
        continue;
      }

      // Run the full Senior Analyst pipeline (data refresh + AI tiles + verdict)
      try {
        var verdict = await runVerdict(sym);
        if (verdict) {
          if (c.quote) {
            verdict.currentPrice = c.quote.price;
            if (verdict.priceTarget) {
              verdict.upside = ((verdict.priceTarget - c.quote.price) / c.quote.price * 100).toFixed(1);
            }
          }
          verdict._symbol = sym;
          verdict._name = (c.profile && c.profile.name) ? c.profile.name : sym;
          verdict._price = c.quote ? c.quote.price : null;
          verdict._change = c.quote ? c.quote.changePct : null;
          results.push(verdict);
          // Update the detail view if this stock is currently selected
          if (selectedSymbol === sym) renderDetail(sym);
        } else {
          failed.push(sym + ' (no verdict returned)');
        }
      } catch (e) {
        failed.push(sym + ' (' + e.message + ')');
        console.warn('Morning report verdict failed for ' + sym + ':', e.message);
        morningReportProgress.innerHTML = '<div>\u26A0\uFE0F ' + step + ' — ' + sym + ': Failed — ' + e.message + '</div><div class="mrp-bar" style="width:' + pct + '%"></div>';
        await delay(2000);
      }

      // Pace between stocks — let Finnhub rate limit window slide
      if (i < total - 1) {
        var fhUsed = StockAPI.getFHCallsInLastMinute();
        var cooldown = fhUsed > 45 ? 8000 : (fhUsed > 30 ? 4000 : 2000);
        await delay(cooldown);
      }
    }

    // Build email
    morningReportProgress.innerHTML = '<div>\u2709\uFE0F Building email report\u2026</div><div class="mrp-bar" style="width:90%"></div>';

    var emailHTML = buildMorningReportEmail(results, failed);

    // Generate AI Portfolio Brief
    if (results.length > 0) {
      morningReportProgress.innerHTML = '<div>\uD83E\uDDE0 Victoria Park is preparing your portfolio brief\u2026</div><div class="mrp-bar" style="width:93%"></div>';
      try {
        var brief = await NewsAI.generatePortfolioBrief(results);
        showPortfolioBrief(brief, results, emailHTML);
      } catch (e) {
        console.warn('Portfolio brief failed:', e.message);
        // Brief failed — fall back to sending email directly
        openMorningReportEmail(emailHTML, buildFallbackPlainText(results));
      }
    } else {
      openMorningReportEmail(emailHTML, buildFallbackPlainText(results));
    }

    // Open mailto or copy to clipboard
    morningReportProgress.innerHTML = '<div>\u2705 Report ready for ' + results.length + ' stocks' + (failed.length ? ' (' + failed.length + ' failed)' : '') + '</div><div class="mrp-bar" style="width:100%"></div>';

    } catch (e) {
      showError('Morning Report error: ' + e.message);
    } finally {
      morningReportRunning = false;
      morningReportBtn.disabled = false;
      morningReportBtn.textContent = '\uD83D\uDCE7 Morning Report';
      startAutoRefresh(); // Resume auto-refresh after morning report completes
    }

    // Auto-hide progress after 10s
    setTimeout(function() {
      morningReportProgress.classList.add('hidden');
    }, 10000);
  }

  function buildMorningReportEmail(results, failed) {
    var today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    var h = '';
    h += '<h2 style="color:#6366f1;margin:0 0 4px;">Stock Tracker — Morning Report</h2>';
    h += '<p style="color:#888;font-size:13px;margin:0 0 16px;">' + today + ' | ' + results.length + ' stocks analyzed</p>';

    // Summary table
    h += '<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;">';
    h += '<thead><tr style="background:#1a1d27;color:#e2e8f0;">';
    h += '<th style="padding:8px 10px;text-align:left;border:1px solid #333;">Stock</th>';
    h += '<th style="padding:8px 10px;text-align:right;border:1px solid #333;">Price</th>';
    h += '<th style="padding:8px 10px;text-align:right;border:1px solid #333;">Change</th>';
    h += '<th style="padding:8px 10px;text-align:center;border:1px solid #333;">Verdict</th>';
    h += '<th style="padding:8px 10px;text-align:center;border:1px solid #333;">Confidence</th>';
    h += '<th style="padding:8px 10px;text-align:right;border:1px solid #333;">Target</th>';
    h += '<th style="padding:8px 10px;text-align:right;border:1px solid #333;">Upside</th>';
    h += '<th style="padding:8px 10px;text-align:left;border:1px solid #333;">Summary</th>';
    h += '</tr></thead><tbody>';

    var verdictColors = {
      'STRONG BUY': '#22c55e', 'BUY': '#4ade80', 'HOLD': '#f59e0b',
      'SELL': '#f87171', 'STRONG SELL': '#ef4444'
    };

    results.forEach(function(v, idx) {
      var bg = idx % 2 === 0 ? '#0f1117' : '#161922';
      var vColor = verdictColors[v.verdict] || '#888';
      var changeVal = v._change || 0;
      var changeColor = changeVal >= 0 ? '#4ade80' : '#f87171';
      var changeSign = changeVal >= 0 ? '+' : '';
      var upsideVal = parseFloat(v.upside || 0);
      var upsideColor = upsideVal >= 0 ? '#4ade80' : '#f87171';
      var upsideSign = upsideVal >= 0 ? '+' : '';

      h += '<tr style="background:' + bg + ';color:#e2e8f0;">';
      h += '<td style="padding:8px 10px;border:1px solid #333;font-weight:600;">' + v._symbol + '<br><span style="font-weight:400;font-size:11px;color:#888;">' + v._name + '</span></td>';
      h += '<td style="padding:8px 10px;border:1px solid #333;text-align:right;">$' + (v._price ? v._price.toFixed(2) : 'N/A') + '</td>';
      h += '<td style="padding:8px 10px;border:1px solid #333;text-align:right;color:' + changeColor + ';">' + changeSign + changeVal.toFixed(2) + '%</td>';
      h += '<td style="padding:8px 10px;border:1px solid #333;text-align:center;color:' + vColor + ';font-weight:700;">' + (v.verdict || 'N/A') + '</td>';
      h += '<td style="padding:8px 10px;border:1px solid #333;text-align:center;">' + (v.confidence || 'N/A') + '</td>';
      h += '<td style="padding:8px 10px;border:1px solid #333;text-align:right;">$' + (v.priceTarget ? v.priceTarget.toFixed(2) : 'N/A') + '</td>';
      h += '<td style="padding:8px 10px;border:1px solid #333;text-align:right;color:' + upsideColor + ';">' + upsideSign + (v.upside || '0') + '%</td>';
      h += '<td style="padding:8px 10px;border:1px solid #333;font-size:12px;max-width:300px;">' + (v.summary || '').substring(0, 200) + '</td>';
      h += '</tr>';
    });
    h += '</tbody></table>';

    // Detail section per stock
    h += '<br><h3 style="color:#6366f1;">Detailed Analysis</h3>';
    results.forEach(function(v) {
      var vColor = verdictColors[v.verdict] || '#888';
      h += '<div style="margin-bottom:16px;padding:12px;background:#161922;border-radius:8px;border-left:4px solid ' + vColor + ';">';
      h += '<h4 style="margin:0 0 6px;color:#e2e8f0;">' + v._symbol + ' — <span style="color:' + vColor + ';">' + (v.verdict || 'N/A') + '</span></h4>';
      h += '<p style="margin:0 0 6px;font-size:13px;color:#cbd5e1;">' + (v.summary || '') + '</p>';
      if (v.verdictReason) h += '<p style="margin:0 0 6px;font-size:12px;color:#94a3b8;"><strong>Rationale:</strong> ' + v.verdictReason + '</p>';
      if (v.thinkingProcess) h += '<p style="margin:0 0 6px;font-size:12px;color:#94a3b8;"><strong>Analysis:</strong> ' + v.thinkingProcess + '</p>';
      if (v.intrinsicValue != null) h += '<p style="margin:0 0 6px;font-size:12px;color:#94a3b8;"><strong>DCF Intrinsic Value:</strong> $' + parseFloat(v.intrinsicValue).toFixed(2) + (v.dcfAssumptions ? ' — ' + v.dcfAssumptions : '') + '</p>';
      if (v.bull && v.bull.length) h += '<p style="margin:0 0 4px;font-size:12px;color:#4ade80;"><strong>Bull:</strong> ' + v.bull.join(' | ') + '</p>';
      if (v.bear && v.bear.length) h += '<p style="margin:0 0 4px;font-size:12px;color:#f87171;"><strong>Bear:</strong> ' + v.bear.join(' | ') + '</p>';
      if (v.catalysts && v.catalysts.length) h += '<p style="margin:0 0 4px;font-size:12px;color:#60a5fa;"><strong>Catalysts:</strong> ' + v.catalysts.map(function(c) { return c.event + ' (' + c.timeline + ', ' + c.impact + ')'; }).join(' | ') + '</p>';
      if (v.dataQuality) h += '<p style="margin:0;font-size:11px;color:#64748b;">' + v.dataQuality + '</p>';
      h += '</div>';
    });

    if (failed.length) {
      h += '<p style="color:#f87171;font-size:12px;">Failed: ' + failed.join(', ') + '</p>';
    }
    h += '<p style="color:#64748b;font-size:11px;margin-top:16px;">Generated by Stock Tracker AI | Not financial advice</p>';
    return h;
  }

  function buildFallbackPlainText(results) {
    var today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    var body = 'STOCK TRACKER MORNING REPORT\n' + today + '\n';
    body += '=======================================\n\n';
    results.forEach(function(v) {
      body += v._symbol + ' (' + v._name + '): ' + (v.verdict || 'N/A') + ' | Target: ' + (v.priceTarget ? v.priceTarget.toFixed(2) : 'N/A') + ' | Upside: ' + (v.upside || '0') + '%\n';
      if (v.summary) body += '  ' + v.summary + '\n';
      body += '\n';
    });
    body += '---------------------------------------\nGenerated by Stock Tracker AI | Not financial advice\n';
    return body;
  }

  function openMorningReportEmail(html, plainTextBody) {
    var today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    var subject = 'Portfolio Morning Brief \u2014 ' + today;
    var body = plainTextBody || '';

    // Copy rich HTML to clipboard for pasting into email
    var clipboardOk = false;
    function tryCopyToClipboard() {
      try {
        var blob = new Blob([html], { type: 'text/html' });
        var plainBlob = new Blob([body], { type: 'text/plain' });
        return navigator.clipboard.write([
          new ClipboardItem({
            'text/html': blob,
            'text/plain': plainBlob
          })
        ]).then(function() {
          clipboardOk = true;
        }).catch(function() {
          return navigator.clipboard.writeText(body).then(function() {
            clipboardOk = true;
          });
        });
      } catch(e) {
        try {
          return navigator.clipboard.writeText(body).then(function() {
            clipboardOk = true;
          });
        } catch(e2) {
          return Promise.resolve();
        }
      }
    }

    tryCopyToClipboard().catch(function() {}).finally(function() {
      var email = localStorage.getItem('report_email') || '';
      var mailtoBody = body;
      var encodedBody = encodeURIComponent(mailtoBody);
      var encodedSubject = encodeURIComponent(subject);
      var baseUrl = 'mailto:' + encodeURIComponent(email) + '?subject=' + encodedSubject + '&body=';
      var totalLen = baseUrl.length + encodedBody.length;

      if (totalLen > 15000) {
        var maxRawChars = Math.floor(15000 / 3);
        mailtoBody = body.substring(0, maxRawChars) + '\n\n--- Report trimmed for email. Full report on clipboard \u2014 paste into email body. ---';
        encodedBody = encodeURIComponent(mailtoBody);
      }

      var mailto = baseUrl + encodedBody;

      try {
        window.location.href = mailto;
      } catch(e) {}

      if (clipboardOk) {
        showWarning('Portfolio brief copied to clipboard (rich HTML). Paste into your email body for the full formatted report.', 10000);
      } else {
        showWarning('Email client should open. If not, check your popup blocker settings.', 8000);
      }
    });
  }

  /** Called on init and after Google login — loads user data and starts the app */
  function startApp() {
    var appEl = document.getElementById('app');
    if (appEl) appEl.classList.remove('hidden');
    loadTrackedStocks();
    loadPriceAlerts();
    updateUserUI();

    if (!StockAPI.hasKey()) {
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
      keyInput.value = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
    }
    if (NewsAI.hasKey()) {
      groqKeyInput.value = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
    }
    if (NewsAI.hasKey2() && groqKey2Input) {
      groqKey2Input.value = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
    }
    if (AlphaAPI.hasKey()) {
      avKeyInput.value = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
    }
    if (AlphaAPI.hasKey2() && avKey2Input) {
      avKey2Input.value = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
    }
    requestNotificationPermission();
    renderSidebar();
    startTickerRefresh();
    if (trackedStocks.length) {
      selectStock(trackedStocks[0].symbol);
      // Smart init load for up to 40 stocks:
      // Phase 1: Full load for selected stock (immediate detail view)
      // Phase 2: Quick load (quote + profile/financials) for all others (sidebar prices)
      // Phase 3: Backfill heavy data (news, earnings, etc.) in batches of 4
      (async function() {
        // Phase 1: Full load for selected stock
        try {
          await loadStockData(trackedStocks[0].symbol, trackedStocks[0].type);
        } catch(e) {
          console.warn('Init load error for ' + trackedStocks[0].symbol + ':', e.message);
        }

        // Phase 2: Quick load for remaining stocks — just quote + profile/financials
        // 3 calls/stock, staggered to stay under 60/min
        for (var i = 1; i < trackedStocks.length; i++) {
          var s = trackedStocks[i];
          try {
            await loadQuote(s.symbol).catch(function() {});
            await loadProfileAndFinancials(s.symbol, s.type).catch(function() {});
            renderSidebar();
          } catch(e) {
            console.warn('Quick load error for ' + s.symbol + ':', e.message);
          }
          // Check rate limit budget — slow down if getting close
          var fhUsed = StockAPI.getFHCallsInLastMinute();
          var gapMs = fhUsed > 45 ? 3000 : (fhUsed > 30 ? 1500 : 800);
          if (i < trackedStocks.length - 1) await delay(gapMs);
        }

        // Phase 3: Backfill heavy data (news, earnings, analyst, insider, etc.)
        // Process in batches of 4 stocks with rate-limit-aware pacing
        var backfillBatch = 4;
        for (var bi = 1; bi < trackedStocks.length; bi += backfillBatch) {
          var batchEnd = Math.min(bi + backfillBatch, trackedStocks.length);
          for (var j = bi; j < batchEnd; j++) {
            var bs = trackedStocks[j];
            try {
              await loadStockData(bs.symbol, bs.type);
            } catch(e) {
              console.warn('Backfill error for ' + bs.symbol + ':', e.message);
            }
            // Adaptive delay based on current API usage
            var fhNow = StockAPI.getFHCallsInLastMinute();
            var bfGap = fhNow > 50 ? 4000 : (fhNow > 35 ? 2500 : 1500);
            if (j < batchEnd - 1) await delay(bfGap);
          }
          // Pause between batches to let the rate limit window slide
          if (batchEnd < trackedStocks.length) await delay(5000);
        }

        startAutoRefresh();
      })();
    } else {
      showEmpty();
    }
  }

  // --- Init ---
  function init() {
    // Global unhandled error safety net
    window.addEventListener('unhandledrejection', function(e) {
      var msg = (e.reason && e.reason.message) ? e.reason.message : 'Unknown error';
      console.error('Unhandled rejection:', msg);
      if (msg.indexOf('rate limit') !== -1 || msg.indexOf('Rate limit') !== -1 || msg.indexOf('429') !== -1) {
        showWarning('Rate limited — some requests failed. Will retry automatically.');
      } else if (msg.indexOf('Network') !== -1 || msg.indexOf('timed out') !== -1 || msg.indexOf('Failed to fetch') !== -1) {
        showError('Network error — check your internet connection.');
      }
      e.preventDefault();
    });

    // Add toast animation CSS
    var style = document.createElement('style');
    style.textContent = '@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}';
    document.head.appendChild(style);

    // Wire up auth callbacks — re-run startApp on login to reload user-scoped data
    Auth.onLogin(function(user) {
      // Reload with user-scoped data
      stopAutoRefresh();
      cache = {};
      trackedStocks = [];
      priceAlerts = [];
      selectedSymbol = null;
      stockListEl.innerHTML = '';
      startApp();
    });

    // Try to restore Google session (optional — works without it)
    Auth.restoreSession();

    // Always go straight to the app — login is optional
    startApp();

    // Try to init Google Sign-In in background (non-blocking)
    _initSidebarGSI();
  }

  function _initSidebarGSI() {
    var clientId = Auth.getClientId();
    if (!clientId) return;
    function tryInit(attempts) {
      if (window.google && google.accounts && google.accounts.id) {
        if (Auth.initGSI()) {
          if (!Auth.isLoggedIn()) {
            Auth.renderButton('sidebar-google-btn');
          }
        }
      } else if (attempts > 0) {
        setTimeout(function() { tryInit(attempts - 1); }, 300);
      }
    }
    tryInit(30);
  }

  // ===== Chat Assistant (Wealth Advisor) =====
  (function initChat() {
    var chatFab = document.getElementById('chat-fab');
    var chatPanel = document.getElementById('chat-panel');
    var chatClose = document.getElementById('chat-close');
    var chatClear = document.getElementById('chat-clear');
    var chatForm = document.getElementById('chat-form');
    var chatInput = document.getElementById('chat-input');
    var chatMessages = document.getElementById('chat-messages');
    var chatThinking = document.getElementById('chat-thinking');
    var chatSend = document.getElementById('chat-send');
    if (!chatFab || !chatPanel) return;

    var conversation = []; // { role, content } history
    var isBusy = false;

    chatFab.addEventListener('click', function() {
      var isOpen = !chatPanel.classList.contains('hidden');
      chatPanel.classList.toggle('hidden', isOpen);
      chatFab.classList.toggle('active', !isOpen);
      if (!isOpen) chatInput.focus();
    });
    chatClose.addEventListener('click', function() {
      chatPanel.classList.add('hidden');
      chatFab.classList.remove('active');
    });
    chatClear.addEventListener('click', function() {
      conversation = [];
      chatMessages.innerHTML = '<div class="chat-msg assistant"><div class="chat-msg-content">Conversation cleared. Ask me anything about your stocks.</div></div>';
    });

    function scrollToBottom() {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function appendMsg(role, text) {
      var div = document.createElement('div');
      div.className = 'chat-msg ' + role;
      var content = document.createElement('div');
      content.className = 'chat-msg-content';
      content.innerHTML = formatChatText(text);
      div.appendChild(content);
      chatMessages.appendChild(div);
      scrollToBottom();
    }

    function formatChatText(text) {
      // Basic markdown-like formatting
      var s = text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
      return s;
    }

    function buildStockContext(sym, c, isSelected) {
      var parts = [];
      var stockInfo = trackedStocks.find(function(t) { return t.symbol === sym; }) || {};
      var typeLabel = stockInfo.type === 'ETF' ? ' [ETF]' : '';
      parts.push('=== ' + (isSelected ? 'CURRENTLY VIEWING: ' : '') + sym + typeLabel + ' ===');

      // Quote
      if (c.quote) {
        var q = c.quote;
        parts.push('PRICE: $' + (q.c || 'N/A') + ' | Change: ' + (q.dp != null ? q.dp.toFixed(2) + '%' : 'N/A'));
        parts.push('Open: $' + (q.o || '') + ' | High: $' + (q.h || '') + ' | Low: $' + (q.l || '') + ' | Prev Close: $' + (q.pc || ''));
      }

      // Profile
      if (c.profile) {
        var p = c.profile;
        parts.push('COMPANY: ' + (p.name || sym) + ' | Sector: ' + (p.finnhubIndustry || 'N/A') + ' | Market Cap: $' + fmtBigNum(p.marketCapitalization * 1e6));
        if (p.ipo) parts.push('IPO: ' + p.ipo);
      }

      // Financials / KPIs
      if (c.financials && c.financials.metric) {
        var m = c.financials.metric;
        var kpis = [];
        if (m.peBasicExclExtraTTM != null) kpis.push('P/E: ' + m.peBasicExclExtraTTM.toFixed(2));
        if (m.epsBasicExclExtraItemsTTM != null) kpis.push('EPS: $' + m.epsBasicExclExtraItemsTTM.toFixed(2));
        if (m.beta != null) kpis.push('Beta: ' + m.beta.toFixed(2));
        if (m.dividendYieldIndicatedAnnual != null) kpis.push('Div Yield: ' + m.dividendYieldIndicatedAnnual.toFixed(2) + '%');
        if (m['52WeekHigh'] != null) kpis.push('52W High: $' + m['52WeekHigh']);
        if (m['52WeekLow'] != null) kpis.push('52W Low: $' + m['52WeekLow']);
        if (kpis.length) parts.push('KPIs: ' + kpis.join(' | '));
      }

      // AI News result
      if (c.aiResult) {
        parts.push('AI NEWS ANALYSIS: Outlook=' + (c.aiResult.outlook || 'N/A') + ' | Summary: ' + (c.aiResult.summary || ''));
      }

      // Analyst AI
      if (c.analystAIResult) {
        parts.push('ANALYST RATINGS AI: Consensus=' + (c.analystAIResult.consensus || 'N/A') + ' | Summary: ' + (c.analystAIResult.summary || ''));
      }

      // Macro AI
      if (c.macroAIResult) {
        parts.push('MACRO IMPACT AI: Impact=' + (c.macroAIResult.impact || 'N/A') + ' | Summary: ' + (c.macroAIResult.summary || ''));
      }

      // Technicals AI
      if (c.technicalsResult) {
        parts.push('TECHNICALS AI: Signal=' + (c.technicalsResult.signal || 'N/A') + ' | Summary: ' + (c.technicalsResult.summary || ''));
        if (c.technicalsResult.support) parts.push('Support: ' + c.technicalsResult.support + ' | Resistance: ' + c.technicalsResult.resistance);
      }

      // Fundamentals AI
      if (c.fundamentalsResult) {
        var fr = c.fundamentalsResult;
        parts.push('FUNDAMENTALS AI: Overall=' + (fr.overallAssessment || 'N/A'));
        if (fr.summary) parts.push('Fundamentals Summary: ' + fr.summary);
      }

      // Verdict
      if (c.verdictResult) {
        var v = c.verdictResult;
        var vParts = ['SENIOR ANALYST VERDICT: ' + (v.verdict || 'N/A')];
        if (v.confidence) vParts.push('Confidence=' + v.confidence);
        if (v.priceTarget) vParts.push('Target=' + v.priceTarget);
        if (v.upside) vParts.push('Upside=' + v.upside + '%');
        if (v.intrinsicValue != null) vParts.push('DCF=' + v.intrinsicValue);
        parts.push(vParts.join(' | '));
        if (v.summary) parts.push('Thesis: ' + v.summary);
        if (v.verdictReason) parts.push('Rationale: ' + v.verdictReason);
        if (v.thinkingProcess) parts.push('Analysis: ' + v.thinkingProcess);
        if (v.bull && v.bull.length) parts.push('Bull: ' + v.bull.join('; '));
        if (v.bear && v.bear.length) parts.push('Bear: ' + v.bear.join('; '));
        if (v.catalysts && v.catalysts.length) parts.push('Catalysts: ' + v.catalysts.map(function(ct) { return typeof ct === 'string' ? ct : ct.event + ' (' + ct.timeline + ', ' + ct.impact + ')'; }).join('; '));
        if (v.risks && v.risks.length) parts.push('Risks: ' + v.risks.map(function(r) { return typeof r === 'string' ? r : r.risk + ' (' + r.severity + ')'; }).join('; '));
      }

      // Earnings
      if (c.earnings && c.earnings.length) {
        var latest = c.earnings[0];
        parts.push('LATEST EARNINGS: Period=' + (latest.period || '') + ' | Actual EPS=$' + (latest.actual || 'N/A') + ' | Estimate=$' + (latest.estimate || 'N/A') + ' | Surprise=' + (latest.surprise || 'N/A'));
      }

      // Transcript AI
      if (c.transcriptResult) {
        parts.push('EARNINGS CALL AI: Tone=' + (c.transcriptResult.tone || 'N/A') + ' | Summary: ' + (c.transcriptResult.summary || ''));
      }

      // Revenue / Income
      if (c.incomeData && c.incomeData.length) {
        var latest = c.incomeData[0];
        parts.push('LATEST QUARTERLY INCOME: Revenue=$' + fmtBigNum(latest.revenue) + ' | Net Income=$' + fmtBigNum(latest.netIncome) + ' | Gross Profit=$' + fmtBigNum(latest.grossProfit));
      }

      // Cash Flow
      if (c.cashFlowData && c.cashFlowData.length) {
        var cf = c.cashFlowData[0];
        parts.push('LATEST CASH FLOW: Operating=$' + fmtBigNum(cf.operatingCashFlow) + ' | CapEx=$' + fmtBigNum(cf.capitalExpenditure) + ' | FCF=$' + fmtBigNum(cf.freeCashFlow));
      }

      // Balance Sheet
      if (c.balanceSheetData && c.balanceSheetData.length) {
        var bs = c.balanceSheetData[0];
        parts.push('LATEST BALANCE SHEET: Assets=$' + fmtBigNum(bs.totalAssets) + ' | Liabilities=$' + fmtBigNum(bs.totalLiabilities) + ' | Equity=$' + fmtBigNum(bs.equity) + ' | Cash=$' + fmtBigNum(bs.cash) + ' | Debt=$' + fmtBigNum(bs.totalDebt));
      }

      // Insider
      if (c.insider && c.insider.length) {
        var buys = 0, sells = 0;
        c.insider.forEach(function(t) { if (t.change === 'Purchase') buys++; else if (t.change === 'Sale') sells++; });
        parts.push('INSIDER TRADING: ' + buys + ' buys, ' + sells + ' sells (recent transactions)');
      }

      // Recommendations
      if (c.recommendations && c.recommendations.length) {
        var r = c.recommendations[0];
        parts.push('ANALYST CONSENSUS: Buy=' + (r.buy || 0) + ' | Hold=' + (r.hold || 0) + ' | Sell=' + (r.sell || 0) + ' | Strong Buy=' + (r.strongBuy || 0) + ' | Strong Sell=' + (r.strongSell || 0));
      }

      // Peers
      if (c.peerData && c.peerData.length) {
        parts.push('PEERS: ' + c.peerData.map(function(p) { return p.symbol; }).join(', '));
      }

      // AV Overview
      if (c.avOverview) {
        var ov = c.avOverview;
        if (ov.Description && isSelected) parts.push('DESCRIPTION: ' + ov.Description.substring(0, 300));
        if (ov.PERatio) parts.push('AV P/E: ' + ov.PERatio + ' | PEG: ' + (ov.PEGRatio || 'N/A') + ' | P/B: ' + (ov.PriceToBookRatio || 'N/A'));
      }

      // ETF Holdings
      if (c.etfHoldings && c.etfHoldings.holdings && c.etfHoldings.holdings.length) {
        var topH = c.etfHoldings.holdings.slice(0, 10).map(function(h) {
          return h.symbol + ' ' + (h.percent != null ? (h.percent * 100).toFixed(1) + '%' : '');
        }).join(', ');
        parts.push('ETF TOP HOLDINGS: ' + topH);
      }

      return parts.join('\n');
    }

    function buildContext() {
      var sections = [];
      var sym = selectedSymbol;

      // Selected stock gets full context
      if (sym && cache[sym]) {
        sections.push(buildStockContext(sym, cache[sym], true));
      }

      // All other tracked stocks get condensed but complete AI context
      // Cap at 20 most relevant stocks to avoid blowing token limits
      if (trackedStocks && trackedStocks.length) {
        var others = trackedStocks.filter(function(s) { return s.symbol !== sym; });
        if (others.length) {
          sections.push('\n=== OTHER PORTFOLIO STOCKS (' + others.length + ' total) ===');
          // If >20 stocks, prioritize ones with verdicts/AI data
          var toInclude = others;
          if (others.length > 20) {
            var withData = others.filter(function(s) { var oc = cache[s.symbol]; return oc && (oc.verdictResult || oc.aiResult); });
            var withoutData = others.filter(function(s) { var oc = cache[s.symbol]; return !oc || (!oc.verdictResult && !oc.aiResult); });
            toInclude = withData.concat(withoutData).slice(0, 20);
            if (others.length > 20) sections.push('(Showing top 20 of ' + others.length + ' — remaining: ' + others.slice(20).map(function(s) { return s.symbol; }).join(', ') + ')');
          }
          toInclude.forEach(function(s) {
            var oc = cache[s.symbol];
            if (oc) {
              sections.push(buildStockContext(s.symbol, oc, false));
            }
          });
        }
      }

      if (!sections.length) return 'No stock is currently selected and no stocks are tracked.';
      return sections.join('\n\n');
    }

    function fmtBigNum(n) {
      if (n == null || isNaN(n)) return 'N/A';
      n = Number(n);
      if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(2) + 'T';
      if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
      if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
      if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return n.toFixed(2);
    }

    var SYSTEM_PROMPT = 'You are Alexander Sterling — Chief Investment Officer & Senior Wealth Advisor.\n'
      + 'Background: 28 years on Wall Street. Former MD at Goldman Sachs Asset Management, CIO at Bridgewater Associates, and founder of Sterling Capital Advisors ($3B AUM). CFA, CAIA, CFP charterholder. MBA (Harvard), MS Financial Engineering (Columbia).\n\n'
      + 'You are known for:\n'
      + '- Portfolio-level thinking: you never analyze a stock in isolation — you always consider position sizing, correlation, sector exposure, and portfolio risk\n'
      + '- Multi-factor analysis: combining fundamental, technical, macro, and sentiment signals into a unified view\n'
      + '- Risk management obsession: you always quantify downside before discussing upside. You think in terms of risk/reward ratios.\n'
      + '- Contrarian instincts: you push back when the consensus is too crowded and identify opportunities others miss\n'
      + '- Clear communication: you explain complex financial concepts in plain language without dumbing them down\n\n'
      + 'You have FULL ACCESS to all stock data for every stock in the user\'s portfolio (provided below as context). This includes real-time prices, AI-powered news analysis, macro impact assessment, technical signals, fundamental analysis, Senior Analyst verdicts with price targets, earnings data, insider trading, and analyst ratings.\n\n'
      + 'YOUR ANALYTICAL FRAMEWORK:\n'
      + '1. LISTEN FIRST — understand what the user is really asking. Are they looking for validation, a second opinion, or a new idea?\n'
      + '2. REFERENCE THE DATA — always cite specific numbers from the dashboard context. You have AI analysis, Senior Analyst verdicts, fundamentals, technicals, and macro data for ALL portfolio stocks. Never give generic advice when you have specific data.\n'
      + '3. THINK IN PROBABILITIES — don\'t say "this will happen." Say "there\'s a 70% chance of X because of Y, but the 30% downside scenario is Z."\n'
      + '4. CROSS-STOCK ANALYSIS — compare stocks in the portfolio. Identify correlations, concentration risks, relative value, and which positions to size up vs trim.\n'
      + '5. TIME HORIZON MATTERS — always ask about or consider the user\'s time horizon. A stock can be a great 5-year hold but a terrible 3-month trade.\n'
      + '6. RISK FIRST — before any buy recommendation, state what could go wrong and how much the user could lose.\n'
      + '7. BE DECISIVE — give clear, specific recommendations. "It depends" is not helpful. Take a stance and explain your reasoning.\n'
      + '8. MACRO AWARENESS — connect individual stock analysis to the broader macro environment. Interest rates, inflation, geopolitics all matter.\n\n'
      + 'PERSONALITY: Confident but intellectually humble. Direct but empathetic. You challenge bad ideas respectfully. You celebrate good thinking. You never talk down to anyone.\n\n'
      + 'IMPORTANT: You can analyze ALL stocks in the portfolio — not just the currently selected one. If AI analysis or verdicts are missing for a stock, mention that the user should run the analysis first. Do NOT make up data.\n\n'
      + 'Format responses with **bold** for emphasis and `code` for numbers/tickers. Use line breaks for readability.';

    chatForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      var text = chatInput.value.trim();
      if (!text || isBusy) return;
      if (!NewsAI.hasKey()) {
        appendMsg('assistant', 'Please add your Groq API key in Settings first.');
        return;
      }

      isBusy = true;
      chatSend.disabled = true;
      chatInput.value = '';
      appendMsg('user', text);

      // Build context fresh each message
      var context = buildContext();

      // Add user message to conversation
      conversation.push({ role: 'user', content: text });

      // Build messages array for API
      var apiMessages = [];
      apiMessages.push({ role: 'system', content: SYSTEM_PROMPT + '\n\n--- DASHBOARD DATA ---\n' + context + '\n--- END DATA ---' });

      // Include conversation history (keep last 20 messages to stay within token limits)
      var historySlice = conversation.slice(-20);
      for (var i = 0; i < historySlice.length; i++) {
        apiMessages.push({ role: historySlice[i].role, content: historySlice[i].content });
      }

      chatThinking.classList.remove('hidden');
      scrollToBottom();

      try {
        var response = await NewsAI.chatAdvisor(apiMessages, { timeoutMs: 60000, maxTokens: 2048 });
        conversation.push({ role: 'assistant', content: response });
        chatThinking.classList.add('hidden');
        appendMsg('assistant', response);
      } catch (err) {
        // Auto-retry once on rate limit after 35s
        if (err.message && err.message.indexOf('Rate') !== -1) {
          chatThinking.innerHTML = '<span>\u23F3 Rate limited — retrying in 35s\u2026</span>';
          await new Promise(function(r) { setTimeout(r, 35000); });
          chatThinking.innerHTML = '<span>Thinking\u2026</span>';
          try {
            var retryResp = await NewsAI.chatAdvisor(apiMessages, { timeoutMs: 60000, maxTokens: 2048 });
            conversation.push({ role: 'assistant', content: retryResp });
            chatThinking.classList.add('hidden');
            appendMsg('assistant', retryResp);
          } catch (retryErr) {
            chatThinking.classList.add('hidden');
            appendMsg('assistant', 'Error: ' + retryErr.message);
          }
        } else {
          chatThinking.classList.add('hidden');
          appendMsg('assistant', 'Error: ' + err.message);
        }
      }

      isBusy = false;
      chatSend.disabled = false;
      chatInput.focus();
    });
  })();

  // ===== AI Stock Screener Agent =====
  (function initScreener() {
    var fab = document.getElementById('screener-fab');
    var panel = document.getElementById('screener-panel');
    var closeBtn = document.getElementById('screener-close');
    var clearBtn = document.getElementById('screener-clear');
    var form = document.getElementById('screener-form');
    var inputEl = document.getElementById('screener-input');
    var messagesEl = document.getElementById('screener-messages');
    var thinkingEl = document.getElementById('screener-thinking');
    var resultsEl = document.getElementById('screener-results');
    var sendBtn = document.getElementById('screener-send');
    if (!fab || !panel) return;

    var conversation = [];
    var isBusy = false;
    var lastCriteria = null;
    var screenResults = [];
    var currentSort = { field: null, dir: 'desc' };

    // S&P 500 + popular ETFs universe — cached to avoid burning API calls
    var UNIVERSE_KEY = 'screener_universe';
    var UNIVERSE_TTL = 7 * 24 * 3600 * 1000; // 7 days

    fab.addEventListener('click', function() {
      var isOpen = !panel.classList.contains('hidden');
      panel.classList.toggle('hidden', isOpen);
      fab.classList.toggle('active', !isOpen);
      if (!isOpen) inputEl.focus();
    });
    closeBtn.addEventListener('click', function() {
      panel.classList.add('hidden');
      fab.classList.remove('active');
    });
    clearBtn.addEventListener('click', function() {
      conversation = [];
      lastCriteria = null;
      screenResults = [];
      resultsEl.classList.add('hidden');
      resultsEl.innerHTML = '';
      messagesEl.innerHTML = '<div class="chat-msg assistant"><div class="chat-msg-content">Fresh start! So, what are you looking to invest in today? Tell me a bit about your goals and I\'ll help you find the right stocks.</div></div>';
    });

    function scrollBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

    function appendMsg(role, html) {
      var div = document.createElement('div');
      div.className = 'chat-msg ' + role;
      var content = document.createElement('div');
      content.className = 'chat-msg-content';
      content.innerHTML = html;
      div.appendChild(content);
      messagesEl.appendChild(div);
      scrollBottom();
      return content;
    }

    function fmtText(text) {
      return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
    }

    // Build criteria display HTML
    function buildCriteriaHTML(criteria) {
      var h = '<div class="screener-criteria-box">';
      h += '<div class="criteria-label">Your Investment Criteria</div>';
      if (criteria.type && criteria.type !== 'both') {
        h += '<div class="screener-criteria-item">' + (criteria.type === 'etf' ? 'ETFs only' : 'Stocks only') + '</div>';
      }
      if (criteria.sector) {
        var sectors = Array.isArray(criteria.sector) ? criteria.sector.join(', ') : criteria.sector;
        h += '<div class="screener-criteria-item">Sector: ' + sectors + '</div>';
      }
      if (criteria.filters && criteria.filters.length) {
        criteria.filters.forEach(function(f) {
          h += '<div class="screener-criteria-item">' + (f.label || (f.field + ' ' + f.op + ' ' + f.value)) + '</div>';
        });
      }
      if (criteria.sortBy) {
        h += '<div class="screener-criteria-item">Sort by: ' + criteria.sortBy + ' (' + (criteria.sortDir || 'desc') + ')</div>';
      }
      h += '</div>';
      return h;
    }

    // Get or build the stock universe
    async function getUniverse() {
      // Check cache
      var cached = null;
      try {
        var raw = localStorage.getItem(UNIVERSE_KEY);
        if (raw) {
          cached = JSON.parse(raw);
          if (cached.ts && Date.now() - cached.ts < UNIVERSE_TTL && cached.symbols && cached.symbols.length > 100) {
            return cached.symbols;
          }
        }
      } catch(e) {}

      // Fetch US stock symbols from Finnhub
      if (!StockAPI.hasKey()) throw new Error('Finnhub API key required for screening.');
      appendMsg('assistant', '📡 Building stock universe from Finnhub (one-time, cached for 7 days)...');

      var symbols = [];
      try {
        var symUrl = 'https://finnhub.io/api/v1/stock/symbol?exchange=US&token=' + (StockAPI.getKey());
        var data = null;

        // Try direct fetch first (works locally, may fail on GitHub Pages due to CORS)
        try {
          var controller = new AbortController();
          var timeoutId = setTimeout(function() { controller.abort(); }, 45000);
          var res = await fetch(symUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (res.ok) data = await res.json();
        } catch(directErr) {
          // Direct fetch failed (likely CORS) — fall through to proxy
        }

        // Fallback: use CORS proxy chain
        if (!data) {
          appendMsg('assistant', '🔄 Direct fetch blocked — trying via proxy...');
          var proxyRes = await StockAPI.fetchViaProxy(symUrl, { timeout: 60000 });
          var proxyText = await proxyRes.text();
          data = JSON.parse(proxyText);
        }

        if (Array.isArray(data)) {
          symbols = data
            .filter(function(s) {
              return s.symbol && s.type && (s.type === 'Common Stock' || s.type === 'ETP')
                && s.symbol.indexOf('.') === -1
                && s.symbol.length <= 5;
            })
            .map(function(s) {
              return { symbol: s.symbol, name: s.description || '', type: s.type === 'Common Stock' ? 'stock' : 'etf' };
            });
        }
      } catch(e) {
        if (e.name === 'AbortError') throw new Error('Finnhub stock list request timed out. Try again — it may be slow on first load.');
        throw new Error('Failed to fetch stock universe: ' + (e.message || 'Network error'));
      }

      if (symbols.length < 50) throw new Error('Universe too small (' + symbols.length + '). Check Finnhub key.');

      // Cache it
      try {
        localStorage.setItem(UNIVERSE_KEY, JSON.stringify({ ts: Date.now(), symbols: symbols }));
      } catch(e) {}

      return symbols;
    }

    // Expose fhGet for the screener (it's inside StockAPI closure)
    // We need to add it to StockAPI — let's use the existing searchTicker pattern instead
    // Actually, fhGet is not exposed. We'll use a workaround via the existing API methods.

    // Screen stocks against criteria
    async function runScreen(criteria) {
      resultsEl.classList.remove('hidden');
      resultsEl.innerHTML = '<div class="screener-progress">🔍 Preparing to screen...<div class="screener-progress-bar"><div class="screener-progress-fill" id="screener-progress-fill" style="width:0%"></div></div></div>';

      var universe;
      try {
        universe = await getUniverse();
      } catch(e) {
        resultsEl.innerHTML = '<div class="screener-progress" style="color:var(--red);">Error: ' + e.message + '</div>';
        return;
      }

      // Filter by type
      var candidates = universe;
      if (criteria.type === 'stock') candidates = candidates.filter(function(s) { return s.type === 'stock'; });
      else if (criteria.type === 'etf') candidates = candidates.filter(function(s) { return s.type === 'etf'; });

      // Limit universe to a manageable size for API calls
      // Shuffle and take a sample to get diverse results
      var maxToScreen = Math.min(candidates.length, 200);
      var shuffled = candidates.slice();
      for (var i = shuffled.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp;
      }
      // But prioritize well-known stocks — put tracked stocks and common ones first
      var prioritized = [];
      var rest = [];
      var knownSymbols = {};
      trackedStocks.forEach(function(s) { knownSymbols[s.symbol] = true; });
      shuffled.forEach(function(s) {
        if (knownSymbols[s.symbol]) prioritized.push(s);
        else rest.push(s);
      });
      var toScreen = prioritized.concat(rest).slice(0, maxToScreen);

      var progressFill = document.getElementById('screener-progress-fill');
      var progressEl = resultsEl.querySelector('.screener-progress');
      var matches = [];
      var screened = 0;
      var errors = 0;
      var batchSize = 3; // 3 concurrent to stay under 60/min
      var delayBetweenBatches = 3200; // ~18 calls/min safe

      for (var bi = 0; bi < toScreen.length; bi += batchSize) {
        var batch = toScreen.slice(bi, bi + batchSize);
        var promises = batch.map(function(stock) {
          return screenOneStock(stock, criteria).then(function(result) {
            screened++;
            if (result) matches.push(result);
          }).catch(function() {
            screened++;
            errors++;
          });
        });
        await Promise.all(promises);

        var pct = Math.round(screened / toScreen.length * 100);
        if (progressFill) progressFill.style.width = pct + '%';
        if (progressEl) progressEl.firstChild.textContent = '🔍 Screened ' + screened + '/' + toScreen.length + ' (' + matches.length + ' matches)...';

        // Check if we have enough matches
        var limit = (criteria.limit || 25);
        if (matches.length >= limit * 2) break; // Got plenty, stop early

        // Rate limit delay between batches
        if (bi + batchSize < toScreen.length) {
          await new Promise(function(r) { setTimeout(r, delayBetweenBatches); });
        }
      }

      // Sort results
      var sortField = criteria.sortBy || 'marketCap';
      var sortDir = criteria.sortDir || 'desc';
      matches.sort(function(a, b) {
        var va = a.metrics[sortField] != null ? a.metrics[sortField] : (sortDir === 'desc' ? -Infinity : Infinity);
        var vb = b.metrics[sortField] != null ? b.metrics[sortField] : (sortDir === 'desc' ? -Infinity : Infinity);
        return sortDir === 'desc' ? vb - va : va - vb;
      });

      screenResults = matches.slice(0, criteria.limit || 25);
      currentSort = { field: sortField, dir: sortDir };
      renderResults();

      var summary = '✅ Found ' + matches.length + ' matches out of ' + screened + ' screened.';
      if (errors > 0) summary += ' (' + errors + ' had data errors)';
      if (matches.length > (criteria.limit || 25)) summary += ' Showing top ' + (criteria.limit || 25) + '.';
      appendMsg('assistant', summary + '\n\nYou can click column headers to re-sort, or click **+ Add** to add any stock to your watchlist.\n\nWant to refine the criteria? Just tell me what to change.');
    }

    // Screen a single stock against criteria
    async function screenOneStock(stock, criteria) {
      try {
        // Get metrics from Finnhub
        var data = await StockAPI.getBasicFinancials(stock.symbol);
        if (!data) return null;

        var metrics = {
          symbol: stock.symbol,
          name: stock.name,
          type: stock.type,
          peTTM: data.peTTM,
          epsTTM: data.epsTTM,
          dividendYield: parseFloat(data.dividendYield) || null,
          beta: parseFloat(data.beta) || null,
          revenueGrowthTTMYoy: data.revenueGrowth1Y,
          epsGrowthTTMYoy: data.epsGrowth,
          grossMarginTTM: data.grossMargin,
          operatingMarginTTM: data.operatingMargin,
          netProfitMarginTTM: data.netMargin,
          roeTTM: data.roeTTM,
          roaTTM: data.roaTTM,
          currentRatioQuarterly: data.currentRatio,
          totalDebtToEquityQuarterly: data.debtEquity,
          marketCap: null,
          price: null,
          change: null,
          changePct: null,
        };

        // Parse 52W values
        if (data.week52High && data.week52High !== 'N/A') metrics['52WeekHigh'] = parseFloat(data.week52High.replace('$',''));
        if (data.week52Low && data.week52Low !== 'N/A') metrics['52WeekLow'] = parseFloat(data.week52Low.replace('$',''));

        // Check sector filter — need profile for this
        if (criteria.sector) {
          var profile = await StockAPI.getProfile(stock.symbol);
          if (profile) {
            metrics.sector = profile.sector;
            metrics.marketCap = profile.marketCap ? profile.marketCap / 1e6 : null; // in millions
            metrics.name = profile.name || stock.name;
          }
          var sectorList = Array.isArray(criteria.sector) ? criteria.sector : [criteria.sector];
          var sectorMatch = false;
          if (metrics.sector) {
            var sLower = metrics.sector.toLowerCase();
            sectorList.forEach(function(s) { if (sLower.indexOf(s.toLowerCase()) !== -1) sectorMatch = true; });
          }
          if (!sectorMatch) return null;
        }

        // If we need marketCap but don't have it yet
        if (!metrics.marketCap) {
          var needsMcap = criteria.filters && criteria.filters.some(function(f) { return f.field === 'marketCap'; });
          var sortNeedsMcap = criteria.sortBy === 'marketCap';
          if (needsMcap || sortNeedsMcap) {
            if (!criteria.sector) { // didn't fetch profile yet
              var prof = await StockAPI.getProfile(stock.symbol);
              if (prof) {
                metrics.marketCap = prof.marketCap ? prof.marketCap / 1e6 : null;
                metrics.name = prof.name || stock.name;
              }
            }
          }
        }

        // Apply filters
        if (criteria.filters && criteria.filters.length) {
          for (var i = 0; i < criteria.filters.length; i++) {
            var f = criteria.filters[i];
            var val = metrics[f.field];
            if (val == null) return null; // missing data = skip

            if (f.op === '>' && !(val > f.value)) return null;
            if (f.op === '<' && !(val < f.value)) return null;
            if (f.op === '>=' && !(val >= f.value)) return null;
            if (f.op === '<=' && !(val <= f.value)) return null;
            if (f.op === 'between') {
              if (!Array.isArray(f.value) || f.value.length !== 2) return null;
              if (!(val >= f.value[0] && val <= f.value[1])) return null;
            }
          }
        }

        // Get quote for price data
        try {
          var quote = await StockAPI.getQuote(stock.symbol);
          if (quote) {
            metrics.price = quote.price;
            metrics.change = quote.change;
            metrics.changePct = quote.changePct;
          }
        } catch(e) {}

        return { symbol: stock.symbol, name: metrics.name || stock.name, type: stock.type, metrics: metrics };
      } catch(e) {
        return null;
      }
    }

    // Render results table
    function renderResults() {
      if (!screenResults.length) {
        resultsEl.innerHTML = '<div class="screener-progress">No matches found. Try broadening your criteria.</div>';
        return;
      }

      var h = '<div class="screener-results-header"><span class="screener-results-count">' + screenResults.length + ' results</span></div>';
      h += '<table class="screener-table"><thead><tr>';

      var columns = [
        { key: 'symbol', label: 'Symbol', cls: 'sym-cell' },
        { key: 'name', label: 'Name', cls: 'name-cell' },
        { key: 'price', label: 'Price', cls: 'num-cell', fmt: 'price' },
        { key: 'changePct', label: 'Chg%', cls: 'num-cell', fmt: 'pct' },
        { key: 'peTTM', label: 'P/E', cls: 'num-cell', fmt: 'dec1' },
        { key: 'dividendYield', label: 'Div%', cls: 'num-cell', fmt: 'dec2' },
        { key: 'roeTTM', label: 'ROE%', cls: 'num-cell', fmt: 'dec1' },
        { key: 'revenueGrowthTTMYoy', label: 'RevGr%', cls: 'num-cell', fmt: 'dec1' },
        { key: 'beta', label: 'Beta', cls: 'num-cell', fmt: 'dec2' },
        { key: '_add', label: '', cls: '' },
      ];

      columns.forEach(function(col) {
        var arrow = '';
        if (col.key === currentSort.field) arrow = '<span class="sort-arrow">' + (currentSort.dir === 'desc' ? '▼' : '▲') + '</span>';
        h += '<th data-sort="' + col.key + '">' + col.label + arrow + '</th>';
      });
      h += '</tr></thead><tbody>';

      screenResults.forEach(function(r) {
        var m = r.metrics;
        var isTracked = trackedStocks.some(function(t) { return t.symbol === r.symbol; });
        h += '<tr>';
        columns.forEach(function(col) {
          if (col.key === '_add') {
            if (isTracked) {
              h += '<td><span class="screener-add-btn added">✓ Tracked</span></td>';
            } else {
              h += '<td><button class="screener-add-btn" data-sym="' + r.symbol + '" data-name="' + (r.name || '').replace(/"/g, '&quot;') + '" data-type="' + r.type + '">+ Add</button></td>';
            }
            return;
          }
          var val = col.key === 'name' ? r.name : (col.key === 'symbol' ? r.symbol : m[col.key]);
          var display = '';
          var cls = col.cls || '';

          if (val == null || val === 'N/A') { display = '—'; }
          else if (col.fmt === 'price') { display = '$' + Number(val).toFixed(2); }
          else if (col.fmt === 'pct') {
            display = (val >= 0 ? '+' : '') + Number(val).toFixed(2) + '%';
            cls += val >= 0 ? ' pos' : ' neg';
          }
          else if (col.fmt === 'dec1') { display = Number(val).toFixed(1); }
          else if (col.fmt === 'dec2') { display = Number(val).toFixed(2); }
          else { display = String(val); }

          h += '<td class="' + cls + '">' + display + '</td>';
        });
        h += '</tr>';
      });

      h += '</tbody></table>';
      resultsEl.innerHTML = h;

      // Wire up sort headers
      resultsEl.querySelectorAll('th[data-sort]').forEach(function(th) {
        th.addEventListener('click', function() {
          var field = th.getAttribute('data-sort');
          if (field === '_add') return;
          if (currentSort.field === field) {
            currentSort.dir = currentSort.dir === 'desc' ? 'asc' : 'desc';
          } else {
            currentSort.field = field;
            currentSort.dir = (field === 'symbol' || field === 'name') ? 'asc' : 'desc';
          }
          screenResults.sort(function(a, b) {
            var va = field === 'name' ? a.name : (field === 'symbol' ? a.symbol : a.metrics[field]);
            var vb = field === 'name' ? b.name : (field === 'symbol' ? b.symbol : b.metrics[field]);
            if (va == null) va = currentSort.dir === 'desc' ? -Infinity : Infinity;
            if (vb == null) vb = currentSort.dir === 'desc' ? -Infinity : Infinity;
            if (typeof va === 'string') return currentSort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
            return currentSort.dir === 'desc' ? vb - va : va - vb;
          });
          renderResults();
        });
      });

      // Wire up add buttons
      resultsEl.querySelectorAll('.screener-add-btn:not(.added)').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var sym = btn.getAttribute('data-sym');
          var name = btn.getAttribute('data-name');
          var type = btn.getAttribute('data-type') === 'etf' ? 'ETF' : 'Equity';
          addStock(sym, name, type);
          btn.classList.add('added');
          btn.textContent = '✓ Added';
        });
      });
    }

    // Main form submit
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var text = inputEl.value.trim();
      if (!text || isBusy) return;
      if (!NewsAI.hasKey()) {
        appendMsg('assistant', 'Please add your Groq API key in Settings to use the screener.');
        return;
      }
      if (!StockAPI.hasKey()) {
        appendMsg('assistant', 'Please add your Finnhub API key in Settings to search stocks.');
        return;
      }

      isBusy = true;
      sendBtn.disabled = true;
      inputEl.value = '';
      appendMsg('user', fmtText(text));

      conversation.push({ role: 'user', content: text });

      thinkingEl.classList.remove('hidden');
      scrollBottom();

      try {
        var response = await NewsAI.screenerAgent(conversation);

        thinkingEl.classList.add('hidden');

        if (!response || !response.status) {
          appendMsg('assistant', 'I had trouble understanding that. Could you rephrase what kind of stocks you\'re looking for?');
          isBusy = false;
          sendBtn.disabled = false;
          return;
        }

        // Add assistant response to conversation
        conversation.push({ role: 'assistant', content: JSON.stringify(response) });

        if (response.status === 'clarify') {
          appendMsg('assistant', fmtText(response.message || 'Could you tell me more about what you\'re looking for?'));
        } else if (response.status === 'criteria' || response.status === 'refine') {
          lastCriteria = response.criteria;

          // Show the message
          var msgHTML = fmtText(response.message || 'Here are the criteria I\'ll use:');
          msgHTML += buildCriteriaHTML(response.criteria);

          // Add confirm/edit buttons
          msgHTML += '<div class="screener-confirm-btns">';
          msgHTML += '<button class="screener-confirm-btn yes" id="screener-confirm-yes">🔍 Search Now</button>';
          msgHTML += '<button class="screener-confirm-btn edit" id="screener-confirm-edit">✏️ Adjust</button>';
          msgHTML += '</div>';

          var msgEl = appendMsg('assistant', msgHTML);

          // Wire up buttons
          var yesBtn = msgEl.querySelector('#screener-confirm-yes');
          var editBtn = msgEl.querySelector('#screener-confirm-edit');

          yesBtn.addEventListener('click', async function() {
            yesBtn.disabled = true;
            editBtn.disabled = true;
            yesBtn.textContent = 'Searching...';
            try {
              await runScreen(lastCriteria);
            } catch(err) {
              appendMsg('assistant', 'Error during screening: ' + err.message);
            }
          });

          editBtn.addEventListener('click', function() {
            yesBtn.disabled = true;
            editBtn.disabled = true;
            appendMsg('assistant', 'No problem at all! What would you like to tweak? For example:\n• "I\'d prefer less risky stocks"\n• "Can we add a dividend requirement?"\n• "Focus on tech companies only"\n• "Remove the debt filter"\n\nJust tell me what feels right.');
            inputEl.focus();
          });
        }
      } catch(err) {
        thinkingEl.classList.add('hidden');
        appendMsg('assistant', 'Error: ' + err.message + '. Try again.');
      }

      isBusy = false;
      sendBtn.disabled = false;
      inputEl.focus();
    });
  })();

  init();
})();
