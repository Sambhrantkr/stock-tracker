/**
 * Unified AI Advisor Module (Wealth Advisor + Investment Screener)
 * Routes between Alexander Sterling (wealth) and Marcus Chen (screener) personas
 * Self-contained IIFE — accesses outer scope vars from app.js
 */
  // ===== Unified AI Advisor (routes between Wealth Advisor & Investment Screener) =====
  (function initAdvisor() {
    var fab = document.getElementById('advisor-fab');
    var panel = document.getElementById('advisor-panel');
    var closeBtn = document.getElementById('advisor-close');
    var clearBtn = document.getElementById('advisor-clear');
    var form = document.getElementById('advisor-form');
    var inputEl = document.getElementById('advisor-input');
    var messagesEl = document.getElementById('advisor-messages');
    var thinkingEl = document.getElementById('advisor-thinking');
    var resultsEl = document.getElementById('advisor-results');
    var sendBtn = document.getElementById('advisor-send');
    var titleEl = document.getElementById('advisor-title');
    if (!fab || !panel) return;

    var conversation = []; // unified conversation history
    var screenerConversation = []; // separate screener AI context
    var isBusy = false;
    var lastCriteria = null;
    var screenResults = [];
    var currentSort = { field: null, dir: 'desc' };
    var activeMode = null; // 'screener' or 'advisor'

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
      screenerConversation = [];
      lastCriteria = null;
      screenResults = [];
      activeMode = null;
      resultsPage = 0;
      resultsFilter = '';
      visibleCols = null;
      resultsEl.classList.add('hidden');
      resultsEl.innerHTML = '';
      titleEl.textContent = '💬 AI Advisor';
      messagesEl.innerHTML = '<div class="chat-msg assistant"><div class="chat-msg-content">Conversation cleared. Ask me anything — find stocks, analyze your portfolio, or get investment advice.</div></div>';
    });

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function appendMsg(role, html, persona) {
      var div = document.createElement('div');
      div.className = 'chat-msg ' + role;
      var content = document.createElement('div');
      content.className = 'chat-msg-content';
      if (role === 'assistant' && persona) {
        var badge = persona === 'screener' ? '🔍 ' : '🧠 ';
        content.innerHTML = '<span style="opacity:0.6;font-size:0.65rem;">' + badge + (persona === 'screener' ? 'Marcus' : 'Alexander') + '</span><br>' + html;
      } else {
        content.innerHTML = html;
      }
      div.appendChild(content);
      messagesEl.appendChild(div);
      scrollToBottom();
      return content;
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
      var stockInfo = window._appBridge.getTrackedStocks().find(function(t) { return t.symbol === sym; }) || {};
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
      var sym = window._appBridge.getSelectedSymbol();

      // Selected stock gets full context
      if (sym && window._appBridge.getCache()[sym]) {
        sections.push(buildStockContext(sym, window._appBridge.getCache()[sym], true));
      }

      // All other tracked stocks get condensed but complete AI context
      // Cap at 20 most relevant stocks to avoid blowing token limits
      if (window._appBridge.getTrackedStocks() && window._appBridge.getTrackedStocks().length) {
        var others = window._appBridge.getTrackedStocks().filter(function(s) { return s.symbol !== sym; });
        if (others.length) {
          sections.push('\n=== OTHER PORTFOLIO STOCKS (' + others.length + ' total) ===');
          // If >20 stocks, prioritize ones with verdicts/AI data
          var toInclude = others;
          if (others.length > 20) {
            var withData = others.filter(function(s) { var oc = window._appBridge.getCache()[s.symbol]; return oc && (oc.verdictResult || oc.aiResult); });
            var withoutData = others.filter(function(s) { var oc = window._appBridge.getCache()[s.symbol]; return !oc || (!oc.verdictResult && !oc.aiResult); });
            toInclude = withData.concat(withoutData).slice(0, 20);
            if (others.length > 20) sections.push('(Showing top 20 of ' + others.length + ' — remaining: ' + others.slice(20).map(function(s) { return s.symbol; }).join(', ') + ')');
          }
          toInclude.forEach(function(s) {
            var oc = window._appBridge.getCache()[s.symbol];
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

    // === Intent Router — classifies user message as screener or advisor ===
    function classifyIntent(text) {
      var t = text.toLowerCase();
      // If we're in an active screener conversation, stay in screener mode
      if (activeMode === 'screener' && screenerConversation.length > 0) {
        // Unless the user clearly switches to advisory
        var advisorySwitch = /\b(my portfolio|my stocks|how.?s my|compare|should i (buy|sell|hold)|what.?s my risk|analyze my|portfolio strategy|market outlook)\b/i;
        if (advisorySwitch.test(t)) return 'advisor';
        return 'screener';
      }
      // Screener intent — looking for stocks/ETFs to buy
      var screenerPatterns = /\b(find|search|screen|look for|show me|discover|hunt|scan)\b.*\b(stock|etf|invest|dividend|growth|value|income|sector|industry)\b|\b(high.?growth|low.?pe|undervalued|bargain|momentum|dividend.?yield|small.?cap|large.?cap|mid.?cap)\b|\b(stocks? (with|under|over|above|below))\b|\b(find me|search for|screen for|look for)\b/i;
      if (screenerPatterns.test(t)) return 'screener';
      // Advisory intent — portfolio analysis, stock questions, market outlook
      return 'advisor';
    }

    function fmtText(text) {
      return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
    }

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

    // === Unified form submit handler ===
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var text = inputEl.value.trim();
      if (!text || isBusy) return;
      if (!NewsAI.hasKey()) {
        appendMsg('assistant', formatChatText('Please add your Groq API key in Settings first.'));
        return;
      }

      // Immediately lock to prevent double-submit
      isBusy = true;
      sendBtn.disabled = true;
      inputEl.value = '';
      inputEl.disabled = true;
      appendMsg('user', formatChatText(text));

      var intent = classifyIntent(text);
      activeMode = intent;

      if (intent === 'screener') {
        titleEl.textContent = '🔍 Marcus — Investment Advisor';
        await handleScreenerMessage(text);
      } else {
        titleEl.textContent = '🧠 Alexander — Wealth Advisor';
        await handleAdvisorMessage(text);
      }

      isBusy = false;
      sendBtn.disabled = false;
      inputEl.disabled = false;
      inputEl.focus();
    });

    // === Advisor (Alexander) handler ===
    async function handleAdvisorMessage(text) {
      var context = buildContext();
      conversation.push({ role: 'user', content: text });

      var apiMessages = [];
      apiMessages.push({ role: 'system', content: SYSTEM_PROMPT + '\n\n--- DASHBOARD DATA ---\n' + context + '\n--- END DATA ---' });
      var historySlice = conversation.slice(-20);
      for (var i = 0; i < historySlice.length; i++) {
        apiMessages.push({ role: historySlice[i].role, content: historySlice[i].content });
      }

      thinkingEl.classList.remove('hidden');
      var thinkLabel = thinkingEl.querySelector('.chat-thinking-label');
      if (thinkLabel) thinkLabel.textContent = 'Thinking...';
      scrollToBottom();

      var thinkTimer = setTimeout(function() {
        if (thinkLabel) thinkLabel.textContent = 'Still working — analyzing portfolio data...';
      }, 12000);
      var thinkTimer2 = setTimeout(function() {
        if (thinkLabel) thinkLabel.textContent = 'Taking longer than usual — hang tight...';
      }, 30000);

      try {
        var response = await NewsAI.chatAdvisor(apiMessages, { timeoutMs: 60000, maxTokens: 2048 });
        clearTimeout(thinkTimer);
        clearTimeout(thinkTimer2);
        conversation.push({ role: 'assistant', content: response });
        thinkingEl.classList.add('hidden');
        if (thinkLabel) thinkLabel.textContent = 'Thinking...';
        appendMsg('assistant', formatChatText(response), 'advisor');
      } catch (err) {
        clearTimeout(thinkTimer);
        clearTimeout(thinkTimer2);
        if (err.message && err.message.indexOf('Rate') !== -1) {
          if (thinkLabel) thinkLabel.textContent = 'Rate limited — retrying in 35s...';
          await new Promise(function(r) { setTimeout(r, 35000); });
          if (thinkLabel) thinkLabel.textContent = 'Thinking...';
          try {
            var retryResp = await NewsAI.chatAdvisor(apiMessages, { timeoutMs: 60000, maxTokens: 2048 });
            conversation.push({ role: 'assistant', content: retryResp });
            thinkingEl.classList.add('hidden');
            if (thinkLabel) thinkLabel.textContent = 'Thinking...';
            appendMsg('assistant', formatChatText(retryResp), 'advisor');
          } catch (retryErr) {
            thinkingEl.classList.add('hidden');
            if (thinkLabel) thinkLabel.textContent = 'Thinking...';
            appendMsg('assistant', formatChatText('Error: ' + retryErr.message));
          }
        } else {
          thinkingEl.classList.add('hidden');
          if (thinkLabel) thinkLabel.textContent = 'Thinking...';
          appendMsg('assistant', formatChatText('Error: ' + err.message));
        }
      }
    }

    // === Screener (Marcus) handler ===
    async function handleScreenerMessage(text) {
      if (!StockAPI.hasKey()) {
        appendMsg('assistant', formatChatText('Please add your Finnhub API key in Settings to search stocks.'), 'screener');
        return;
      }

      screenerConversation.push({ role: 'user', content: text });

      thinkingEl.classList.remove('hidden');
      var thinkLabel = thinkingEl.querySelector('.chat-thinking-label');
      if (thinkLabel) thinkLabel.textContent = 'Thinking...';
      scrollToBottom();

      // Timeout feedback — let user know if it's taking long
      var thinkTimer = setTimeout(function() {
        if (thinkLabel) thinkLabel.textContent = 'Still working — AI is processing...';
      }, 12000);
      var thinkTimer2 = setTimeout(function() {
        if (thinkLabel) thinkLabel.textContent = 'Taking longer than usual — hang tight...';
      }, 30000);

      try {
        var response = await NewsAI.screenerAgent(screenerConversation);

        clearTimeout(thinkTimer);
        clearTimeout(thinkTimer2);
        thinkingEl.classList.add('hidden');
        if (thinkLabel) thinkLabel.textContent = 'Thinking...';

        if (!response || !response.status) {
          appendMsg('assistant', formatChatText('I had trouble understanding that. Could you rephrase what kind of stocks you\'re looking for?'), 'screener');
          return;
        }

        screenerConversation.push({ role: 'assistant', content: JSON.stringify(response) });

        if (response.status === 'clarify') {
          appendMsg('assistant', fmtText(response.message || 'Could you tell me more about what you\'re looking for?'), 'screener');
        } else if (response.status === 'criteria' || response.status === 'refine') {
          lastCriteria = response.criteria;

          var rawMsg = response.message || 'Here are the criteria I\'ll use:';
          rawMsg = rawMsg.replace(/\{[^}]*"field"[^}]*\}/g, '').replace(/\n\s*-\s*\{[^}]*\}/g, '').replace(/\n{3,}/g, '\n\n').trim();
          var msgHTML = fmtText(rawMsg);
          msgHTML += buildCriteriaHTML(response.criteria);

          msgHTML += '<div class="screener-confirm-btns">';
          msgHTML += '<button class="screener-confirm-btn yes" id="screener-confirm-yes">🔍 Search Now</button>';
          msgHTML += '<button class="screener-confirm-btn edit" id="screener-confirm-edit">✏️ Adjust</button>';
          msgHTML += '</div>';

          var msgEl = appendMsg('assistant', msgHTML, 'screener');

          var yesBtn = msgEl.querySelector('#screener-confirm-yes');
          var editBtn = msgEl.querySelector('#screener-confirm-edit');

          yesBtn.addEventListener('click', async function() {
            yesBtn.disabled = true;
            editBtn.disabled = true;
            yesBtn.textContent = 'Searching...';
            try {
              await runScreen(lastCriteria);
            } catch(err) {
              appendMsg('assistant', formatChatText('Error during screening: ' + err.message), 'screener');
            }
          });

          editBtn.addEventListener('click', function() {
            yesBtn.disabled = true;
            editBtn.disabled = true;
            appendMsg('assistant', formatChatText('No problem! What would you like to tweak? For example:\n• "Less risky stocks"\n• "Add a dividend requirement"\n• "Focus on tech only"\n• "Remove the debt filter"'), 'screener');
            inputEl.focus();
          });
        }
      } catch(err) {
        clearTimeout(thinkTimer);
        clearTimeout(thinkTimer2);
        thinkingEl.classList.add('hidden');
        if (thinkLabel) thinkLabel.textContent = 'Thinking...';
        appendMsg('assistant', formatChatText('Error: ' + err.message + '. Try again.'), 'screener');
      }
    }

    // ===== Screener Data & Functions =====

    // BUILTIN_STOCKS and BUILTIN_ETFS are defined in universe.js (loaded before this file)

    // Build universe from hardcoded lists (fallback)
    function getBuiltinUniverse() {
      var seen = {};
      var symbols = [];
      BUILTIN_STOCKS.forEach(function(s) {
        var sym = s.toUpperCase();
        if (!seen[sym]) { seen[sym] = true; symbols.push({ symbol: sym, name: '', type: 'stock' }); }
      });
      BUILTIN_ETFS.forEach(function(s) {
        var sym = s.toUpperCase();
        if (!seen[sym]) { seen[sym] = true; symbols.push({ symbol: sym, name: '', type: 'etf' }); }
      });
      return symbols;
    }

    // Try to fetch dynamic universe from Finnhub (MIC-filtered to reduce payload)
    async function fetchDynamicUniverse() {
      var CACHE_KEY = 'screener_universe_cache';
      var CACHE_TTL = 24 * 60 * 60 * 1000; // 1 day

      // Check localStorage cache first
      try {
        var cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          var parsed = JSON.parse(cached);
          if (parsed.ts && (Date.now() - parsed.ts) < CACHE_TTL && parsed.data && parsed.data.length > 100) {
            return parsed.data;
          }
        }
      } catch(e) {}

      // Fetch NYSE and NASDAQ symbols separately (much smaller than all US)
      var nyse = await StockAPI.fhGet('/stock/symbol?exchange=US&mic=XNYS');
      var nasdaq = await StockAPI.fhGet('/stock/symbol?exchange=US&mic=XNAS');

      var all = (nyse || []).concat(nasdaq || []);
      if (!all.length) return null;

      // Filter to common stocks and ETFs, skip warrants/units/preferred
      var seen = {};
      var results = [];
      all.forEach(function(item) {
        if (!item.symbol || !item.description) return;
        var sym = item.symbol.toUpperCase();
        if (seen[sym]) return;
        // Skip symbols with dots/dashes (preferred shares, warrants, units)
        if (sym.indexOf('.') !== -1 || sym.indexOf('-') !== -1) return;
        // Skip very long symbols (usually warrants/units)
        if (sym.length > 5) return;
        seen[sym] = true;
        var t = (item.type || '').toUpperCase();
        var isEtf = t === 'ETP' || t === 'ETF';
        results.push({ symbol: sym, name: item.description || '', type: isEtf ? 'etf' : 'stock' });
      });

      // Cache the results
      if (results.length > 100) {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: results }));
        } catch(e) {}
      }

      return results;
    }

    // Get the stock universe — tries dynamic fetch, falls back to hardcoded
    async function getUniverse() {
      var base;
      try {
        window._appBridge.getStatusBar().textContent = 'Fetching stock universe...';
        var dynamic = await fetchDynamicUniverse();
        if (dynamic && dynamic.length > 100) {
          base = dynamic;
          window._appBridge.getStatusBar().textContent = 'Universe: ' + dynamic.length + ' symbols from Finnhub';
        } else {
          base = getBuiltinUniverse();
          window._appBridge.getStatusBar().textContent = 'Universe: ' + base.length + ' built-in symbols';
        }
      } catch(e) {
        base = getBuiltinUniverse();
        window._appBridge.getStatusBar().textContent = 'Universe: ' + base.length + ' built-in symbols (fallback)';
      }

      // Merge in user-tracked stocks
      var seen = {};
      base.forEach(function(s) { seen[s.symbol] = true; });
      window._appBridge.getTrackedStocks().forEach(function(s) {
        var sym = s.symbol.toUpperCase();
        if (!seen[sym]) {
          seen[sym] = true;
          base.push({ symbol: sym, name: s.name || '', type: (s.type === 'ETF' ? 'etf' : 'stock') });
        }
      });
      return base;
    }

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

      // Screen ALL candidates — no sampling limit
      // Shuffle to get diverse results across runs
      var toScreen = candidates.slice();
      for (var i = toScreen.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = toScreen[i]; toScreen[i] = toScreen[j]; toScreen[j] = tmp;
      }
      // But prioritize tracked stocks at the front
      var prioritized = [];
      var rest = [];
      var knownSymbols = {};
      window._appBridge.getTrackedStocks().forEach(function(s) { knownSymbols[s.symbol] = true; });
      toScreen.forEach(function(s) {
        if (knownSymbols[s.symbol]) prioritized.push(s);
        else rest.push(s);
      });
      toScreen = prioritized.concat(rest);

      var progressFill = document.getElementById('screener-progress-fill');
      var progressEl = resultsEl.querySelector('.screener-progress');
      var matches = [];
      var screened = 0;
      var errors = 0;
      var screenCancelled = false;

      // Add stop button to progress area
      var stopBtn = document.createElement('button');
      stopBtn.textContent = '⏹ Stop';
      stopBtn.className = 'screener-confirm-btn edit';
      stopBtn.style.cssText = 'margin-left:0.5rem;font-size:0.7rem;padding:0.2rem 0.6rem;';
      stopBtn.addEventListener('click', function() { screenCancelled = true; });
      if (progressEl) progressEl.appendChild(stopBtn);

      // Phase 1: Fast filter using only getBasicFinancials (1 API call per stock)
      // Phase 2: Enrich matches with getQuote + getProfile
      var needsPrice = criteria.filters && criteria.filters.some(function(f) {
        return ['price','changePct','pctFrom52High','pctFrom52Low'].indexOf(f.field) !== -1;
      });
      var needsSector = !!criteria.sector;
      var needsMcap = (criteria.filters && criteria.filters.some(function(f) { return f.field === 'marketCap'; })) || criteria.sortBy === 'marketCap';

      // Adaptive batch size: bigger batches for filter-only, smaller when needing extra calls
      var batchSize = (needsPrice || needsSector || needsMcap) ? 5 : 8;
      var delayBetweenBatches = (needsPrice || needsSector || needsMcap) ? 2800 : 1800;

      for (var bi = 0; bi < toScreen.length; bi += batchSize) {
        if (screenCancelled) break;
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

        // Rate limit delay between batches
        if (bi + batchSize < toScreen.length && !screenCancelled) {
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
      resultsPage = 0;
      resultsFilter = '';
      visibleCols = null;

      // Enrich final results with profile data (marketCap, sector) if not already loaded
      var toEnrich = screenResults.filter(function(r) { return r.metrics.marketCap == null; });
      if (toEnrich.length && !screenCancelled) {
        if (progressEl) progressEl.firstChild.textContent = '📊 Enriching ' + toEnrich.length + ' results with market data...';
        for (var ei = 0; ei < toEnrich.length; ei += 5) {
          var eBatch = toEnrich.slice(ei, ei + 5);
          await Promise.all(eBatch.map(function(r) {
            return StockAPI.getProfile(r.symbol).then(function(profile) {
              if (profile) {
                r.metrics.marketCap = profile.marketCap ? profile.marketCap / 1e6 : null;
                r.metrics.sector = profile.sector || r.metrics.sector;
                if (profile.name) r.name = profile.name;
              }
            }).catch(function() {});
          }));
          if (ei + 5 < toEnrich.length) await new Promise(function(r) { setTimeout(r, 1200); });
        }
      }

      renderResults();

      var summary = screenCancelled
        ? '⏹ Stopped. Found ' + matches.length + ' matches out of ' + screened + '/' + toScreen.length + ' screened.'
        : '✅ Found ' + matches.length + ' matches out of ' + screened + ' screened.';
      if (errors > 0) summary += ' (' + errors + ' had data errors)';
      if (matches.length > (criteria.limit || 25)) summary += ' Showing top ' + (criteria.limit || 25) + '.';
      appendMsg('assistant', formatChatText(summary + '\n\nUse the toolbar to filter, sort columns, toggle metrics, and page through results. Click **+ Add** to track any stock.'));
    }

    // Screen a single stock against criteria
    async function screenOneStock(stock, criteria) {
      try {
        // Phase 1: Get basic financials (1 API call — has most filter data)
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
          roicTTM: data.roicTTM || null,
          currentRatioQuarterly: data.currentRatio,
          quickRatioQuarterly: data.quickRatio || null,
          totalDebtToEquityQuarterly: data.debtEquity,
          revenueGrowth3Y: data.revenueGrowth3Y || null,
          revenueGrowth5Y: data.revenueGrowth5Y || null,
          epsGrowth3Y: data.epsGrowth3Y || null,
          epsGrowth5Y: data.epsGrowth5Y || null,
          pbAnnual: data.annualSeries && data.annualSeries.pb && data.annualSeries.pb.length ? data.annualSeries.pb[0].v : null,
          psAnnual: data.annualSeries && data.annualSeries.ps && data.annualSeries.ps.length ? data.annualSeries.ps[0].v : null,
          marketCap: null,
          price: null,
          change: null,
          changePct: null,
        };

        // Parse 52W values
        if (data.week52High && data.week52High !== 'N/A') metrics['52WeekHigh'] = parseFloat(data.week52High.replace('$',''));
        if (data.week52Low && data.week52Low !== 'N/A') metrics['52WeekLow'] = parseFloat(data.week52Low.replace('$',''));

        // === PHASE 1: Apply basic filters (no extra API calls needed) ===
        var PRICE_FIELDS = { price: 1, changePct: 1, pctFrom52High: 1, pctFrom52Low: 1 };
        var PROFILE_FIELDS = { marketCap: 1, sector: 1 };
        var basicFilters = [];
        var priceFilters = [];
        var profileFilters = [];
        if (criteria.filters) {
          criteria.filters.forEach(function(f) {
            if (PRICE_FIELDS[f.field]) priceFilters.push(f);
            else if (PROFILE_FIELDS[f.field]) profileFilters.push(f);
            else basicFilters.push(f);
          });
        }

        // Apply basic filters first (free — data already loaded)
        if (basicFilters.length) {
          var failCount = 0;
          for (var i = 0; i < basicFilters.length; i++) {
            var f = basicFilters[i];
            var val = metrics[f.field];
            if (val == null) { if (f.required) return null; failCount++; continue; }
            var passed = true;
            if (f.op === '>' && !(val > f.value)) passed = false;
            if (f.op === '<' && !(val < f.value)) passed = false;
            if (f.op === '>=' && !(val >= f.value)) passed = false;
            if (f.op === '<=' && !(val <= f.value)) passed = false;
            if (f.op === 'between') {
              if (!Array.isArray(f.value) || f.value.length !== 2) passed = false;
              else if (!(val >= f.value[0] && val <= f.value[1])) passed = false;
            }
            if (!passed) return null;
          }
          if (basicFilters.length > 0 && failCount > basicFilters.length * 0.5) return null;
        }

        // === PHASE 2: Fetch profile only if needed by sector/marketCap filters or sort ===
        var needsSector = !!criteria.sector;
        var needsMcap = profileFilters.length > 0 || criteria.sortBy === 'marketCap';
        if (needsSector || needsMcap) {
          try {
            var profile = await StockAPI.getProfile(stock.symbol);
            if (profile) {
              metrics.sector = profile.sector;
              metrics.marketCap = profile.marketCap ? profile.marketCap / 1e6 : null;
              metrics.name = profile.name || stock.name;
            }
          } catch(e) {}

          // Apply sector filter
          if (criteria.sector) {
            var sectorList = Array.isArray(criteria.sector) ? criteria.sector : [criteria.sector];
            var sectorMatch = false;
            if (metrics.sector) {
              var sLower = metrics.sector.toLowerCase();
              sectorList.forEach(function(s) { if (sLower.indexOf(s.toLowerCase()) !== -1) sectorMatch = true; });
            }
            if (!sectorMatch) return null;
          }

          // Apply marketCap filters
          for (var pi = 0; pi < profileFilters.length; pi++) {
            var pf = profileFilters[pi];
            var pval = metrics[pf.field];
            if (pval == null) { if (pf.required) return null; continue; }
            var pp = true;
            if (pf.op === '>' && !(pval > pf.value)) pp = false;
            if (pf.op === '<' && !(pval < pf.value)) pp = false;
            if (pf.op === '>=' && !(pval >= pf.value)) pp = false;
            if (pf.op === '<=' && !(pval <= pf.value)) pp = false;
            if (pf.op === 'between') {
              if (!Array.isArray(pf.value) || pf.value.length !== 2) pp = false;
              else if (!(pval >= pf.value[0] && pval <= pf.value[1])) pp = false;
            }
            if (!pp) return null;
          }
        }

        // === PHASE 3: Fetch quote only if needed by price filters, or for final enrichment ===
        try {
          var quote = await StockAPI.getQuote(stock.symbol);
          if (quote) {
            metrics.price = quote.price;
            metrics.change = quote.change;
            metrics.changePct = quote.changePct;
            if (metrics['52WeekHigh'] && quote.price) {
              metrics.pctFrom52High = ((quote.price - metrics['52WeekHigh']) / metrics['52WeekHigh']) * 100;
            }
            if (metrics['52WeekLow'] && quote.price) {
              metrics.pctFrom52Low = ((quote.price - metrics['52WeekLow']) / metrics['52WeekLow']) * 100;
            }
          }
        } catch(e) {}

        // Apply price-based filters
        for (var qi = 0; qi < priceFilters.length; qi++) {
          var qf = priceFilters[qi];
          var qval = metrics[qf.field];
          if (qval == null) { if (qf.required) return null; continue; }
          var qp = true;
          if (qf.op === '>' && !(qval > qf.value)) qp = false;
          if (qf.op === '<' && !(qval < qf.value)) qp = false;
          if (qf.op === '>=' && !(qval >= qf.value)) qp = false;
          if (qf.op === '<=' && !(qval <= qf.value)) qp = false;
          if (qf.op === 'between') {
            if (!Array.isArray(qf.value) || qf.value.length !== 2) qp = false;
            else if (!(qval >= qf.value[0] && qval <= qf.value[1])) qp = false;
          }
          if (!qp) return null;
        }

        return { symbol: stock.symbol, name: metrics.name || stock.name, type: stock.type, metrics: metrics };
      } catch(e) {
        return null;
      }
    }

    // Render results table
    var resultsPage = 0;
    var resultsPerPage = 15;
    var resultsFilter = '';
    var visibleCols = null; // null = use defaults

    var ALL_COLUMNS = [
      { key: 'symbol', label: 'Symbol', cls: 'sym-cell', group: 'core', default: true },
      { key: 'name', label: 'Name', cls: 'name-cell', group: 'core', default: true },
      { key: 'price', label: 'Price', cls: 'num-cell', fmt: 'price', group: 'core', default: true },
      { key: 'changePct', label: 'Chg%', cls: 'num-cell', fmt: 'pct', group: 'core', default: true },
      { key: 'marketCap', label: 'Mkt Cap', cls: 'num-cell', fmt: 'mcap', group: 'core', default: true },
      { key: 'peTTM', label: 'P/E', cls: 'num-cell', fmt: 'dec1', group: 'valuation', default: true },
      { key: 'pbAnnual', label: 'P/B', cls: 'num-cell', fmt: 'dec2', group: 'valuation', default: false },
      { key: 'psAnnual', label: 'P/S', cls: 'num-cell', fmt: 'dec2', group: 'valuation', default: false },
      { key: 'epsTTM', label: 'EPS', cls: 'num-cell', fmt: 'dec2', group: 'valuation', default: false },
      { key: 'dividendYield', label: 'Div%', cls: 'num-cell', fmt: 'dec2', group: 'income', default: true },
      { key: 'roeTTM', label: 'ROE%', cls: 'num-cell', fmt: 'dec1', group: 'profitability', default: true },
      { key: 'roaTTM', label: 'ROA%', cls: 'num-cell', fmt: 'dec1', group: 'profitability', default: false },
      { key: 'roicTTM', label: 'ROIC%', cls: 'num-cell', fmt: 'dec1', group: 'profitability', default: false },
      { key: 'grossMarginTTM', label: 'Gross%', cls: 'num-cell', fmt: 'dec1', group: 'profitability', default: false },
      { key: 'operatingMarginTTM', label: 'OpMgn%', cls: 'num-cell', fmt: 'dec1', group: 'profitability', default: false },
      { key: 'netProfitMarginTTM', label: 'NetMgn%', cls: 'num-cell', fmt: 'dec1', group: 'profitability', default: false },
      { key: 'revenueGrowthTTMYoy', label: 'RevGr%', cls: 'num-cell', fmt: 'dec1', group: 'growth', default: true },
      { key: 'epsGrowthTTMYoy', label: 'EPSGr%', cls: 'num-cell', fmt: 'dec1', group: 'growth', default: false },
      { key: 'revenueGrowth3Y', label: 'Rev3Y%', cls: 'num-cell', fmt: 'dec1', group: 'growth', default: false },
      { key: 'revenueGrowth5Y', label: 'Rev5Y%', cls: 'num-cell', fmt: 'dec1', group: 'growth', default: false },
      { key: 'beta', label: 'Beta', cls: 'num-cell', fmt: 'dec2', group: 'risk', default: true },
      { key: 'currentRatioQuarterly', label: 'CurRat', cls: 'num-cell', fmt: 'dec2', group: 'health', default: false },
      { key: 'totalDebtToEquityQuarterly', label: 'D/E', cls: 'num-cell', fmt: 'dec2', group: 'health', default: false },
      { key: '52WeekHigh', label: '52W Hi', cls: 'num-cell', fmt: 'price', group: 'range', default: false },
      { key: '52WeekLow', label: '52W Lo', cls: 'num-cell', fmt: 'price', group: 'range', default: false },
      { key: 'pctFrom52High', label: 'vs52Hi%', cls: 'num-cell', fmt: 'pct', group: 'range', default: false },
      { key: '_add', label: '', cls: '', group: 'core', default: true },
    ];

    function getVisibleColumns() {
      if (!visibleCols) return ALL_COLUMNS.filter(function(c) { return c.default; });
      return ALL_COLUMNS.filter(function(c) { return c.key === '_add' || visibleCols.indexOf(c.key) !== -1; });
    }

    function fmtScreenerVal(val, fmt) {
      if (val == null || val === 'N/A' || (typeof val === 'number' && isNaN(val))) return '—';
      if (fmt === 'price') return '$' + Number(val).toFixed(2);
      if (fmt === 'pct') return (val >= 0 ? '+' : '') + Number(val).toFixed(2) + '%';
      if (fmt === 'dec1') return Number(val).toFixed(1);
      if (fmt === 'dec2') return Number(val).toFixed(2);
      if (fmt === 'mcap') {
        if (val == null) return '—';
        var n = Number(val); // already in millions
        if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'T';
        if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'B';
        return '$' + n.toFixed(0) + 'M';
      }
      return String(val);
    }

    function renderResults() {
      if (!screenResults.length) {
        resultsEl.innerHTML = '<div class="screener-progress">No matches found. Try broadening your criteria.</div>';
        return;
      }

      // Filter
      var filtered = screenResults;
      if (resultsFilter) {
        var q = resultsFilter.toLowerCase();
        filtered = screenResults.filter(function(r) {
          return r.symbol.toLowerCase().indexOf(q) !== -1 || (r.name && r.name.toLowerCase().indexOf(q) !== -1);
        });
      }

      // Pagination
      var totalPages = Math.max(1, Math.ceil(filtered.length / resultsPerPage));
      if (resultsPage >= totalPages) resultsPage = totalPages - 1;
      if (resultsPage < 0) resultsPage = 0;
      var start = resultsPage * resultsPerPage;
      var pageItems = filtered.slice(start, start + resultsPerPage);
      var columns = getVisibleColumns();

      var h = '<div class="screener-toolbar">';
      h += '<div class="screener-toolbar-left">';
      h += '<span class="screener-results-count">' + filtered.length + ' result' + (filtered.length !== 1 ? 's' : '');
      if (resultsFilter) h += ' (filtered)';
      h += '</span>';
      h += '<input type="text" class="screener-filter-input" id="screener-filter" placeholder="Filter by symbol or name..." value="' + (resultsFilter || '').replace(/"/g, '&quot;') + '" />';
      h += '</div>';
      h += '<div class="screener-toolbar-right">';
      h += '<button class="screener-col-toggle-btn" id="screener-col-toggle" title="Choose columns">⚙ Columns</button>';
      h += '<select class="screener-page-size" id="screener-page-size">';
      [10, 15, 25, 50].forEach(function(n) {
        h += '<option value="' + n + '"' + (resultsPerPage === n ? ' selected' : '') + '>' + n + '/page</option>';
      });
      h += '</select>';
      h += '</div></div>';

      // Column picker dropdown (hidden by default)
      h += '<div class="screener-col-picker hidden" id="screener-col-picker">';
      var groups = { core: 'Core', valuation: 'Valuation', income: 'Income', profitability: 'Profitability', growth: 'Growth', risk: 'Risk', health: 'Health', range: '52-Week' };
      var currentGroup = '';
      ALL_COLUMNS.forEach(function(col) {
        if (col.key === '_add') return;
        if (col.group !== currentGroup) {
          currentGroup = col.group;
          h += '<div class="screener-col-group-label">' + (groups[col.group] || col.group) + '</div>';
        }
        var checked = columns.some(function(c) { return c.key === col.key; });
        h += '<label class="screener-col-option"><input type="checkbox" data-col="' + col.key + '"' + (checked ? ' checked' : '') + ' />' + col.label + '</label>';
      });
      h += '</div>';

      // Table
      h += '<table class="screener-table"><thead><tr>';
      columns.forEach(function(col) {
        var arrow = '';
        if (col.key === currentSort.field) arrow = '<span class="sort-arrow">' + (currentSort.dir === 'desc' ? '▼' : '▲') + '</span>';
        h += '<th data-sort="' + col.key + '">' + col.label + arrow + '</th>';
      });
      h += '</tr></thead><tbody>';

      if (!pageItems.length) {
        h += '<tr><td colspan="' + columns.length + '" style="text-align:center;color:var(--muted);padding:1rem;">No matches for filter.</td></tr>';
      }

      pageItems.forEach(function(r) {
        var m = r.metrics;
        var isTracked = window._appBridge.getTrackedStocks().some(function(t) { return t.symbol === r.symbol; });
        h += '<tr>';
        columns.forEach(function(col) {
          if (col.key === '_add') {
            if (isTracked) {
              h += '<td><span class="screener-add-btn added">\u2713</span></td>';
            } else {
              h += '<td><button class="screener-add-btn" data-sym="' + r.symbol + '" data-name="' + (r.name || '').replace(/"/g, '&quot;') + '" data-type="' + r.type + '">+</button></td>';
            }
            return;
          }
          var val = col.key === 'name' ? r.name : (col.key === 'symbol' ? r.symbol : m[col.key]);
          var display = fmtScreenerVal(val, col.fmt);
          var cls = col.cls || '';
          if (col.fmt === 'pct' && val != null && !isNaN(val)) cls += val >= 0 ? ' pos' : ' neg';
          h += '<td class="' + cls + '">' + display + '</td>';
        });
        h += '</tr>';
      });

      h += '</tbody></table>';

      // Pagination controls
      if (totalPages > 1) {
        h += '<div class="screener-pagination">';
        h += '<button class="screener-page-btn" data-page="prev"' + (resultsPage === 0 ? ' disabled' : '') + '>&laquo;</button>';
        // Show page numbers with ellipsis
        var pages = [];
        for (var p = 0; p < totalPages; p++) {
          if (p === 0 || p === totalPages - 1 || Math.abs(p - resultsPage) <= 1) {
            pages.push(p);
          } else if (pages[pages.length - 1] !== -1) {
            pages.push(-1); // ellipsis marker
          }
        }
        pages.forEach(function(p) {
          if (p === -1) {
            h += '<span class="screener-page-ellipsis">\u2026</span>';
          } else {
            h += '<button class="screener-page-btn' + (p === resultsPage ? ' active' : '') + '" data-page="' + p + '">' + (p + 1) + '</button>';
          }
        });
        h += '<button class="screener-page-btn" data-page="next"' + (resultsPage >= totalPages - 1 ? ' disabled' : '') + '>&raquo;</button>';
        h += '</div>';
      }

      resultsEl.innerHTML = h;

      // Wire up filter input
      var filterInput = document.getElementById('screener-filter');
      if (filterInput) {
        filterInput.addEventListener('input', function() {
          resultsFilter = filterInput.value.trim();
          resultsPage = 0;
          renderResults();
        });
        // Restore focus and cursor position
        if (resultsFilter) {
          filterInput.focus();
          filterInput.setSelectionRange(filterInput.value.length, filterInput.value.length);
        }
      }

      // Wire up page size
      var pageSizeEl = document.getElementById('screener-page-size');
      if (pageSizeEl) {
        pageSizeEl.addEventListener('change', function() {
          resultsPerPage = parseInt(pageSizeEl.value, 10) || 15;
          resultsPage = 0;
          renderResults();
        });
      }

      // Wire up column toggle
      var colToggle = document.getElementById('screener-col-toggle');
      var colPicker = document.getElementById('screener-col-picker');
      if (colToggle && colPicker) {
        colToggle.addEventListener('click', function(e) {
          e.stopPropagation();
          colPicker.classList.toggle('hidden');
        });
        colPicker.addEventListener('click', function(e) { e.stopPropagation(); });
        // Close picker on outside click
        document.addEventListener('click', function() { colPicker.classList.add('hidden'); });
      }
      // Wire up column checkboxes
      resultsEl.querySelectorAll('.screener-col-option input').forEach(function(cb) {
        cb.addEventListener('change', function() {
          var selected = [];
          resultsEl.querySelectorAll('.screener-col-option input:checked').forEach(function(c) {
            selected.push(c.getAttribute('data-col'));
          });
          visibleCols = selected;
          renderResults();
        });
      });

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

      // Wire up pagination
      resultsEl.querySelectorAll('.screener-page-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var pg = btn.getAttribute('data-page');
          if (pg === 'prev') resultsPage = Math.max(0, resultsPage - 1);
          else if (pg === 'next') resultsPage = Math.min(totalPages - 1, resultsPage + 1);
          else resultsPage = parseInt(pg, 10);
          renderResults();
        });
      });

      // Wire up add buttons
      resultsEl.querySelectorAll('.screener-add-btn:not(.added)').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var sym = btn.getAttribute('data-sym');
          var name = btn.getAttribute('data-name');
          var type = btn.getAttribute('data-type') === 'etf' ? 'ETF' : 'Equity';
          window._appBridge.addStock(sym, name, type);
          btn.classList.add('added');
          btn.textContent = '\u2713';
        });
      });
    }

  })();

