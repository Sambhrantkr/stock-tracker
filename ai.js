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
        var waitSec = 15 + retry * 15; // 30s, 45s
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

    var prompt = 'Analyze these recent macro/economy/market news headlines. Focus on the key economic themes — Fed policy, wars/geopolitics, employment, government policy, and global economy.\n';
    prompt += 'Then explain their impact specifically on ' + symbol + ' (' + (companyName || symbol) + ').\n\n';
    prompt += sectorStr + '\n' + kpiContext + '\n\n';
    prompt += 'Recent Macro & Economy News:\n' + newsList + '\n\n';
    prompt += 'Respond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):\n';
    prompt += '{\n';
    prompt += '  "macroRegime": "1 sentence describing the current macro regime (e.g. late-cycle tightening, early easing, stagflation risk)",\n';
    prompt += '  "summary": "2-3 sentence summary of the most important macro developments from these headlines and what they mean for ' + symbol + '",\n';
    prompt += '  "impact": "POSITIVE" or "NEGATIVE" or "MIXED",\n';
    prompt += '  "impactReason": "1 sentence on the overall macro impact on this stock",\n';
    prompt += '  "macroFactors": [\n';
    prompt += '    {\n';
    prompt += '      "factor": "short label from: Fed Policy, Interest Rates, Inflation, Geopolitics/Wars, Trade Policy, Employment, Government Policy, GDP/Growth, Energy/Commodities, Currency",\n';
    prompt += '      "direction": "TAILWIND" or "HEADWIND" or "NEUTRAL",\n';
    prompt += '      "detail": "1 sentence on how this macro factor affects ' + symbol + ' specifically"\n';
    prompt += '    }\n';
    prompt += '  ],\n';
    prompt += '  "risks": [\n';
    prompt += '    {\n';
    prompt += '      "risk": "specific macro risk tied to headlines",\n';
    prompt += '      "severity": "HIGH" or "MEDIUM" or "LOW",\n';
    prompt += '      "detail": "1 sentence on why this is a risk for ' + symbol + '"\n';
    prompt += '    }\n';
    prompt += '  ]\n';
    prompt += '}\n\n';
    prompt += 'Keep macroFactors to 3-5 items. Keep risks to 2-3 items. Only include factors supported by the actual headlines — do not invent macro themes not present in the news.';

    return groqFetch([{ role: 'system', content: sysMsg }, { role: 'user', content: prompt }], 900, 0.3);
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

    return groqFetch([{ role: 'user', content: prompt }], 900, 0.3, { model: MODEL_MID });
  }

  /**
   * Senior Analyst Verdict — aggregates ALL data into a final recommendation.
   * Uses system persona + structured briefing for deeper, more rigorous analysis.
   * Increased token budget (1500) and temperature (0.5) for nuanced reasoning.
   */
  async function generateVerdict(symbol, companyName, allData) {
    if (!hasKey()) throw new Error('Groq API key required.');

    // ── SYSTEM PERSONA (condensed) ──
    var sysMsg = 'You are Marcus Chen, CFA, CMT — MD & Head of Cross-Asset Equity Research. 25yr veteran (GS, MS, own fund).\n';
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

    return groqFetch([{ role: 'user', content: prompt }], 900, 0.3, { model: MODEL_MID });
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

    return groqFetch([{ role: 'user', content: prompt }], 700, 0.3, { model: MODEL_MID });
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
    ], 1500, 0.4, { model: MODEL_DEEP, timeoutMs: 60000 });
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

  return { getKey, setKey, hasKey, getKey2, setKey2, hasKey2, getGeminiKey, setGeminiKey, hasGeminiKey, testGemini, analyzeNews, analyzeAnalysts, analyzeMacro, summarizeTranscript, generateVerdict, generatePortfolioBrief, analyzeFundamentals, analyzeTechnicals, chatAdvisor };
})();
