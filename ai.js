/**
 * AI News Analysis using Groq + Google Gemini (dual-provider for rate limit resilience)
 * Groq: https://console.groq.com/keys
 * Gemini: https://aistudio.google.com/apikey
 */
const NewsAI = (() => {
  const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const GEMINI_MODEL = 'gemini-2.0-flash';

  // ── Model tiers (each has its own Groq rate limit bucket) ──
  // LIGHT: fast, high RPD — news, analyst, macro analysis (offloaded to Gemini when available)
  const MODEL_LIGHT = 'llama-3.1-8b-instant';
  // MID: good quality, high TPM — technicals, fundamentals, transcript
  const MODEL_MID = 'meta-llama/llama-4-scout-17b-16e-instruct';
  // DEEP: best reasoning — senior analyst verdict, chat advisor
  const MODEL_DEEP = 'llama-3.3-70b-versatile';

  // Legacy alias
  const MODEL = MODEL_LIGHT;

  function getKey() { return (typeof Auth !== 'undefined' && Auth.isLoggedIn()) ? (Auth.getItem('groq_api_key') || '') : (localStorage.getItem('groq_api_key') || ''); }
  function setKey(key) { if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) Auth.setItem('groq_api_key', key.trim()); else localStorage.setItem('groq_api_key', key.trim()); }
  function hasKey() { return getKey().length > 0; }

  // ── Groq key 2 (second account for double throughput) ──
  function getKey2() { return (typeof Auth !== 'undefined' && Auth.isLoggedIn()) ? (Auth.getItem('groq_api_key_2') || '') : (localStorage.getItem('groq_api_key_2') || ''); }
  function setKey2(key) { if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) Auth.setItem('groq_api_key_2', key.trim()); else localStorage.setItem('groq_api_key_2', key.trim()); }
  function hasKey2() { return getKey2().length > 0; }

  // Round-robin counter for alternating between Groq keys
  var _groqKeyToggle = 0;
  function _nextGroqKey() {
    if (!hasKey2()) return getKey();
    _groqKeyToggle = (_groqKeyToggle + 1) % 2;
    return _groqKeyToggle === 0 ? getKey() : getKey2();
  }

  // ── Gemini key management ──
  function getGeminiKey() { return (typeof Auth !== 'undefined' && Auth.isLoggedIn()) ? (Auth.getItem('gemini_api_key') || '') : (localStorage.getItem('gemini_api_key') || ''); }
  function setGeminiKey(key) { if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) Auth.setItem('gemini_api_key', key.trim()); else localStorage.setItem('gemini_api_key', key.trim()); }
  function hasGeminiKey() { return getGeminiKey().length > 0; }

  // ── Per-model rate-limit queues ──
  // Each model has its own 30 RPM bucket on Groq, so we run separate queues.
  // This gives us ~90 RPM combined instead of 30.
  var _modelQueues = {};
  var GROQ_MIN_GAP_MS = 2500; // ~24 req/min per model, safe under 30 RPM

  function _getModelQueue(model) {
    if (!_modelQueues[model]) {
      _modelQueues[model] = { queue: [], running: false, lastCallTime: 0, backoffUntil: 0 };
    }
    return _modelQueues[model];
  }

  function _groqEnqueue(fn, model) {
    var mq = _getModelQueue(model || MODEL_LIGHT);
    return new Promise(function(resolve, reject) {
      mq.queue.push({ fn: fn, resolve: resolve, reject: reject });
      _groqProcessModelQueue(mq);
    });
  }

  async function _groqProcessModelQueue(mq) {
    if (mq.running || !mq.queue.length) return;
    mq.running = true;
    while (mq.queue.length) {
      var item = mq.queue.shift();
      var now = Date.now();
      var waitUntil = Math.max(mq.lastCallTime + GROQ_MIN_GAP_MS, mq.backoffUntil);
      if (now < waitUntil) {
        await new Promise(function(r) { setTimeout(r, waitUntil - now); });
      }
      try {
        var result = await item.fn();
        mq.lastCallTime = Date.now();
        mq.backoffUntil = 0;
        item.resolve(result);
      } catch (e) {
        mq.lastCallTime = Date.now();
        if (e.message && (e.message.toLowerCase().indexOf('rate') !== -1 || e.message.indexOf('Network') !== -1)) {
          mq.backoffUntil = Date.now() + 15000;
        }
        item.reject(e);
      }
    }
    mq.running = false;
  }

  // ── Gemini rate-limit queue ──
  var _geminiQueue = { queue: [], running: false, lastCallTime: 0, backoffUntil: 0 };
  var GEMINI_MIN_GAP_MS = 4200; // ~14 req/min, safe under 15 RPM free tier

  function _geminiEnqueue(fn) {
    return new Promise(function(resolve, reject) {
      _geminiQueue.queue.push({ fn: fn, resolve: resolve, reject: reject });
      _processGeminiQueue();
    });
  }

  async function _processGeminiQueue() {
    if (_geminiQueue.running || !_geminiQueue.queue.length) return;
    _geminiQueue.running = true;
    while (_geminiQueue.queue.length) {
      var item = _geminiQueue.queue.shift();
      var now = Date.now();
      var waitUntil = Math.max(_geminiQueue.lastCallTime + GEMINI_MIN_GAP_MS, _geminiQueue.backoffUntil);
      if (now < waitUntil) {
        await new Promise(function(r) { setTimeout(r, waitUntil - now); });
      }
      try {
        var result = await item.fn();
        _geminiQueue.lastCallTime = Date.now();
        _geminiQueue.backoffUntil = 0;
        item.resolve(result);
      } catch (e) {
        _geminiQueue.lastCallTime = Date.now();
        if (e.message && (e.message.toLowerCase().indexOf('rate') !== -1 || e.message.indexOf('429') !== -1)) {
          _geminiQueue.backoffUntil = Date.now() + 15000;
        }
        item.reject(e);
      }
    }
    _geminiQueue.running = false;
  }

  /** Gemini fetch with auto-retry. Converts OpenAI-style messages to Gemini format. */
  async function _geminiFetchDirect(messages, maxTokens, temperature) {
    var key = getGeminiKey();
    if (!key) throw new Error('Gemini API key not set.');
    var url = GEMINI_URL + GEMINI_MODEL + ':generateContent?key=' + key;

    // Convert messages to Gemini format
    var systemInstruction = null;
    var contents = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.role === 'system') {
        systemInstruction = { parts: [{ text: m.content }] };
      } else {
        contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
      }
    }

    var body = {
      contents: contents,
      generationConfig: {
        temperature: temperature || 0.3,
        maxOutputTokens: maxTokens || 800,
        responseMimeType: 'application/json'
      }
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;

    var retries = 2;
    var waitMs = 4000;
    for (var attempt = 0; attempt < retries; attempt++) {
      var res;
      try {
        var controller = new AbortController();
        var timeoutId = setTimeout(function() { controller.abort(); }, 30000);
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (e) {
        if (e.name === 'AbortError') {
          if (attempt < retries - 1) { await new Promise(function(r) { setTimeout(r, 3000); }); continue; }
          throw new Error('Gemini request timed out.');
        }
        if (attempt < 1) { await new Promise(function(r) { setTimeout(r, 2000); }); continue; }
        throw new Error('Network error reaching Gemini. Check connection.');
      }
      if (res.status === 429 && attempt < retries - 1) {
        var retryMs = waitMs;
        await new Promise(function(r) { setTimeout(r, retryMs); });
        waitMs = Math.min(waitMs * 2, 30000);
        continue;
      }
      if (res.status === 429) throw new Error('Gemini rate limited. Wait and try again.');
      if (res.status === 400) {
        var errData; try { errData = await res.json(); } catch(e2) { errData = {}; }
        throw new Error('Gemini error: ' + (errData.error && errData.error.message ? errData.error.message : 'Bad request'));
      }
      if (!res.ok) throw new Error('Gemini error: HTTP ' + res.status);
      var data;
      try { data = await res.json(); } catch (e) {
        if (attempt < retries - 1) { await new Promise(function(r) { setTimeout(r, 2000); }); continue; }
        throw new Error('Gemini returned invalid response.');
      }
      // Extract text from Gemini response
      var text = '';
      try { text = data.candidates[0].content.parts[0].text; } catch(e) {
        if (attempt < retries - 1) { await new Promise(function(r) { setTimeout(r, 2000); }); continue; }
        throw new Error('Gemini returned empty response.');
      }
      var cleaned = text.trim();
      if (cleaned.indexOf('```') === 0) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      // Try to extract JSON object even if surrounded by text
      if (cleaned.charAt(0) !== '{') {
        var jsonStart = cleaned.indexOf('{');
        var jsonEnd = cleaned.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd > jsonStart) {
          cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
        }
      }
      // Remove trailing commas before } or ]
      cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
      try { return JSON.parse(cleaned); } catch (e) {
        if (attempt < retries - 1) { await new Promise(function(r) { setTimeout(r, 2000); }); continue; }
        throw new Error('Gemini returned invalid JSON.');
      }
    }
  }

  /**
   * Smart fetch with dual-provider routing and auto-retry.
   * ALL tiers → Gemini primary (when key available), Groq fallback
   * DEEP without Gemini → Groq 70b only
   * This maximizes throughput by spreading load across both providers.
   */
  async function groqFetch(messages, maxTokens, temperature, opts) {
    var useModel = (opts && opts.model) || MODEL_LIGHT;
    var isDeep = (useModel === MODEL_DEEP);
    var lastError = null;

    for (var retry = 0; retry < 3; retry++) {
      if (retry > 0) {
        var waitSec = 5 + retry * 5; // 10s, 15s — faster retries
        console.log('[AI] Retry ' + retry + '/2 — waiting ' + waitSec + 's...');
        await new Promise(function(r) { setTimeout(r, waitSec * 1000); });
      }

      // === ALL tiers: Gemini primary, Groq fallback ===
      if (hasGeminiKey()) {
        var tierLabel = isDeep ? 'DEEP' : (useModel === MODEL_MID ? 'MID' : 'LIGHT');
        try {
          console.log('[AI] → Gemini (' + tierLabel + ')' + (retry ? ' [retry ' + retry + ']' : ''));
          return await _geminiEnqueue(function() {
            return _geminiFetchDirect(messages, maxTokens, temperature);
          });
        } catch (e) {
          console.warn('[AI] Gemini failed: ' + e.message);
          lastError = e;
          try {
            console.log('[AI] → Groq fallback (' + tierLabel + ')');
            return await _groqEnqueue(function() {
              return _groqFetchDirect(messages, maxTokens, temperature, opts);
            }, useModel);
          } catch (e2) {
            console.warn('[AI] Groq fallback also failed: ' + e2.message);
            lastError = e2;
            continue;
          }
        }
      }

      // === No Gemini key — Groq only ===
      try {
        console.log('[AI] → Groq (' + useModel.split('/').pop() + ')' + (retry ? ' [retry ' + retry + ']' : ''));
        return await _groqEnqueue(function() {
          return _groqFetchDirect(messages, maxTokens, temperature, opts);
        }, useModel);
      } catch (e) {
        console.warn('[AI] Groq failed: ' + e.message);
        lastError = e;
        continue;
      }
    }
    // All retries exhausted
    throw lastError || new Error('AI request failed after retries.');
  }

  async function _groqFetchDirect(messages, maxTokens, temperature, opts) {
    var useModel = (opts && opts.model) || MODEL;
    var useTimeout = (opts && opts.timeoutMs) || 30000;
    var apiKey = _nextGroqKey(); // round-robin between keys
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
            'Authorization': 'Bearer ' + apiKey,
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
        // Network errors: retry once quickly, then fail fast to unblock the queue
        if (attempt < 1) { await new Promise(function(r) { setTimeout(r, 2000); }); continue; }
        throw new Error('Network error reaching Groq AI. Check your connection and try again.');
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
      // Try to extract JSON object even if surrounded by text
      if (cleaned.charAt(0) !== '{') {
        var jsonStart = cleaned.indexOf('{');
        var jsonEnd = cleaned.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd > jsonStart) {
          cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
        }
      }
      // Remove trailing commas before } or ]
      cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
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
  async function analyzeNews(symbol, companyName, articles, kpis, isETF) {
    if (!hasKey()) throw new Error('Groq API key required for AI analysis.');
    if (!articles || !articles.length) throw new Error('No news to analyze.');

    var newsList = '';
    articles.forEach(function(a, i) {
      newsList += (i + 1) + '. "' + a.title + '" (' + a.publisher + ', ' + a.date + ')';
      if (a.summary) newsList += '\n   ' + a.summary;
      newsList += '\n';
    });

    var kpiContext = kpis ? 'Current KPIs: P/E=' + (kpis.peRatio || 'N/A') + ', EPS=' + (kpis.eps || 'N/A') + ', Market Cap=' + (kpis.marketCap || 'N/A') + ', 52W High=' + (kpis.week52High || 'N/A') + ', 52W Low=' + (kpis.week52Low || 'N/A') + ', Beta=' + (kpis.beta || 'N/A') + ', Div Yield=' + (kpis.dividendYield || 'N/A') : '';

    var sysMsg = 'You are David Reeves — Senior Equity News Analyst & Market Intelligence Lead.\n';
    sysMsg += 'Background: 18 years at Bloomberg Intelligence and Dow Jones covering equity markets. Former investigative journalist at the Wall Street Journal.\n';
    sysMsg += 'You are known for:\n';
    sysMsg += '- Separating signal from noise in news flow — identifying which headlines actually move valuations\n';
    sysMsg += '- Deep understanding of how news catalysts transmit to stock prices (revenue impact, multiple expansion/compression, sentiment shifts)\n';
    sysMsg += '- Tracking competitive dynamics — reading between the lines on market share shifts, pricing power, and supply chain moves\n';
    sysMsg += '- Identifying second-order effects that most analysts miss (e.g., a supplier win implies demand strength at the customer)\n';
    sysMsg += '- Connecting micro news (company-specific) to the broader sector and macro narrative\n\n';
    sysMsg += 'YOUR ANALYTICAL FRAMEWORK:\n';
    sysMsg += '1. REVENUE IMPACT: Does this news affect top-line growth? New products, partnerships, market expansion, customer wins/losses\n';
    sysMsg += '2. MARGIN IMPACT: Does this affect profitability? Cost changes, pricing power, efficiency gains, regulatory costs\n';
    sysMsg += '3. COMPETITIVE POSITION: Does this strengthen or weaken the company vs peers? Market share, moat, barriers to entry\n';
    sysMsg += '4. MANAGEMENT & GOVERNANCE: Leadership changes, strategy shifts, insider activity, corporate actions (M&A, buybacks, splits)\n';
    sysMsg += '5. SENTIMENT & NARRATIVE: Is the market narrative shifting? Analyst tone changes, media coverage intensity, social sentiment\n';
    sysMsg += '6. TIMELINE: Is this a near-term catalyst (days/weeks) or a structural shift (quarters/years)?\n\n';
    sysMsg += 'RULES:\n';
    sysMsg += '- For EVERY news item, explain the specific transmission mechanism to ' + symbol + ' stock price\n';
    sysMsg += '- Quantify impact where possible (e.g., "this contract could add ~5% to annual revenue")\n';
    sysMsg += '- Flag any news that contradicts the current consensus or could trigger a re-rating\n';
    sysMsg += '- Distinguish between noise (short-term sentiment) and signal (fundamental value change)\n';
    sysMsg += '- Always respond in exact JSON format. No markdown, no commentary outside JSON.';
    if (isETF) {
      sysMsg += '\n\nETF-SPECIFIC CONTEXT: ' + symbol + ' is an ETF (Exchange-Traded Fund), NOT an individual stock.\n';
      sysMsg += '- Focus on sector rotation, fund flows, holdings impact, and thematic trends rather than company-specific revenue/margin analysis\n';
      sysMsg += '- News about top holdings affects the ETF. News about the sector/theme the ETF tracks is most relevant.\n';
      sysMsg += '- Valuation impact should reference NAV premium/discount, expense ratio competitiveness, and fund flow trends rather than P/E or earnings.';
    }

    var entityLabel = isETF ? 'ETF' : 'stock';
    var prompt = 'Analyze these recent news articles for ' + symbol + ' (' + (companyName || symbol) + ').' + (isETF ? ' This is an ETF — focus on sector/thematic news, fund flows, and holdings impact.' : ' For each significant piece of news, explain exactly HOW and WHY it matters for the stock.') + '\n\n' + kpiContext + '\n\nRecent News:\n' + newsList + '\n\nRespond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):\n{\n  "summary": "3-4 sentence summary of the overall news narrative — what is the market learning about this ' + entityLabel + ' right now? What is the dominant theme?",\n  "longTermOutlook": "BULLISH" or "BEARISH" or "NEUTRAL",\n  "outlookReason": "2 sentences explaining the long-term outlook based on the news flow and how it changes (or confirms) the investment thesis",\n  "valuationImpact": [\n    {\n      "factor": "short label (e.g. ' + (isETF ? 'Sector Rotation, Fund Flows, Holdings Performance, Thematic Trend, Regulatory Risk' : 'Revenue Growth, Margin Pressure, Market Share, Competitive Threat, Regulatory Risk') + ')",\n      "direction": "POSITIVE" or "NEGATIVE" or "NEUTRAL",\n      "magnitude": "HIGH" or "MEDIUM" or "LOW",\n      "detail": "2 sentences: what happened and exactly how it transmits to the ' + entityLabel + ' valuation"\n    }\n  ],\n  "keyTriggers": [\n    {\n      "event": "specific event from the news",\n      "impact": "HIGH" or "MEDIUM" or "LOW",\n      "timeline": "IMMEDIATE" or "WEEKS" or "QUARTERS" or "STRUCTURAL",\n      "explanation": "2 sentences on why this could trigger a price move and what to watch for confirmation"\n    }\n  ],\n  "narrativeShift": "1-2 sentences: is the market narrative around this ' + entityLabel + ' changing? If so, from what to what?"\n}\n\nKeep valuationImpact to 3-5 items. Keep keyTriggers to 2-4 items. Be specific — cite the actual news, not generic observations.';

    return groqFetch([{ role: 'system', content: sysMsg }, { role: 'user', content: prompt }], 1000, 0.3);
  }

  /**
   * Analyze analyst upgrades/downgrades and recommendation trends.
   */
  async function analyzeAnalysts(symbol, companyName, recommendations, upgrades, kpis, isETF) {
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

    var prompt = 'You are Rachel Torres — Head of Sell-Side Research Intelligence.\n';
    prompt += 'Background: 15 years tracking Wall Street analyst behavior at Citadel and Point72. Expert at reading between the lines of analyst actions.\n';
    prompt += 'You are known for: identifying when analyst consensus is about to shift, spotting conviction calls vs herd behavior, and understanding the politics behind upgrades/downgrades.\n\n';
    if (isETF) {
      prompt += 'IMPORTANT: ' + symbol + ' is an ETF (Exchange-Traded Fund). Analyst ratings here are fund-level ratings, not individual stock ratings. Focus on fund recommendation trends, Morningstar/Lipper ratings if referenced, and how analyst sentiment toward the ETF\'s sector/theme is shifting.\n\n';
    }
    prompt += 'Analyze the following analyst activity for ' + symbol + ' (' + (companyName || symbol) + ') from the last 30 days.\n\n' + kpiContext + '\n\n' + recText + upgradeText;
    prompt += '\n\nYOUR ANALYTICAL FRAMEWORK:\n';
    prompt += '1. CONSENSUS MOMENTUM: Is the consensus shifting? Are upgrades accelerating or are we seeing early cracks?\n';
    prompt += '2. CONVICTION SIGNALS: Which actions show real conviction (large target changes, rare strong buy/sell) vs routine maintenance?\n';
    prompt += '3. CONTRARIAN INDICATORS: Is the consensus too crowded in one direction? When everyone agrees, the risk is highest.\n';
    prompt += '4. FIRM QUALITY: Weight actions from top-tier firms (GS, MS, JPM, BAC) more heavily than boutiques.\n';
    prompt += '5. PRICE TARGET SPREAD: Wide spread = high uncertainty. Narrow spread = consensus is firm.\n\n';
    prompt += 'Respond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):\n{\n  "summary": "3-4 sentences: what is the analyst community saying about ' + symbol + '? Is the consensus shifting? What is the conviction level?",\n  "consensus": "BULLISH" or "BEARISH" or "NEUTRAL",\n  "consensusReason": "2 sentences explaining the consensus view and whether it is strengthening or weakening",\n  "keyTakeaways": [\n    {\n      "point": "short takeaway label",\n      "detail": "2 sentences: what happened, which firm, and why it matters for the stock"\n    }\n  ],\n  "contrarian": "1-2 sentences: what could the consensus be wrong about? What is the biggest risk to the consensus view?"\n}\n\nKeep keyTakeaways to 3-5 items. Be specific about which firms and what actions they took. Flag any outlier calls.';

    return groqFetch([{ role: 'user', content: prompt }], 800, 0.3);
  }

  /**
   * Analyze macro/economy news in the context of a specific stock.
   */
  async function analyzeMacro(symbol, companyName, macroArticles, kpis, sector, isETF) {
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

    // System persona: macro economics reporter
    var sysMsg = 'You are Sarah Mitchell — Chief Economics Correspondent and Macro Analyst.\n';
    sysMsg += 'Background: 20 years covering global economics for Reuters, Bloomberg, and the Financial Times.\n';
    sysMsg += 'You are known for:\n';
    sysMsg += '- Deep expertise in Federal Reserve policy, interest rate cycles, and their market impact\n';
    sysMsg += '- Tracking geopolitical conflicts (wars, trade wars, sanctions) and their economic ripple effects\n';
    sysMsg += '- Analyzing US employment data (jobs reports, unemployment, wage growth) and what it signals\n';
    sysMsg += '- Decoding government policies (fiscal stimulus, regulation, tariffs, tax changes) and their sector-specific impact\n';
    sysMsg += '- Connecting global macro events (China slowdown, EU energy crisis, emerging market stress) to US equities\n\n';
    sysMsg += 'YOUR FOCUS AREAS (prioritize these when analyzing headlines):\n';
    sysMsg += '1. FED & MONETARY POLICY: Interest rate decisions, inflation data (CPI/PCE), quantitative tightening, Fed speeches\n';
    sysMsg += '2. GEOPOLITICS & WARS: Armed conflicts, trade wars, sanctions, supply chain disruptions, oil/energy shocks\n';
    sysMsg += '3. EMPLOYMENT & LABOR: Jobs reports, unemployment claims, wage inflation, labor market tightness\n';
    sysMsg += '4. GOVERNMENT POLICY: Fiscal spending, tax policy, regulation changes, infrastructure bills, industry-specific legislation\n';
    sysMsg += '5. GLOBAL ECONOMY: GDP data, recession signals, currency moves, sovereign debt, commodity prices\n\n';
    sysMsg += 'RULES:\n';
    sysMsg += '- Filter out noise — focus on articles that relate to the 5 areas above. Ignore fluff or company-specific news.\n';
    sysMsg += '- Be specific about HOW each macro factor transmits to the stock (e.g. "higher rates increase TSLA financing costs for buyers").\n';
    sysMsg += '- Always state the current macro regime (tightening/easing, expansion/contraction) and where we are in the cycle.\n';
    sysMsg += '- Always respond in the exact JSON format requested. No markdown, no commentary outside JSON.';
    if (isETF) {
      sysMsg += '\n\nETF-SPECIFIC CONTEXT: ' + symbol + ' is an ETF, not an individual stock. Macro factors affect the ETF through its basket of holdings and sector exposure. Explain how macro themes transmit to the ETF\'s underlying holdings and sector weighting, not a single company\'s business lines.';
    }

    var prompt = 'Analyze these recent macro/economy/market news headlines. Focus on the key economic themes — Fed policy, wars/geopolitics, employment, government policy, and global economy.\n';
    prompt += 'Then explain their impact specifically on ' + symbol + ' (' + (companyName || symbol) + ').' + (isETF ? ' This is an ETF — explain how macro factors affect its sector/thematic exposure and underlying holdings.' : '') + '\n\n';
    prompt += sectorStr + '\n' + kpiContext + '\n\n';
    prompt += 'Recent Macro & Economy News:\n' + newsList + '\n\n';
    prompt += 'Respond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):\n';
    prompt += '{\n';
    prompt += '  "macroRegime": "1-2 sentences describing the current macro regime (e.g. late-cycle tightening, early easing, stagflation risk) and where we are in the economic cycle",\n';
    prompt += '  "summary": "3-4 sentences: the most important macro developments from these headlines, what they mean for the broader market, and specifically how they transmit to ' + symbol + ' (through demand, costs, financing, regulation, or sentiment)",\n';
    prompt += '  "impact": "POSITIVE" or "NEGATIVE" or "MIXED",\n';
    prompt += '  "impactReason": "2 sentences on the overall macro impact on ' + symbol + ' — be specific about the transmission mechanism (e.g. higher rates -> higher discount rate -> lower growth stock valuations, or tariffs -> input cost increase -> margin compression)",\n';
    prompt += '  "macroFactors": [\n';
    prompt += '    {\n';
    prompt += '      "factor": "short label from: Fed Policy, Interest Rates, Inflation, Geopolitics/Wars, Trade Policy, Employment, Government Policy, GDP/Growth, Energy/Commodities, Currency, Consumer Spending",\n';
    prompt += '      "direction": "TAILWIND" or "HEADWIND" or "NEUTRAL",\n';
    prompt += '      "magnitude": "HIGH" or "MEDIUM" or "LOW",\n';
    prompt += '      "detail": "2 sentences: what is happening with this macro factor AND exactly how it affects ' + symbol + ' — cite the specific business line, revenue segment, cost structure, or customer base that is impacted"\n';
    prompt += '    }\n';
    prompt += '  ],\n';
    prompt += '  "risks": [\n';
    prompt += '    {\n';
    prompt += '      "risk": "specific macro risk tied to headlines",\n';
    prompt += '      "severity": "HIGH" or "MEDIUM" or "LOW",\n';
    prompt += '      "probability": "HIGH" or "MEDIUM" or "LOW",\n';
    prompt += '      "detail": "2 sentences: why this is a risk for ' + symbol + ' and what would trigger it"\n';
    prompt += '    }\n';
    prompt += '  ],\n';
    prompt += '  "sectorImpact": "1-2 sentences on how these macro factors affect the ' + (sector || 'broader') + ' sector specifically, and whether ' + symbol + ' is better or worse positioned than sector peers"\n';
    prompt += '}\n\n';
    prompt += 'Keep macroFactors to 3-5 items. Keep risks to 2-3 items. Only include factors supported by the actual headlines — do not invent macro themes not present in the news. Always explain the SPECIFIC transmission mechanism to ' + symbol + '.';

    return groqFetch([{ role: 'system', content: sysMsg }, { role: 'user', content: prompt }], 1100, 0.3);
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
    var sysMsg = 'You are James Whitfield — Senior Earnings Analyst & Forensic Accountant.\n';
    sysMsg += 'Background: 20 years at Muddy Waters Research and Citron Research. CPA, CFA. Former SEC enforcement division.\n';
    sysMsg += 'You are known for:\n';
    sysMsg += '- Reading management tone and body language from transcripts — detecting confidence, evasion, and sandbagging\n';
    sysMsg += '- Forensic analysis of earnings quality — distinguishing sustainable earnings from one-time items, accounting tricks, and channel stuffing\n';
    sysMsg += '- Identifying guidance games — when management is sandbagging (setting low bar to beat) vs genuinely cautious\n';
    sysMsg += '- Tracking key operating metrics that predict future earnings before they show up in financials\n';
    sysMsg += '- Spotting divergences between what management says and what the numbers show\n\n';
    sysMsg += 'RULES: Be forensic. Question everything. If management is vague on a topic, flag it. Always respond in exact JSON format.';

    var prompt = sourceNote + ', provide a comprehensive analysis of ' + symbol + ' (' + (companyName || symbol) + ') most recent earnings results.\n\n' + kpiContext + '\n\n' + earningsText + transcriptText + newsText + '\n\nRespond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):\n{\n  "summary": "4-5 sentence executive summary: key financial results, management tone, forward outlook, and what the market is pricing in vs what the numbers show",\n  "sentiment": "POSITIVE" or "NEGATIVE" or "CAUTIOUS" or "CONFIDENT",\n  "sentimentReason": "2 sentences on the overall tone — is management genuinely confident or performing? Any red flags in language?",\n  "earningsQuality": "HIGH" or "MEDIUM" or "LOW",\n  "earningsQualityReason": "1-2 sentences: are these earnings sustainable? Any one-time items, accounting changes, or revenue recognition concerns?",\n  "keyHighlights": [\n    {\n      "topic": "short label (e.g. Revenue Beat, Margin Expansion, User Growth, Guidance Raise)",\n      "detail": "2-3 sentences: what happened, by how much, and what it signals for the next 2-4 quarters"\n    }\n  ],\n  "guidance": [\n    {\n      "metric": "what metric (e.g. Revenue, EPS, Margins, CapEx)",\n      "direction": "RAISED" or "LOWERED" or "MAINTAINED" or "INTRODUCED" or "WITHDRAWN",\n      "detail": "1-2 sentences on the forward guidance and whether management is sandbagging or genuinely cautious"\n    }\n  ],\n  "risks": [\n    {\n      "risk": "risk or concern from the earnings",\n      "detail": "1-2 sentences: what went wrong or what management was evasive about"\n    }\n  ],\n  "managementCredibility": "1-2 sentences: based on beat/miss history and guidance accuracy, how credible is this management team?"\n}\n\nKeep keyHighlights to 3-5 items. Keep guidance to 2-3 items. Keep risks to 2-3 items. Be specific about numbers — cite actual figures.';

    return groqFetch([{ role: 'system', content: sysMsg }, { role: 'user', content: prompt }], 1100, 0.3, { model: MODEL_MID });
  }

  /**
   * Senior Analyst Verdict — aggregates ALL data into a final recommendation.
   * Uses system persona + structured briefing for deeper, more rigorous analysis.
   * Increased token budget (1500) and temperature (0.5) for nuanced reasoning.
   */
  async function generateVerdict(symbol, companyName, allData, isETF) {
    if (!hasKey()) throw new Error('Groq API key required.');

    // ── SYSTEM PERSONA (condensed) ──
    var sysMsg;
    if (isETF) {
      sysMsg = 'You are Marcus Chen, CFA, CAIA — MD & Head of ETF & Passive Strategy Research. 25yr veteran (BlackRock, Vanguard, own fund).\n';
      sysMsg += 'Known for: ETF selection, portfolio construction, cost analysis, tracking efficiency, sector rotation.\n\n';
      sysMsg += 'ETF ANALYTICAL FRAMEWORK:\n';
      sysMsg += '1. HOLDINGS ANALYSIS: Top holdings concentration, sector allocation, overlap risk, single-stock dominance\n';
      sysMsg += '2. COST & STRUCTURE: Expense ratio, tracking error, AUM, liquidity, bid-ask spread\n';
      sysMsg += '3. PERFORMANCE: Price momentum, relative to benchmark, risk-adjusted returns\n';
      sysMsg += '4. MACRO ALIGNMENT: Does this ETF benefit from current macro regime? Sector tailwinds/headwinds?\n';
      sysMsg += '5. TECHNICALS: Price trend, support/resistance, RSI, moving averages\n';
      sysMsg += '6. NEWS & SENTIMENT: Fund flows, sector rotation signals, regulatory changes\n';
      sysMsg += '7. RISK ASSESSMENT: Concentration risk, sector risk, liquidity risk, correlation to broad market\n';
      sysMsg += '8. SYNTHESIS: Integrate all factors. Price target based on technical levels + macro outlook.\n\n';
      sysMsg += 'RULES: No fabrication. ETFs have NO earnings, P/E, cash flow, insider trades, or DCF. Focus on holdings, cost, macro, technicals. JSON only.';
    } else {
      sysMsg = 'You are Marcus Chen, CFA, CMT — MD & Head of Cross-Asset Equity Research. 25yr veteran (GS, MS, own fund).\n';
      sysMsg += 'Known for: calling inflection points early, rigorous multi-factor analysis, brutal honesty, quantitative price targets.\n\n';
      sysMsg += 'ANALYTICAL FRAMEWORK (follow before writing verdict):\n';
      sysMsg += '1. BUSINESS QUALITY: Moat, margins (gross/op/net), ROE, ROIC vs cost of capital\n';
      sysMsg += '2. GROWTH: Revenue/EPS growth trajectory (1Y/3Y/5Y), organic vs acquired, guidance\n';
      sysMsg += '3. FINANCIAL HEALTH: FCF, debt/equity, current ratio, cash, capex\n';
      sysMsg += '4. VALUATION: P/E vs peers+history, EV/EBITDA, P/S, DCF if cash flow available. Price target MUST use one method.\n';
      sysMsg += '   DCF: latest FCF base, 5Y growth from trend, WACC=10%, terminal=2.5-3%, shares=MCap/Price\n';
      sysMsg += '5. CATALYSTS & RISKS: News-driven events that could move stock 10%+. Check news/macro sections carefully.\n';
      sysMsg += '   New business lines (AI, robotaxis, etc.) can have outsized impact — reflect in price target.\n';
      sysMsg += '6. SIGNAL CONVERGENCE: Do technicals, sentiment, insiders, analysts agree? Divergence = lower confidence.\n';
      sysMsg += '7. SYNTHESIS: Integrate all factors. STRONG BUY/SELL need HIGH confidence + catalysts + valuation support.\n';
      sysMsg += '8. EPS MOMENTUM: Rising estimates + beats = strong. Falling + misses = weak.\n\n';
      sysMsg += 'RULES: No fabrication. Data SHOWS vs INFER. Be contrarian when supported. Specific price target. JSON only.';
    }

    // ── BUILD COMPACT DATA BRIEFING (token-optimized) ──
    var b = '';
    var today = new Date();
    b += 'BRIEFING: ' + symbol + ' (' + (companyName || symbol) + ') | ' + today.toISOString().split('T')[0] + '\n\n';

    // ── SECTION 1: PRICE ──
    b += '[PRICE]\n';
    if (allData.quote) {
      var q = allData.quote;
      b += 'Price: $' + q.price.toFixed(2) + ' | Chg: ' + (q.change >= 0 ? '+' : '') + q.change.toFixed(2) + ' (' + q.changePct.toFixed(2) + '%) | Range: $' + q.low.toFixed(2) + '-$' + q.high.toFixed(2) + '\n';
    } else { b += '[NO QUOTE]\n'; }

    // ── SECTION 2: PROFILE (compact) ──
    b += '\n[PROFILE]\n';
    if (allData.profile) {
      var p = allData.profile;
      b += (p.name || symbol) + ' | ' + (p.sector || 'N/A') + ' | MCap: ' + (p.marketCap ? '$' + (p.marketCap / 1e9).toFixed(1) + 'B' : 'N/A') + '\n';
    }
    if (allData.avOverview && allData.avOverview.Description) {
      b += allData.avOverview.Description.substring(0, 150) + '...\n';
    }

    // ── ETF-SPECIFIC BRIEFING PATH ──
    if (isETF) {
      // ETF Holdings
      b += '\n[ETF HOLDINGS]\n';
      if (allData.etfHoldings && allData.etfHoldings.holdings && allData.etfHoldings.holdings.length) {
        if (allData.etfHoldings.atDate) b += 'As of: ' + allData.etfHoldings.atDate + '\n';
        var topWeight = 0;
        allData.etfHoldings.holdings.slice(0, 15).forEach(function(h) {
          b += h.symbol + ' (' + (h.name || '') + '): ' + (h.percent != null ? (h.percent * 100).toFixed(2) + '%' : 'N/A') + '\n';
          if (h.percent) topWeight += h.percent;
        });
        b += 'Top ' + Math.min(15, allData.etfHoldings.holdings.length) + ' holdings = ' + (topWeight * 100).toFixed(1) + '% of fund\n';
      } else { b += '[NO HOLDINGS DATA]\n'; }

      // ETF Valuation (limited)
      b += '\n[ETF METRICS]\n';
      if (allData.financials) {
        var ef = allData.financials;
        b += 'Beta=' + (ef.beta || 'N/A') + ' | DivYield=' + (ef.dividendYield || 'N/A');
        b += ' | 52W: ' + (ef.week52Low || 'N/A') + ' - ' + (ef.week52High || 'N/A') + '\n';
      }

      // Technicals
      b += '\n[TECHNICALS]\n';
      if (allData.technicalsResult) {
        var tech = allData.technicalsResult;
        b += 'Signal=' + (tech.signal || 'N/A');
        if (tech.support) b += ' Sup=' + tech.support;
        if (tech.resistance) b += ' Res=' + tech.resistance;
        b += '\n';
        if (tech.summary) b += tech.summary + '\n';
      }
      if (allData.rsiData && allData.rsiData.length) {
        var rsiVal = allData.rsiData[0].rsi;
        b += 'RSI=' + rsiVal.toFixed(1) + (rsiVal > 70 ? ' OVERBOUGHT' : rsiVal < 30 ? ' OVERSOLD' : '') + ' ';
      }
      if (allData.macdData && allData.macdData.length) {
        b += 'MACD=' + allData.macdData[0].histogram.toFixed(3) + (allData.macdData[0].histogram >= 0 ? ' BULL' : ' BEAR') + ' ';
      }
      if (allData.sma50Data && allData.sma50Data.length && allData.sma200Data && allData.sma200Data.length) {
        b += (allData.sma50Data[0].sma > allData.sma200Data[0].sma ? 'GOLDEN CROSS' : 'DEATH CROSS');
        b += ' SMA50=' + allData.sma50Data[0].sma.toFixed(2) + ' SMA200=' + allData.sma200Data[0].sma.toFixed(2);
      }
      if (allData.rsiData || allData.macdData || allData.sma50Data) b += '\n';

      // News & Sentiment
      b += '\n[NEWS & SENTIMENT]\n';
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
        if (sentT > 0) b += 'Sentiment: Bull=' + bullC + ' Neut=' + neutC + ' Bear=' + bearC + ' (' + Math.round(bullC / sentT * 100) + '% bull)\n';
      }
      if (allData.articles && allData.articles.length) {
        allData.articles.slice(0, 5).forEach(function(a) {
          b += '- ' + a.title;
          if (a.summary) b += ' | ' + a.summary.substring(0, 100);
          b += '\n';
        });
      }
      if (allData.macroArticles && allData.macroArticles.length) {
        b += 'Macro Headlines:\n';
        allData.macroArticles.slice(0, 4).forEach(function(a) {
          b += '- ' + a.title;
          if (a.summary) b += ' | ' + a.summary.substring(0, 100);
          b += '\n';
        });
      }

      // AI Sub-analyst summaries
      b += '\n[AI ANALYSES]\n';
      if (allData.aiResult) {
        b += 'NEWS: ' + (allData.aiResult.longTermOutlook || 'N/A') + ' -- ' + (allData.aiResult.summary || '') + '\n';
      }
      if (allData.macroAIResult) {
        var mai = allData.macroAIResult;
        b += 'MACRO: ' + (mai.impact || 'N/A') + ' -- ' + (mai.summary || '');
        if (mai.macroRegime) b += ' Regime: ' + mai.macroRegime;
        b += '\n';
      }
      if (allData.technicalsResult) {
        b += 'TECHNICALS: Signal=' + (allData.technicalsResult.signal || 'N/A') + ' -- ' + (allData.technicalsResult.summary || '') + '\n';
      }

      // Data coverage
      var dataAvail = 0, dataTotal = 0, missing = [];
      function _chkE(ok, name) { dataTotal++; if (ok) dataAvail++; else missing.push(name); }
      _chkE(allData.quote, 'Quote'); _chkE(allData.profile, 'Profile');
      _chkE(allData.etfHoldings && allData.etfHoldings.holdings, 'Holdings');
      _chkE(allData.articles && allData.articles.length, 'News');
      _chkE(allData.macroAIResult, 'MacroAI'); _chkE(allData.technicalsResult, 'TechAI');
      b += '\n[DATA] ' + dataAvail + '/' + dataTotal + ' sources.';
      if (missing.length) b += ' Missing: ' + missing.join(', ');
      b += '\n';

      // ETF user prompt
      var userMsg = 'Analyze this ETF briefing for ' + symbol + ' and deliver your verdict.\n\n';
      userMsg += 'INSTRUCTIONS:\n';
      userMsg += '- This is an ETF, NOT an individual stock. Do NOT reference earnings, P/E, cash flow, insider trades, or DCF.\n';
      userMsg += '- Focus on: holdings concentration, sector exposure, macro alignment, technical levels, cost efficiency.\n';
      userMsg += '- Price target should be based on technical analysis + macro outlook + sector momentum.\n';
      userMsg += '- Assess concentration risk from top holdings.\n';
      userMsg += '- News/macro catalysts MUST be reflected in your thesis and price target.\n\n';
      userMsg += b;
      userMsg += '\nRespond in EXACT JSON (no markdown):\n';
      userMsg += '{"verdict":"STRONG BUY|BUY|HOLD|SELL|STRONG SELL","confidence":"HIGH|MEDIUM|LOW",';
      userMsg += '"priceTarget":<number>,"timeHorizon":"12 months",';
      userMsg += '"thinkingProcess":"4-6 sentences covering key analytical steps",';
      userMsg += '"summary":"4-5 sentence thesis focused on ETF merits",';
      userMsg += '"verdictReason":"2-3 sentences on price target derivation + method used",';
      userMsg += '"dataQuality":"1 sentence on data gaps",';
      userMsg += '"holdingsAnalysis":"2-3 sentences on top holdings, concentration, sector tilt",';
      userMsg += '"sectorExposure":"primary sectors and allocation bias",';
      userMsg += '"bull":["specific point with numbers"],"bear":["specific point"],';
      userMsg += '"catalysts":[{"event":"...","timeline":"...","impact":"HIGH|MED|LOW"}],';
      userMsg += '"risks":[{"risk":"...","severity":"HIGH|MED|LOW","mitigation":"..."}]}\n';
      userMsg += 'Keep bull 3-4, bear 2-3, catalysts 2-3, risks 2-3. Be specific with numbers.';

      var result = await groqFetch([
        { role: 'system', content: sysMsg },
        { role: 'user', content: userMsg }
      ], 2000, 0.5, { model: MODEL_DEEP, timeoutMs: 60000 });

      if (allData.quote) result.currentPrice = allData.quote.price;
      if (result.priceTarget && allData.quote) {
        result.upside = ((result.priceTarget - allData.quote.price) / allData.quote.price * 100).toFixed(1);
      }
      result._isETF = true;
      return result;
    }

    // ── STOCK-SPECIFIC BRIEFING (original path) ──

    // ── SECTION 3: VALUATION METRICS ──
    b += '\n[VALUATION]\n';
    if (allData.financials) {
      var f = allData.financials;
      var fwdPE = 'N/A';
      if (allData.avOverview && allData.avOverview.ForwardPE && allData.avOverview.ForwardPE !== 'None') fwdPE = allData.avOverview.ForwardPE;
      b += 'P/E=' + (f.peRatio || 'N/A') + ' | FwdP/E=' + fwdPE + ' | EPS=' + (f.eps || 'N/A') + ' | Beta=' + (f.beta || 'N/A') + ' | DivYld=' + (f.dividendYield || 'N/A') + '\n';
      b += '52W: ' + (f.week52Low || 'N/A') + ' - ' + (f.week52High || 'N/A') + '\n';
    }
    if (allData.avOverview) {
      var av = allData.avOverview;
      var valParts = [];
      if (av.PriceToBookRatio) valParts.push('P/B=' + av.PriceToBookRatio);
      if (av.EVToEBITDA) valParts.push('EV/EBITDA=' + av.EVToEBITDA);
      if (av.PriceToSalesRatioTTM) valParts.push('P/S=' + av.PriceToSalesRatioTTM);
      if (av.EVToRevenue) valParts.push('EV/Rev=' + av.EVToRevenue);
      if (av.PEGRatio) valParts.push('PEG=' + av.PEGRatio);
      if (valParts.length) b += valParts.join(' | ') + '\n';
    }

    // ── SECTION 4: GROWTH & MARGINS ──
    b += '\n[GROWTH & MARGINS]\n';
    if (allData.financials) {
      var ef = allData.financials;
      b += 'RevGrowth: 1Y=' + (ef.revenueGrowth1Y != null ? ef.revenueGrowth1Y.toFixed(1) + '%' : 'N/A') + ' 3Y=' + (ef.revenueGrowth3Y != null ? ef.revenueGrowth3Y.toFixed(1) + '%' : 'N/A') + ' 5Y=' + (ef.revenueGrowth5Y != null ? ef.revenueGrowth5Y.toFixed(1) + '%' : 'N/A') + '\n';
      b += 'EPSGrowth: 1Y=' + (ef.epsGrowth != null ? ef.epsGrowth.toFixed(1) + '%' : 'N/A') + ' 3Y=' + (ef.epsGrowth3Y != null ? ef.epsGrowth3Y.toFixed(1) + '%' : 'N/A') + ' 5Y=' + (ef.epsGrowth5Y != null ? ef.epsGrowth5Y.toFixed(1) + '%' : 'N/A') + '\n';
      b += 'Margins: Gross=' + (ef.grossMargin != null ? ef.grossMargin.toFixed(1) + '%' : 'N/A') + ' Op=' + (ef.operatingMargin != null ? ef.operatingMargin.toFixed(1) + '%' : 'N/A') + ' Net=' + (ef.netMargin != null ? ef.netMargin.toFixed(1) + '%' : 'N/A') + '\n';
      b += 'ROE=' + (ef.roeTTM != null ? ef.roeTTM.toFixed(1) + '%' : 'N/A') + ' ROIC=' + (ef.roicTTM != null ? ef.roicTTM.toFixed(1) + '%' : 'N/A') + ' D/E=' + (ef.debtEquity != null ? ef.debtEquity.toFixed(2) : 'N/A') + ' CurRatio=' + (ef.currentRatio != null ? ef.currentRatio.toFixed(2) : 'N/A') + '\n';
    }

    // ── SECTION 5: EARNINGS (compact) ──
    b += '\n[EARNINGS]\n';
    if (allData.earnings && allData.earnings.length) {
      var beats = 0, total = 0;
      allData.earnings.slice(0, 4).forEach(function(e) {
        var result = '';
        if (e.actual != null && e.estimate != null) {
          total++;
          if (e.actual > e.estimate) { beats++; result = ' BEAT'; }
          else if (e.actual < e.estimate) result = ' MISS';
          else result = ' MET';
        }
        b += e.period + ': $' + (e.actual != null ? e.actual.toFixed(2) : 'N/A') + ' vs $' + (e.estimate != null ? e.estimate.toFixed(2) : 'N/A') + result + '\n';
      });
      if (total > 0) b += 'Beat Rate: ' + Math.round(beats / total * 100) + '% (' + beats + '/' + total + ')\n';
    } else { b += '[NO EARNINGS DATA]\n'; }
    if (allData.earningsCalendar) {
      var ec = allData.earningsCalendar;
      var daysUntil = Math.ceil((new Date(ec.date) - new Date()) / 86400000);
      b += 'NEXT: ' + ec.date + ' (' + daysUntil + 'd)';
      if (ec.epsEstimate != null) b += ' Est $' + ec.epsEstimate.toFixed(2);
      b += '\n';
    }

    // ── SECTION 6: CASH FLOW & BALANCE SHEET (latest 2 quarters only) ──
    b += '\n[CASH FLOW]\n';
    if (allData.cashFlowData && allData.cashFlowData.length) {
      allData.cashFlowData.slice(0, 2).forEach(function(cf) {
        var yr = (cf.date || '').substring(0, 7);
        b += yr + ': OpCF=$' + (cf.operatingCashFlow != null ? (cf.operatingCashFlow / 1e9).toFixed(2) + 'B' : 'N/A');
        b += ' CapEx=$' + (cf.capitalExpenditure != null ? (cf.capitalExpenditure / 1e9).toFixed(2) + 'B' : 'N/A');
        b += ' FCF=$' + (cf.freeCashFlow != null ? (cf.freeCashFlow / 1e9).toFixed(2) + 'B' : 'N/A');
        b += ' NI=$' + (cf.netIncome != null ? (cf.netIncome / 1e9).toFixed(2) + 'B' : 'N/A') + '\n';
      });
    } else { b += '[NO CASH FLOW — DCF not possible]\n'; }
    if (allData.balanceSheetData && allData.balanceSheetData.length) {
      b += '[BALANCE SHEET]\n';
      allData.balanceSheetData.slice(0, 2).forEach(function(bs) {
        var yr = (bs.date || '').substring(0, 7);
        b += yr + ': Assets=$' + (bs.totalAssets != null ? (bs.totalAssets / 1e9).toFixed(1) + 'B' : 'N/A');
        b += ' Liab=$' + (bs.totalLiabilities != null ? (bs.totalLiabilities / 1e9).toFixed(1) + 'B' : 'N/A');
        b += ' Cash=$' + (bs.cash != null ? (bs.cash / 1e9).toFixed(1) + 'B' : 'N/A');
        b += ' Debt=$' + (bs.totalDebt != null ? (bs.totalDebt / 1e9).toFixed(1) + 'B' : 'N/A') + '\n';
      });
    }
    if (allData.incomeData && allData.incomeData.length) {
      b += '[INCOME]\n';
      allData.incomeData.slice(0, 2).forEach(function(inc) {
        var yr = (inc.date || '').substring(0, 7);
        b += yr + ': Rev=$' + (inc.revenue != null ? (inc.revenue / 1e9).toFixed(2) + 'B' : 'N/A');
        b += ' GP=$' + (inc.grossProfit != null ? (inc.grossProfit / 1e9).toFixed(2) + 'B' : 'N/A');
        b += ' OpInc=$' + (inc.operatingIncome != null ? (inc.operatingIncome / 1e9).toFixed(2) + 'B' : 'N/A');
        b += ' NI=$' + (inc.netIncome != null ? (inc.netIncome / 1e9).toFixed(2) + 'B' : 'N/A') + '\n';
      });
    }

    // ── SECTION 7: DIVIDENDS (1 line) ──
    var divYield = (allData.financials && allData.financials.dividendYield) ? allData.financials.dividendYield : null;
    var avDiv = allData.avOverview || {};
    if (divYield || (avDiv.DividendPerShare && avDiv.DividendPerShare !== 'None')) {
      b += '\n[DIVIDENDS] Yield=' + (divYield || 'N/A');
      if (avDiv.DividendPerShare && avDiv.DividendPerShare !== 'None') b += ' DPS=$' + avDiv.DividendPerShare;
      if (avDiv.PayoutRatio && avDiv.PayoutRatio !== 'None') b += ' Payout=' + (parseFloat(avDiv.PayoutRatio) * 100).toFixed(1) + '%';
      b += '\n';
    }

    // ── SECTION 8: ANALYST CONSENSUS (1 line) ──
    b += '\n[ANALYSTS]\n';
    if (allData.recommendations && allData.recommendations.length) {
      var r = allData.recommendations[0];
      b += r.period + ': StrongBuy=' + (r.strongBuy || 0) + ' Buy=' + (r.buy || 0) + ' Hold=' + (r.hold || 0) + ' Sell=' + (r.sell || 0) + ' StrongSell=' + (r.strongSell || 0) + '\n';
    } else { b += '[NO RATINGS]\n'; }

    // ── SECTION 9: INSIDER ACTIVITY (summary only) ──
    b += '\n[INSIDERS]\n';
    if (allData.insiderTrades && allData.insiderTrades.length) {
      var iBuys = 0, iSells = 0, iBuyVal = 0, iSellVal = 0;
      allData.insiderTrades.forEach(function(t) {
        if (t.code === 'P' || t.code === 'A') { iBuys++; if (t.price) iBuyVal += Math.abs(t.change) * t.price; }
        else if (t.code === 'S') { iSells++; if (t.price) iSellVal += Math.abs(t.change) * t.price; }
      });
      var iSignal = iBuys > iSells * 1.5 ? 'BULLISH' : iSells > iBuys * 1.5 ? 'BEARISH' : 'NEUTRAL';
      b += allData.insiderTrades.length + ' txns: Buys=' + iBuys + ' Sells=' + iSells + ' Signal=' + iSignal;
      if (iBuyVal > 0) b += ' BuyVal=$' + (iBuyVal / 1e6).toFixed(1) + 'M';
      if (iSellVal > 0) b += ' SellVal=$' + (iSellVal / 1e6).toFixed(1) + 'M';
      b += '\n';
    } else { b += '[NO INSIDER DATA]\n'; }

    // ── SECTION 10: TECHNICALS (compact) ──
    b += '\n[TECHNICALS]\n';
    if (allData.technicalsResult) {
      var tech = allData.technicalsResult;
      b += 'Signal=' + (tech.signal || 'N/A');
      if (tech.support) b += ' Sup=' + tech.support;
      if (tech.resistance) b += ' Res=' + tech.resistance;
      b += '\n';
      if (tech.summary) b += tech.summary + '\n';
    }
    if (allData.rsiData && allData.rsiData.length) {
      var rsiVal = allData.rsiData[0].rsi;
      b += 'RSI=' + rsiVal.toFixed(1) + (rsiVal > 70 ? ' OVERBOUGHT' : rsiVal < 30 ? ' OVERSOLD' : '') + ' ';
    }
    if (allData.macdData && allData.macdData.length) {
      b += 'MACD=' + allData.macdData[0].histogram.toFixed(3) + (allData.macdData[0].histogram >= 0 ? ' BULL' : ' BEAR') + ' ';
    }
    if (allData.sma50Data && allData.sma50Data.length && allData.sma200Data && allData.sma200Data.length) {
      b += (allData.sma50Data[0].sma > allData.sma200Data[0].sma ? 'GOLDEN CROSS' : 'DEATH CROSS');
      b += ' SMA50=' + allData.sma50Data[0].sma.toFixed(2) + ' SMA200=' + allData.sma200Data[0].sma.toFixed(2);
    }
    if (allData.rsiData || allData.macdData || allData.sma50Data) b += '\n';

    // ── SECTION 11: PEERS (compact) ──
    if (allData.peers && allData.peers.length) {
      b += '\n[PEERS]\n';
      allData.peers.forEach(function(pr) {
        var pf = pr.financials || {};
        var pq = pr.quote || {};
        b += pr.symbol + ': $' + (pq.price ? pq.price.toFixed(2) : 'N/A') + ' P/E=' + (pf.peRatio || 'N/A') + ' Growth=' + (pf.revenueGrowth || 'N/A') + '\n';
      });
    }

    // ── SECTION 12: NEWS (5 headlines max, 100 char summaries) ──
    b += '\n[NEWS & SENTIMENT]\n';
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
      if (sentT > 0) b += 'Sentiment: Bull=' + bullC + ' Neut=' + neutC + ' Bear=' + bearC + ' (' + Math.round(bullC / sentT * 100) + '% bull)\n';
    }
    if (allData.articles && allData.articles.length) {
      allData.articles.slice(0, 5).forEach(function(a) {
        b += '- ' + a.title;
        if (a.summary) b += ' | ' + a.summary.substring(0, 100);
        b += '\n';
      });
    }
    if (allData.macroArticles && allData.macroArticles.length) {
      b += 'Macro Headlines:\n';
      allData.macroArticles.slice(0, 4).forEach(function(a) {
        b += '- ' + a.title;
        if (a.summary) b += ' | ' + a.summary.substring(0, 100);
        b += '\n';
      });
    }

    // ── SECTION 13: EPS ESTIMATES ──
    if (allData.epsEstimates && allData.epsEstimates.quarterly && allData.epsEstimates.quarterly.length) {
      b += '\n[EPS ESTIMATES]\n';
      allData.epsEstimates.quarterly.forEach(function(e) {
        b += e.period + ': Avg=$' + (e.avg != null ? e.avg.toFixed(2) : 'N/A') + ' Hi=$' + (e.high != null ? e.high.toFixed(2) : 'N/A') + ' Lo=$' + (e.low != null ? e.low.toFixed(2) : 'N/A') + ' #' + (e.numAnalysts || 'N/A') + '\n';
      });
    }

    // ── SECTION 14: AI SUB-ANALYST SUMMARIES (compressed — summary + outlook only) ──
    b += '\n[AI ANALYSES]\n';
    if (allData.aiResult) {
      b += 'NEWS: ' + (allData.aiResult.longTermOutlook || 'N/A') + ' — ' + (allData.aiResult.summary || '') + '\n';
    }
    if (allData.analystAIResult) {
      b += 'ANALYST: ' + (allData.analystAIResult.consensus || 'N/A') + ' — ' + (allData.analystAIResult.summary || '') + '\n';
    }
    if (allData.macroAIResult) {
      var mai = allData.macroAIResult;
      b += 'MACRO: ' + (mai.impact || 'N/A') + ' — ' + (mai.summary || '');
      if (mai.macroRegime) b += ' Regime: ' + mai.macroRegime;
      b += '\n';
    }
    if (allData.transcriptAIResult) {
      b += 'EARNINGS: ' + (allData.transcriptAIResult.sentiment || 'N/A') + ' — ' + (allData.transcriptAIResult.summary || '') + '\n';
    }
    if (allData.fundamentalsResult) {
      var fr = allData.fundamentalsResult;
      b += 'FUNDAMENTALS: Growth=' + (fr.growthOutlook || 'N/A') + ' Margins=' + (fr.marginTrend || 'N/A') + ' Health=' + (fr.healthScore || 'N/A') + ' — ' + (fr.summary || '') + '\n';
    }

    // ── DATA COVERAGE (1 line) ──
    var dataAvail = 0;
    var dataTotal = 0;
    var missing = [];
    function _chk(ok, name) { dataTotal++; if (ok) dataAvail++; else missing.push(name); }
    _chk(allData.quote, 'Quote'); _chk(allData.profile, 'Profile'); _chk(allData.financials, 'Financials');
    _chk(allData.earnings && allData.earnings.length, 'Earnings'); _chk(allData.articles && allData.articles.length, 'News');
    _chk(allData.cashFlowData && allData.cashFlowData.length, 'CashFlow'); _chk(allData.aiResult, 'NewsAI');
    _chk(allData.macroAIResult, 'MacroAI'); _chk(allData.fundamentalsResult, 'FundamentalsAI'); _chk(allData.technicalsResult, 'TechAI');
    b += '\n[DATA] ' + dataAvail + '/' + dataTotal + ' sources.';
    if (missing.length) b += ' Missing: ' + missing.join(', ');
    b += '\n';

    // ── USER PROMPT (condensed) ──
    var userMsg = 'Analyze this briefing for ' + symbol + ' and deliver your verdict.\n\n';
    userMsg += 'INSTRUCTIONS:\n';
    userMsg += '- Walk through your 8-step framework. Document key findings in thinkingProcess.\n';
    userMsg += '- If cash flow data available, compute DCF: FCF base -> 5Y growth -> WACC 10% -> terminal 2.5% -> subtract net debt -> per share.\n';
    userMsg += '- If no cash flow, set intrinsicValue and dcfAssumptions to null.\n';
    userMsg += '- Check EPS estimates for revision momentum. Cross-ref with beat/miss rate.\n';
    userMsg += '- News/macro catalysts MUST be reflected in your thesis and price target.\n';
    userMsg += '- State which valuation method you used.\n\n';
    userMsg += b;
    userMsg += '\nRespond in EXACT JSON (no markdown):\n';
    userMsg += '{"verdict":"STRONG BUY|BUY|HOLD|SELL|STRONG SELL","confidence":"HIGH|MEDIUM|LOW",';
    userMsg += '"priceTarget":<number>,"timeHorizon":"12 months",';
    userMsg += '"thinkingProcess":"4-6 sentences covering key steps",';
    userMsg += '"summary":"4-5 sentence thesis",';
    userMsg += '"verdictReason":"2-3 sentences on price target derivation + valuation method used",';
    userMsg += '"dataQuality":"1 sentence on data gaps",';
    userMsg += '"intrinsicValue":<number|null>,"dcfAssumptions":"1-2 sentences or null",';
    userMsg += '"bull":["specific point with numbers"],"bear":["specific point"],';
    userMsg += '"catalysts":[{"event":"...","timeline":"...","impact":"HIGH|MED|LOW"}],';
    userMsg += '"risks":[{"risk":"...","severity":"HIGH|MED|LOW","mitigation":"..."}]}\n';
    userMsg += 'Keep bull 3-4, bear 2-3, catalysts 2-3, risks 2-3. Be specific with numbers.';

    // MODEL_DEEP, reduced to 2000 tokens (was 3000), 60s timeout
    var result = await groqFetch([
      { role: 'system', content: sysMsg },
      { role: 'user', content: userMsg }
    ], 2000, 0.5, { model: MODEL_DEEP, timeoutMs: 60000 });

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
  async function analyzeFundamentals(symbol, companyName, financials, overview, sentimentData, profile, isETF) {
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

    var sysMsg = 'You are Elena Vasquez — Director of Fundamental Research & Valuation.\n';
    sysMsg += 'Background: 17 years at Fidelity Investments and T. Rowe Price managing $2B+ in assets. CFA, MBA (Wharton).\n';
    if (isETF) {
      sysMsg += 'You are known for:\n';
      sysMsg += '- ETF due diligence: evaluating expense ratios, tracking error, liquidity, and fund structure\n';
      sysMsg += '- Holdings quality analysis: assessing the quality and concentration of an ETF\'s underlying basket\n';
      sysMsg += '- Fund flow analysis: tracking institutional and retail flows to gauge conviction\n';
      sysMsg += '- Sector/thematic exposure assessment: understanding what macro factors drive the ETF\'s returns\n';
      sysMsg += '- Competitive comparison: evaluating the ETF vs similar funds on cost, tracking, and liquidity\n\n';
      sysMsg += 'RULES: This is an ETF, not a stock. Do NOT analyze it like a company. Focus on fund-level metrics: expense ratio, AUM, tracking error, holdings concentration, sector exposure, and fund flows. Always respond in exact JSON format.';
    } else {
      sysMsg += 'You are known for:\n';
      sysMsg += '- Deep-dive fundamental analysis: dissecting financial statements to find what the market is missing\n';
      sysMsg += '- Margin trajectory analysis: predicting margin expansion/compression before it shows up in consensus estimates\n';
      sysMsg += '- Capital allocation scoring: evaluating how well management deploys capital (buybacks, M&A, R&D, dividends)\n';
      sysMsg += '- Competitive moat assessment: quantifying pricing power, switching costs, network effects, and scale advantages\n';
      sysMsg += '- Balance sheet forensics: identifying hidden risks in debt structure, off-balance-sheet items, and working capital trends\n\n';
      sysMsg += 'RULES: Every assessment must be backed by specific numbers from the data. Compare metrics to industry benchmarks where possible. Always respond in exact JSON format.';
    }

    var entityDesc = isETF ? 'ETF fundamentals' : 'company fundamentals';
    var summaryGuide = isETF
      ? '4-5 sentence executive summary: ETF quality, expense efficiency, holdings concentration, sector exposure, and whether the fund is well-positioned for current market conditions.'
      : '4-5 sentence executive summary: company quality, growth trajectory, financial health, and whether the fundamentals support the current valuation. Compare to sector benchmarks where possible.';
    var growthGuide = isETF ? '2 sentences on the ETF\'s performance trajectory — is the underlying sector/theme growing? Are fund flows accelerating?' : '2 sentences on the growth trajectory — is it organic or acquired? Sustainable or one-time?';
    var marginGuide = isETF ? '2 sentences on expense ratio competitiveness and whether the fund is gaining or losing assets to competitors' : '2 sentences on margin trends — what is driving them and are they sustainable?';
    var healthGuide = isETF ? '2 sentences on fund structure health — liquidity, tracking error, and ability to handle redemptions' : '2 sentences on balance sheet health — debt levels, cash position, and ability to weather a downturn';
    var capitalGuide = isETF ? '1-2 sentences on the fund manager\'s rebalancing strategy and index tracking methodology' : '1-2 sentences on how management is deploying capital (buybacks, dividends, M&A, R&D)';

    var prompt = 'Analyze the following ' + entityDesc + ' for ' + symbol + ' (' + (companyName || symbol) + ') and provide a comprehensive assessment.\n\n' + sections + 'Respond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):\n{\n  "summary": "' + summaryGuide + '",\n  "overallAssessment": "STRONG" or "ADEQUATE" or "WEAK",\n  "growthOutlook": "ACCELERATING" or "STABLE" or "DECELERATING" or "DECLINING",\n  "growthReason": "' + growthGuide + '",\n  "marginTrend": "EXPANDING" or "STABLE" or "COMPRESSING",\n  "marginReason": "' + marginGuide + '",\n  "healthScore": "STRONG" or "ADEQUATE" or "WEAK",\n  "healthReason": "' + healthGuide + '",\n  "capitalAllocation": "EXCELLENT" or "GOOD" or "POOR",\n  "capitalAllocationReason": "' + capitalGuide + '",\n  "sentimentLabel": "BULLISH" or "BEARISH" or "NEUTRAL" or "MIXED",\n  "sentimentReason": "1-2 sentences on market sentiment based on news flow and analyst positioning",\n  "strengths": [\n    {\n      "area": "short label",\n      "detail": "1-2 sentences with specific numbers"\n    }\n  ],\n  "weaknesses": [\n    {\n      "area": "short label",\n      "detail": "1-2 sentences with specific numbers"\n    }\n  ],\n  "keyInsights": [\n    {\n      "insight": "short label",\n      "detail": "1-2 sentences: actionable insight that most investors are missing"\n    }\n  ]\n}\n\nKeep strengths to 3-4 items. Keep weaknesses to 2-3 items. Keep keyInsights to 2-3 items. Be specific with numbers — cite actual metrics.';

    return groqFetch([{ role: 'system', content: sysMsg }, { role: 'user', content: prompt }], 1100, 0.3, { model: MODEL_MID });
  }

  /**
   * Analyze technical indicators — RSI, MACD, SMA.
   */
  async function analyzeTechnicals(symbol, companyName, rsi, macd, sma50, sma200, quote, isETF) {
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

    var sysMsg = 'You are Kenji Nakamura — Chief Technical Strategist & Quantitative Analyst.\n';
    sysMsg += 'Background: 22 years at Renaissance Technologies and Two Sigma. PhD in Applied Mathematics (MIT). CMT charterholder.\n';
    sysMsg += 'You are known for:\n';
    sysMsg += '- Multi-timeframe analysis: reading the daily, weekly, and monthly charts simultaneously to identify confluence zones\n';
    sysMsg += '- Identifying high-probability setups where multiple indicators align (RSI + MACD + SMA + volume)\n';
    sysMsg += '- Precise support/resistance levels based on historical price action, not round numbers\n';
    sysMsg += '- Understanding market microstructure: how institutional order flow creates support/resistance\n';
    sysMsg += '- Risk-defined trade setups: always specifying entry, stop-loss, and target levels\n\n';
    sysMsg += 'RULES: Be precise with numbers. Every claim must be backed by the indicator data. Always respond in exact JSON format.';
    if (isETF) {
      sysMsg += '\n\nETF NOTE: ' + symbol + ' is an ETF. Technical analysis applies the same way to ETFs, but note that support/resistance levels may reflect sector-wide flows rather than company-specific catalysts. Volume patterns may indicate institutional rebalancing or fund flow shifts.';
    }

    var prompt = 'Analyze the following technical indicators for ' + symbol + ' (' + (companyName || symbol) + ')' + (isETF ? ' (ETF)' : '') + ' and provide a comprehensive technical assessment.\n\n' + sections + '\nRespond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):\n{\n  "summary": "3-4 sentence technical analysis: current trend, momentum, and where the stock sits relative to key levels. Is this a trending or range-bound market?",\n  "signal": "BULLISH" or "BEARISH" or "NEUTRAL",\n  "signalStrength": "STRONG" or "MODERATE" or "WEAK",\n  "signalReason": "2 sentences explaining the overall technical signal and which indicators are driving it",\n  "indicators": [\n    {\n      "name": "indicator name (RSI, MACD, SMA50, SMA200, Golden/Death Cross)",\n      "value": "current value",\n      "signal": "BULLISH" or "BEARISH" or "NEUTRAL",\n      "interpretation": "1-2 sentences: what this indicator is saying and whether it confirms or diverges from the overall signal"\n    }\n  ],\n  "support": "nearest support level with reasoning",\n  "resistance": "nearest resistance level with reasoning",\n  "keyLevels": "1-2 sentences on critical price levels to watch — breakout/breakdown triggers",\n  "recommendation": "2 sentences: actionable recommendation for traders including entry zone, stop-loss level, and risk/reward assessment"\n}\n\nKeep indicators to 4-6 items. Be specific with numbers. Flag any divergences between indicators.';

    return groqFetch([{ role: 'system', content: sysMsg }, { role: 'user', content: prompt }], 900, 0.3, { model: MODEL_MID });
  }

  /**
   * Portfolio Wealth Manager — synthesizes all Senior Analyst verdicts into
   * a clean, actionable morning briefing with portfolio-level insights.
   * verdicts: array of verdict objects (each with _symbol, _name, _price, _change, verdict, etc.)
   */
  async function generatePortfolioBrief(verdicts) {
    if (!hasKey()) throw new Error('API key required.');
    if (!verdicts || !verdicts.length) throw new Error('No verdicts to analyze.');

    var sysMsg = 'You are Victoria Park — Senior Portfolio Strategist & Wealth Manager.\n';
    sysMsg += 'Background: 20 years at JPMorgan Private Bank and UBS Wealth Management. CFA, CAIA charterholder.\n';
    sysMsg += 'You manage $500M+ in client assets. You are known for:\n';
    sysMsg += '- Distilling complex multi-stock analysis into clear, actionable morning briefs\n';
    sysMsg += '- Portfolio-level thinking: correlation, concentration risk, sector exposure\n';
    sysMsg += '- Decisive action calls: exactly what to buy, sell, hold, and why\n';
    sysMsg += '- Risk-first mindset: always flag what could go wrong before what could go right\n\n';
    sysMsg += 'RULES: Be direct. No fluff. Every sentence must be actionable or informative. JSON only.';

    // Build compact data for each stock
    var data = '';
    verdicts.forEach(function(v, i) {
      data += (i + 1) + '. ' + v._symbol + ' (' + v._name + ')';
      data += ' | Price: $' + (v._price ? v._price.toFixed(2) : 'N/A');
      data += ' | Chg: ' + (v._change != null ? (v._change >= 0 ? '+' : '') + v._change.toFixed(2) + '%' : 'N/A');
      data += ' | Verdict: ' + (v.verdict || 'N/A');
      data += ' | Confidence: ' + (v.confidence || 'N/A');
      data += ' | Target: $' + (v.priceTarget ? v.priceTarget.toFixed(2) : 'N/A');
      data += ' | Upside: ' + (v.upside ? v.upside + '%' : 'N/A');
      if (v.intrinsicValue != null) data += ' | DCF: $' + parseFloat(v.intrinsicValue).toFixed(2);
      data += '\n';
      if (v.summary) data += '   Summary: ' + v.summary + '\n';
      if (v.verdictReason) data += '   Rationale: ' + v.verdictReason + '\n';
      if (v.bull && v.bull.length) data += '   Bull: ' + v.bull.slice(0, 2).join(' | ') + '\n';
      if (v.bear && v.bear.length) data += '   Bear: ' + v.bear.slice(0, 2).join(' | ') + '\n';
      if (v.catalysts && v.catalysts.length) data += '   Catalysts: ' + v.catalysts.map(function(c) { return c.event + ' (' + c.timeline + ')'; }).join(', ') + '\n';
    });

    var userMsg = 'Here are the Senior Analyst verdicts for my portfolio (' + verdicts.length + ' stocks):\n\n' + data;
    userMsg += '\nSynthesize into a morning portfolio brief. Respond in EXACT JSON:\n';
    userMsg += '{"portfolioVerdict":"BULLISH|BEARISH|CAUTIOUS|NEUTRAL",';
    userMsg += '"riskLevel":"LOW|MODERATE|ELEVATED|HIGH",';
    userMsg += '"summary":"3-4 sentence portfolio-level overview — overall positioning, key themes, biggest movers",';
    userMsg += '"actions":[{"symbol":"...","action":"BUY|SELL|HOLD|TRIM|ADD","urgency":"NOW|THIS WEEK|MONITOR","reason":"1 sentence"}],';
    userMsg += '"topPick":{"symbol":"...","reason":"1 sentence why this is the best opportunity right now"},';
    userMsg += '"topRisk":{"symbol":"...","reason":"1 sentence why this needs attention"},';
    userMsg += '"sectorExposure":"1 sentence on sector concentration or diversification",';
    userMsg += '"portfolioRisks":["1 sentence portfolio-level risk"],';
    userMsg += '"weekAhead":"2-3 sentences on what to watch this week — earnings, macro events, key levels"}\n';
    userMsg += 'Actions array must have one entry per stock. Be specific. No generic advice.';

    return groqFetch([
      { role: 'system', content: sysMsg },
      { role: 'user', content: userMsg }
    ], 2500, 0.4, { model: MODEL_DEEP, timeoutMs: 90000 });
  }

  /**
   * Chat with wealth advisor — streams text response (not JSON).
   * messages: array of { role, content } (full conversation history)
   * Returns plain text string (not parsed JSON).
   */
  async function chatAdvisor(messages, opts) {
    var useModel = (opts && opts.model) || MODEL_DEEP;
    // Chat always uses Groq DEEP — don't compete with Gemini queue
    return _groqEnqueue(function() {
      return _chatAdvisorDirect(messages, opts);
    }, useModel);
  }

  /** Gemini chat — returns plain text (not JSON) */
  async function _geminiChatDirect(messages, maxTokens, temperature) {
    var key = getGeminiKey();
    if (!key) throw new Error('Gemini API key not set.');
    var url = GEMINI_URL + GEMINI_MODEL + ':generateContent?key=' + key;

    var systemInstruction = null;
    var contents = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.role === 'system') {
        systemInstruction = { parts: [{ text: m.content }] };
      } else {
        contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
      }
    }

    var body = {
      contents: contents,
      generationConfig: { temperature: temperature || 0.5, maxOutputTokens: maxTokens || 2048 }
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;

    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 429) throw new Error('Gemini rate limited.');
    if (!res.ok) throw new Error('Gemini error: HTTP ' + res.status);
    var data = await res.json();
    try { return data.candidates[0].content.parts[0].text.trim(); } catch(e) { throw new Error('Gemini empty response.'); }
  }

  async function _chatAdvisorDirect(messages, opts) {
    var useModel = (opts && opts.model) || MODEL_DEEP;
    var useTimeout = (opts && opts.timeoutMs) || 60000;
    var maxTokens = (opts && opts.maxTokens) || 2048;
    var apiKey = _nextGroqKey(); // round-robin between keys
    var retries = 3;
    var waitMs = 8000;
    for (var attempt = 0; attempt < retries; attempt++) {
      var res;
      try {
        var controller = new AbortController();
        var timeoutId = setTimeout(function() { controller.abort(); }, useTimeout);
        res = await fetch(GROQ_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
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
        if (attempt < 1) { await new Promise(function(r) { setTimeout(r, 2000); }); continue; }
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

  /** Quick diagnostic — call NewsAI.testGemini() from browser console */
  async function testGemini() {
    if (!hasGeminiKey()) return 'No Gemini key saved. hasGeminiKey()=' + hasGeminiKey() + ', key length=' + getGeminiKey().length;
    try {
      var result = await _geminiFetchDirect(
        [{ role: 'user', content: 'Respond with exactly this JSON: {"status":"ok","provider":"gemini"}' }],
        100, 0.1
      );
      return 'Gemini OK: ' + JSON.stringify(result);
    } catch (e) {
      return 'Gemini FAILED: ' + e.message;
    }
  }

  /**
   * Screener Agent — conversational AI that translates plain English into screening criteria.
   * Returns JSON with structured criteria for the screening engine.
   */
  async function screenerAgent(messages) {
    var sysMsg = 'You are Marcus Chen — a warm, patient Personal Wealth Advisor with 22 years of experience helping everyday people invest wisely.\n';
    sysMsg += 'Background: Started as a financial planner at Vanguard, then ran your own boutique advisory firm for 15 years. You specialize in making investing accessible to people who feel intimidated by Wall Street jargon.\n\n';
    sysMsg += 'YOUR PERSONALITY:\n';
    sysMsg += '- You are genuinely curious about what the user wants to achieve — you ask thoughtful questions\n';
    sysMsg += '- You explain financial concepts in simple, relatable terms (use analogies, everyday language)\n';
    sysMsg += '- You build trust by being transparent about trade-offs ("higher growth usually means more risk")\n';
    sysMsg += '- You never assume the user knows technical terms — if you use one, explain it briefly\n';
    sysMsg += '- You are encouraging and supportive, never condescending\n';
    sysMsg += '- You guide the conversation step by step, never overwhelming with too many options at once\n\n';
    sysMsg += 'CONVERSATION FLOW (follow this carefully):\n\n';
    sysMsg += 'PHASE 1 — UNDERSTAND INTENT (1-2 messages):\n';
    sysMsg += '- Start by understanding WHY they want to invest. Ask about their goal in a friendly way.\n';
    sysMsg += '- Examples: "Are you looking to grow your money over time, or generate regular income like dividends?"\n';
    sysMsg += '- "Is this for retirement savings, a shorter-term goal, or are you just exploring?"\n';
    sysMsg += '- Keep it to ONE question at a time. Do not ask multiple questions.\n\n';
    sysMsg += 'PHASE 2 — EDUCATE & GUIDE (1-2 messages):\n';
    sysMsg += '- Based on their answer, explain what kind of stocks typically match their goal\n';
    sysMsg += '- Use simple language: "Growth stocks are companies growing their revenue fast — think of them as the up-and-comers. They can go up a lot, but they can also be bumpy rides."\n';
    sysMsg += '- Explain the key metrics you will use and WHY: "I will look at P/E ratio — that is basically how much you pay for each dollar the company earns. A lower P/E can mean a better deal, but sometimes cheap stocks are cheap for a reason."\n';
    sysMsg += '- Ask about their comfort with risk: "How do you feel about ups and downs? Some stocks swing 2-3% daily — is that okay, or would you prefer steadier ones?"\n\n';
    sysMsg += 'PHASE 3 — BUILD CRITERIA TOGETHER (1 message):\n';
    sysMsg += '- Summarize what you have learned about them and propose specific criteria\n';
    sysMsg += '- Explain each filter in plain English: "I am setting a minimum dividend yield of 2% — that means the company pays you at least 2 cents per year for every dollar you invest"\n';
    sysMsg += '- Present the criteria with confidence but invite feedback: "Here is what I have put together based on our conversation. Take a look and tell me if anything feels off."\n\n';
    sysMsg += 'IMPORTANT RULES:\n';
    sysMsg += '- Do NOT jump to criteria on the first message unless the user is clearly experienced and gives very specific technical requirements\n';
    sysMsg += '- If the user says something vague like "find me good stocks" or "I want to invest", start with Phase 1\n';
    sysMsg += '- If the user gives specific technical criteria ("P/E under 15, ROE above 20"), they are experienced — skip to Phase 3\n';
    sysMsg += '- NEVER use more than 2-3 short paragraphs per message. Keep it conversational, not lecture-like.\n';
    sysMsg += '- Use encouraging language: "Great choice", "That makes a lot of sense", "Smart thinking"\n';
    sysMsg += '- When you finally present criteria, make sure your "message" explains each filter in beginner-friendly terms\n';
    sysMsg += '- THINK DEEPLY before setting criteria. Consider: What combination of metrics truly identifies the best stocks for this goal? What thresholds separate great from mediocre?\n';
    sysMsg += '- Use MULTIPLE complementary filters that work together. For growth: combine revenue growth + EPS growth + margins. For value: combine P/E + P/B + ROE + debt.\n';
    sysMsg += '- Set REALISTIC but SELECTIVE thresholds. Too loose = noise, too tight = no results. Aim for filters that pass 5-15% of stocks.\n';
    sysMsg += '- Always include at least one profitability filter (margins, ROE, or EPS) to avoid junk stocks\n';
    sysMsg += '- Always include at least one financial health filter (debt, current ratio) to avoid risky companies\n';
    sysMsg += '- When the user says "growth", think: revenue growth + EPS growth + gross margin + reasonable valuation\n';
    sysMsg += '- When the user says "value", think: low P/E + low P/B + high ROE + low debt + positive earnings\n';
    sysMsg += '- When the user says "income/dividends", think: high yield + low payout risk (positive EPS, low debt) + stable business\n';
    sysMsg += '- When the user says "safe/conservative", think: low beta + high current ratio + low debt + positive margins + large cap\n';
    sysMsg += '- Default to type "both" (stocks AND ETFs) unless the user specifically asks for only one type\n\n';
    sysMsg += 'AVAILABLE SCREENING FIELDS (Finnhub metric names — use these internally, but explain them simply to the user):\n';
    sysMsg += '--- VALUATION ---\n';
    sysMsg += '- marketCap: market capitalization in millions (mega>200000, large=10000-200000, mid=2000-10000, small=300-2000, micro<300)\n';
    sysMsg += '- peTTM: trailing P/E ratio (low<15, moderate=15-25, high>25, negative=unprofitable)\n';
    sysMsg += '- pbAnnual: price-to-book ratio (low<1.5, moderate=1.5-3, high>3)\n';
    sysMsg += '- psAnnual: price-to-sales ratio (low<2, moderate=2-5, high>5)\n';
    sysMsg += '- epsTTM: earnings per share TTM\n';
    sysMsg += '--- DIVIDENDS ---\n';
    sysMsg += '- dividendYield: annual dividend yield % (high>4, good=2-4, moderate=1-2, low<1)\n';
    sysMsg += '--- GROWTH ---\n';
    sysMsg += '- revenueGrowthTTMYoy: revenue growth % year-over-year (trailing twelve months)\n';
    sysMsg += '- revenueGrowth3Y: revenue growth % 3-year CAGR\n';
    sysMsg += '- revenueGrowth5Y: revenue growth % 5-year CAGR\n';
    sysMsg += '- epsGrowthTTMYoy: EPS growth % year-over-year\n';
    sysMsg += '- epsGrowth3Y: EPS growth % 3-year CAGR\n';
    sysMsg += '- epsGrowth5Y: EPS growth % 5-year CAGR\n';
    sysMsg += '--- PROFITABILITY ---\n';
    sysMsg += '- grossMarginTTM: gross margin %\n';
    sysMsg += '- operatingMarginTTM: operating margin %\n';
    sysMsg += '- netProfitMarginTTM: net profit margin %\n';
    sysMsg += '- roeTTM: return on equity % (excellent>20, good=15-20, average=10-15)\n';
    sysMsg += '- roaTTM: return on assets %\n';
    sysMsg += '- roicTTM: return on invested capital % (excellent>15, good=10-15)\n';
    sysMsg += '--- FINANCIAL HEALTH ---\n';
    sysMsg += '- currentRatioQuarterly: current ratio (healthy>1.5, adequate=1-1.5, risky<1)\n';
    sysMsg += '- quickRatioQuarterly: quick ratio (healthy>1, risky<0.5)\n';
    sysMsg += '- totalDebtToEquityQuarterly: debt-to-equity ratio (low<0.5, moderate=0.5-1, high>1, very high>2)\n';
    sysMsg += '--- RISK & MOMENTUM ---\n';
    sysMsg += '- beta: volatility vs market (low<0.8, moderate=0.8-1.2, high>1.2)\n';
    sysMsg += '- price: current stock price\n';
    sysMsg += '- changePct: today\'s price change %\n';
    sysMsg += '- pctFrom52High: % distance from 52-week high (negative = below high, e.g. -20 means 20% below)\n';
    sysMsg += '- pctFrom52Low: % above 52-week low (positive = above low, e.g. 50 means 50% above)\n';
    sysMsg += '- 52WeekHigh: 52-week high price\n';
    sysMsg += '- 52WeekLow: 52-week low price\n';
    sysMsg += '--- CLASSIFICATION ---\n';
    sysMsg += '- sector: finnhubIndustry from profile (Technology, Healthcare, Financial Services, Energy, Consumer Cyclical, Consumer Defensive, Industrials, Basic Materials, Real Estate, Utilities, Communication Services)\n';
    sysMsg += '- type: "stock" or "etf" or "both"\n\n';
    sysMsg += 'FILTER TIPS (use these to build better criteria):\n';
    sysMsg += '- For "value investing": low peTTM (<15), low pbAnnual (<1.5), good roeTTM (>15), low totalDebtToEquityQuarterly (<1)\n';
    sysMsg += '- For "growth investing": high revenueGrowthTTMYoy (>15), high epsGrowthTTMYoy (>20), high grossMarginTTM (>40)\n';
    sysMsg += '- For "dividend income": high dividendYield (>3), positive epsTTM, low totalDebtToEquityQuarterly (<1.5)\n';
    sysMsg += '- For "bargain hunting": pctFrom52High between [-40,-15] (stocks that dropped significantly from highs)\n';
    sysMsg += '- For "momentum": pctFrom52Low > 30 (stocks trending up from lows), positive changePct\n';
    sysMsg += '- For "quality": roeTTM > 15, netProfitMarginTTM > 10, currentRatioQuarterly > 1.5\n';
    sysMsg += '- For "small cap gems": marketCap between [300,2000], revenueGrowthTTMYoy > 15\n';
    sysMsg += '- You can add "required": true to any filter to reject stocks missing that data (default: lenient — missing data is skipped)\n';
    sysMsg += '- Use 3-6 filters for best results. Too few = too broad, too many = no matches.\n\n';
    sysMsg += 'RESPONSE FORMAT — you MUST respond with ONLY valid JSON, no markdown, no commentary:\n';
    sysMsg += '{\n';
    sysMsg += '  "status": "clarify" or "criteria" or "refine",\n';
    sysMsg += '  "message": "your conversational message to the user",\n';
    sysMsg += '  "criteria": {\n';
    sysMsg += '    "type": "stock" or "etf" or "both",\n';
    sysMsg += '    "sector": null or "Technology" or ["Technology","Healthcare"] etc,\n';
    sysMsg += '    "filters": [\n';
    sysMsg += '      {"field": "metric_name", "op": ">" or "<" or ">=" or "<=" or "between", "value": number_or_[min,max], "label": "human readable description"}\n';
    sysMsg += '    ],\n';
    sysMsg += '    "sortBy": "field_name",\n';
    sysMsg += '    "sortDir": "desc" or "asc",\n';
    sysMsg += '    "limit": 25\n';
    sysMsg += '  }\n';
    sysMsg += '}\n\n';
    sysMsg += 'RULES:\n';
    sysMsg += '- When status is "clarify", criteria MUST be null — you are having a conversation, not screening yet\n';
    sysMsg += '- When status is "criteria" or "refine", criteria MUST be populated\n';
    sysMsg += '- In the "message" field, explain each filter in plain English when presenting criteria. Do NOT include raw JSON, field names, or technical filter syntax in the message — the UI will display the criteria separately.\n';
    sysMsg += '- Example good message: "Based on what you told me, I am looking for companies with strong revenue growth above 15%, healthy profit margins above 10%, and solid returns on equity. I am also making sure they have manageable debt levels."\n';
    sysMsg += '- Example bad message: "Here are the filters: {field: revenueGrowthTTMYoy, op: >, value: 15}" — NEVER do this\n';
    sysMsg += '- Use the "label" field in each filter to provide a beginner-friendly description (e.g. "Companies earning good profits" instead of "netProfitMarginTTM > 10")\n';
    sysMsg += '- Keep filters reasonable — 3-6 filters is ideal. Use "required": true on the most important ones.\n';
    sysMsg += '- ALWAYS respond with valid JSON only. No markdown code blocks.';

    return groqFetch(
      [{ role: 'system', content: sysMsg }].concat(messages),
      2000, 0.3, { model: MODEL_DEEP, timeoutMs: 60000 }
    );
  }

  return { getKey, setKey, hasKey, getKey2, setKey2, hasKey2, getGeminiKey, setGeminiKey, hasGeminiKey, testGemini, analyzeNews, analyzeAnalysts, analyzeMacro, summarizeTranscript, generateVerdict, generatePortfolioBrief, analyzeFundamentals, analyzeTechnicals, chatAdvisor, screenerAgent };
})();
