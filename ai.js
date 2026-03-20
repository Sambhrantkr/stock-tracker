/**
 * AI News Analysis using Groq (free tier, 14,400 req/day)
 * Uses Llama model for fast inference
 * Get your free key at: https://console.groq.com/keys
 */
const NewsAI = (() => {
  const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const MODEL = 'llama-3.1-8b-instant';

  function getKey() { return localStorage.getItem('groq_api_key') || ''; }
  function setKey(key) { localStorage.setItem('groq_api_key', key.trim()); }
  function hasKey() { return getKey().length > 0; }

  /** Groq fetch with auto-retry on 429 rate limit */
  async function groqFetch(messages, maxTokens, temperature) {
    var retries = 3;
    var waitMs = 3000;
    for (var attempt = 0; attempt < retries; attempt++) {
      var res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + getKey(),
        },
        body: JSON.stringify({
          model: MODEL,
          messages: messages,
          temperature: temperature || 0.3,
          max_tokens: maxTokens || 800,
        }),
      });
      if (res.status === 429 && attempt < retries - 1) {
        await new Promise(function(r) { setTimeout(r, waitMs); });
        waitMs *= 2;
        continue;
      }
      if (res.status === 429) throw new Error('AI rate limited. Wait a moment and try again.');
      if (res.status === 401) throw new Error('Invalid Groq API key.');
      if (!res.ok) throw new Error('AI error: HTTP ' + res.status);
      var data = await res.json();
      var content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      var cleaned = content.trim();
      if (cleaned.indexOf('```') === 0) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      try {
        return JSON.parse(cleaned);
      } catch (e) {
        throw new Error('AI returned invalid format. Try again.');
      }
    }
  }

  /**
   * Analyze news articles for a stock and return:
   * - AI summary of all news
   * - Valuation impact signals (bullish/bearish/neutral per article)
   * - Overall long-term outlook
   * - Key trigger events that could move valuation
   */
  async function analyzeNews(symbol, companyName, articles, kpis) {
    if (!hasKey()) throw new Error('Groq API key required for AI analysis.');
    if (!articles || !articles.length) throw new Error('No news to analyze.');

    const newsList = articles.map((a, i) =>
      `${i + 1}. "${a.title}" (${a.publisher}, ${a.date})${a.summary ? '\n   ' + a.summary : ''}`
    ).join('\n');

    const kpiContext = kpis ? `Current KPIs: P/E=${kpis.peRatio}, EPS=${kpis.eps}, Market Cap=${kpis.marketCap}, 52W High=${kpis.week52High}, 52W Low=${kpis.week52Low}, Beta=${kpis.beta}, Div Yield=${kpis.dividendYield}` : '';

    const prompt = `You are a senior equity research analyst. Analyze these recent news articles for ${symbol} (${companyName || symbol}) and provide a concise investment-focused analysis.

${kpiContext}

Recent News:
${newsList}

Respond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):
{
  "summary": "2-3 sentence summary of the overall news narrative and what it means for the company",
  "longTermOutlook": "BULLISH" or "BEARISH" or "NEUTRAL",
  "outlookReason": "1 sentence explaining the long-term valuation outlook",
  "valuationImpact": [
    {
      "factor": "short label (e.g. Revenue Growth, Margin Pressure, Market Share)",
      "direction": "POSITIVE" or "NEGATIVE" or "NEUTRAL",
      "detail": "1 sentence on how this affects long-term valuation"
    }
  ],
  "keyTriggers": [
    {
      "event": "specific event from the news",
      "impact": "HIGH" or "MEDIUM" or "LOW",
      "explanation": "1 sentence on why this could trigger a long-term valuation change"
    }
  ]
}

Keep valuationImpact to 2-4 items max. Keep keyTriggers to 1-3 items max. Be specific, not generic.`;

    return groqFetch([{ role: 'user', content: prompt }], 800, 0.3);
  }

  /**
   * Analyze analyst upgrades/downgrades and recommendation trends.
   * Returns: { summary, consensus, consensusReason, analystActions: [{firm, action, detail}] }
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
   * Returns: { summary, impact, impactReason, macroFactors: [{factor, direction, detail}], risks: [{risk, severity, detail}] }
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
   * Returns: { summary, sentiment, sentimentReason, keyHighlights, guidance, risks }
   */
  async function summarizeTranscript(symbol, companyName, earnings, articles, kpis, avTranscript) {
    if (!hasKey()) throw new Error('Groq API key required for AI analysis.');

    var transcriptText = '';
    if (avTranscript && avTranscript.transcript && avTranscript.transcript.length) {
      // Use real transcript from Alpha Vantage — condense to fit token limits
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
      // Only use news if we don't have a real transcript
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
   * Returns: { verdict, priceTarget, currentPrice, upside, confidence, summary, bull, bear, catalysts, risks, timeHorizon }
   */
  async function generateVerdict(symbol, companyName, allData) {
    if (!hasKey()) throw new Error('Groq API key required.');

    var sections = '';

    // Quote
    if (allData.quote) {
      var q = allData.quote;
      sections += 'CURRENT PRICE: $' + q.price.toFixed(2) + ' (Change: ' + (q.change >= 0 ? '+' : '') + q.change.toFixed(2) + ', ' + q.changePct.toFixed(2) + '%)\n';
      sections += 'Day High: $' + q.high.toFixed(2) + ', Day Low: $' + q.low.toFixed(2) + ', Prev Close: $' + q.prevClose.toFixed(2) + '\n\n';
    }

    // KPIs
    if (allData.financials) {
      var f = allData.financials;
      sections += 'KEY METRICS: P/E=' + (f.peRatio || 'N/A') + ', Fwd P/E=' + (f.forwardPE || 'N/A') + ', EPS=' + (f.eps || 'N/A') + ', Div Yield=' + (f.dividendYield || 'N/A') + ', Beta=' + (f.beta || 'N/A') + ', 52W High=' + (f.week52High || 'N/A') + ', 52W Low=' + (f.week52Low || 'N/A') + ', Profit Margin=' + (f.profitMargin || 'N/A') + ', Revenue Growth=' + (f.revenueGrowth || 'N/A') + '\n\n';
    }

    // Profile
    if (allData.profile) {
      var p = allData.profile;
      sections += 'COMPANY: ' + (p.name || symbol) + ', Sector: ' + (p.sector || 'N/A') + ', Market Cap: ' + (p.marketCap ? '$' + (p.marketCap / 1e9).toFixed(1) + 'B' : 'N/A') + '\n\n';
    }

    // Earnings
    if (allData.earnings && allData.earnings.length) {
      sections += 'EARNINGS HISTORY (last ' + allData.earnings.length + ' quarters):\n';
      var beats = 0, total = 0;
      allData.earnings.forEach(function(e) {
        var result = '';
        if (e.actual != null && e.estimate != null) {
          total++;
          if (e.actual > e.estimate) { beats++; result = ' BEAT'; }
          else if (e.actual < e.estimate) result = ' MISS';
          else result = ' MET';
        }
        sections += '  ' + e.period + ': EPS $' + (e.actual != null ? e.actual.toFixed(2) : 'N/A') + ' vs Est $' + (e.estimate != null ? e.estimate.toFixed(2) : 'N/A') + result + '\n';
      });
      if (total > 0) sections += '  Beat Rate: ' + Math.round(beats / total * 100) + '% (' + beats + '/' + total + ')\n';
      sections += '\n';
    }

    // Analyst consensus
    if (allData.recommendations && allData.recommendations.length) {
      var r = allData.recommendations[0];
      sections += 'ANALYST CONSENSUS (' + r.period + '): Strong Buy=' + (r.strongBuy || 0) + ', Buy=' + (r.buy || 0) + ', Hold=' + (r.hold || 0) + ', Sell=' + (r.sell || 0) + ', Strong Sell=' + (r.strongSell || 0) + '\n\n';
    }

    // AI results summaries (if available)
    if (allData.aiResult) {
      sections += 'NEWS AI ANALYSIS: Outlook=' + (allData.aiResult.longTermOutlook || 'N/A') + '. ' + (allData.aiResult.summary || '') + '\n\n';
    }
    if (allData.analystAIResult) {
      sections += 'ANALYST AI SUMMARY: Consensus=' + (allData.analystAIResult.consensus || 'N/A') + '. ' + (allData.analystAIResult.summary || '') + '\n\n';
    }
    if (allData.macroAIResult) {
      sections += 'MACRO IMPACT: ' + (allData.macroAIResult.impact || 'N/A') + '. ' + (allData.macroAIResult.summary || '') + '\n\n';
    }
    if (allData.transcriptAIResult) {
      sections += 'EARNINGS CALL: Sentiment=' + (allData.transcriptAIResult.sentiment || 'N/A') + '. ' + (allData.transcriptAIResult.summary || '') + '\n\n';
    }

    // Fundamentals AI analysis
    if (allData.fundamentalsResult) {
      var fr = allData.fundamentalsResult;
      sections += 'FUNDAMENTALS ANALYSIS: Growth=' + (fr.growthOutlook || 'N/A') + ', Margins=' + (fr.marginTrend || 'N/A') + ', Health=' + (fr.healthScore || 'N/A') + ', Sentiment=' + (fr.sentimentLabel || 'N/A') + '. ' + (fr.summary || '') + '\n';
      if (fr.strengths && fr.strengths.length) {
        sections += '  Strengths: ' + fr.strengths.map(function(s) { return s.area; }).join(', ') + '\n';
      }
      if (fr.weaknesses && fr.weaknesses.length) {
        sections += '  Weaknesses: ' + fr.weaknesses.map(function(w) { return w.area; }).join(', ') + '\n';
      }
      sections += '\n';
    }

    // Extended financials for verdict
    if (allData.financials) {
      var ef = allData.financials;
      var extMetrics = [];
      if (ef.grossMargin != null) extMetrics.push('Gross Margin=' + ef.grossMargin.toFixed(1) + '%');
      if (ef.operatingMargin != null) extMetrics.push('Op Margin=' + ef.operatingMargin.toFixed(1) + '%');
      if (ef.netMargin != null) extMetrics.push('Net Margin=' + ef.netMargin.toFixed(1) + '%');
      if (ef.roeTTM != null) extMetrics.push('ROE=' + ef.roeTTM.toFixed(1) + '%');
      if (ef.roicTTM != null) extMetrics.push('ROIC=' + ef.roicTTM.toFixed(1) + '%');
      if (ef.debtEquity != null) extMetrics.push('D/E=' + ef.debtEquity.toFixed(2));
      if (ef.currentRatio != null) extMetrics.push('Current Ratio=' + ef.currentRatio.toFixed(2));
      if (ef.revenueGrowth3Y != null) extMetrics.push('Rev Growth 3Y=' + ef.revenueGrowth3Y.toFixed(1) + '%');
      if (ef.revenueGrowth5Y != null) extMetrics.push('Rev Growth 5Y=' + ef.revenueGrowth5Y.toFixed(1) + '%');
      if (extMetrics.length) {
        sections += 'EXTENDED FINANCIALS: ' + extMetrics.join(', ') + '\n\n';
      }
    }

    // AV Overview extras
    if (allData.avOverview) {
      var avo = allData.avOverview;
      var avExtras = [];
      if (avo.FullTimeEmployees) avExtras.push('Employees=' + avo.FullTimeEmployees);
      if (avo.PriceToBookRatio) avExtras.push('P/B=' + avo.PriceToBookRatio);
      if (avo.EVToEBITDA) avExtras.push('EV/EBITDA=' + avo.EVToEBITDA);
      if (avo.PriceToSalesRatioTTM) avExtras.push('P/S=' + avo.PriceToSalesRatioTTM);
      if (avExtras.length) {
        sections += 'ADDITIONAL VALUATION: ' + avExtras.join(', ') + '\n\n';
      }
    }

    // Sentiment data
    if (allData.avSentiment && allData.avSentiment.length) {
      var bullCount = 0, bearCount = 0, neutCount = 0;
      allData.avSentiment.forEach(function(s) {
        if (s.tickerSentiment) {
          var lbl = s.tickerSentiment.label.toLowerCase();
          if (lbl.indexOf('bullish') !== -1) bullCount++;
          else if (lbl.indexOf('bearish') !== -1) bearCount++;
          else neutCount++;
        }
      });
      var sentTotal = bullCount + bearCount + neutCount;
      if (sentTotal > 0) {
        sections += 'NEWS SENTIMENT (' + sentTotal + ' articles): Bullish=' + bullCount + ', Neutral=' + neutCount + ', Bearish=' + bearCount + ' (' + Math.round(bullCount / sentTotal * 100) + '% bullish)\n\n';
      }
    }

    // Peer comparison summary
    if (allData.peers && allData.peers.length) {
      sections += 'PEER COMPARISON (' + allData.peers.length + ' peers):\n';
      allData.peers.forEach(function(p) {
        var pf = p.financials || {};
        var pq = p.quote || {};
        sections += '  ' + p.symbol + ': Price=$' + (pq.price ? pq.price.toFixed(2) : 'N/A') + ', P/E=' + (pf.peRatio || 'N/A') + ', Rev Growth=' + (pf.revenueGrowth || 'N/A') + ', Margin=' + (pf.profitMargin || 'N/A') + '\n';
      });
      sections += '\n';
    }

    // Insider trading data
    if (allData.insiderTrades && allData.insiderTrades.length) {
      var iBuys = 0, iSells = 0, iBuyVal = 0, iSellVal = 0;
      allData.insiderTrades.forEach(function(t) {
        if (t.code === 'P' || t.code === 'A') {
          iBuys++;
          if (t.price) iBuyVal += Math.abs(t.change) * t.price;
        } else if (t.code === 'S') {
          iSells++;
          if (t.price) iSellVal += Math.abs(t.change) * t.price;
        }
      });
      var iSignal = 'NEUTRAL';
      if (iBuys > 0 && iSells === 0) iSignal = 'BULLISH';
      else if (iBuys > iSells * 1.5) iSignal = 'BULLISH';
      else if (iSells > iBuys * 1.5) iSignal = 'BEARISH';
      else if (iSells > 0 && iBuys === 0) iSignal = 'BEARISH';
      sections += 'INSIDER TRADING (' + allData.insiderTrades.length + ' transactions): Buys=' + iBuys + ', Sells=' + iSells + ', Signal=' + iSignal + '\n';
      if (iBuyVal > 0) sections += '  Total Buy Value: $' + (iBuyVal / 1e6).toFixed(2) + 'M\n';
      if (iSellVal > 0) sections += '  Total Sell Value: $' + (iSellVal / 1e6).toFixed(2) + 'M\n';
      // Notable transactions (top 3 by value)
      var notable = allData.insiderTrades.filter(function(t) { return t.price && t.change; })
        .sort(function(a, b) { return Math.abs(b.change * (b.price || 0)) - Math.abs(a.change * (a.price || 0)); })
        .slice(0, 3);
      if (notable.length) {
        sections += '  Notable: ';
        notable.forEach(function(t) {
          var type = t.code === 'P' ? 'BUY' : t.code === 'S' ? 'SELL' : t.code === 'A' ? 'AWARD' : t.code;
          sections += t.name + ' ' + type + ' $' + (Math.abs(t.change * t.price) / 1e6).toFixed(2) + 'M; ';
        });
        sections += '\n';
      }
      sections += '\n';
    }

    // Recent news headlines
    if (allData.articles && allData.articles.length) {
      sections += 'RECENT NEWS (' + allData.articles.length + ' articles):\n';
      allData.articles.slice(0, 5).forEach(function(a) {
        sections += '  - ' + a.title + ' (' + a.publisher + ', ' + a.date + ')\n';
      });
      sections += '\n';
    }

    var prompt = 'You are a senior trade analyst at a top investment bank with 20+ years of experience. Based on ALL the following data for ' + symbol + ' (' + (companyName || symbol) + '), provide your final investment verdict.\n\n' + sections + 'Respond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):\n{\n  "verdict": "STRONG BUY" or "BUY" or "HOLD" or "SELL" or "STRONG SELL",\n  "confidence": "HIGH" or "MEDIUM" or "LOW",\n  "priceTarget": <number - your 12-month price target>,\n  "timeHorizon": "12 months",\n  "summary": "3-4 sentence executive summary of your investment thesis",\n  "verdictReason": "2-3 sentences explaining why you chose this specific verdict and price target",\n  "bull": [\n    "1 sentence bull case point"\n  ],\n  "bear": [\n    "1 sentence bear case point"\n  ],\n  "catalysts": [\n    {\n      "event": "specific upcoming catalyst",\n      "timeline": "when (e.g. Q2 2025, Next 3 months)",\n      "impact": "HIGH" or "MEDIUM" or "LOW"\n    }\n  ],\n  "risks": [\n    {\n      "risk": "specific risk",\n      "severity": "HIGH" or "MEDIUM" or "LOW",\n      "mitigation": "1 sentence on what could mitigate this"\n    }\n  ]\n}\n\nKeep bull to 3-4 points. Keep bear to 2-3 points. Keep catalysts to 2-3 items. Keep risks to 2-3 items.\nBe SPECIFIC with numbers. Your price target must be a realistic number based on the data. Show your conviction.';

    var result = await groqFetch([{ role: 'user', content: prompt }], 1000, 0.4);
    // Attach current price for upside calc
    if (allData.quote) result.currentPrice = allData.quote.price;
    if (result.priceTarget && allData.quote) {
      result.upside = ((result.priceTarget - allData.quote.price) / allData.quote.price * 100).toFixed(1);
    }
    return result;
  }

  /**
   * Analyze company fundamentals — growth, margins, health, sentiment.
   * Returns: { summary, growthOutlook, marginTrend, healthScore, sentimentSummary, strengths, weaknesses, keyInsights }
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

  return { getKey, setKey, hasKey, analyzeNews, analyzeAnalysts, analyzeMacro, summarizeTranscript, generateVerdict, analyzeFundamentals };
})();
