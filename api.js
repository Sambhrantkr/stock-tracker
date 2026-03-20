/**
 * Stock API using Finnhub.io (free tier, 60 calls/min, CORS-friendly)
 * Get your free key at: https://finnhub.io/register
 */
const StockAPI = (() => {
  const BASE = 'https://finnhub.io/api/v1';

  function getKey() { return (typeof Auth !== 'undefined' && Auth.isLoggedIn()) ? (Auth.getItem('fh_api_key') || '') : (localStorage.getItem('fh_api_key') || ''); }
  function setKey(key) { if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) Auth.setItem('fh_api_key', key.trim()); else localStorage.setItem('fh_api_key', key.trim()); }
  function hasKey() { return getKey().length > 0; }

  let statusCb = null;
  function onStatus(cb) { statusCb = cb; }
  function status(msg) { if (statusCb) statusCb(msg); }

  // --- Finnhub API call tracking (60 calls/min free tier) ---
  var fhCallLog = [];
  function trackFHCall() {
    var now = Date.now();
    fhCallLog.push(now);
    while (fhCallLog.length && fhCallLog[0] < now - 60000) fhCallLog.shift();
  }
  function getFHCallsInLastMinute() {
    var now = Date.now();
    while (fhCallLog.length && fhCallLog[0] < now - 60000) fhCallLog.shift();
    return fhCallLog.length;
  }

  async function fhGet(path) {
    var sep = path.indexOf('?') !== -1 ? '&' : '?';
    var url = BASE + path + sep + 'token=' + getKey();
    trackFHCall();
    var res;
    try {
      var controller = new AbortController();
      var timeoutId = setTimeout(function() { controller.abort(); }, 15000);
      res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Request timed out. Check your connection.');
      throw new Error('Network error: ' + (e.message || 'Could not reach Finnhub. Check your internet connection.'));
    }
    if (res.status === 429) throw new Error('Finnhub rate limit (60/min). Wait a moment and try again.');
    if (res.status === 401 || res.status === 403) throw new Error('Invalid Finnhub API key. Check Settings.');
    // Retry once on server errors (5xx)
    if (res.status >= 500) {
      await new Promise(function(r) { setTimeout(r, 2000); });
      trackFHCall();
      try {
        var controller2 = new AbortController();
        var timeoutId2 = setTimeout(function() { controller2.abort(); }, 15000);
        res = await fetch(url, { signal: controller2.signal });
        clearTimeout(timeoutId2);
      } catch (e2) {
        throw new Error('Finnhub server error (retry failed): ' + (e2.message || ''));
      }
      if (!res.ok) throw new Error('Finnhub server error: HTTP ' + res.status);
    }
    if (!res.ok) throw new Error('Finnhub HTTP ' + res.status);
    var data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error('Invalid response from Finnhub (not JSON).');
    }
    return data;
  }

  /** Search — returns [{symbol, name, type}] */
  async function searchTicker(query) {
    status('Searching "' + query + '"…');
    try {
      const data = await fhGet(`/search?q=${encodeURIComponent(query)}`);
      status('');
      return (data.result || [])
        .filter(r => ['Common Stock', 'ETP', 'ETF'].includes(r.type))
        .slice(0, 10)
        .map(r => ({
          symbol: r.symbol,
          name: r.description,
          type: r.type === 'Common Stock' ? 'Equity' : 'ETF',
        }));
    } catch (e) {
      status('');
      throw e;
    }
  }

  /** Quote — {price, change, changePct, high, low, prevClose} */
  async function getQuote(symbol) {
    status('Quote ' + symbol + '…');
    try {
      const q = await fhGet(`/quote?symbol=${encodeURIComponent(symbol)}`);
      if (!q || q.c === 0 || q.c === undefined || q.c === null) throw new Error('No quote data for ' + symbol);
      status('');
      return {
        price: q.c, change: q.d || 0, changePct: q.dp || 0,
        high: q.h || 0, low: q.l || 0, prevClose: q.pc || 0,
      };
    } catch (e) {
      status('');
      throw e;
    }
  }

  /** Company profile — {name, sector, marketCap, logo, finnhubIndustry} */
  async function getProfile(symbol) {
    status('Profile ' + symbol + '…');
    try {
      const p = await fhGet(`/stock/profile2?symbol=${encodeURIComponent(symbol)}`);
      status('');
      if (!p || !p.name) return null;
      return {
        name: p.name,
        sector: p.finnhubIndustry || 'N/A',
        marketCap: p.marketCapitalization ? p.marketCapitalization * 1e6 : null,
        logo: p.logo || '',
        exchange: p.exchange || '',
        ipo: p.ipo || '',
        weburl: p.weburl || '',
      };
    } catch (e) {
      status('');
      throw e;
    }
  }

  /** Basic financials — KPIs + historical annual series */
  async function getBasicFinancials(symbol) {
    status('Financials ' + symbol + '…');
    try {
      const data = await fhGet(`/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`);
      status('');
      const m = data.metric || {};
      const series = data.series || {};
    return {
      peRatio: m.peNormalizedAnnual != null ? m.peNormalizedAnnual.toFixed(1) : (m.peTTM != null ? m.peTTM.toFixed(1) : 'N/A'),
      peTTM: m.peTTM || null,
      forwardPE: m.peBasicExclExtraTTM != null ? m.peBasicExclExtraTTM.toFixed(1) : 'N/A',
      eps: m.epsNormalizedAnnual != null ? m.epsNormalizedAnnual.toFixed(2) : (m.epsTTM != null ? m.epsTTM.toFixed(2) : 'N/A'),
      dividendYield: m.dividendYieldIndicatedAnnual != null ? (m.dividendYieldIndicatedAnnual).toFixed(2) + '%' : 'N/A',
      week52High: m['52WeekHigh'] != null ? '$' + m['52WeekHigh'].toFixed(2) : 'N/A',
      week52Low: m['52WeekLow'] != null ? '$' + m['52WeekLow'].toFixed(2) : 'N/A',
      beta: m.beta != null ? m.beta.toFixed(2) : 'N/A',
      profitMargin: m.netProfitMarginTTM != null ? m.netProfitMarginTTM.toFixed(1) + '%' : 'N/A',
      revenueGrowth: m.revenueGrowthTTMYoy != null ? m.revenueGrowthTTMYoy.toFixed(1) + '%' : 'N/A',
      // Extended metrics for fundamentals tile
      grossMargin: m.grossMarginTTM != null ? m.grossMarginTTM : null,
      operatingMargin: m.operatingMarginTTM != null ? m.operatingMarginTTM : null,
      netMargin: m.netProfitMarginTTM != null ? m.netProfitMarginTTM : null,
      revenueGrowth1Y: m.revenueGrowthTTMYoy != null ? m.revenueGrowthTTMYoy : null,
      revenueGrowth3Y: m.revenueGrowth3Y != null ? m.revenueGrowth3Y : null,
      revenueGrowth5Y: m.revenueGrowth5Y != null ? m.revenueGrowth5Y : null,
      epsGrowth: m.epsGrowthTTMYoy != null ? m.epsGrowthTTMYoy : null,
      epsGrowth3Y: m.epsGrowth3Y != null ? m.epsGrowth3Y : null,
      epsGrowth5Y: m.epsGrowth5Y != null ? m.epsGrowth5Y : null,
      roeTTM: m.roeTTM != null ? m.roeTTM : null,
      roaTTM: m.roaTTM != null ? m.roaTTM : null,
      roicTTM: m.roicTTM != null ? m.roicTTM : null,
      currentRatio: m.currentRatioQuarterly != null ? m.currentRatioQuarterly : null,
      debtEquity: m.totalDebtToEquityQuarterly != null ? m.totalDebtToEquityQuarterly : null,
      quickRatio: m.quickRatioQuarterly != null ? m.quickRatioQuarterly : null,
      annualSeries: series.annual || {},
    };
    } catch (e) {
      status('');
      throw e;
    }
  }

  /** Company news — returns [{title, url, publisher, date, summary, sentiment}] */
  async function getNews(symbol) {
    status('News ' + symbol + '…');
    try {
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const articles = await fhGet(`/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`);
      status('');
      if (!Array.isArray(articles)) return [];
      return articles.slice(0, 15).map(a => ({
        title: a.headline || 'Untitled',
        url: a.url || '#',
        publisher: a.source || 'Unknown',
        date: a.datetime ? new Date(a.datetime * 1000).toLocaleDateString() : '',
        summary: a.summary || '',
        sentiment: a.sentiment || null,
      }));
    } catch (e) {
      status('');
      throw e;
    }
  }

  /** Earnings — last 8 quarters [{period, actual, estimate, surprise, surprisePct}] */
  async function getEarnings(symbol) {
    status('Earnings ' + symbol + '\u2026');
    try {
      var data = await fhGet('/stock/earnings?symbol=' + encodeURIComponent(symbol));
      status('');
      if (!Array.isArray(data)) return [];
      return data.slice(0, 8).map(function(e) {
        return {
          period: e.period || '',
          actual: e.actual,
          estimate: e.estimate,
          surprise: e.surprise,
          surprisePct: e.surprisePercent,
        };
      });
    } catch (e) {
      status('');
      throw e;
    }
  }

  /** Upcoming earnings calendar — returns {date, epsEstimate, revenueEstimate, quarter, year} or null */
  async function getEarningsCalendar(symbol) {
    status('Earnings calendar ' + symbol + '\u2026');
    var from = new Date().toISOString().slice(0, 10);
    var toDate = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    try {
      var data = await fhGet('/calendar/earnings?from=' + from + '&to=' + toDate + '&symbol=' + encodeURIComponent(symbol));
      status('');
      if (!data || !data.earningsCalendar || !data.earningsCalendar.length) return null;
      var e = data.earningsCalendar[0];
      return {
        date: e.date || '',
        epsEstimate: e.epsEstimate,
        revenueEstimate: e.revenueEstimate,
        quarter: e.quarter,
        year: e.year,
      };
    } catch (err) {
      status('');
      console.warn('Earnings calendar error:', err.message);
      return null;
    }
  }

  /**
   * Compute PE history from basic financials annual series.
   * Uses the 'pe' series if available, otherwise tries to derive from eps + price data.
   * Returns [{date, pe}] sorted chronologically.
   */
  function computePEHistory(annualSeries) {
    // Try direct PE series first
    if (annualSeries.pe && annualSeries.pe.length > 0) {
      return annualSeries.pe
        .filter(p => p.v != null && p.v > 0 && p.v < 500)
        .map(p => ({ date: p.period, pe: p.v }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }
    // Try peNormalized
    if (annualSeries.peNormalized && annualSeries.peNormalized.length > 0) {
      return annualSeries.peNormalized
        .filter(p => p.v != null && p.v > 0 && p.v < 500)
        .map(p => ({ date: p.period, pe: p.v }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }
    // Try peBasicExclExtraTTM
    if (annualSeries.peBasicExclExtraTTM && annualSeries.peBasicExclExtraTTM.length > 0) {
      return annualSeries.peBasicExclExtraTTM
        .filter(p => p.v != null && p.v > 0 && p.v < 500)
        .map(p => ({ date: p.period, pe: p.v }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }
    return [];
  }

  /** Analyst recommendations — returns [{period, buy, hold, sell, strongBuy, strongSell}] */
  async function getRecommendations(symbol) {
    status('Recommendations ' + symbol + '\u2026');
    try {
      const data = await fhGet('/stock/recommendation?symbol=' + encodeURIComponent(symbol));
      status('');
      if (!Array.isArray(data)) return [];
      return data.slice(0, 6);
    } catch (e) {
      status('');
      throw e;
    }
  }

  /** Analyst upgrades/downgrades (last 30 days) — returns [{gradeDate, company, fromGrade, toGrade, action}] */
  async function getUpgradeDowngrade(symbol) {
    status('Analyst ratings ' + symbol + '\u2026');
    try {
      var to = new Date().toISOString().slice(0, 10);
      var from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      var data = await fhGet('/stock/upgrade-downgrade?symbol=' + encodeURIComponent(symbol) + '&from=' + from + '&to=' + to);
      status('');
      if (!Array.isArray(data)) return [];
      return data.slice(0, 20).map(function(d) {
        return {
          date: d.gradeDate || '',
          company: d.company || 'Unknown',
          fromGrade: d.fromGrade || '',
          toGrade: d.toGrade || '',
          action: d.action || '',
        };
      });
    } catch (e) {
      status('');
      console.warn('Upgrade/downgrade endpoint (premium): ' + e.message);
      return [];
    }
  }

  /**
   * Historical price chart data via Yahoo Finance (free, via CORS proxy fallback chain).
   * range: '1d','5d','1mo','3mo','6mo','1y','5y','10y'
   * Returns [{date, close}] sorted chronologically.
   */
  const RANGE_INTERVAL = {
    '1d': '5m', '5d': '15m', '1mo': '1d', '3mo': '1d',
    '6mo': '1d', '1y': '1wk', '5y': '1mo', '10y': '1mo',
  };

  // Multiple CORS proxies — tries each in order until one works
  const PROXIES = [
    function(url) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url); },
    function(url) { return 'https://api.cors.lol/?url=' + encodeURIComponent(url); },
    function(url) { return 'https://corsproxy.io/?' + encodeURIComponent(url); },
  ];

  async function fetchViaProxy(targetUrl) {
    var lastErr = null;
    for (var i = 0; i < PROXIES.length; i++) {
      try {
        var proxyUrl = PROXIES[i](targetUrl);
        var controller = new AbortController();
        var timeoutId = setTimeout(function() { controller.abort(); }, 15000);
        var res = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) return res;
        lastErr = new Error('Proxy HTTP ' + res.status);
      } catch (e) {
        if (e.name === 'AbortError') lastErr = new Error('Proxy request timed out');
        else lastErr = e;
      }
    }
    throw lastErr || new Error('All CORS proxies failed. Try again later.');
  }

  async function getChartData(symbol, range) {
    range = range || '1y';
    var interval = RANGE_INTERVAL[range] || '1d';
    status('Chart ' + symbol + ' (' + range + ')\u2026');
    var yUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/'
      + encodeURIComponent(symbol)
      + '?range=' + range + '&interval=' + interval + '&includePrePost=false';
    var res = await fetchViaProxy(yUrl);
    var json = await res.json();
    status('');
    // allorigins may wrap in {contents: "..."} — handle that
    if (json.contents && typeof json.contents === 'string') {
      json = JSON.parse(json.contents);
    }
    var result = json.chart && json.chart.result && json.chart.result[0];
    if (!result || !result.timestamp) throw new Error('No chart data for ' + symbol);
    var timestamps = result.timestamp;
    var closes = result.indicators.quote[0].close;
    var points = [];
    for (var i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) {
        var d = new Date(timestamps[i] * 1000);
        var label;
        if (range === '1d' || range === '5d') {
          label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (range === '1mo' || range === '3mo') {
          label = (d.getMonth() + 1) + '/' + d.getDate();
        } else {
          label = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        }
        points.push({ date: label, close: closes[i] });
      }
    }
    return points;
  }

  /** General / macro market news — returns [{title, url, publisher, date, summary}] */
  async function getMarketNews() {
    status('Macro news\u2026');
    try {
      var data = await fhGet('/news?category=general');
      status('');
      if (!Array.isArray(data)) return [];
      return data.slice(0, 20).map(function(a) {
        return {
          title: a.headline || 'Untitled',
          url: a.url || '#',
          publisher: a.source || 'Unknown',
          date: a.datetime ? new Date(a.datetime * 1000).toLocaleDateString() : '',
          summary: a.summary || '',
        };
      });
    } catch (e) {
      status('');
      throw e;
    }
  }

  /** Peer companies — returns [symbol, symbol, ...] */
  async function getPeers(symbol) {
    status('Peers ' + symbol + '\u2026');
    try {
      var data = await fhGet('/stock/peers?symbol=' + encodeURIComponent(symbol));
      status('');
      if (!Array.isArray(data)) return [];
      return data.filter(function(s) { return s !== symbol; }).slice(0, 5);
    } catch (e) {
      status('');
      throw e;
    }
  }

  /** Insider transactions — returns [{name, share, change, filingDate, transactionDate, code, price}] */
  async function getInsiderTransactions(symbol) {
    status('Insider trades ' + symbol + '\u2026');
    try {
      var data = await fhGet('/stock/insider-transactions?symbol=' + encodeURIComponent(symbol));
      status('');
      if (!data || !data.data || !Array.isArray(data.data)) return [];
      return data.data.slice(0, 30).map(function(t) {
        return {
          name: t.name || 'Unknown',
          share: t.share || 0,
          change: t.change || 0,
          filingDate: t.filingDate || '',
          transactionDate: t.transactionDate || '',
          code: t.transactionCode || '',
          price: t.transactionPrice || null,
        };
      });
    } catch (e) {
      status('');
      throw e;
    }
  }

  /** ETF holdings — returns {symbol, atDate, holdings: [{symbol, name, percent, value, share}]} */
  async function getETFHoldings(symbol) {
    status('ETF holdings ' + symbol + '\u2026');
    try {
      var data = await fhGet('/etf/holdings?symbol=' + encodeURIComponent(symbol));
      status('');
      if (!data || !data.holdings || !Array.isArray(data.holdings)) return null;
      return {
        symbol: data.symbol || symbol,
        atDate: data.atDate || '',
        holdings: data.holdings.slice(0, 25).map(function(h) {
          return {
            symbol: h.symbol || '',
            name: h.name || '',
            percent: h.percent != null ? h.percent : null,
            value: h.value != null ? h.value : null,
            share: h.share != null ? h.share : null,
          };
        }),
      };
    } catch (e) {
      status('');
      console.warn('ETF holdings error:', e.message);
      return null;
    }
  }

  /** SEC EDGAR filings — returns [{date, type, title, url, accessionNo}] */
  async function getSECFilings(symbol) {
    status('SEC filings ' + symbol + '\u2026');
    try {
      var filings = [];

      // Primary: SEC EFTS full-text search API (CORS-friendly, JSON)
      try {
        var controller = new AbortController();
        var timeoutId = setTimeout(function() { controller.abort(); }, 12000);
        var res = await fetch('https://efts.sec.gov/LATEST/search-index?q=%22' + encodeURIComponent(symbol) + '%22&forms=10-K,10-Q,8-K', {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          var data = await res.json();
          var hits = (data.hits && data.hits.hits) ? data.hits.hits : [];
          hits.forEach(function(hit) {
            var src = hit._source || {};
            var form = src.form_type || '';
            if (form === '10-K' || form === '10-Q' || form === '8-K') {
              filings.push({
                date: src.file_date || '',
                type: form,
                title: form + (src.file_description ? ' \u2014 ' + src.file_description : ''),
                url: src.file_num ? 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=' + encodeURIComponent(symbol) + '&type=' + form + '&dateb=&owner=include&count=5&search_text=&action=getcompany' : '',
                accessionNo: src.adsh || '',
              });
            }
          });
        }
      } catch(e) { /* EFTS failed, try fallback */ }

      // Fallback: proxy-based EDGAR atom feed
      if (!filings.length) {
        var tickerUrl = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=&CIK=' + encodeURIComponent(symbol) + '&type=10-K%2C10-Q%2C8-K&dateb=&owner=include&count=15&search_text=&action=getcompany&output=atom';
        var proxyRes = await fetchViaProxy(tickerUrl);
        var text = await proxyRes.text();
        var parser = new DOMParser();
        var doc = parser.parseFromString(text, 'text/xml');
        if (!doc.querySelector('parsererror')) {
          doc.querySelectorAll('entry').forEach(function(entry) {
            var title = entry.querySelector('title') ? entry.querySelector('title').textContent : '';
            var link = entry.querySelector('link');
            var href = link ? link.getAttribute('href') : '';
            var updated = entry.querySelector('updated') ? entry.querySelector('updated').textContent : '';
            var typeMatch = title.match(/^(10-K|10-Q|8-K)/);
            if (typeMatch) {
              filings.push({
                date: updated ? updated.slice(0, 10) : '',
                type: typeMatch[1],
                title: title,
                url: href.indexOf('http') === 0 ? href : 'https://www.sec.gov' + href,
              });
            }
          });
        }
      }

      status('');
      if (!filings.length) throw new Error('No SEC filings found for ' + symbol + '. Try a US-listed stock.');
      return filings.slice(0, 15);
    } catch (e) {
      status('');
      throw e;
    }
  }

  /** EPS Estimates — returns {annual: [{period, avg, high, low, numAnalysts}], quarterly: [...]} */
  async function getEPSEstimates(symbol) {
    status('EPS estimates ' + symbol + '\u2026');
    try {
      var data = await fhGet('/stock/eps-estimate?symbol=' + encodeURIComponent(symbol) + '&freq=quarterly');
      status('');
      if (!data || !data.data || !Array.isArray(data.data)) return null;
      var quarterly = data.data.slice(0, 8).map(function(e) {
        return {
          period: e.period || '',
          avg: e.epsAvg != null ? e.epsAvg : null,
          high: e.epsHigh != null ? e.epsHigh : null,
          low: e.epsLow != null ? e.epsLow : null,
          numAnalysts: e.numberAnalysts || 0,
        };
      });
      return { quarterly: quarterly };
    } catch (e) {
      status('');
      console.warn('EPS estimates error:', e.message);
      return null;
    }
  }

  return {
    getKey, setKey, hasKey, onStatus,
    searchTicker, getQuote, getProfile, getBasicFinancials,
    getNews, getEarnings, computePEHistory, getRecommendations,
    getUpgradeDowngrade, getChartData, getMarketNews, getEarningsCalendar,
    getPeers, getInsiderTransactions, getETFHoldings, getSECFilings,
    getEPSEstimates, getFHCallsInLastMinute,
  };
})();
