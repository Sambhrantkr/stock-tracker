# 📈 Stock Tracker Dashboard

AI-powered stock analysis dashboard with real-time data, earnings tracking, peer comparison, and senior analyst verdicts.

## Features

- **Live Quotes & KPIs** — Real-time price, P/E, EPS, market cap, beta, dividend yield, 52-week range
- **TradingView Chart** — Full interactive price chart with indicators and drawing tools
- **P/E History** — Historical P/E ratio chart with average line
- **Earnings & EPS Surprise** — Upcoming dates, beat/miss record, EPS surprise chart
- **Company Fundamentals** — Revenue growth (1Y/3Y/5Y), margin stack, ROE/ROA/ROIC, financial health, workforce, news sentiment
- **AI News Analysis** — Groq-powered summary with BULLISH/BEARISH outlook and valuation impact
- **Analyst Ratings** — Consensus distribution, trend, AI-summarized sentiment
- **Macro & Economy Impact** — Market news analyzed in context of your stock
- **Earnings Call Summary** — AI synthesis from Alpha Vantage transcripts or news
- **Peer Comparison** — Side-by-side KPIs against sector peers with best/worst highlighting
- **AI Analyst Verdict** — Aggregates all data into BUY/HOLD/SELL with price target and thesis
- **Auto-Refresh** — All data refreshes every 60 seconds
- **Persistent Watchlist** — Saved in localStorage

## API Keys Required

| Service | Purpose | Free Tier | Get Key |
|---------|---------|-----------|---------|
| [Finnhub](https://finnhub.io/register) | Quotes, financials, news, earnings | 60 calls/min | Required |
| [Groq](https://console.groq.com/keys) | AI analysis (Llama 3.1 8B) | 14,400 req/day | Optional |
| [Alpha Vantage](https://www.alphavantage.co/support/#api-key) | Transcripts, sentiment, overview | 25 req/day | Optional |

All keys are stored in your browser's localStorage — never sent to any server.

## Deploy

This is a zero-dependency static site. No build step needed.

**GitHub Pages:**
1. Push this repo to GitHub
2. Settings → Pages → Source: `main` branch, `/ (root)`
3. Live at `https://yourusername.github.io/repo-name/`

**Netlify:** Drag the folder to [netlify.com/drop](https://app.netlify.com/drop)

**Cloudflare Pages:** Direct upload at [pages.cloudflare.com](https://pages.cloudflare.com)
