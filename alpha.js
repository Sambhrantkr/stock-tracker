/**
 * Alpha Vantage API — complements Finnhub for premium data on free tier
 * Free: 25 requests/day. Get key at: https://www.alphavantage.co/support/#api-key
 * Used for: Earnings call transcripts, news sentiment, company overview
 */
var AlphaAPI = (function() {
  var BASE = 'https://www.alphavantage.co/query';

  function getKey() { return (typeof Auth !== 'undefined' && Auth.isLoggedIn()) ? (Auth.getItem('av_api_key') || '') : (localStorage.getItem('av_api_key') || ''); }
  function setKey(key) { if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) Auth.setItem('av_api_key', key.trim()); else localStorage.setItem('av_api_key', key.trim()); }
  function hasKey() { return getKey().length > 0; }

  // ── Second AV key (different account, doubles daily limit) ──
  function getKey2() { return (typeof Auth !== 'undefined' && Auth.isLoggedIn()) ? (Auth.getItem('av_api_key_2') || '') : (localStorage.getItem('av_api_key_2') || ''); }
  function setKey2(key) { if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) Auth.setItem('av_api_key_2', key.trim()); else localStorage.setItem('av_api_key_2', key.trim()); }
  function hasKey2() { return getKey2().length > 0; }

  // --- AV daily call tracking — per-key (25 calls/day each, resets midnight EST) ---
  var AV_DAILY_LIMIT_PER_KEY = 25;

  function getESTDate() {
    // Alpha Vantage resets at midnight US Eastern Time
    var now = new Date();
    // toLocaleString with timeZone gives us the EST/EDT date
    var estStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    var estDate = new Date(estStr);
    var y = estDate.getFullYear();
    var m = String(estDate.getMonth() + 1).padStart(2, '0');
    var d = String(estDate.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  // One-time migration: convert old single-counter {date,count} to per-key {date,key1,key2}
  (function migrateCallLog() {
    try {
      // Migrate both localStorage and Auth storage
      var sources = [
        { get: function() { return localStorage.getItem('av_call_log'); }, set: function(v) { localStorage.setItem('av_call_log', v); } }
      ];
      if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
        sources.push({ get: function() { return Auth.getItem('av_call_log'); }, set: function(v) { Auth.setItem('av_call_log', v); } });
      }
      sources.forEach(function(src) {
        var raw = src.get();
        if (!raw) return;
        var log = JSON.parse(raw);
        if (!log || !log.date) return;
        if (log.count !== undefined && log.key1 === undefined) {
          var newLog = { date: log.date, key1: log.count || 0, key2: 0 };
          src.set(JSON.stringify(newLog));
          console.log('[AV] Migrated call log: key1=' + newLog.key1 + ' (key2 ready)');
        }
      });
    } catch(e) {}
  })();

  function _getCallLog() {
    var raw = (typeof Auth !== 'undefined' && Auth.isLoggedIn()) ? Auth.getItem('av_call_log') : localStorage.getItem('av_call_log');
    if (!raw) return { date: '', key1: 0, key2: 0 };
    try { var d = JSON.parse(raw); return d && d.date ? { date: d.date, key1: d.key1 || 0, key2: d.key2 || 0 } : { date: '', key1: 0, key2: 0 }; }
    catch(e) { return { date: '', key1: 0, key2: 0 }; }
  }
  function _saveCallLog(log) {
    var s = JSON.stringify(log);
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) Auth.setItem('av_call_log', s);
    else localStorage.setItem('av_call_log', s);
  }
  function _todayLog() {
    var today = getESTDate();
    var log = _getCallLog();
    if (log.date !== today) return { date: today, key1: 0, key2: 0 };
    return log;
  }

  /** Pick the active key: use key1 until exhausted, then key2 */
  function _pickAVKey() {
    var log = _todayLog();
    if (log.key1 < AV_DAILY_LIMIT_PER_KEY) return 1;
    if (hasKey2() && log.key2 < AV_DAILY_LIMIT_PER_KEY) return 2;
    return 0; // both exhausted
  }

  function trackAVCall(keyNum) {
    var log = _todayLog();
    if (keyNum === 2) log.key2++;
    else log.key1++;
    _saveCallLog(log);
  }

  function getAVCallsRemaining() {
    var log = _todayLog();
    var rem1 = Math.max(0, AV_DAILY_LIMIT_PER_KEY - log.key1);
    var rem2 = hasKey2() ? Math.max(0, AV_DAILY_LIMIT_PER_KEY - log.key2) : 0;
    return rem1 + rem2;
  }

  // ── Persistent localStorage cache for quarterly data (30-day TTL) ──
  // Financial statements only change quarterly, so caching saves precious AV calls.
  var AV_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  function _cacheKey(symbol, fn) { return 'av_cache_' + symbol + '_' + fn; }

  function _cacheGet(symbol, fn) {
    try {
      var raw = localStorage.getItem(_cacheKey(symbol, fn));
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (!entry || !entry.ts || !entry.data) return null;
      if (Date.now() - entry.ts > AV_CACHE_TTL_MS) {
        localStorage.removeItem(_cacheKey(symbol, fn));
        return null;
      }
      return entry.data;
    } catch(e) { return null; }
  }

  function _cacheSet(symbol, fn, data) {
    try {
      localStorage.setItem(_cacheKey(symbol, fn), JSON.stringify({ ts: Date.now(), data: data }));
    } catch(e) { /* storage full — ignore */ }
  }

  function avGet(params) {
    var keyNum = _pickAVKey();
    if (keyNum === 0) {
      var total = hasKey2() ? '50' : '25';
      return Promise.reject(new Error('Alpha Vantage daily limit reached (' + total + '/day). Resets tomorrow.'));
    }
    var apiKey = keyNum === 2 ? getKey2() : getKey();
    trackAVCall(keyNum);
    console.log('[AV] Using key ' + keyNum + ' (' + getAVCallsRemaining() + ' calls remaining)');
    var url = BASE + '?' + params + '&apikey=' + apiKey;
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, 20000);
    return fetch(url, { signal: controller.signal }).then(function(res) {
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error('Alpha Vantage HTTP ' + res.status);
      return res.text().then(function(text) {
        try { return JSON.parse(text); }
        catch (e) { throw new Error('Alpha Vantage returned invalid/truncated response. Try again.'); }
      });
    }).then(function(data) {
      if (data['Note']) throw new Error('Alpha Vantage rate limit (25/day). Try again tomorrow.');
      if (data['Error Message']) throw new Error('Alpha Vantage: ' + data['Error Message']);
      if (data['Information']) {
        if (data['Information'].indexOf('rate limit') !== -1 || data['Information'].indexOf('call frequency') !== -1) {
          throw new Error('Alpha Vantage rate limit (25/day). Try again tomorrow.');
        }
        if (data['Information'].indexOf('Thank you') !== -1 || data['Information'].indexOf('premium') !== -1) {
          throw new Error('Alpha Vantage: ' + data['Information'].substring(0, 120));
        }
      }
      return data;
    }).catch(function(e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') throw new Error('Alpha Vantage request timed out.');
      if (e.message && e.message.indexOf('Alpha Vantage') !== -1) throw e;
      throw new Error('Network error reaching Alpha Vantage: ' + (e.message || 'Check your connection.'));
    });
  }

  /**
   * Earnings call transcript for a specific quarter.
   * quarter format: "2024Q1", "2024Q2", etc.
   * Returns: { symbol, quarter, transcript: [{speaker, text, sentiment, sentimentScore}] }
   */
  async function getEarningsTranscript(symbol, quarter) {
    if (!hasKey()) return null;
    var cached = _cacheGet(symbol, 'transcript_' + quarter);
    if (cached) { console.log('[AV] Cache hit: transcript/' + symbol + '/' + quarter); return cached; }
    try {
      var data = await avGet('function=EARNINGS_CALL_TRANSCRIPT&symbol=' + encodeURIComponent(symbol) + '&quarter=' + encodeURIComponent(quarter));
      if (!data || !data.transcript || !data.transcript.length) return null;
      var result = {
        symbol: data.symbol || symbol,
        quarter: data.quarter || quarter,
        transcript: data.transcript.map(function(t) {
          return {
            speaker: t.speaker || 'Unknown',
            text: t.text || '',
            sentiment: t.sentiment || null,
            sentimentScore: t.sentiment_score != null ? parseFloat(t.sentiment_score) : null,
          };
        }),
      };
      _cacheSet(symbol, 'transcript_' + quarter, result);
      return result;
    } catch (e) {
      console.warn('AV transcript error:', e.message);
      return null;
    }
  }


  /**
   * Determine the most recent earnings quarter string (e.g. "2025Q4").
   * Uses earnings data from Finnhub to find the latest period.
   * Falls back to estimating from current date.
   */
  function guessLatestQuarter(earnings) {
    if (earnings && earnings.length && earnings[0].period) {
      // earnings[0].period is like "2025-03-31"
      var d = new Date(earnings[0].period);
      var y = d.getFullYear();
      var m = d.getMonth() + 1;
      var q;
      if (m <= 3) q = 1;
      else if (m <= 6) q = 2;
      else if (m <= 9) q = 3;
      else q = 4;
      return y + 'Q' + q;
    }
    // Fallback: estimate from current date minus ~45 days (most recent reported quarter)
    var now = new Date(Date.now() - 45 * 86400000);
    var yr = now.getFullYear();
    var mo = now.getMonth() + 1;
    var qtr;
    if (mo <= 3) qtr = 1;
    else if (mo <= 6) qtr = 2;
    else if (mo <= 9) qtr = 3;
    else qtr = 4;
    return yr + 'Q' + qtr;
  }

  /**
   * News sentiment for a ticker.
   * Returns: [{title, url, source, publishedAt, summary, overallSentiment, sentimentScore, tickerSentiment}]
   */
  async function getNewsSentiment(symbol) {
    if (!hasKey()) return [];
    try {
      var data = await avGet('function=NEWS_SENTIMENT&tickers=' + encodeURIComponent(symbol) + '&limit=15&sort=LATEST');
      if (!data || !data.feed || !data.feed.length) return [];
      return data.feed.slice(0, 15).map(function(a) {
        var tickerData = null;
        if (a.ticker_sentiment) {
          tickerData = a.ticker_sentiment.find(function(ts) {
            return ts.ticker === symbol;
          });
        }
        return {
          title: a.title || '',
          url: a.url || '#',
          source: a.source || 'Unknown',
          publishedAt: a.time_published || '',
          summary: a.summary || '',
          overallSentiment: a.overall_sentiment_label || 'Neutral',
          sentimentScore: a.overall_sentiment_score != null ? parseFloat(a.overall_sentiment_score) : 0,
          tickerSentiment: tickerData ? {
            label: tickerData.ticker_sentiment_label || 'Neutral',
            score: parseFloat(tickerData.ticker_sentiment_score || 0),
            relevance: parseFloat(tickerData.relevance_score || 0),
          } : null,
        };
      });
    } catch (e) {
      console.warn('AV news sentiment error:', e.message);
      return [];
    }
  }

  /**
   * Company overview — rich KPIs not available in Finnhub free tier.
   * Returns object with many fields like PERatio, ForwardPE, PriceToBookRatio, etc.
   */
  async function getOverview(symbol) {
    if (!hasKey()) return null;
    var cached = _cacheGet(symbol, 'overview');
    if (cached) { console.log('[AV] Cache hit: overview/' + symbol); return cached; }
    try {
      var data = await avGet('function=OVERVIEW&symbol=' + encodeURIComponent(symbol));
      if (!data || !data.Symbol) return null;
      _cacheSet(symbol, 'overview', data);
      return data;
    } catch (e) {
      console.warn('AV overview error:', e.message);
      return null;
    }
  }

  /**
   * Quarterly income statement — revenue & net income trend.
   * Returns: [{fiscalDateEnding, totalRevenue, netIncome, grossProfit, operatingIncome}]
   */
  async function getIncomeStatement(symbol) {
    if (!hasKey()) return [];
    var cached = _cacheGet(symbol, 'income');
    if (cached) { console.log('[AV] Cache hit: income/' + symbol); return cached; }
    try {
      var data = await avGet('function=INCOME_STATEMENT&symbol=' + encodeURIComponent(symbol));
      if (!data) return [];
      // Try quarterly first, fall back to annual
      var reports = null;
      var isAnnual = false;
      if (data.quarterlyReports && data.quarterlyReports.length) {
        reports = data.quarterlyReports.slice(0, 12);
      } else if (data.annualReports && data.annualReports.length) {
        reports = data.annualReports.slice(0, 8);
        isAnnual = true;
      }
      if (!reports || !reports.length) return [];
      var result = reports.map(function(r) {
        return {
          date: r.fiscalDateEnding || '',
          revenue: r.totalRevenue && r.totalRevenue !== 'None' ? parseFloat(r.totalRevenue) : null,
          netIncome: r.netIncome && r.netIncome !== 'None' ? parseFloat(r.netIncome) : null,
          grossProfit: r.grossProfit && r.grossProfit !== 'None' ? parseFloat(r.grossProfit) : null,
          operatingIncome: r.operatingIncome && r.operatingIncome !== 'None' ? parseFloat(r.operatingIncome) : null,
          isAnnual: isAnnual,
        };
      });
      _cacheSet(symbol, 'income', result);
      return result;
    } catch (e) {
      console.warn('AV income statement error:', e.message);
      if (e.message && (e.message.indexOf('rate limit') !== -1 || e.message.indexOf('daily limit') !== -1)) throw e;
      return [];
    }
  }

  /**
   * RSI (Relative Strength Index) — daily, 14-period.
   * Returns: [{date, rsi}] last 30 data points
   */
  async function getRSI(symbol) {
    if (!hasKey()) return [];
    try {
      var data = await avGet('function=RSI&symbol=' + encodeURIComponent(symbol) + '&interval=daily&time_period=14&series_type=close');
      if (!data || !data['Technical Analysis: RSI']) return [];
      var raw = data['Technical Analysis: RSI'];
      var dates = Object.keys(raw).sort().reverse().slice(0, 30);
      return dates.map(function(d) { return { date: d, rsi: parseFloat(raw[d].RSI) }; });
    } catch (e) { console.warn('AV RSI error:', e.message); return []; }
  }

  /**
   * MACD — daily, 12/26/9.
   * Returns: [{date, macd, signal, histogram}] last 30 data points
   */
  async function getMACD(symbol) {
    if (!hasKey()) return [];
    try {
      var data = await avGet('function=MACD&symbol=' + encodeURIComponent(symbol) + '&interval=daily&series_type=close');
      if (!data || !data['Technical Analysis: MACD']) return [];
      var raw = data['Technical Analysis: MACD'];
      var dates = Object.keys(raw).sort().reverse().slice(0, 30);
      return dates.map(function(d) {
        return {
          date: d,
          macd: parseFloat(raw[d].MACD),
          signal: parseFloat(raw[d].MACD_Signal),
          histogram: parseFloat(raw[d].MACD_Hist),
        };
      });
    } catch (e) { console.warn('AV MACD error:', e.message); return []; }
  }

  /**
   * SMA (Simple Moving Average) — daily.
   * Returns: [{date, sma}] last 30 data points
   */
  async function getSMA(symbol, period) {
    if (!hasKey()) return [];
    try {
      var data = await avGet('function=SMA&symbol=' + encodeURIComponent(symbol) + '&interval=daily&time_period=' + (period || 50) + '&series_type=close');
      if (!data || !data['Technical Analysis: SMA']) return [];
      var raw = data['Technical Analysis: SMA'];
      var dates = Object.keys(raw).sort().reverse().slice(0, 30);
      return dates.map(function(d) { return { date: d, sma: parseFloat(raw[d].SMA) }; });
    } catch (e) { console.warn('AV SMA error:', e.message); return []; }
  }

  /** Cash Flow Statement — quarterly, returns [{date, operatingCashFlow, capitalExpenditure, freeCashFlow, dividendPayout}] */
  async function getCashFlow(symbol) {
    if (!hasKey()) return [];
    var cached = _cacheGet(symbol, 'cashflow');
    if (cached) { console.log('[AV] Cache hit: cashflow/' + symbol); return cached; }
    try {
      var data = await avGet('function=CASH_FLOW&symbol=' + encodeURIComponent(symbol));
      var reports = data.quarterlyReports || data.annualReports || [];
      if (!reports || !reports.length) return [];
      var result = reports.slice(0, 12).map(function(r) {
        var ocf = r.operatingCashflow && r.operatingCashflow !== 'None' ? parseFloat(r.operatingCashflow) : null;
        var capex = r.capitalExpenditures && r.capitalExpenditures !== 'None' ? parseFloat(r.capitalExpenditures) : null;
        var fcf = (ocf !== null && capex !== null) ? ocf - capex : null;
        return {
          date: r.fiscalDateEnding || '',
          operatingCashFlow: ocf,
          capitalExpenditure: capex,
          freeCashFlow: fcf,
          dividendPayout: r.dividendPayout && r.dividendPayout !== 'None' ? parseFloat(r.dividendPayout) : null,
          netIncome: r.netIncome && r.netIncome !== 'None' ? parseFloat(r.netIncome) : null,
        };
      });
      _cacheSet(symbol, 'cashflow', result);
      return result;
    } catch (e) {
      console.warn('AV Cash Flow error:', e.message);
      if (e.message && (e.message.indexOf('rate limit') !== -1 || e.message.indexOf('daily limit') !== -1)) throw e;
      return [];
    }
  }

  /** Balance Sheet — quarterly, returns [{date, totalAssets, totalLiabilities, totalDebt, cash, bookValue, sharesOutstanding}] */
  async function getBalanceSheet(symbol) {
    if (!hasKey()) return [];
    var cached = _cacheGet(symbol, 'balancesheet');
    if (cached) { console.log('[AV] Cache hit: balancesheet/' + symbol); return cached; }
    try {
      var data = await avGet('function=BALANCE_SHEET&symbol=' + encodeURIComponent(symbol));
      var reports = data.quarterlyReports || data.annualReports || [];
      if (!reports || !reports.length) return [];
      var result = reports.slice(0, 8).map(function(r) {
        var assets = r.totalAssets && r.totalAssets !== 'None' ? parseFloat(r.totalAssets) : null;
        var liabilities = r.totalLiabilities && r.totalLiabilities !== 'None' ? parseFloat(r.totalLiabilities) : null;
        return {
          date: r.fiscalDateEnding || '',
          totalAssets: assets,
          totalLiabilities: liabilities,
          totalDebt: r.shortLongTermDebtTotal && r.shortLongTermDebtTotal !== 'None' ? parseFloat(r.shortLongTermDebtTotal) : (r.longTermDebt && r.longTermDebt !== 'None' ? parseFloat(r.longTermDebt) : null),
          cash: r.cashAndCashEquivalentsAtCarryingValue && r.cashAndCashEquivalentsAtCarryingValue !== 'None' ? parseFloat(r.cashAndCashEquivalentsAtCarryingValue) : (r.cashAndShortTermInvestments && r.cashAndShortTermInvestments !== 'None' ? parseFloat(r.cashAndShortTermInvestments) : null),
          bookValue: (assets !== null && liabilities !== null) ? assets - liabilities : null,
          sharesOutstanding: r.commonStockSharesOutstanding && r.commonStockSharesOutstanding !== 'None' ? parseFloat(r.commonStockSharesOutstanding) : null,
        };
      });
      _cacheSet(symbol, 'balancesheet', result);
      return result;
    } catch (e) {
      console.warn('AV Balance Sheet error:', e.message);
      if (e.message && (e.message.indexOf('rate limit') !== -1 || e.message.indexOf('daily limit') !== -1)) throw e;
      return [];
    }
  }

  return {
    getKey: getKey,
    setKey: setKey,
    hasKey: hasKey,
    getKey2: getKey2,
    setKey2: setKey2,
    hasKey2: hasKey2,
    getAVCallsRemaining: getAVCallsRemaining,
    getEarningsTranscript: getEarningsTranscript,
    guessLatestQuarter: guessLatestQuarter,
    getNewsSentiment: getNewsSentiment,
    getOverview: getOverview,
    getIncomeStatement: getIncomeStatement,
    getRSI: getRSI,
    getMACD: getMACD,
    getSMA: getSMA,
    getCashFlow: getCashFlow,
    getBalanceSheet: getBalanceSheet,
  };
})();
