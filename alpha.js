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

  function avGet(params) {
    var url = BASE + '?' + params + '&apikey=' + getKey();
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, 20000);
    return fetch(url, { signal: controller.signal }).then(function(res) {
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error('Alpha Vantage HTTP ' + res.status);
      return res.json();
    }).then(function(data) {
      if (data['Note']) throw new Error('Alpha Vantage rate limit (25/day). Try again tomorrow.');
      if (data['Error Message']) throw new Error('Alpha Vantage: ' + data['Error Message']);
      if (data['Information'] && data['Information'].indexOf('rate limit') !== -1) throw new Error('Alpha Vantage rate limit (25/day). Try again tomorrow.');
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
    try {
      var data = await avGet('function=EARNINGS_CALL_TRANSCRIPT&symbol=' + encodeURIComponent(symbol) + '&quarter=' + encodeURIComponent(quarter));
      if (!data || !data.transcript || !data.transcript.length) return null;
      return {
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
    try {
      var data = await avGet('function=OVERVIEW&symbol=' + encodeURIComponent(symbol));
      if (!data || !data.Symbol) return null;
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
      return reports.map(function(r) {
        return {
          date: r.fiscalDateEnding || '',
          revenue: r.totalRevenue && r.totalRevenue !== 'None' ? parseFloat(r.totalRevenue) : null,
          netIncome: r.netIncome && r.netIncome !== 'None' ? parseFloat(r.netIncome) : null,
          grossProfit: r.grossProfit && r.grossProfit !== 'None' ? parseFloat(r.grossProfit) : null,
          operatingIncome: r.operatingIncome && r.operatingIncome !== 'None' ? parseFloat(r.operatingIncome) : null,
          isAnnual: isAnnual,
        };
      });
    } catch (e) {
      console.warn('AV income statement error:', e.message);
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

  return {
    getKey: getKey,
    setKey: setKey,
    hasKey: hasKey,
    getEarningsTranscript: getEarningsTranscript,
    guessLatestQuarter: guessLatestQuarter,
    getNewsSentiment: getNewsSentiment,
    getOverview: getOverview,
    getIncomeStatement: getIncomeStatement,
    getRSI: getRSI,
    getMACD: getMACD,
    getSMA: getSMA,
  };
})();
