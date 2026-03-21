/**
 * AI News Analysis using Groq (free tier, 14,400 req/day)
 * Uses Llama model for fast inference
 * Get your free key at: https://console.groq.com/keys
 */
const NewsAI = (() => {
  const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const MODEL = 'llama-3.1-8b-instant';
  const MODEL_DEEP = 'llama-3.3-70b-versatile';

  function getKey() { return (typeof Auth !== 'undefined' && Auth.isLoggedIn()) ? (Auth.getItem('groq_api_key') || '') : (localStorage.getItem('groq_api_key') || ''); }
  function setKey(key) { if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) Auth.setItem('groq_api_key', key.trim()); else localStorage.setItem('groq_api_key', key.trim()); }
  function hasKey() { return getKey().length > 0; }

  /** Groq fetch with auto-retry on 429 rate limit. opts: { model, timeoutMs } */
  async function groqFetch(messages, maxTokens, temperature, opts) {
    var useModel = (opts && opts.model) || MODEL;
    var useTimeout = (opts && opts.timeoutMs) || 30000;
    var retries = 5;
    var waitMs = 5000;
    for (var attempt = 0; attempt < retries; attempt++) {
      var res;
      try {
        var controller = new AbortController();
        var timeoutId = setTimeout(function() { controller.abort(); }, useTimeout);
        res = await fetch(GROQ_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + getKey(),
          },
          body: JSON.stringify({
            model: useModel,
            messages: messages,
            temperature: temperature || 0.3,
            max_tokens: maxTokens || 800,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (e) {
        if (e.name === 'AbortError') {
          if (attempt < retries - 1) { await new Promise(function(r) { setTimeout(r, 3000); }); continue; }
          throw new Error('AI request timed out. Try again.');
        }
        if (attempt < retries - 1) { await new Promise(function(r) { setTimeout(r, 2000); }); continue; }
        throw new Error('Network error reaching Groq AI: ' + (e.message || 'Check your connection.'));
      }
      if (res.status === 429 && attempt < retries - 1) {
        var retryAfter = res.headers.get('retry-after');
        var retryMs = retryAfter ? (parseFloat(retryAfter) * 1000 + 500) : waitMs;
        await new Promise(function(r) { setTimeout(r, retryMs); });
        waitMs = Math.min(waitMs * 2, 30000);
        continue;
      }
      if (res.status === 429) throw new Error('AI rate limited. Wait 30 seconds and try again.');
      if (res.status === 401) throw new Error('Invalid Groq API key. Check Settings.');
      if (!res.ok) throw new Error('AI error: HTTP ' + res.status);
      var data;
      try {
        data = await res.json();
      } catch (e) {
        if (attempt < retries - 1) { await new Promise(function(r) { setTimeout(r, 2000); }); continue; }
        throw new Error('AI returned invalid response. Try again.');
      }
      var content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      if (!content.trim()) {
        if (attempt < retries - 1) { await new Promise(function(r) { setTimeout(r, 2000); }); continue; }
        throw new Error('AI returned empty response. Try again.');
      }
      var cleaned = content.trim();
      if (cleaned.indexOf('```') === 0) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      try {
        return JSON.parse(cleaned);
      } catch (e) {
        if (attempt < retries - 1) {
          await new Promise(function(r) { setTimeout(r, 2000); });
          continue;
        }
        throw new Error('AI returned invalid JSON format. Try again.');
      }
    }
  }

  /**
   * Analyze news articles for a stock
   */
  async function analyzeNews(symbol, companyName, articles, kpis) {
    if (!hasKey()) throw new Error('Groq API key required for AI analysis.');
    if (!articles || !articles.length) throw new Error('No news to analyze.');

    var newsList = '';
    articles.forEach(function(a, i) {
      newsList += (i + 1) + '. "' + a.title + '" (' + a.publisher + ', ' + a.date + ')';
      if (a.summary) newsList += '\n   ' + a.summary;
      newsList += '\n';
    });

    var kpiContext = kpis ? 'Current KPIs: P/E=' + (kpis.peRatio || 'N/A') + ', EPS=' + (kpis.eps || 'N/A') + ', Market Cap=' + (kpis.marketCap || 'N/A') + ', 52W High=' + (kpis.week52High || 'N/A') + ', 52W Low=' + (kpis.week52Low || 'N/A') + ', Beta=' + (kpis.beta || 'N/A') + ', Div Yield=' + (kpis.dividendYield || 'N/A') : '';

    var prompt = 'You are a senior equity research analyst. Analyze these recent news articles for ' + symbol + ' (' + (companyName || symbol) + ') and provide a concise investment-focused analysis.\n\n' + kpiContext + '\n\nRecent News:\n' + newsList + '\n\nRespond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):\n{\n  "summary": "2-3 sentence summary of the overall news narrative and what it means for the company",\n  "longTermOutlook": "BULLISH" or "BEARISH" or "NEUTRAL",\n  "outlookReason": "1 sentence explaining the long-term valuation outlook",\n  "valuationImpact": [\n    {\n      "factor": "short label (e.g. Revenue Growth, Margin Pressure, Market Share)",\n      "direction": "POSITIVE" or "NEGATIVE" or "NEUTRAL",\n      "detail": "1 sentence on how this affects long-term valuation"\n    }\n  ],\n  "keyTriggers": [\n    {\n      "event": "specific event from the news",\n      "impact": "HIGH" or "MEDIUM" or "LOW",\n      "explanation": "1 sentence on why this could trigger a long-term valuation change"\n    }\n  ]\n}\n\nKeep valuationImpact to 2-4 items max. Keep keyTriggers to 1-3 items max. Be specific, not generic.';

    return groqFetch([{ role: 'user', content: prompt }], 800, 0.3);
  }

  /**
   * Analyze analyst upgrades/downgrades and recommendation trends.
   */
  async function analyzeAnalysts(symbol, companyName, recommendations, upgrades, kpis) {
    if (!hasKey()) throw new Error('Groq API key required for AI analysis.');
    if ((!recommendations || !recommendations.length) && (!upgrades || !upgrades.length)) {
      throw new Error('No analyst data to analyze.');
    }

    var recText = '';
    if (recommendations && recommendations.length) {
      recText = 'Recent recommendation trends (newest first):\n';
      recommendations.forEach(function(r, i) {
        recText += (i + 1) + '. Period: ' + r.period + ' — Strong Buy: ' + (r.strongBuy || 0) + ', Buy: ' + (r.buy || 0) + ', Hold: ' + (r.hold || 0) + ', Sell: ' + (r.sell || 0) + ', Strong Sell: ' + (r.strongSell || 0) + '\n';
      });
    }

    var upgradeText = '';
    if (upgrades && upgrades.length) {
      upgradeText = '\nRecent analyst upgrades/downgrades (last 30 days):\n';
      upgrades.forEach(function(u, i) {
        var arrow = u.fromGrade ? (u.fromGrade + ' -> ' + u.toGrade) : u.toGrade;
        upgradeText += (i + 1) + '. ' + u.date + ' — ' + u.company + ': ' + u.action + ' (' + arrow + ')\n';
      });
    }

    var kpiContext = kpis ? 'Current KPIs: P/E=' + (kpis.peRatio || 'N/A') + ', EPS=' + (kpis.eps || 'N/A') + ', 52W High=' + (kpis.week52High || 'N/A') + ', 52W Low=' + (kpis.week52Low || 'N/A') : '';

    var prompt = 'You are a senior equity research analyst. Analyze the following analyst activity for ' + symbol + ' (' + (companyName || symbol) + ') from the last 30 days and provide a concise summary.\n\n' + kpiContext + '\n\n' + recText + upgradeText + '\n\nRespond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):\n{\n  "summary": "2-3 sentence summary of what analysts are saying overall and the trend direction",\n  "consensus": "BULLISH" or "BEARISH" or "NEUTRAL",\n  "consensusReason": "1 sentence explaining the consensus view",\n  "keyTakeaways": [\n    {\n      "point": "short takeaway label",\n      "detail": "1 sentence explanation"\n    }\n  ]\n}\n\nKeep keyTakeaways to 2-4 items max. Be specific about which firms and what actions they took.';

    return groqFetch([{ role: 'user', content: prompt }], 600, 0.3);
  }

  /**
   * Analyze macro/economy news in the context of a specific stock.
   */
  async function analyzeMacro(symbol, companyName, macroArticles, kpis, sector) {
    if (!hasKey()) throw new Error('Groq API key required for AI analysis.');
    if (!macroArticles || !macroArticles.length) throw new Error('No macro news to analyze.');

    var newsList = '';
    macroArticles.forEach(function(a, i) {
      newsList += (i + 1) + '. "' + a.title + '" (' + a.publisher + ', ' + a.date + ')';
      if (a.summary) newsList += '\n   ' + a.summary;
      newsList += '\n';
    });

    var kpiContext = kpis ? 'Current KPIs: P/E=' + (kpis.peRatio || 'N/A') + ', EPS=' + (kpis.eps || 'N/A') + ', Beta=' + (kpis.beta || 'N/A') + ', Div Yield=' + (kpis.dividendYield || 'N/A') + ', 52W High=' + (kpis.week52High || 'N/A') + ', 52W Low=' + (kpis.week52Low || 'N/A') : '';
    var sectorStr = sector ? 'Sector: ' + sector : '';

    var prompt = 'You are a senior macro strategist. Analyze these recent macro/economy/market news headlines and explain their impact specifically on ' + symbol + ' (' + (companyName || symbol) + ').\n\n' + sectorStr + '\n' + kpiContext + '\n\nRecent Macro & Economy News:\n' + newsList + '\n\nRespond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):\n{\n  "summary": "2-3 sentence summary of the current macro environment and what it means specifically for ' + symbol + '",\n  "impact": "POSITIVE" or "NEGATIVE" or "MIXED",\n  "impactReason": "1 sentence on the overall macro impact on this stock",\n  "macroFactors": [\n    {\n      "factor": "short label (e.g. Interest Rates, Inflation, GDP, Trade Policy, Fed Policy)",\n      "direction": "TAILWIND" or "HEADWIND" or "NEUTRAL",\n      "detail": "1 sentence on how this macro factor affects ' + symbol + ' specifically"\n    }\n  ],\n  "risks": [\n    {\n      "risk": "specific macro risk",\n      "severity": "HIGH" or "MEDIUM" or "LOW",\n      "detail": "1 sentence on why this is a risk for ' + symbol + '"\n    }\n  ]\n}\n\nKeep macroFactors to 3-5 items. Keep risks to 2-3 items. Be specific to ' + symbol + ' and its sector, not generic.';

    return groqFetch([{ role: 'user', content: prompt }], 800, 0.3);
  }

  /**
   * Summarize the last earnings call using earnings data + earnings-related news.
   */
  async function summarizeTranscript(symbol, companyName, earnings, articles, kpis, avTranscript) {
    if (!hasKey()) throw new Error('Groq API key required for AI analysis.');

    var transcriptText = '';
    if (avTranscript && avTranscript.transcript && avTranscript.transcript.length) {
      transcriptText = '\nEarnings Call Transcript (' + avTranscript.quarter + '):\n';
      var charLimit = 5000;
      var chars = 0;
      for (var i = 0; i < avTranscript.transcript.length; i++) {
        var entry = avTranscript.transcript[i];
        var line = (entry.speaker || 'Speaker') + ': ' + (entry.text || '') + '\n';
        if (chars + line.length > charLimit) {
          transcriptText += '\n[... transcript truncated for length ...]\n';
          break;
        }
        transcriptText += line;
        chars += line.length;
      }
    }

    var earningsText = '';
    if (earnings && earnings.length) {
      earningsText = 'Recent quarterly earnings (newest first):\n';
      earnings.forEach(function(e, i) {
        var result = '';
        if (e.actual != null && e.estimate != null) {
          result = e.actual > e.estimate ? ' BEAT' : (e.actual < e.estimate ? ' MISS' : ' MET');
        }
        earningsText += (i + 1) + '. ' + e.period + ': Actual EPS $' + (e.actual != null ? e.actual.toFixed(2) : 'N/A') + ', Estimate $' + (e.estimate != null ? e.estimate.toFixed(2) : 'N/A');
        if (e.surprisePct != null) earningsText += ', Surprise ' + (e.surprisePct >= 0 ? '+' : '') + e.surprisePct.toFixed(1) + '%';
        earningsText += result + '\n';
      });
    }

    var newsText = '';
    if (!transcriptText && articles && articles.length) {
      var earningsKeywords = ['earning', 'quarter', 'revenue', 'profit', 'eps', 'guidance', 'outlook', 'forecast', 'results', 'beat', 'miss', 'report'];
      var earningsNews = articles.filter(function(a) {
        var text = ((a.title || '') + ' ' + (a.summary || '')).toLowerCase();
        return earningsKeywords.some(function(kw) { return text.indexOf(kw) !== -1; });
      });
      if (!earningsNews.length) earningsNews = articles.slice(0, 5);
      newsText = '\nEarnings-related news coverage:\n';
      earningsNews.slice(0, 8).forEach(function(a, i) {
        newsText += (i + 1) + '. "' + a.title + '" (' + a.publisher + ', ' + a.date + ')';
        if (a.summary) newsText += '\n   ' + a.summary;
        newsText += '\n';
      });
    }

    if (!earningsText && !transcriptText && !newsText) throw new Error('No earnings data to analyze.');

    var kpiContext = kpis ? 'Current KPIs: P/E=' + (kpis.peRatio || 'N/A') + ', EPS=' + (kpis.eps || 'N/A') + ', Revenue Growth=' + (kpis.revenueGrowth || 'N/A') + ', Profit Margin=' + (kpis.profitMargin || 'N/A') : '';

    var sourceNote = transcriptText ? 'Based on the actual earnings call transcript below' : 'Based on the following earnings data and news coverage';
    var prompt = 'You are a senior equity research analyst. ' + sourceNote + ', provide a comprehensive summary of ' + symbol + ' (' + (companyName || symbol) + ') most recent earnings results.\n\n' + kpiContext + '\n\n' + earningsText + transcriptText + newsText + '\n\nRespond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):\n{\n  "summary": "3-4 sentence executive summary covering key financial results, management outlook, and market reaction",\n  "sentiment": "POSITIVE" or "NEGATIVE" or "CAUTIOUS" or "CONFIDENT",\n  "sentimentReason": "1 sentence on the overall tone of the earnings results",\n  "keyHighlights": [\n    {\n      "topic": "short label (e.g. Revenue Beat, Margin Expansion, User Growth)",\n      "detail": "1-2 sentences on the key point"\n    }\n  ],\n  "guidance": [\n    {\n      "metric": "what metric (e.g. Revenue, EPS, Margins)",\n      "direction": "RAISED" or "LOWERED" or "MAINTAINED" or "INTRODUCED",\n      "detail": "1 sentence on the forward guidance"\n    }\n  ],\n  "risks": [\n    {\n      "risk": "risk or concern from the earnings",\n      "detail": "1 sentence explanation"\n    }\n  ]\n}\n\nKeep keyHighlights to 3-5 items. Keep guidance to 2-3 items. Keep risks to 2-3 items. Be specific about numbers.';

    return groqFetch([{ role: 'user', content: prompt }], 900, 0.3);
  }

  /**
   * Senior Analyst Verdict — aggregates ALL data into a final recommendation.
   * Uses system persona + structured briefing for deeper, more rigorous analysis.
   * Increased token budget (1500) and temperature (0.5) for nuanced reasoning.
   */
  async function generateVerdict(symbol, companyName, allData) {
    if (!hasKey()) throw new Error('Groq API key required.');

    // ── SYSTEM PERSONA ──
    var sysMsg = 'You are Marcus Chen, CFA, CMT — Managing Director and Head of Cross-Asset Equity Research.\n';
    sysMsg += 'Background: 25 years at Goldman Sachs, Morgan Stanley, and your own fund. You have covered every sector.\n';
    sysMsg += 'You are known on Wall Street for:\n';
    sysMsg += '- Calling inflection points 6-12 months before consensus (you spotted NVDA AI thesis in 2022, warned on SVB in late 2022)\n';
    sysMsg += '- Rigorous multi-factor analysis: you never rely on a single signal\n';
    sysMsg += '- Brutal honesty: you call overvalued stocks overvalued even when they are popular. You do not sugarcoat.\n';
    sysMsg += '- Quantitative grounding: every price target is backed by math (DCF, multiples, or peer-relative valuation)\n';
    sysMsg += '- Integrating macro regime, technicals, sentiment, and fundamentals into one coherent thesis\n\n';
    sysMsg += 'YOUR ANALYTICAL PROCESS (you MUST follow this mental framework before writing your verdict):\n\n';
    sysMsg += 'STEP 1 — BUSINESS QUALITY ASSESSMENT\n';
    sysMsg += '  Ask: Is this a good business? What is the moat? Are margins sustainable? How does ROIC compare to cost of capital?\n';
    sysMsg += '  Look at: Gross/operating/net margins, ROE, ROIC, competitive position, sector dynamics.\n\n';
    sysMsg += 'STEP 2 — GROWTH TRAJECTORY\n';
    sysMsg += '  Ask: Is growth accelerating, stable, or decelerating? Is it organic or acquisition-driven?\n';
    sysMsg += '  Look at: Revenue growth (1Y/3Y/5Y), EPS growth, quarterly trends, management guidance.\n\n';
    sysMsg += 'STEP 3 — FINANCIAL HEALTH & CASH FLOW\n';
    sysMsg += '  Ask: Can this company fund its growth? Is the balance sheet a weapon or a liability?\n';
    sysMsg += '  Look at: FCF generation, debt/equity, current ratio, cash position, capex trends, buybacks.\n\n';
    sysMsg += 'STEP 4 — VALUATION (most critical step)\n';
    sysMsg += '  Ask: What is this stock WORTH vs. what is it PRICED at? Is the market right or wrong?\n';
    sysMsg += '  Methods: (a) P/E vs peers and history, (b) EV/EBITDA vs peers, (c) P/S for growth stocks, (d) DCF if cash flow data available.\n';
    sysMsg += '  DCF approach: Use latest FCF as base. Estimate 5Y growth from historical trends. WACC=10%. Terminal growth=2.5-3%. Shares = Market Cap / Price.\n';
    sysMsg += '  Your price target MUST come from one of these methods. State which method you used.\n\n';
    sysMsg += 'STEP 5 — CATALYST & RISK MAPPING\n';
    sysMsg += '  Ask: What specific events in the next 12 months could move this stock 10%+ in either direction?\n';
    sysMsg += '  Look at: Earnings dates, product launches, regulatory events, macro shifts, insider activity.\n\n';
    sysMsg += 'STEP 6 — SIGNAL CONVERGENCE\n';
    sysMsg += '  Ask: Are technicals, sentiment, insiders, and analysts all pointing the same direction? Or is there divergence?\n';
    sysMsg += '  Convergence = higher confidence. Divergence = lower confidence. Note any contradictions explicitly.\n\n';
    sysMsg += 'STEP 7 — FINAL SYNTHESIS\n';
    sysMsg += '  Weigh all 7 steps. Assign verdict and confidence. Write your thesis as if presenting to the investment committee.\n';
    sysMsg += '  STRONG BUY/SELL require HIGH confidence + clear catalysts + valuation support. Use sparingly.\n\n';
    sysMsg += 'STEP 8 — EARNINGS ESTIMATE MOMENTUM\n';
    sysMsg += '  Ask: Are analyst EPS estimates rising or falling over recent quarters? Rising estimates = positive earnings revision cycle. Falling = negative.\n';
    sysMsg += '  Cross-reference with actual earnings beat/miss rate. A stock that consistently beats AND has rising estimates is in a powerful uptrend.\n';
    sysMsg += '  A stock with falling estimates AND misses is in a negative revision cycle — avoid or short.\n\n';
    sysMsg += 'RULES:\n';
    sysMsg += '- Never fabricate data. If something is missing, say so and lower confidence.\n';
    sysMsg += '- Distinguish between what the data SHOWS vs. what you INFER.\n';
    sysMsg += '- Be contrarian when data supports it. Do not default to consensus.\n';
    sysMsg += '- Price target must be a specific number derived from valuation work.\n';
    sysMsg += '- Always respond in the exact JSON format requested. No markdown, no commentary outside JSON.';

    // ── BUILD STRUCTURED DATA BRIEFING ──
    var b = '';
    var ageMin = allData._dataLoadedAt ? Math.round((Date.now() - allData._dataLoadedAt) / 60000) : -1;
    var today = new Date();

    b += '================================================================\n';
    b += '  EQUITY RESEARCH BRIEFING: ' + symbol + ' (' + (companyName || symbol) + ')\n';
    b += '  Date: ' + today.toISOString().split('T')[0] + ' | Data Age: ' + (ageMin < 0 ? 'Unknown' : ageMin < 1 ? 'Live' : ageMin + ' min') + '\n';
    b += '================================================================\n\n';

    // ── SECTION 1: PRICE & TRADING DATA ──
    b += '┌─ SECTION 1: PRICE & TRADING DATA ─────────────────────────────┐\n';
    if (allData.quote) {
      var q = allData.quote;
      b += '  Current Price:  $' + q.price.toFixed(2) + '\n';
      b += '  Day Change:     ' + (q.change >= 0 ? '+' : '') + q.change.toFixed(2) + ' (' + q.changePct.toFixed(2) + '%)\n';
      b += '  Day Range:      $' + q.low.toFixed(2) + ' - $' + q.high.toFixed(2) + '\n';
      b += '  Prev Close:     $' + q.prevClose.toFixed(2) + '\n';
    } else { b += '  [NO LIVE QUOTE AVAILABLE]\n'; }
    b += '└──────────────────────────────────────────────────────────────┘\n\n';

    // ── SECTION 2: COMPANY PROFILE ──
    b += '┌─ SECTION 2: COMPANY PROFILE ──────────────────────────────────┐\n';
    if (allData.profile) {
      var p = allData.profile;
      b += '  Name:           ' + (p.name || symbol) + '\n';
      b += '  Sector:         ' + (p.sector || 'N/A') + '\n';
      b += '  Market Cap:     ' + (p.marketCap ? '$' + (p.marketCap / 1e9).toFixed(1) + 'B' : 'N/A') + '\n';
      b += '  Exchange:       ' + (p.exchange || 'N/A') + '\n';
    } else { b += '  [NO PROFILE DATA]\n'; }
    if (allData.avOverview) {
      var avo = allData.avOverview;
      if (avo.Description) b += '  Description:    ' + avo.Description.substring(0, 300) + (avo.Description.length > 300 ? '...' : '') + '\n';
      if (avo.FullTimeEmployees) b += '  Employees:      ' + avo.FullTimeEmployees + '\n';
    }
    b += '└──────────────────────────────────────────────────────────────┘\n\n';

    // ── SECTION 3: KEY VALUATION METRICS ──
    b += '┌─ SECTION 3: VALUATION METRICS ────────────────────────────────┐\n';
    if (allData.financials) {
      var f = allData.financials;
      b += '  P/E (TTM):      ' + (f.peRatio || 'N/A') + '\n';
      b += '  Forward P/E:    ' + (f.forwardPE || 'N/A') + '\n';
      b += '  EPS (TTM):      ' + (f.eps || 'N/A') + '\n';
      b += '  52W High:       ' + (f.week52High || 'N/A') + '\n';
      b += '  52W Low:        ' + (f.week52Low || 'N/A') + '\n';
      b += '  Beta:           ' + (f.beta || 'N/A') + '\n';
      b += '  Div Yield:      ' + (f.dividendYield || 'N/A') + '\n';
    } else { b += '  [NO FINANCIAL METRICS]\n'; }
    if (allData.avOverview) {
      var av = allData.avOverview;
      if (av.PriceToBookRatio) b += '  P/B Ratio:      ' + av.PriceToBookRatio + '\n';
      if (av.EVToEBITDA) b += '  EV/EBITDA:      ' + av.EVToEBITDA + '\n';
      if (av.PriceToSalesRatioTTM) b += '  P/S Ratio:      ' + av.PriceToSalesRatioTTM + '\n';
      if (av.EVToRevenue) b += '  EV/Revenue:     ' + av.EVToRevenue + '\n';
    }
    b += '└──────────────────────────────────────────────────────────────┘\n\n';

    // ── SECTION 3B: VALUATION SCORECARD (pre-computed) ──
    if (allData.financials && allData.avOverview) {
      var vf = allData.financials;
      var vav = allData.avOverview;
      b += '┌─ SECTION 3B: VALUATION SCORECARD (pre-computed) ────────────┐\n';
      var pe = parseFloat(vf.peRatio) || 0;
      var pb = parseFloat(vav.PriceToBookRatio) || 0;
      var ps = parseFloat(vav.PriceToSalesRatioTTM) || 0;
      var peg = parseFloat(vav.PEGRatio) || 0;
      var peScore = pe <= 0 ? 'N/A' : pe < 10 ? '10 (deep value)' : pe < 15 ? '8 (value)' : pe < 20 ? '6 (fair)' : pe < 30 ? '4 (growth premium)' : pe < 50 ? '2 (expensive)' : '1 (extreme)';
      var pbScore = pb <= 0 ? 'N/A' : pb < 1 ? '10 (below book)' : pb < 2 ? '7 (fair)' : pb < 5 ? '4 (premium)' : '2 (expensive)';
      var psScore = ps <= 0 ? 'N/A' : ps < 1 ? '10 (deep value)' : ps < 3 ? '7 (fair)' : ps < 8 ? '4 (growth)' : '2 (expensive)';
      var pegScore = peg <= 0 ? 'N/A' : peg < 1 ? '10 (undervalued)' : peg < 1.5 ? '7 (fair)' : peg < 2 ? '4 (rich)' : '2 (overvalued)';
      b += '  P/E Score:      ' + peScore + ' (P/E=' + (pe || 'N/A') + ')\n';
      b += '  P/B Score:      ' + pbScore + ' (P/B=' + (pb || 'N/A') + ')\n';
      b += '  P/S Score:      ' + psScore + ' (P/S=' + (ps || 'N/A') + ')\n';
      b += '  PEG Score:      ' + pegScore + ' (PEG=' + (peg || 'N/A') + ')\n';
      b += '└──────────────────────────────────────────────────────────────┘\n\n';
    }

    // ── SECTION 4: GROWTH & MARGINS ──
    b += '┌─ SECTION 4: GROWTH & PROFITABILITY ───────────────────────────┐\n';
    if (allData.financials) {
      var ef = allData.financials;
      b += '  Revenue Growth:  1Y=' + (ef.revenueGrowth1Y != null ? ef.revenueGrowth1Y.toFixed(1) + '%' : 'N/A') + ', 3Y=' + (ef.revenueGrowth3Y != null ? ef.revenueGrowth3Y.toFixed(1) + '%' : 'N/A') + ', 5Y=' + (ef.revenueGrowth5Y != null ? ef.revenueGrowth5Y.toFixed(1) + '%' : 'N/A') + '\n';
      b += '  EPS Growth:      1Y=' + (ef.epsGrowth != null ? ef.epsGrowth.toFixed(1) + '%' : 'N/A') + ', 3Y=' + (ef.epsGrowth3Y != null ? ef.epsGrowth3Y.toFixed(1) + '%' : 'N/A') + ', 5Y=' + (ef.epsGrowth5Y != null ? ef.epsGrowth5Y.toFixed(1) + '%' : 'N/A') + '\n';
      b += '  Gross Margin:    ' + (ef.grossMargin != null ? ef.grossMargin.toFixed(1) + '%' : 'N/A') + '\n';
      b += '  Operating Margin:' + (ef.operatingMargin != null ? ef.operatingMargin.toFixed(1) + '%' : 'N/A') + '\n';
      b += '  Net Margin:      ' + (ef.netMargin != null ? ef.netMargin.toFixed(1) + '%' : 'N/A') + '\n';
      b += '  ROE:             ' + (ef.roeTTM != null ? ef.roeTTM.toFixed(1) + '%' : 'N/A') + '\n';
      b += '  ROIC:            ' + (ef.roicTTM != null ? ef.roicTTM.toFixed(1) + '%' : 'N/A') + '\n';
      b += '  D/E Ratio:       ' + (ef.debtEquity != null ? ef.debtEquity.toFixed(2) : 'N/A') + '\n';
      b += '  Current Ratio:   ' + (ef.currentRatio != null ? ef.currentRatio.toFixed(2) : 'N/A') + '\n';
    } else { b += '  [NO GROWTH/MARGIN DATA]\n'; }
    b += '└──────────────────────────────────────────────────────────────┘\n\n';

    // ── SECTION 5: EARNINGS TRACK RECORD ──
    b += '┌─ SECTION 5: EARNINGS HISTORY ─────────────────────────────────┐\n';
    if (allData.earnings && allData.earnings.length) {
      var beats = 0, total = 0;
      allData.earnings.forEach(function(e) {
        var result = '';
        if (e.actual != null && e.estimate != null) {
          total++;
          if (e.actual > e.estimate) { beats++; result = ' BEAT'; }
          else if (e.actual < e.estimate) result = ' MISS';
          else result = ' MET';
        }
        b += '  ' + e.period + ': EPS $' + (e.actual != null ? e.actual.toFixed(2) : 'N/A') + ' vs Est $' + (e.estimate != null ? e.estimate.toFixed(2) : 'N/A') + result + '\n';
      });
      if (total > 0) b += '  Beat Rate: ' + Math.round(beats / total * 100) + '% (' + beats + '/' + total + ')\n';
    } else { b += '  [NO EARNINGS DATA]\n'; }
    if (allData.earningsCalendar) {
      var ec = allData.earningsCalendar;
      var daysUntil = Math.ceil((new Date(ec.date) - new Date()) / 86400000);
      b += '  NEXT EARNINGS: ' + ec.date + ' (' + daysUntil + ' days)';
      if (ec.epsEstimate != null) b += ', Est EPS $' + ec.epsEstimate.toFixed(2);
      b += '\n';
    }
    b += '└──────────────────────────────────────────────────────────────┘\n\n';

    // ── SECTION 6: CASH FLOW & BALANCE SHEET ──
    b += '┌─ SECTION 6: CASH FLOW & BALANCE SHEET ────────────────────────┐\n';
    if (allData.cashFlowData && allData.cashFlowData.length) {
      b += '  CASH FLOW (quarterly):\n';
      allData.cashFlowData.forEach(function(cf) {
        var yr = (cf.date || '').substring(0, 7);
        var opCF = cf.operatingCashFlow != null ? '$' + (cf.operatingCashFlow / 1e9).toFixed(2) + 'B' : 'N/A';
        var capex = cf.capitalExpenditure != null ? '$' + (cf.capitalExpenditure / 1e9).toFixed(2) + 'B' : 'N/A';
        var fcf = cf.freeCashFlow != null ? '$' + (cf.freeCashFlow / 1e9).toFixed(2) + 'B' : 'N/A';
        var divPaid = cf.dividendPayout != null ? '$' + (cf.dividendPayout / 1e9).toFixed(2) + 'B' : 'N/A';
        var ni = cf.netIncome != null ? '$' + (cf.netIncome / 1e9).toFixed(2) + 'B' : 'N/A';
        b += '    ' + yr + ': OpCF=' + opCF + ' | CapEx=' + capex + ' | FCF=' + fcf + ' | Div=' + divPaid + ' | NetInc=' + ni + '\n';
      });
    } else { b += '  [NO CASH FLOW DATA — DCF not possible]\n'; }
    b += '\n';
    if (allData.balanceSheetData && allData.balanceSheetData.length) {
      b += '  BALANCE SHEET (quarterly):\n';
      allData.balanceSheetData.forEach(function(bs) {
        var yr = (bs.date || '').substring(0, 7);
        var assets = bs.totalAssets != null ? '$' + (bs.totalAssets / 1e9).toFixed(2) + 'B' : 'N/A';
        var liab = bs.totalLiabilities != null ? '$' + (bs.totalLiabilities / 1e9).toFixed(2) + 'B' : 'N/A';
        var bv = bs.bookValue != null ? '$' + (bs.bookValue / 1e9).toFixed(2) + 'B' : 'N/A';
        var cashVal = bs.cash != null ? '$' + (bs.cash / 1e9).toFixed(2) + 'B' : 'N/A';
        var debt = bs.totalDebt != null ? '$' + (bs.totalDebt / 1e9).toFixed(2) + 'B' : 'N/A';
        b += '    ' + yr + ': Assets=' + assets + ' | Liab=' + liab + ' | BookVal=' + bv + ' | Cash=' + cashVal + ' | Debt=' + debt + '\n';
      });
    } else { b += '  [NO BALANCE SHEET DATA]\n'; }
    b += '└──────────────────────────────────────────────────────────────┘\n\n';

    // ── SECTION 6B: REVENUE & INCOME TRENDS ──
    if (allData.incomeData && allData.incomeData.length) {
      b += '┌─ SECTION 6B: REVENUE & INCOME TRENDS ────────────────────────┐\n';
      allData.incomeData.forEach(function(inc) {
        var yr = (inc.date || '').substring(0, 7);
        var rev = inc.revenue != null ? '$' + (inc.revenue / 1e9).toFixed(2) + 'B' : 'N/A';
        var ni = inc.netIncome != null ? '$' + (inc.netIncome / 1e9).toFixed(2) + 'B' : 'N/A';
        var gp = inc.grossProfit != null ? '$' + (inc.grossProfit / 1e9).toFixed(2) + 'B' : 'N/A';
        var oi = inc.operatingIncome != null ? '$' + (inc.operatingIncome / 1e9).toFixed(2) + 'B' : 'N/A';
        b += '    ' + yr + ': Rev=' + rev + ' | GP=' + gp + ' | OpInc=' + oi + ' | NetInc=' + ni + '\n';
      });
      b += '└──────────────────────────────────────────────────────────────┘\n\n';
    }

    // ── SECTION 7: DIVIDENDS ──
    var divYield = (allData.financials && allData.financials.dividendYield) ? allData.financials.dividendYield : null;
    var avDiv = allData.avOverview || {};
    if (divYield || (avDiv.DividendPerShare && avDiv.DividendPerShare !== 'None')) {
      b += '┌─ SECTION 7: DIVIDENDS ────────────────────────────────────────┐\n';
      if (divYield) b += '  Yield:          ' + divYield + '\n';
      if (avDiv.DividendPerShare && avDiv.DividendPerShare !== 'None') b += '  Per Share:      $' + avDiv.DividendPerShare + '\n';
      if (avDiv.PayoutRatio && avDiv.PayoutRatio !== 'None') b += '  Payout Ratio:   ' + (parseFloat(avDiv.PayoutRatio) * 100).toFixed(1) + '%\n';
      if (avDiv.ExDividendDate && avDiv.ExDividendDate !== 'None') b += '  Ex-Div Date:    ' + avDiv.ExDividendDate + '\n';
      b += '└──────────────────────────────────────────────────────────────┘\n\n';
    }

    // ── SECTION 8: ANALYST CONSENSUS ──
    b += '┌─ SECTION 8: WALL STREET CONSENSUS ────────────────────────────┐\n';
    if (allData.recommendations && allData.recommendations.length) {
      var r = allData.recommendations[0];
      b += '  Period: ' + r.period + '\n';
      b += '  Strong Buy=' + (r.strongBuy || 0) + ' | Buy=' + (r.buy || 0) + ' | Hold=' + (r.hold || 0) + ' | Sell=' + (r.sell || 0) + ' | Strong Sell=' + (r.strongSell || 0) + '\n';
    } else { b += '  [NO ANALYST RATINGS]\n'; }
    b += '└──────────────────────────────────────────────────────────────┘\n\n';

    // ── SECTION 9: INSIDER ACTIVITY ──
    b += '┌─ SECTION 9: INSIDER TRADING ──────────────────────────────────┐\n';
    if (allData.insiderTrades && allData.insiderTrades.length) {
      var iBuys = 0, iSells = 0, iBuyVal = 0, iSellVal = 0;
      allData.insiderTrades.forEach(function(t) {
        if (t.code === 'P' || t.code === 'A') { iBuys++; if (t.price) iBuyVal += Math.abs(t.change) * t.price; }
        else if (t.code === 'S') { iSells++; if (t.price) iSellVal += Math.abs(t.change) * t.price; }
      });
      var iSignal = 'NEUTRAL';
      if (iBuys > 0 && iSells === 0) iSignal = 'BULLISH';
      else if (iBuys > iSells * 1.5) iSignal = 'BULLISH';
      else if (iSells > iBuys * 1.5) iSignal = 'BEARISH';
      else if (iSells > 0 && iBuys === 0) iSignal = 'BEARISH';
      b += '  Transactions: ' + allData.insiderTrades.length + ' | Buys=' + iBuys + ' | Sells=' + iSells + ' | Signal=' + iSignal + '\n';
      if (iBuyVal > 0) b += '  Total Buy Value:  $' + (iBuyVal / 1e6).toFixed(2) + 'M\n';
      if (iSellVal > 0) b += '  Total Sell Value: $' + (iSellVal / 1e6).toFixed(2) + 'M\n';
      var notable = allData.insiderTrades.filter(function(t) { return t.price && t.change; })
        .sort(function(a, bb) { return Math.abs(bb.change * (bb.price || 0)) - Math.abs(a.change * (a.price || 0)); })
        .slice(0, 3);
      if (notable.length) {
        b += '  Notable:\n';
        notable.forEach(function(t) {
          var type = t.code === 'P' ? 'BUY' : t.code === 'S' ? 'SELL' : t.code === 'A' ? 'AWARD' : t.code;
          b += '    ' + t.name + ' — ' + type + ' $' + (Math.abs(t.change * t.price) / 1e6).toFixed(2) + 'M\n';
        });
      }
    } else { b += '  [NO INSIDER DATA]\n'; }
    b += '└──────────────────────────────────────────────────────────────┘\n\n';

    // ── SECTION 10: TECHNICAL INDICATORS ──
    b += '┌─ SECTION 10: TECHNICAL SIGNALS ─────────────────────────────┐\n';
    if (allData.technicalsResult) {
      var tech = allData.technicalsResult;
      b += '  AI Signal:      ' + (tech.signal || 'N/A') + '\n';
      if (tech.support) b += '  Support:        ' + tech.support + '\n';
      if (tech.resistance) b += '  Resistance:     ' + tech.resistance + '\n';
      if (tech.recommendation) b += '  Recommendation: ' + tech.recommendation + '\n';
      if (tech.summary) b += '  AI Summary:     ' + tech.summary + '\n';
      if (tech.indicators && tech.indicators.length) {
        b += '  Indicator Detail:\n';
        tech.indicators.forEach(function(ind) {
          b += '    ' + (ind.name || 'N/A') + ': ' + (ind.value || 'N/A') + ' — ' + (ind.interpretation || '') + '\n';
        });
      }
    }
    if (allData.rsiData && allData.rsiData.length) {
      var rsiVal = allData.rsiData[0].rsi;
      b += '  RSI (14):       ' + rsiVal.toFixed(1) + (rsiVal > 70 ? ' OVERBOUGHT' : rsiVal < 30 ? ' OVERSOLD' : ' NEUTRAL') + '\n';
    }
    if (allData.macdData && allData.macdData.length) {
      b += '  MACD Histogram: ' + allData.macdData[0].histogram.toFixed(3) + (allData.macdData[0].histogram >= 0 ? ' BULLISH' : ' BEARISH') + '\n';
    }
    if (allData.sma50Data && allData.sma50Data.length && allData.sma200Data && allData.sma200Data.length) {
      var gc = allData.sma50Data[0].sma > allData.sma200Data[0].sma;
      b += '  SMA Cross:      ' + (gc ? 'GOLDEN CROSS (bullish)' : 'DEATH CROSS (bearish)') + ' | SMA50=' + allData.sma50Data[0].sma.toFixed(2) + ' SMA200=' + allData.sma200Data[0].sma.toFixed(2) + '\n';
    }
    if (!allData.technicalsResult && !allData.rsiData && !allData.macdData) { b += '  [NO TECHNICAL DATA]\n'; }
    b += '└──────────────────────────────────────────────────────────────┘\n\n';

    // ── SECTION 11: PEER COMPARISON ──
    if (allData.peers && allData.peers.length) {
      b += '┌─ SECTION 11: PEER COMPARISON ───────────────────────────────┐\n';
      allData.peers.forEach(function(pr) {
        var pf = pr.financials || {};
        var pq = pr.quote || {};
        b += '  ' + pr.symbol + ': Price=$' + (pq.price ? pq.price.toFixed(2) : 'N/A') + ' | P/E=' + (pf.peRatio || 'N/A') + ' | Growth=' + (pf.revenueGrowth || 'N/A') + ' | Margin=' + (pf.profitMargin || 'N/A') + '\n';
      });
      b += '└──────────────────────────────────────────────────────────────┘\n\n';
    }

    // ── SECTION 12: NEWS SENTIMENT ──
    b += '┌─ SECTION 12: SENTIMENT & NEWS ────────────────────────────────┐\n';
    if (allData.avSentiment && allData.avSentiment.length) {
      var bullC = 0, bearC = 0, neutC = 0;
      allData.avSentiment.forEach(function(s) {
        if (s.tickerSentiment) {
          var lbl = s.tickerSentiment.label.toLowerCase();
          if (lbl.indexOf('bullish') !== -1) bullC++;
          else if (lbl.indexOf('bearish') !== -1) bearC++;
          else neutC++;
        }
      });
      var sentT = bullC + bearC + neutC;
      if (sentT > 0) b += '  Sentiment (' + sentT + ' articles): Bullish=' + bullC + ' Neutral=' + neutC + ' Bearish=' + bearC + ' (' + Math.round(bullC / sentT * 100) + '% bullish)\n';
    }
    if (allData.articles && allData.articles.length) {
      b += '  Recent Headlines (' + allData.articles.length + '):\n';
      allData.articles.slice(0, 5).forEach(function(a) {
        b += '    - ' + a.title + ' (' + a.publisher + ', ' + a.date + ')\n';
      });
    }
    b += '└──────────────────────────────────────────────────────────────┘\n\n';

    // ── SECTION 13: EPS ESTIMATE REVISIONS ──
    if (allData.epsEstimates && allData.epsEstimates.quarterly && allData.epsEstimates.quarterly.length) {
      b += '┌─ SECTION 13: EPS ESTIMATE REVISIONS ───────────────────────┐\n';
      allData.epsEstimates.quarterly.forEach(function(e) {
        b += '  ' + e.period + ': Avg=' + (e.avg != null ? '$' + e.avg.toFixed(2) : 'N/A') + ' | High=' + (e.high != null ? '$' + e.high.toFixed(2) : 'N/A') + ' | Low=' + (e.low != null ? '$' + e.low.toFixed(2) : 'N/A') + ' | Analysts=' + (e.numAnalysts || 'N/A') + '\n';
      });
      b += '└──────────────────────────────────────────────────────────────┘\n\n';
    }

    // ── SECTION 14: AI ANALYSIS SUMMARIES ──
    b += '┌─ SECTION 14: AI ANALYSIS SUMMARIES (from sub-analysts) ──────┐\n';
    if (allData.aiResult) {
      b += '  NEWS AI:         Outlook=' + (allData.aiResult.longTermOutlook || 'N/A') + '\n';
      b += '                   ' + (allData.aiResult.summary || '') + '\n';
    }
    if (allData.analystAIResult) {
      b += '  ANALYST AI:      Consensus=' + (allData.analystAIResult.consensus || 'N/A') + '\n';
      b += '                   ' + (allData.analystAIResult.summary || '') + '\n';
    }
    if (allData.macroAIResult) {
      b += '  MACRO AI:        Impact=' + (allData.macroAIResult.impact || 'N/A') + '\n';
      b += '                   ' + (allData.macroAIResult.summary || '') + '\n';
    }
    if (allData.transcriptAIResult) {
      b += '  EARNINGS AI:     Sentiment=' + (allData.transcriptAIResult.sentiment || 'N/A') + '\n';
      b += '                   ' + (allData.transcriptAIResult.summary || '') + '\n';
    }
    if (allData.fundamentalsResult) {
      var fr = allData.fundamentalsResult;
      b += '  FUNDAMENTALS AI: Growth=' + (fr.growthOutlook || 'N/A') + ' | Margins=' + (fr.marginTrend || 'N/A') + ' | Health=' + (fr.healthScore || 'N/A') + '\n';
      b += '                   ' + (fr.summary || '') + '\n';
      if (fr.strengths && fr.strengths.length) b += '    Strengths: ' + fr.strengths.map(function(s) { return s.area; }).join(', ') + '\n';
      if (fr.weaknesses && fr.weaknesses.length) b += '    Weaknesses: ' + fr.weaknesses.map(function(w) { return w.area; }).join(', ') + '\n';
    }
    if (!allData.aiResult && !allData.analystAIResult && !allData.macroAIResult && !allData.transcriptAIResult && !allData.fundamentalsResult) {
      b += '  [NO AI ANALYSES RUN YET]\n';
    }
    b += '└──────────────────────────────────────────────────────────────┘\n\n';

    // ── SECTION 15: DATA COMPLETENESS AUDIT ──
    var dataAvail = [];
    var dataMissing = [];
    if (allData.quote) dataAvail.push('Live Quote'); else dataMissing.push('Live Quote');
    if (allData.profile) dataAvail.push('Company Profile'); else dataMissing.push('Company Profile');
    if (allData.financials) dataAvail.push('Financial Metrics'); else dataMissing.push('Financial Metrics');
    if (allData.earnings && allData.earnings.length) dataAvail.push('Earnings History'); else dataMissing.push('Earnings History');
    if (allData.recommendations && allData.recommendations.length) dataAvail.push('Analyst Ratings'); else dataMissing.push('Analyst Ratings');
    if (allData.articles && allData.articles.length) dataAvail.push('Company News'); else dataMissing.push('Company News');
    if (allData.macroArticles && allData.macroArticles.length) dataAvail.push('Macro News'); else dataMissing.push('Macro News');
    if (allData.insiderTrades && allData.insiderTrades.length) dataAvail.push('Insider Trades'); else dataMissing.push('Insider Trades');
    if (allData.aiResult) dataAvail.push('AI News Analysis'); else dataMissing.push('AI News Analysis');
    if (allData.analystAIResult) dataAvail.push('AI Analyst Summary'); else dataMissing.push('AI Analyst Summary');
    if (allData.macroAIResult) dataAvail.push('AI Macro Impact'); else dataMissing.push('AI Macro Impact');
    if (allData.transcriptAIResult) dataAvail.push('Earnings Call Summary'); else dataMissing.push('Earnings Call Summary');
    if (allData.fundamentalsResult) dataAvail.push('Fundamentals Analysis'); else dataMissing.push('Fundamentals Analysis');
    if (allData.technicalsResult) dataAvail.push('Technical Analysis'); else dataMissing.push('Technical Analysis');
    if (allData.avOverview) dataAvail.push('Company Overview'); else dataMissing.push('Company Overview');
    if (allData.peers && allData.peers.length) dataAvail.push('Peer Comparison'); else dataMissing.push('Peer Comparison');
    if (allData.secFilings && allData.secFilings.length) dataAvail.push('SEC Filings'); else dataMissing.push('SEC Filings');
    if (allData.cashFlowData && allData.cashFlowData.length) dataAvail.push('Cash Flow Statement'); else dataMissing.push('Cash Flow Statement');
    if (allData.balanceSheetData && allData.balanceSheetData.length) dataAvail.push('Balance Sheet'); else dataMissing.push('Balance Sheet');
    if (allData.incomeData && allData.incomeData.length) dataAvail.push('Revenue & Income'); else dataMissing.push('Revenue & Income');
    if (allData.epsEstimates && allData.epsEstimates.quarterly && allData.epsEstimates.quarterly.length) dataAvail.push('EPS Estimates'); else dataMissing.push('EPS Estimates');
    if (allData.rsiData && allData.rsiData.length) dataAvail.push('RSI/MACD/SMA');

    b += '┌─ SECTION 15: DATA COMPLETENESS AUDIT ─────────────────────────┐\n';
    b += '  Coverage: ' + dataAvail.length + '/' + (dataAvail.length + dataMissing.length) + ' sources\n';
    b += '  Available: ' + dataAvail.join(', ') + '\n';
    if (dataMissing.length) b += '  MISSING:   ' + dataMissing.join(', ') + '\n';
    b += '  INSTRUCTION: Factor missing data into confidence. Missing cash flow = no DCF. Missing earnings = lower conviction.\n';
    b += '└──────────────────────────────────────────────────────────────┘\n\n';

    // ── USER PROMPT (instructions + data) ──
    var userMsg = 'Analyze the following research briefing for ' + symbol + ' and deliver your final investment verdict.\n\n';
    userMsg += 'THINKING INSTRUCTIONS:\n';
    userMsg += 'Before writing your verdict, mentally walk through each of the 8 steps in your analytical framework.\n';
    userMsg += 'For each step, note what the data tells you. Identify where signals converge and where they diverge.\n';
    userMsg += 'Then synthesize all 8 steps into a coherent thesis. Document your reasoning in the thinkingProcess field.\n\n';
    userMsg += 'VALUATION INSTRUCTIONS:\n';
    userMsg += '- If CASH FLOW data is available in Section 6, compute a DCF intrinsic value:\n';
    userMsg += '  1. Take the most recent year FCF as base\n';
    userMsg += '  2. Estimate 5-year FCF growth rate from the historical trend\n';
    userMsg += '  3. Apply WACC = 10% as discount rate\n';
    userMsg += '  4. Terminal value: FCF_year5 * (1 + 2.5%) / (WACC - 2.5%)\n';
    userMsg += '  5. Sum discounted FCFs + discounted terminal value = Enterprise Value\n';
    userMsg += '  6. Subtract net debt (LT Debt + ST Debt - Cash from Balance Sheet)\n';
    userMsg += '  7. Divide by shares outstanding (Market Cap / Current Price)\n';
    userMsg += '  8. Result = intrinsic value per share\n';
    userMsg += '- If cash flow data is NOT available, set intrinsicValue to null and dcfAssumptions to null.\n';
    userMsg += '- Your priceTarget should be informed by DCF (if available), peer multiples, and/or historical valuation ranges.\n';
    userMsg += '- State which valuation method(s) you used in verdictReason.\n\n';
    userMsg += 'EPS ESTIMATE MOMENTUM:\n';
    userMsg += '- Check Section 13B for EPS estimate revisions. Are estimates rising or falling across quarters?\n';
    userMsg += '- Cross-reference with Section 5 earnings beat/miss rate. Rising estimates + beats = strong. Falling + misses = weak.\n\n';
    userMsg += b;
    userMsg += 'Respond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):\n';
    userMsg += '{\n';
    userMsg += '  "verdict": "STRONG BUY" or "BUY" or "HOLD" or "SELL" or "STRONG SELL",\n';
    userMsg += '  "confidence": "HIGH" or "MEDIUM" or "LOW",\n';
    userMsg += '  "priceTarget": <number - your 12-month price target>,\n';
    userMsg += '  "timeHorizon": "12 months",\n';
    userMsg += '  "thinkingProcess": "Walk through your 8-step analysis here. For each step, state what the data shows and your conclusion. 4-6 sentences covering the key steps.",\n';
    userMsg += '  "summary": "4-5 sentence executive summary of your investment thesis — cover business quality, growth, valuation, and key catalyst",\n';
    userMsg += '  "verdictReason": "2-3 sentences explaining your price target derivation and why you chose this verdict. Mention which valuation method you used.",\n';
    userMsg += '  "dataQuality": "1 sentence on data freshness, coverage, and any gaps that affected your analysis",\n';
    userMsg += '  "intrinsicValue": <number or null - DCF intrinsic value per share>,\n';
    userMsg += '  "dcfAssumptions": "1-2 sentences: FCF base, growth rate used, WACC, terminal growth, shares outstanding. Or null if no DCF.",\n';
    userMsg += '  "bull": ["1 sentence bull point - be specific with numbers"],\n';
    userMsg += '  "bear": ["1 sentence bear point - be specific with numbers"],\n';
    userMsg += '  "catalysts": [{"event": "specific catalyst", "timeline": "when", "impact": "HIGH/MEDIUM/LOW"}],\n';
    userMsg += '  "risks": [{"risk": "specific risk", "severity": "HIGH/MEDIUM/LOW", "mitigation": "1 sentence"}]\n';
    userMsg += '}\n\n';
    userMsg += 'Keep bull to 3-4 points. Keep bear to 2-3 points. Keep catalysts to 2-3. Keep risks to 2-3.\n';
    userMsg += 'Be SPECIFIC with numbers. Show your work. No generic statements.';

    // Use MODEL_DEEP (llama-3.3-70b) for deeper reasoning
    // 3000 tokens for thorough analysis, 60s timeout for larger model
    // Temperature 0.5 for balanced creativity + precision
    var result = await groqFetch([
      { role: 'system', content: sysMsg },
      { role: 'user', content: userMsg }
    ], 3000, 0.5, { model: MODEL_DEEP, timeoutMs: 60000 });

    // Attach current price for upside calc
    if (allData.quote) result.currentPrice = allData.quote.price;
    if (result.priceTarget && allData.quote) {
      result.upside = ((result.priceTarget - allData.quote.price) / allData.quote.price * 100).toFixed(1);
    }
    return result;
  }

  /**
   * Analyze company fundamentals — growth, margins, health, sentiment.
   */
  async function analyzeFundamentals(symbol, companyName, financials, overview, sentimentData, profile) {
    if (!hasKey()) throw new Error('Groq API key required.');

    var sections = '';
    if (profile) {
      sections += 'COMPANY: ' + (profile.name || symbol) + ', Sector: ' + (profile.sector || 'N/A');
      if (profile.marketCap) sections += ', Market Cap: $' + (profile.marketCap / 1e9).toFixed(1) + 'B';
      sections += '\n\n';
    }

    if (financials) {
      var f = financials;
      sections += 'GROWTH METRICS:\n';
      sections += '  Revenue Growth (1Y): ' + (f.revenueGrowth1Y != null ? f.revenueGrowth1Y.toFixed(1) + '%' : 'N/A') + '\n';
      sections += '  Revenue Growth (3Y): ' + (f.revenueGrowth3Y != null ? f.revenueGrowth3Y.toFixed(1) + '%' : 'N/A') + '\n';
      sections += '  Revenue Growth (5Y): ' + (f.revenueGrowth5Y != null ? f.revenueGrowth5Y.toFixed(1) + '%' : 'N/A') + '\n';
      sections += '  EPS Growth (1Y): ' + (f.epsGrowth != null ? f.epsGrowth.toFixed(1) + '%' : 'N/A') + '\n';
      sections += '  EPS Growth (3Y): ' + (f.epsGrowth3Y != null ? f.epsGrowth3Y.toFixed(1) + '%' : 'N/A') + '\n';
      sections += '  EPS Growth (5Y): ' + (f.epsGrowth5Y != null ? f.epsGrowth5Y.toFixed(1) + '%' : 'N/A') + '\n\n';
      sections += 'MARGIN STACK:\n';
      sections += '  Gross Margin: ' + (f.grossMargin != null ? f.grossMargin.toFixed(1) + '%' : 'N/A') + '\n';
      sections += '  Operating Margin: ' + (f.operatingMargin != null ? f.operatingMargin.toFixed(1) + '%' : 'N/A') + '\n';
      sections += '  Net Margin: ' + (f.netMargin != null ? f.netMargin.toFixed(1) + '%' : 'N/A') + '\n\n';
      sections += 'RETURNS & EFFICIENCY:\n';
      sections += '  ROE: ' + (f.roeTTM != null ? f.roeTTM.toFixed(1) + '%' : 'N/A') + '\n';
      sections += '  ROA: ' + (f.roaTTM != null ? f.roaTTM.toFixed(1) + '%' : 'N/A') + '\n';
      sections += '  ROIC: ' + (f.roicTTM != null ? f.roicTTM.toFixed(1) + '%' : 'N/A') + '\n\n';
      sections += 'FINANCIAL HEALTH:\n';
      sections += '  Current Ratio: ' + (f.currentRatio != null ? f.currentRatio.toFixed(2) : 'N/A') + '\n';
      sections += '  Quick Ratio: ' + (f.quickRatio != null ? f.quickRatio.toFixed(2) : 'N/A') + '\n';
      sections += '  Debt/Equity: ' + (f.debtEquity != null ? f.debtEquity.toFixed(2) : 'N/A') + '\n\n';
    }

    if (overview) {
      sections += 'ALPHA VANTAGE OVERVIEW:\n';
      if (overview.FullTimeEmployees) sections += '  Employees: ' + overview.FullTimeEmployees + '\n';
      if (overview.RevenueTTM) sections += '  Revenue TTM: $' + (parseFloat(overview.RevenueTTM) / 1e9).toFixed(2) + 'B\n';
      if (overview.GrossProfitTTM) sections += '  Gross Profit TTM: $' + (parseFloat(overview.GrossProfitTTM) / 1e9).toFixed(2) + 'B\n';
      if (overview.EBITDA) sections += '  EBITDA: $' + (parseFloat(overview.EBITDA) / 1e9).toFixed(2) + 'B\n';
      if (overview.PriceToBookRatio) sections += '  P/B Ratio: ' + overview.PriceToBookRatio + '\n';
      if (overview.PriceToSalesRatioTTM) sections += '  P/S Ratio: ' + overview.PriceToSalesRatioTTM + '\n';
      if (overview.EVToRevenue) sections += '  EV/Revenue: ' + overview.EVToRevenue + '\n';
      if (overview.EVToEBITDA) sections += '  EV/EBITDA: ' + overview.EVToEBITDA + '\n';
      if (overview.QuarterlyRevenueGrowthYOY) sections += '  Quarterly Rev Growth YoY: ' + overview.QuarterlyRevenueGrowthYOY + '\n';
      if (overview.QuarterlyEarningsGrowthYOY) sections += '  Quarterly Earnings Growth YoY: ' + overview.QuarterlyEarningsGrowthYOY + '\n';
      sections += '\n';
    }

    if (sentimentData && sentimentData.length) {
      var totalScore = 0, count = 0;
      var bullish = 0, bearish = 0, neutral = 0;
      sentimentData.forEach(function(s) {
        if (s.tickerSentiment) {
          totalScore += s.tickerSentiment.score;
          count++;
          var label = s.tickerSentiment.label.toLowerCase();
          if (label.indexOf('bullish') !== -1) bullish++;
          else if (label.indexOf('bearish') !== -1) bearish++;
          else neutral++;
        }
      });
      var avgScore = count > 0 ? (totalScore / count).toFixed(3) : 'N/A';
      sections += 'NEWS SENTIMENT (' + sentimentData.length + ' articles):\n';
      sections += '  Avg Ticker Sentiment Score: ' + avgScore + ' (range: -1 bearish to +1 bullish)\n';
      sections += '  Bullish: ' + bullish + ', Neutral: ' + neutral + ', Bearish: ' + bearish + '\n';
      sections += '  Top headlines:\n';
      sentimentData.slice(0, 5).forEach(function(s) {
        sections += '    - ' + s.title + ' [' + s.overallSentiment + ']\n';
      });
      sections += '\n';
    }

    var prompt = 'You are a senior equity research analyst. Analyze the following company fundamentals for ' + symbol + ' (' + (companyName || symbol) + ') and provide a comprehensive assessment.\n\n' + sections + 'Respond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):\n{\n  "summary": "3-4 sentence executive summary of the company fundamentals, growth trajectory, and financial health",\n  "growthOutlook": "ACCELERATING" or "STABLE" or "DECELERATING" or "DECLINING",\n  "growthReason": "1 sentence on the growth trajectory",\n  "marginTrend": "EXPANDING" or "STABLE" or "COMPRESSING",\n  "marginReason": "1 sentence on margin trends",\n  "healthScore": "STRONG" or "ADEQUATE" or "WEAK",\n  "healthReason": "1 sentence on balance sheet health",\n  "sentimentLabel": "BULLISH" or "BEARISH" or "NEUTRAL" or "MIXED",\n  "sentimentReason": "1 sentence on market sentiment",\n  "strengths": [\n    {\n      "area": "short label",\n      "detail": "1 sentence explanation"\n    }\n  ],\n  "weaknesses": [\n    {\n      "area": "short label",\n      "detail": "1 sentence explanation"\n    }\n  ],\n  "keyInsights": [\n    {\n      "insight": "short label",\n      "detail": "1 sentence actionable insight"\n    }\n  ]\n}\n\nKeep strengths to 2-4 items. Keep weaknesses to 2-3 items. Keep keyInsights to 2-3 items. Be specific with numbers.';

    return groqFetch([{ role: 'user', content: prompt }], 900, 0.3);
  }

  /**
   * Analyze technical indicators — RSI, MACD, SMA.
   */
  async function analyzeTechnicals(symbol, companyName, rsi, macd, sma50, sma200, quote) {
    if (!hasKey()) throw new Error('Groq API key required.');

    var sections = '';
    if (quote) {
      sections += 'Current Price: $' + quote.price.toFixed(2) + ' (Change: ' + (quote.change >= 0 ? '+' : '') + quote.change.toFixed(2) + ', ' + quote.changePct.toFixed(2) + '%)\n\n';
    }
    if (rsi && rsi.length) {
      sections += 'RSI (14-day): Current=' + rsi[0].rsi.toFixed(1) + ', 5-day avg=' + (rsi.slice(0, 5).reduce(function(a, b) { return a + b.rsi; }, 0) / Math.min(5, rsi.length)).toFixed(1) + '\n';
      sections += 'RSI trend (last 5): ' + rsi.slice(0, 5).map(function(r) { return r.date + '=' + r.rsi.toFixed(1); }).join(', ') + '\n\n';
    }
    if (macd && macd.length) {
      sections += 'MACD: Line=' + macd[0].macd.toFixed(3) + ', Signal=' + macd[0].signal.toFixed(3) + ', Histogram=' + macd[0].histogram.toFixed(3) + '\n';
      var crossover = 'none';
      if (macd.length >= 2) {
        if (macd[1].histogram < 0 && macd[0].histogram >= 0) crossover = 'BULLISH crossover (histogram turned positive)';
        else if (macd[1].histogram > 0 && macd[0].histogram <= 0) crossover = 'BEARISH crossover (histogram turned negative)';
      }
      sections += 'MACD Crossover: ' + crossover + '\n\n';
    }
    if (sma50 && sma50.length) {
      sections += 'SMA 50-day: ' + sma50[0].sma.toFixed(2) + '\n';
    }
    if (sma200 && sma200.length) {
      sections += 'SMA 200-day: ' + sma200[0].sma.toFixed(2) + '\n';
      if (sma50 && sma50.length) {
        var goldenCross = sma50[0].sma > sma200[0].sma;
        sections += 'Golden/Death Cross: ' + (goldenCross ? 'SMA50 ABOVE SMA200 (bullish)' : 'SMA50 BELOW SMA200 (bearish)') + '\n';
      }
    }
    if (quote && sma50 && sma50.length) {
      sections += 'Price vs SMA50: ' + (quote.price > sma50[0].sma ? 'ABOVE' : 'BELOW') + '\n';
    }
    if (quote && sma200 && sma200.length) {
      sections += 'Price vs SMA200: ' + (quote.price > sma200[0].sma ? 'ABOVE' : 'BELOW') + '\n';
    }

    var prompt = 'You are a senior technical analyst. Analyze the following technical indicators for ' + symbol + ' (' + (companyName || symbol) + ') and provide a trading signal interpretation.\n\n' + sections + '\nRespond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):\n{\n  "summary": "2-3 sentence technical analysis summary",\n  "signal": "BULLISH" or "BEARISH" or "NEUTRAL",\n  "signalReason": "1 sentence explaining the overall technical signal",\n  "indicators": [\n    {\n      "name": "indicator name (RSI, MACD, SMA)",\n      "value": "current value",\n      "interpretation": "1 sentence interpretation"\n    }\n  ],\n  "support": "nearest support level estimate",\n  "resistance": "nearest resistance level estimate",\n  "recommendation": "1 sentence actionable recommendation for traders"\n}\n\nKeep indicators to 3-5 items. Be specific with numbers.';

    return groqFetch([{ role: 'user', content: prompt }], 700, 0.3);
  }

  /**
   * Chat with wealth advisor — streams text response (not JSON).
   * messages: array of { role, content } (full conversation history)
   * Returns plain text string (not parsed JSON).
   */
  async function chatAdvisor(messages, opts) {
    var useModel = (opts && opts.model) || MODEL_DEEP;
    var useTimeout = (opts && opts.timeoutMs) || 60000;
    var maxTokens = (opts && opts.maxTokens) || 2048;
    var retries = 3;
    var waitMs = 5000;
    for (var attempt = 0; attempt < retries; attempt++) {
      var res;
      try {
        var controller = new AbortController();
        var timeoutId = setTimeout(function() { controller.abort(); }, useTimeout);
        res = await fetch(GROQ_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + getKey(),
          },
          body: JSON.stringify({
            model: useModel,
            messages: messages,
            temperature: 0.5,
            max_tokens: maxTokens,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (e) {
        if (e.name === 'AbortError') {
          if (attempt < retries - 1) { await new Promise(function(r) { setTimeout(r, 3000); }); continue; }
          throw new Error('Request timed out. Try again.');
        }
        if (attempt < retries - 1) { await new Promise(function(r) { setTimeout(r, 2000); }); continue; }
        throw new Error('Network error: ' + (e.message || 'Check connection.'));
      }
      if (res.status === 429 && attempt < retries - 1) {
        var retryAfter = res.headers.get('retry-after');
        var retryMs = retryAfter ? (parseFloat(retryAfter) * 1000 + 500) : waitMs;
        await new Promise(function(r) { setTimeout(r, retryMs); });
        waitMs = Math.min(waitMs * 2, 30000);
        continue;
      }
      if (res.status === 429) throw new Error('Rate limited. Wait 30s and try again.');
      if (res.status === 401) throw new Error('Invalid Groq API key. Check Settings.');
      if (!res.ok) throw new Error('AI error: HTTP ' + res.status);
      var data;
      try { data = await res.json(); } catch (e) {
        if (attempt < retries - 1) { await new Promise(function(r) { setTimeout(r, 2000); }); continue; }
        throw new Error('Invalid AI response. Try again.');
      }
      var content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      if (!content.trim() && attempt < retries - 1) { await new Promise(function(r) { setTimeout(r, 2000); }); continue; }
      return content.trim();
    }
    throw new Error('Failed after retries. Try again.');
  }

  return { getKey, setKey, hasKey, analyzeNews, analyzeAnalysts, analyzeMacro, summarizeTranscript, generateVerdict, analyzeFundamentals, analyzeTechnicals, chatAdvisor };
})();
