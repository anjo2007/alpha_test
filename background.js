// background.js - AuraTrade Quant-Semantic Forecast Service Worker (v2.0 — Peak Engine)

const DEFAULT_WATCHLIST = ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS"];
const APP_ID = "alpha-quant-semantic-terminal";
const DEFAULT_SCANNER_TICKERS = [
  "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", 
  "ICICIBANK.NS", "SBIN.NS", "BHARTIARTL.NS", "ITC.NS", 
  "LICI.NS", "LT.NS", "HAL.NS", "BEL.NS", "TATAMOTORS.NS", 
  "SUZLON.NS", "IRFC.NS", "YESBANK.NS", "NHPC.NS", 
  "GMRINFRA.NS", "PNB.NS", "IOC.NS"
];

// Safety toFixed wrapper to prevent null/undefined property exceptions
function safeToFixed(value, fractionDigits = 2) {
  if (value === undefined || value === null || isNaN(Number(value))) {
    return "0.00";
  }
  return Number(value).toFixed(fractionDigits);
}

// Helper to resolve ticker defaults based on exchange settings
function resolveTicker(ticker, settings) {
  ticker = ticker.toUpperCase().trim();
  if (!ticker) return "";
  if (!ticker.includes(".")) {
    const exchange = settings.defaultExchange || "NSE";
    if (exchange === "NSE") return ticker + ".NS";
    if (exchange === "BSE") return ticker + ".BO";
  }
  return ticker;
}

// ─── Exponential Backoff Retry Wrapper ────────────────────────────────────────
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      // Retry on 429 (rate limit) and 5xx server errors
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}`);
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        console.warn(`Retry ${attempt + 1}/${maxRetries} for ${url} after ${Math.round(delay)}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      // Non-retryable HTTP errors (4xx client errors except 429)
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    } catch (err) {
      lastError = err;
      // Only skip retries for non-429 client errors (4xx)
      const isClientError = /^HTTP 4(?!29)\d{1,2}/.test(err.message);
      if (attempt < maxRetries - 1 && !isClientError) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
        console.warn(`Retry ${attempt + 1}/${maxRetries} for ${url}: ${err.message}`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError || new Error(`Failed after ${maxRetries} retries`);
}

// ─── Initialize Alarm and Storage on Installation ─────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  console.log("AuraTrade Quant-Semantic Terminal v2.0 Installed.");
  chrome.storage.local.get(["watchlist", "settings"], (result) => {
    if (!result.watchlist) {
      chrome.storage.local.set({ watchlist: DEFAULT_WATCHLIST });
    }
    
    const currentSettings = result.settings || {};
    const updatedSettings = {
      geminiKey: currentSettings.geminiKey || "",
      geminiModel: currentSettings.geminiModel || "gemini-2.5-flash",
      alertEmail: currentSettings.alertEmail || "",
      gmailToken: currentSettings.gmailToken || "",
      firebaseProject: currentSettings.firebaseProject || "",
      firebaseKey: currentSettings.firebaseKey || "",
      investmentStyle: currentSettings.investmentStyle || "Growth",
      theme: currentSettings.theme || "light",
      defaultExchange: currentSettings.defaultExchange || "NSE",
      scannerTickers: currentSettings.scannerTickers || DEFAULT_SCANNER_TICKERS,
      includeTrending: currentSettings.includeTrending !== false,
      scanFrequency: currentSettings.scanFrequency || "60",
      lastAlertSent: currentSettings.lastAlertSent || {},
      stopLossThreshold: currentSettings.stopLossThreshold || "5.0",
      sharpDropThreshold: currentSettings.sharpDropThreshold || "3.0",
      enablePortfolioAlerts: currentSettings.enablePortfolioAlerts !== false
    };
    chrome.storage.local.set({ settings: updatedSettings }, () => {
      const freq = parseInt(updatedSettings.scanFrequency) || 60;
      chrome.alarms.create("alpha-background-check", { periodInMinutes: freq });
      console.log(`Alarm scheduled to run every ${freq} minutes.`);
    });
  });
});

// ─── Alarm Trigger ────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "alpha-background-check") {
    runWatchlistBackgroundCheck().catch(err => console.error("Watchlist background check error:", err));
    runDynamicTrendScan().catch(err => console.error("Hourly scan failure:", err));
    runPortfolioBackgroundCheck().catch(err => console.error("Portfolio background check error:", err));
  }
});

// ─── Dynamic Scan Frequency Settings Updates ──────────────────────────────────
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.settings) {
    const oldVal = changes.settings.oldValue;
    const newVal = changes.settings.newValue;
    if (newVal && (!oldVal || oldVal.scanFrequency !== newVal.scanFrequency)) {
      const freq = parseInt(newVal.scanFrequency) || 60;
      chrome.alarms.clear("alpha-background-check", () => {
        chrome.alarms.create("alpha-background-check", { periodInMinutes: freq });
        console.log(`Re-scheduled background check alarm to run every ${freq} minutes.`);
      });
    }
  }
});

// ─── Messages Router ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "FETCH_ASSET") {
    handleFetchAsset(request.ticker, request.forceRefresh)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => {
        console.error("Error fetching asset details:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "GET_WATCHLIST") {
    getWatchlist().then(list => sendResponse({ success: true, list }));
    return true;
  }

  if (request.action === "ADD_WATCHLIST") {
    addToWatchlist(request.ticker)
      .then(list => sendResponse({ success: true, list }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "REMOVE_WATCHLIST") {
    removeFromWatchlist(request.ticker)
      .then(list => sendResponse({ success: true, list }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "TRIGGER_TEST_ALERT") {
    triggerTestAlert(request.ticker)
      .then(res => sendResponse({ success: true, details: res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "SYNC_WATCHLIST") {
    getWatchlist()
      .then(list => syncWatchlistToFirestore(list))
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "SCAN_MARKET") {
    runDynamicTrendScan()
      .then(results => sendResponse({ success: true, results }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === "GET_HISTORY") {
    chrome.storage.local.get(["scanHistory"], (res) => {
      sendResponse({ success: true, history: res.scanHistory || [] });
    });
    return true;
  }

  if (request.action === "OPEN_REPORT_TAB") {
    chrome.tabs.create({ url: chrome.runtime.getURL(`report.html?ticker=${request.ticker}`) });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === "CLEAR_HISTORY") {
    chrome.storage.local.set({ scanHistory: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === "REMOVE_HISTORY_ITEM") {
    chrome.storage.local.get(["scanHistory"], (res) => {
      const history = res.scanHistory || [];
      const updated = history.filter(item => item.ticker !== request.ticker);
      chrome.storage.local.set({ scanHistory: updated }, () => {
        sendResponse({ success: true, history: updated });
      });
    });
    return true;
  }

  if (request.action === "SEND_CHAT") {
    handleSendChat(request.message, request.history)
      .then(response => sendResponse({ success: true, response }))
      .catch(error => {
        console.error("Error in chat service:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (request.action === "OPEN_VOICE_PERMISSION") {
    chrome.tabs.create({ url: chrome.runtime.getURL("voice-permission.html") });
    sendResponse({ success: true });
    return true;
  }

  if (request.action === "FETCH_PRICE_ONLY") {
    getSettings().then(settings => {
      const resolved = resolveTicker(request.ticker, settings);
      return fetchQuantData(resolved);
    })
    .then(quant => {
      sendResponse({ success: true, price: quant.currentPrice, ticker: quant.ticker, currency: quant.currency });
    })
    .catch(error => {
      console.error("Error fetching price only:", error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  // ─── Portfolio Management Handlers ────────────────────────────────────────
  if (request.action === "GET_PORTFOLIO") {
    chrome.storage.local.get(["alphaPortfolio"], (res) => {
      sendResponse({ success: true, portfolio: res.alphaPortfolio || [] });
    });
    return true;
  }

  if (request.action === "ADD_PORTFOLIO_POSITION") {
    chrome.storage.local.get(["alphaPortfolio"], (res) => {
      const portfolio = res.alphaPortfolio || [];
      const position = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
        ticker: request.position.ticker,
        qty: parseFloat(request.position.qty),
        avgPrice: parseFloat(request.position.avgPrice),
        addedAt: new Date().toISOString()
      };
      portfolio.push(position);
      chrome.storage.local.set({ alphaPortfolio: portfolio }, () => {
        sendResponse({ success: true, portfolio });
      });
    });
    return true;
  }

  if (request.action === "REMOVE_PORTFOLIO_POSITION") {
    chrome.storage.local.get(["alphaPortfolio"], (res) => {
      const portfolio = (res.alphaPortfolio || []).filter(p => p.id !== request.positionId);
      chrome.storage.local.set({ alphaPortfolio: portfolio }, () => {
        sendResponse({ success: true, portfolio });
      });
    });
    return true;
  }

  // ─── CSV Export Data Handler ──────────────────────────────────────────────
  if (request.action === "EXPORT_ASSET_CSV") {
    chrome.storage.local.get([`cache_${request.ticker}`], (res) => {
      const data = res[`cache_${request.ticker}`];
      if (!data) {
        sendResponse({ success: false, error: "No cached data for this ticker." });
        return;
      }
      const csv = generateAssetCSV(data);
      sendResponse({ success: true, csv, ticker: data.ticker });
    });
    return true;
  }

  // ─── Custom Price Alerts Handlers ──────────────────────────────────────────
  if (request.action === "GET_ALERTS") {
    chrome.storage.local.get(["alphaPriceAlerts"], (res) => {
      sendResponse({ success: true, alerts: res.alphaPriceAlerts || [] });
    });
    return true;
  }

  if (request.action === "ADD_PRICE_ALERT") {
    chrome.storage.local.get(["alphaPriceAlerts", "settings"], (res) => {
      const alerts = res.alphaPriceAlerts || [];
      const newAlert = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
        ticker: resolveTicker(request.ticker, res.settings || {}),
        condition: request.condition,
        targetPrice: parseFloat(request.targetPrice),
        createdAt: Date.now(),
        triggered: false
      };
      alerts.push(newAlert);
      chrome.storage.local.set({ alphaPriceAlerts: alerts }, () => {
        sendResponse({ success: true, alerts });
      });
    });
    return true;
  }

  if (request.action === "REMOVE_PRICE_ALERT") {
    chrome.storage.local.get(["alphaPriceAlerts"], (res) => {
      const alerts = (res.alphaPriceAlerts || []).filter(a => a.id !== request.alertId);
      chrome.storage.local.set({ alphaPriceAlerts: alerts }, () => {
        sendResponse({ success: true, alerts });
      });
    });
    return true;
  }

  // ─── Portfolio Warnings Handlers ───────────────────────────────────────────
  if (request.action === "GET_PORTFOLIO_ALERTS") {
    chrome.storage.local.get(["alphaPortfolioAlerts"], (res) => {
      sendResponse({ success: true, alerts: res.alphaPortfolioAlerts || [] });
    });
    return true;
  }

  if (request.action === "CLEAR_PORTFOLIO_ALERTS") {
    chrome.storage.local.set({ alphaPortfolioAlerts: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["settings"], (res) => {
      resolve(res.settings || {});
    });
  });
}

function getWatchlist() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["watchlist"], (res) => {
      resolve(res.watchlist || DEFAULT_WATCHLIST);
    });
  });
}

// ─── Advanced Technical Indicator Calculations ────────────────────────────────
function calculateSMA(prices, period) {
  const count = Math.min(prices.length, period);
  if (count === 0) return 0;
  const slice = prices.slice(-count);
  return slice.reduce((sum, val) => sum + val, 0) / count;
}

function calculateEMA(prices, period) {
  if (prices.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  
  let gains = [];
  let losses = [];
  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  
  // Calculate first average gain/loss (simple average)
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;
  
  // Apply Wilder's smoothing to the rest of the values
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculatePivotPoints(high, low, close) {
  const pp = (high + low + close) / 3;
  const r1 = 2 * pp - low;
  const s1 = 2 * pp - high;
  const r2 = pp + (high - low);
  const s2 = pp - (high - low);
  return {
    pp: parseFloat(pp.toFixed(2)),
    r1: parseFloat(r1.toFixed(2)),
    s1: parseFloat(s1.toFixed(2)),
    r2: parseFloat(r2.toFixed(2)),
    s2: parseFloat(s2.toFixed(2))
  };
}

function calculateMACD(prices) {
  if (prices.length < 26) return { macdLine: 0, signalLine: 0, histogram: 0 };
  
  // Build MACD history incrementally (O(n) instead of O(n²))
  const k12 = 2 / (12 + 1);
  const k26 = 2 / (26 + 1);
  let ema12 = prices[0];
  let ema26 = prices[0];
  const macdHistory = [];
  
  for (let i = 1; i < prices.length; i++) {
    ema12 = prices[i] * k12 + ema12 * (1 - k12);
    ema26 = prices[i] * k26 + ema26 * (1 - k26);
    if (i >= 25) { // Start recording MACD values once we have 26 data points
      macdHistory.push(ema12 - ema26);
    }
  }
  
  const macdLine = ema12 - ema26;
  const signalLine = macdHistory.length >= 9 ? calculateEMA(macdHistory, 9) : macdLine;
  const histogram = macdLine - signalLine;
  return { macdLine: parseFloat(macdLine.toFixed(4)), signalLine: parseFloat(signalLine.toFixed(4)), histogram: parseFloat(histogram.toFixed(4)) };
}

function calculateBollingerBands(prices, period = 20, multiplier = 2) {
  if (prices.length < period) return { upper: 0, middle: 0, lower: 0, width: 0, percentB: 0.5 };
  const slice = prices.slice(-period);
  const middle = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + Math.pow(v - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = middle + multiplier * stdDev;
  const lower = middle - multiplier * stdDev;
  const width = upper - lower;
  const currentPrice = prices[prices.length - 1];
  const percentB = width > 0 ? (currentPrice - lower) / width : 0.5;
  return {
    upper: parseFloat(upper.toFixed(2)),
    middle: parseFloat(middle.toFixed(2)),
    lower: parseFloat(lower.toFixed(2)),
    width: parseFloat(width.toFixed(2)),
    percentB: parseFloat(percentB.toFixed(4))
  };
}

function calculateATR(highs, lows, closes, period = 14) {
  if (!highs || !lows || closes.length < period + 1) return 0;
  const trueRanges = [];
  for (let i = 1; i < closes.length; i++) {
    const h = highs[i] || closes[i];
    const l = lows[i] || closes[i];
    const prevC = closes[i - 1];
    const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    trueRanges.push(tr);
  }
  const recentTR = trueRanges.slice(-period);
  const atr = recentTR.reduce((s, v) => s + v, 0) / recentTR.length;
  return parseFloat(atr.toFixed(2));
}

function calculateVolumeProfile(volumes) {
  if (!volumes || volumes.length < 5) return { avgVolume: 0, latestVolume: 0, volumeRatio: 1.0, trend: "Normal" };
  const cleaned = volumes.filter(v => v !== null && v !== undefined && v > 0);
  if (cleaned.length < 3) return { avgVolume: 0, latestVolume: 0, volumeRatio: 1.0, trend: "Normal" };
  const avg = cleaned.slice(0, -1).reduce((s, v) => s + v, 0) / (cleaned.length - 1);
  const latest = cleaned[cleaned.length - 1];
  const ratio = avg > 0 ? latest / avg : 1.0;
  let trend = "Normal";
  if (ratio > 1.5) trend = "High Volume Surge";
  else if (ratio > 1.2) trend = "Above Average";
  else if (ratio < 0.5) trend = "Low Volume";
  return {
    avgVolume: Math.round(avg),
    latestVolume: Math.round(latest),
    volumeRatio: parseFloat(ratio.toFixed(2)),
    trend
  };
}

// ─── Linear Regression Calculation ───────────────────────────────────────────
function calculateLinearRegression(prices) {
  const n = prices.length;
  if (n < 2) {
    return { slope: 0, intercept: prices[0] || 0, r2: 0, forecast5Day: prices[0] || 0 };
  }
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += prices[i];
    sumXY += i * prices[i];
    sumXX += i * i;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = meanY - slope * meanX;

  // Calculate R-squared (R2)
  let totalSS = 0;
  let residualSS = 0;
  for (let i = 0; i < n; i++) {
    const fitted = slope * i + intercept;
    totalSS += Math.pow(prices[i] - meanY, 2);
    residualSS += Math.pow(prices[i] - fitted, 2);
  }
  const r2 = totalSS > 0 ? 1 - (residualSS / totalSS) : 0;

  // 5-day forecast
  const forecast5Day = slope * (n - 1 + 5) + intercept;

  return {
    slope: parseFloat(slope.toFixed(4)),
    intercept: parseFloat(intercept.toFixed(2)),
    r2: parseFloat(r2.toFixed(4)),
    forecast5Day: parseFloat(forecast5Day.toFixed(2))
  };
}

// ─── Multi-Factor Granular Quant Score ─────────────────────────────────────────
function computeGranularQuantScore(currentPrice, sma20, sma50, rsi, macd, bollinger, volumeProfile, pivotPoints = null, crossover = "None", regression = null) {
  let score = 0;

  // 1. SMA Alignment (15% weight — 0.0 to 0.15)
  if (currentPrice > sma20 && sma20 > sma50) score += 0.15;
  else if (currentPrice > sma20 || sma20 > sma50) score += 0.08;
  else if (currentPrice < sma20 && sma20 < sma50) score += 0.0;
  else score += 0.04;

  // 2. RSI Signal Zone (15% weight — 0.0 to 0.15)
  if (rsi >= 50 && rsi < 70) score += 0.15; // Healthy bullish
  else if (rsi >= 40 && rsi < 50) score += 0.09; // Neutral-ish
  else if (rsi >= 30 && rsi < 40) score += 0.04; // Approaching oversold
  else if (rsi < 30) score += 0.11; // Oversold bounce potential
  else if (rsi >= 70) score += 0.02; // Overbought — caution

  // 3. MACD Crossover Direction (15% weight — 0.0 to 0.15)
  if (macd.histogram > 0 && macd.macdLine > 0) score += 0.15; // Strong bullish
  else if (macd.histogram > 0) score += 0.10; // Bullish crossover
  else if (macd.histogram < 0 && macd.macdLine < 0) score += 0.0; // Strong bearish
  else if (macd.histogram < 0) score += 0.04; // Bearish crossover
  else score += 0.07; // Flat

  // 4. Bollinger Band Position (15% weight — 0.0 to 0.15)
  if (bollinger.percentB >= 0.4 && bollinger.percentB <= 0.8) score += 0.15; // Healthy mid-band
  else if (bollinger.percentB > 0.8) score += 0.05; // Near upper
  else if (bollinger.percentB < 0.2) score += 0.10; // Near lower
  else score += 0.08;

  // 5. Volume Trend (10% weight — 0.0 to 0.10)
  if (volumeProfile.volumeRatio > 1.5) score += 0.10; // High conviction move
  else if (volumeProfile.volumeRatio > 1.0) score += 0.07;
  else if (volumeProfile.volumeRatio > 0.5) score += 0.04;
  else score += 0.02;

  // 6. Price Momentum (15% weight — 0.0 to 0.15)
  const sma20Dist = sma20 > 0 ? (currentPrice - sma20) / sma20 : 0;
  if (sma20Dist > 0.03) score += 0.15;
  else if (sma20Dist > 0.01) score += 0.11;
  else if (sma20Dist > -0.01) score += 0.07;
  else if (sma20Dist > -0.03) score += 0.04;
  else score += 0.0;

  // 7. Linear Regression Trend Fit (15% weight — 0.0 to 0.15)
  if (regression) {
    const relSlope = regression.slope / currentPrice;
    if (regression.slope > 0 && regression.r2 >= 0.60) score += 0.15;
    else if (regression.slope > 0) score += 0.10;
    else if (Math.abs(relSlope) < 0.0005) score += 0.07;
    else if (regression.slope < 0 && regression.r2 < 0.60) score += 0.03;
    else score += 0.0;
  } else {
    score += 0.07;
  }

  // Pivot Points Breakout (Dynamic adjustment: -0.10 to +0.10)
  if (pivotPoints) {
    if (currentPrice > pivotPoints.r2) score += 0.10;
    else if (currentPrice > pivotPoints.r1) score += 0.05;
    else if (currentPrice < pivotPoints.s2) score -= 0.10;
    else if (currentPrice < pivotPoints.s1) score -= 0.05;
  }

  // Technical Moving Average Crossovers (Dynamic adjustment: -0.08 to +0.08)
  if (crossover === "Golden Cross") {
    score += 0.08;
  } else if (crossover === "Death Cross") {
    score -= 0.08;
  }

  return parseFloat(Math.max(0.0, Math.min(1.0, score)).toFixed(4));
}

// ─── Fetch Fundamental Data from Yahoo Finance quoteSummary ──────────────────
async function fetchFundamentalData(ticker) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=summaryDetail,financialData,defaultKeyStatistics`;
  try {
    const response = await fetchWithRetry(url, {}, 2);
    const json = await response.json();
    const result = json?.quoteSummary?.result?.[0];
    if (!result) return null;

    const financialData = result.financialData || {};
    const summaryDetail = result.summaryDetail || {};
    const keyStatistics = result.defaultKeyStatistics || {};

    return {
      pe: financialData.trailingPE?.raw || summaryDetail.trailingPE?.raw || null,
      forwardPe: financialData.forwardPE?.raw || summaryDetail.forwardPE?.raw || null,
      pb: keyStatistics.priceToBook?.raw || summaryDetail.priceToBook?.raw || null,
      debtToEquity: financialData.debtToEquity?.raw || null,
      roe: financialData.returnOnEquity?.raw || null,
      revenueGrowth: financialData.revenueGrowth?.raw || null,
      earningsGrowth: financialData.earningsGrowth?.raw || null,
      freeCashFlow: financialData.freeCashflow?.raw || null,
      operatingMargins: financialData.operatingMargins?.raw || keyStatistics.operatingMargins?.raw || null,
      marketCap: summaryDetail.marketCap?.raw || null,
      dividendYield: summaryDetail.dividendYield?.raw || null,
      recommendationMean: financialData.recommendationMean?.raw || null
    };
  } catch (err) {
    console.warn(`Failed to fetch fundamental data for ${ticker}:`, err);
    return null;
  }
}

// ─── Compute Fundamental Score from Financial Ratios ─────────────────────────
function computeGranularFundamentalScore(fundamental) {
  if (!fundamental) return 0.5; // neutral fallback

  let score = 0;
  let count = 0;

  // 1. Valuation: P/E Ratio
  if (fundamental.pe !== null) {
    count++;
    if (fundamental.pe > 0 && fundamental.pe <= 18) score += 1.0;
    else if (fundamental.pe > 18 && fundamental.pe <= 35) score += 0.7;
    else if (fundamental.pe > 35 && fundamental.pe <= 60) score += 0.4;
    else if (fundamental.pe > 60) score += 0.15;
    else score += 0.0; // PE <= 0 is negative (loss-making)
  }

  // 2. Valuation: P/B Ratio
  if (fundamental.pb !== null) {
    count++;
    if (fundamental.pb > 0 && fundamental.pb <= 2.5) score += 1.0;
    else if (fundamental.pb > 2.5 && fundamental.pb <= 5.0) score += 0.7;
    else if (fundamental.pb > 5.0 && fundamental.pb <= 10.0) score += 0.4;
    else score += 0.15;
  }

  // 3. Profitability: ROE
  if (fundamental.roe !== null) {
    count++;
    if (fundamental.roe >= 0.18) score += 1.0;
    else if (fundamental.roe >= 0.10) score += 0.75;
    else if (fundamental.roe >= 0.04) score += 0.4;
    else score += 0.0;
  }

  // 4. Profitability: Operating Margin
  if (fundamental.operatingMargins !== null) {
    count++;
    if (fundamental.operatingMargins >= 0.20) score += 1.0;
    else if (fundamental.operatingMargins >= 0.10) score += 0.75;
    else if (fundamental.operatingMargins >= 0.03) score += 0.4;
    else score += 0.0;
  }

  // 5. Growth: Revenue Growth
  if (fundamental.revenueGrowth !== null) {
    count++;
    if (fundamental.revenueGrowth >= 0.15) score += 1.0;
    else if (fundamental.revenueGrowth >= 0.06) score += 0.75;
    else if (fundamental.revenueGrowth >= 0.0) score += 0.5;
    else score += 0.1;
  }

  // 6. Growth: Earnings Growth
  if (fundamental.earningsGrowth !== null) {
    count++;
    if (fundamental.earningsGrowth >= 0.15) score += 1.0;
    else if (fundamental.earningsGrowth >= 0.05) score += 0.75;
    else if (fundamental.earningsGrowth >= 0.0) score += 0.5;
    else score += 0.1;
  }

  // 7. Leverage: Debt-to-Equity
  if (fundamental.debtToEquity !== null) {
    count++;
    const de = fundamental.debtToEquity > 10 ? fundamental.debtToEquity / 100 : fundamental.debtToEquity;
    if (de <= 0.8) score += 1.0;
    else if (de > 0.8 && de <= 1.5) score += 0.7;
    else if (de > 1.5 && de <= 3.0) score += 0.4;
    else score += 0.1;
  }

  // 8. Recommendation Mean
  if (fundamental.recommendationMean !== null) {
    count++;
    if (fundamental.recommendationMean <= 2.0) score += 1.0;
    else if (fundamental.recommendationMean <= 3.0) score += 0.65;
    else if (fundamental.recommendationMean <= 4.0) score += 0.3;
    else score += 0.0;
  }

  if (count === 0) return 0.5;
  return parseFloat((score / count).toFixed(4));
}

// ─── Fetch Benchmark Index & VIX Volatility ──────────────────────────────────
async function fetchBenchmarkData(ticker, settings) {
  const isIndian = ticker.endsWith(".NS") || ticker.endsWith(".BO") || (settings.defaultExchange === "NSE" || settings.defaultExchange === "BSE");
  const benchmarkTicker = isIndian ? "^NSEI" : "^GSPC";
  const vixTicker = isIndian ? "^INDIAVIX" : "^VIX";
  
  let indexPrice = null;
  let indexChangePercent = 0;
  let indexSma50 = null;
  let indexSma20 = null;
  let vixPrice = null;

  try {
    const indexUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${benchmarkTicker}?range=90d&interval=1d`;
    const res = await fetchWithRetry(indexUrl, {}, 2);
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (result) {
      const closePrices = result.indicators?.quote?.[0]?.close || [];
      const cleanedPrices = closePrices.filter(c => c !== null && c !== undefined);
      if (cleanedPrices.length > 0) {
        indexPrice = result.meta?.regularMarketPrice || cleanedPrices[cleanedPrices.length - 1];
        const prevClose = result.meta?.previousClose || cleanedPrices[cleanedPrices.length - 2] || indexPrice;
        indexChangePercent = ((indexPrice - prevClose) / prevClose) * 100;
        
        indexSma50 = calculateSMA(cleanedPrices, 50);
        indexSma20 = calculateSMA(cleanedPrices, 20);
      }
    }
  } catch (err) {
    console.warn(`Failed to fetch benchmark index ${benchmarkTicker}:`, err);
  }

  try {
    const vixUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${vixTicker}?range=1d&interval=1m`;
    const res = await fetchWithRetry(vixUrl, {}, 2);
    const json = await res.json();
    vixPrice = json?.chart?.result?.[0]?.meta?.regularMarketPrice || null;
  } catch (err) {
    if (vixTicker !== "^VIX") {
      try {
        const fallbackRes = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/^VIX?range=1d&interval=1m`);
        const fallbackJson = await fallbackRes.json();
        vixPrice = fallbackJson?.chart?.result?.[0]?.meta?.regularMarketPrice || null;
      } catch (e) {
        console.warn("Fallback VIX query failed:", e);
      }
    }
  }

  return {
    benchmarkTicker,
    indexPrice,
    indexChangePercent,
    indexSma50,
    indexSma20,
    vixTicker,
    vixPrice
  };
}

// ─── Compute Quantitative Market score ───────────────────────────────────────
function computeQuantMarketScore(benchmark) {
  if (!benchmark) return 0.5;

  let score = 0;
  let count = 0;

  // 1. Index trend compared to SMA50
  if (benchmark.indexPrice !== null && benchmark.indexSma50 !== null) {
    count++;
    if (benchmark.indexPrice > benchmark.indexSma50) {
      score += benchmark.indexPrice > benchmark.indexSma20 ? 0.9 : 0.7;
    } else {
      score += benchmark.indexPrice < benchmark.indexSma20 ? 0.15 : 0.35;
    }
  }

  // 2. VIX Volatility Index Level
  if (benchmark.vixPrice !== null) {
    count++;
    if (benchmark.vixPrice < 15) score += 0.9;
    else if (benchmark.vixPrice <= 20) score += 0.65;
    else if (benchmark.vixPrice <= 25) score += 0.4;
    else score += 0.15;
  }

  // 3. Index Daily Change
  if (benchmark.indexChangePercent !== null) {
    count++;
    if (benchmark.indexChangePercent >= 1.0) score += 0.9;
    else if (benchmark.indexChangePercent >= 0.2) score += 0.75;
    else if (benchmark.indexChangePercent >= -0.2) score += 0.5;
    else if (benchmark.indexChangePercent >= -1.0) score += 0.25;
    else score += 0.1;
  }

  if (count === 0) return 0.5;
  return parseFloat((score / count).toFixed(4));
}

// ─── Quant Status Label from Score ────────────────────────────────────────────
function getQuantStatus(S_quant, rsi) {
  if (S_quant >= 0.80) return "Strong Bullish Alignment";
  if (S_quant >= 0.60) return "Moderate Bullish";
  if (S_quant >= 0.45) return "Neutral Consolidation";
  if (S_quant >= 0.30) return "Moderate Bearish";
  return "Strong Bearish Alignment";
}

// ─── Fetch Intraday Data & Advanced Technical Indicators ─────────────────────
async function fetchIntradayData(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=5m`;
    const response = await fetchWithRetry(url, {}, 2);
    const data = await response.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    
    const quotes = result.indicators?.quote?.[0];
    if (!quotes || !quotes.close) return null;
    
    const closes = quotes.close;
    const highs = quotes.high;
    const lows = quotes.low;
    const volumes = quotes.volume;
    
    let cleanedCloses = [], cleanedHighs = [], cleanedLows = [], cleanedVolumes = [];
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] !== null && volumes[i] !== null) {
        cleanedCloses.push(closes[i]);
        cleanedHighs.push(highs[i]);
        cleanedLows.push(lows[i]);
        cleanedVolumes.push(volumes[i]);
      }
    }
    
    if (cleanedCloses.length === 0) return null;
    
    // VWAP Calculation
    let cumulativeVP = 0;
    let cumulativeV = 0;
    for (let i = 0; i < cleanedCloses.length; i++) {
      const typicalPrice = (cleanedHighs[i] + cleanedLows[i] + cleanedCloses[i]) / 3;
      cumulativeVP += typicalPrice * cleanedVolumes[i];
      cumulativeV += cleanedVolumes[i];
    }
    const vwap = cumulativeV > 0 ? cumulativeVP / cumulativeV : cleanedCloses[cleanedCloses.length - 1];
    
    // Stochastic Oscillator (14 periods)
    const stochPeriod = Math.min(14, cleanedCloses.length);
    const recentHighs = cleanedHighs.slice(-stochPeriod);
    const recentLows = cleanedLows.slice(-stochPeriod);
    const highestHigh = Math.max(...recentHighs);
    const lowestLow = Math.min(...recentLows);
    const currentClose = cleanedCloses[cleanedCloses.length - 1];
    const stochasticK = highestHigh - lowestLow > 0 ? ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100 : 50;
    
    // OBV (On-Balance Volume)
    let obv = 0;
    for (let i = 1; i < cleanedCloses.length; i++) {
      if (cleanedCloses[i] > cleanedCloses[i - 1]) obv += cleanedVolumes[i];
      else if (cleanedCloses[i] < cleanedCloses[i - 1]) obv -= cleanedVolumes[i];
    }
    
    return {
      vwap: parseFloat(vwap.toFixed(2)),
      stochasticK: parseFloat(stochasticK.toFixed(2)),
      obv: obv,
      intradayPrices: cleanedCloses.slice(-50)
    };
  } catch (err) {
    console.warn(`Failed to fetch intraday data for ${ticker}:`, err);
    return null;
  }
}

// ─── Fetch Historical Prices from Yahoo Finance (with retry) ──────────────────
async function fetchQuantData(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=90d&interval=1d`;
  const response = await fetchWithRetry(url);
  const data = await response.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    throw new Error(`Invalid data structure returned for ${ticker}.`);
  }
  const quotes = result.indicators?.quote?.[0];
  const closePrices = quotes?.close || [];
  const highPrices = quotes?.high || [];
  const lowPrices = quotes?.low || [];
  const volumes = quotes?.volume || [];
  const currentPrice = result.meta?.regularMarketPrice || closePrices[closePrices.length - 1];

  // Clean out nulls and align prices, highs, lows, and volumes index-by-index
  const cleanedPrices = [];
  const cleanedHighs = [];
  const cleanedLows = [];
  const cleanedVolumes = [];

  for (let i = 0; i < closePrices.length; i++) {
    const c = closePrices[i];
    const h = highPrices[i];
    const l = lowPrices[i];
    const v = volumes[i];
    if (c !== null && c !== undefined && h !== null && h !== undefined && l !== null && l !== undefined && v !== null && v !== undefined) {
      cleanedPrices.push(c);
      cleanedHighs.push(h);
      cleanedLows.push(l);
      cleanedVolumes.push(v);
    }
  }

  if (cleanedPrices.length === 0) {
    throw new Error(`No price history available for ${ticker}.`);
  }

  // Standard moving averages
  const sma20 = calculateSMA(cleanedPrices, 20);
  const sma50 = calculateSMA(cleanedPrices, 50);

  // Advanced indicators
  const rsi = calculateRSI(cleanedPrices, 14);
  const macd = calculateMACD(cleanedPrices);
  const bollinger = calculateBollingerBands(cleanedPrices, 20, 2);
  const atr = calculateATR(cleanedHighs, cleanedLows, cleanedPrices, 14);
  const volumeProfile = calculateVolumeProfile(cleanedVolumes);

  // Compute daily price change
  const prevClose = result.meta?.previousClose || cleanedPrices[cleanedPrices.length - 2] || currentPrice;
  const priceChange = currentPrice - prevClose;
  const priceChangePercent = (priceChange / prevClose) * 100;

  // 52-week range from meta data
  const fiftyTwoWeekHigh = result.meta?.fiftyTwoWeekHigh || Math.max(...cleanedPrices);
  const fiftyTwoWeekLow = result.meta?.fiftyTwoWeekLow || Math.min(...cleanedPrices);
  const fiftyTwoWeekRange = fiftyTwoWeekHigh - fiftyTwoWeekLow;
  const fiftyTwoWeekPosition = fiftyTwoWeekRange > 0 ? (currentPrice - fiftyTwoWeekLow) / fiftyTwoWeekRange : 0.5;

  // Compute Standard Pivot Points based on last day
  const lastIndex = cleanedPrices.length - 1;
  const pivotPoints = calculatePivotPoints(
    cleanedHighs[lastIndex] !== undefined ? cleanedHighs[lastIndex] : currentPrice,
    cleanedLows[lastIndex] !== undefined ? cleanedLows[lastIndex] : currentPrice,
    cleanedPrices[lastIndex] !== undefined ? cleanedPrices[lastIndex] : currentPrice
  );

  // Detect SMA Crossover Events (Golden / Death Cross)
  const pricesYesterday = cleanedPrices.slice(0, -1);
  const sma20_yesterday = calculateSMA(pricesYesterday, 20);
  const sma50_yesterday = calculateSMA(pricesYesterday, 50);
  let crossover = "None";
  if (sma20_yesterday <= sma50_yesterday && sma20 > sma50) {
    crossover = "Golden Cross";
  } else if (sma20_yesterday >= sma50_yesterday && sma20 < sma50) {
    crossover = "Death Cross";
  }

  // Calculate 20-day linear regression
  const regression = calculateLinearRegression(cleanedPrices.slice(-20));

  // Fetch Intraday Advanced Indicators
  const intraday = await fetchIntradayData(ticker);

  // Compute granular S_quant
  const S_quant = computeGranularQuantScore(currentPrice, sma20, sma50, rsi, macd, bollinger, volumeProfile, pivotPoints, crossover, regression);
  const status = getQuantStatus(S_quant, rsi);

  return {
    ticker,
    currentPrice: parseFloat(safeToFixed(currentPrice, 2)),
    prevClose: parseFloat(safeToFixed(prevClose, 2)),
    priceChange: parseFloat(safeToFixed(priceChange, 2)),
    priceChangePercent: parseFloat(safeToFixed(priceChangePercent, 2)),
    sma20: parseFloat(safeToFixed(sma20, 2)),
    sma50: parseFloat(safeToFixed(sma50, 2)),
    prices: cleanedPrices.slice(-70),
    currency: (ticker.endsWith(".NS") || ticker.endsWith(".BO")) ? "INR" : "USD",
    // Advanced indicators
    rsi: parseFloat(safeToFixed(rsi, 2)),
    macd,
    bollinger,
    atr,
    volumeProfile,
    // 52-week data
    fiftyTwoWeekHigh: parseFloat(safeToFixed(fiftyTwoWeekHigh, 2)),
    fiftyTwoWeekLow: parseFloat(safeToFixed(fiftyTwoWeekLow, 2)),
    fiftyTwoWeekPosition: parseFloat(safeToFixed(fiftyTwoWeekPosition, 4)),
    // New parameters
    pivotPoints,
    crossover,
    regression,
    intraday,
    // Scores
    S_quant,
    status
  };
}

// ─── Semantic Engine using Gemini 2.5 Flash with Search Grounding ─────────────
async function fetchSemanticData(ticker, settings, quant = {}) {
  const geminiKey = settings.geminiKey;
  if (!geminiKey) {
    return {
      sentiment: "NEUTRAL",
      summary: "Gemini API key is not configured. Go to settings to enter your key.",
      citations: [],
      targetPrice: "N/A",
      confidence: "N/A",
      bestStrategy: "Hold",
      S_semantic: 0.5,
      marketSentimentAnalysis: "N/A",
      S_market_semantic: 0.5,
      fundamentalAnalysisSummary: "N/A",
      S_fundamental_semantic: 0.5,
      news: []
    };
  }

  const style = settings.investmentStyle || "Growth";
  let activeModel = settings.geminiModel || "gemini-2.5-flash";
  let url = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${geminiKey}`;
  
  const isIndian = ticker.endsWith(".NS") || ticker.endsWith(".BO");
  const targetExample = isIndian ? "₹2450.00" : "$195.00";
  const marketName = isIndian ? "Indian Stock Exchange (NSE/BSE)" : "US Stock Market";

  // Build the quantitative data block to inject into the prompt
  let quantInfo = "";
  if (quant && quant.fundamental) {
    const f = quant.fundamental;
    quantInfo += `
[Quantitative Fundamental Ratios for ${ticker}]:
- P/E Ratio: ${f.pe !== null ? f.pe.toFixed(2) : 'N/A'} (Forward P/E: ${f.forwardPe !== null ? f.forwardPe.toFixed(2) : 'N/A'})
- P/B Ratio: ${f.pb !== null ? f.pb.toFixed(2) : 'N/A'}
- Debt-to-Equity Ratio: ${f.debtToEquity !== null ? f.debtToEquity.toFixed(2) : 'N/A'}
- Return on Equity (ROE): ${f.roe !== null ? (f.roe * 100).toFixed(2) + '%' : 'N/A'}
- Revenue Growth (YoY): ${f.revenueGrowth !== null ? (f.revenueGrowth * 100).toFixed(2) + '%' : 'N/A'}
- Earnings Growth (YoY): ${f.earningsGrowth !== null ? (f.earningsGrowth * 100).toFixed(2) + '%' : 'N/A'}
- Free Cash Flow: ${f.freeCashFlow !== null ? f.freeCashFlow.toLocaleString() : 'N/A'}
- Operating Margin: ${f.operatingMargins !== null ? (f.operatingMargins * 100).toFixed(2) + '%' : 'N/A'}
- Consensus Recommendation: ${f.recommendationMean !== null ? f.recommendationMean.toFixed(2) : 'N/A'} (1.0 = Strong Buy, 5.0 = Sell)
`;
  }
  if (quant && quant.benchmark) {
    const b = quant.benchmark;
    quantInfo += `
[Quantitative Market Conditions for ${marketName}]:
- Benchmark Index (${b.benchmarkTicker}): Current Price: ${b.indexPrice !== null ? b.indexPrice.toFixed(2) : 'N/A'}, Daily Change: ${b.indexChangePercent !== null ? b.indexChangePercent.toFixed(2) + '%' : 'N/A'}
- Volatility Index (VIX / ${b.vixTicker}): Current Level: ${b.vixPrice !== null ? b.vixPrice.toFixed(2) : 'N/A'}
- Market Trend Alignment: Index is trading ${b.indexPrice > b.indexSma50 ? 'above' : 'below'} its 50-day SMA.
`;
  }
  if (quant && quant.intraday) {
    const ind = quant.intraday;
    quantInfo += `
[Intraday & Momentum Indicators for ${ticker}]:
- VWAP (Volume Weighted Avg Price): ${ind.vwap !== null ? ind.vwap : 'N/A'} (Current Price is ${quant.currentPrice > ind.vwap ? 'Above' : 'Below'} VWAP)
- Stochastic Oscillator (%K): ${ind.stochasticK !== null ? ind.stochasticK.toFixed(2) : 'N/A'} (Above 80 is overbought, below 20 is oversold)
- On-Balance Volume (OBV) Trend: ${ind.obv > 0 ? 'Accumulation' : 'Distribution'} (${ind.obv})
`;
  }

  const prompt = `Analyze the latest market updates, news, macroeconomic developments, and sentiment for the asset ticker: ${ticker} on the ${marketName}. 
Focus on breaking updates, regulatory status, and predict its future price action over the next 5 days.
Also, suggest the best investment option or options strategy (e.g. Buy Stock, Long Calls, Covered Calls, Bull Call Spread) matching a user interest profile of '${style}' appropriate for this asset.

Here is the latest quantitative data fetched for the asset and market:
${quantInfo}

You MUST write all output text, especially the 'Best Strategy', 'Summary', 'Market Sentiment Analysis', and 'Fundamental Analysis Summary' fields, in simple, direct, non-technical language. Do not use complex financial jargon, and explain concepts simply for a regular person.
You MUST also wrap critical key terms, tickers, strategies, buy/sell recommendations, and target prices in double asterisks so they are markdown bold (e.g., **strong bullish signal**, **long calls**, **₹2450.00**, **Nifty 50**).

You MUST output your response in this exact format so that the extension can parse it:
Sentiment: [BULLISH, BEARISH, or NEUTRAL]
5-Day Target: [Predicted target price or direction, e.g. ${targetExample}]
Confidence: [e.g. 85%]
Best Strategy: [Concise option/trading strategy recommendation, with key terms in **bold**]
Summary: [Concise 2-sentence summary of the main reason, with key terms in **bold**]
Market Sentiment Analysis: [Concise 1-2 sentence overall market summary, highlighting global/national macro risks and index trends, with key terms in **bold**]
Market Score: [A score from 0.0 to 1.0 representing overall market/macro sentiment where 1.0 is extremely bullish/risk-on and 0.0 is panic/risk-off]
Fundamental Analysis Summary: [Concise 1-2 sentence company health, profitability, and valuation summary based on its ratios, with key terms in **bold**]
Fundamental Score: [A score from 0.0 to 1.0 representing company fundamental health/valuation, where 1.0 is excellent value/profitability and 0.0 is critical distress/overvaluation]
News:
- Headline 1 | Impact: [BULLISH, BEARISH, or NEUTRAL] | Source: [Source Name]
- Headline 2 | Impact: [BULLISH, BEARISH, or NEUTRAL] | Source: [Source Name]

List 2 to 4 recent, real-time news stories or market catalyst headlines in the News section. Explain them simply.
Ensure your analysis uses the googleSearch tool to search the web for real-time news and macro indicators.`;

  const requestBody = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    tools: [{
      google_search: {}
    }]
  };

  let response = null;
  let attempt = 0;
  const maxRetries = 2;
  let lastErrorDetail = "";

  while (attempt <= maxRetries) {
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok && activeModel !== "gemini-2.5-flash") {
        console.warn(`Gemini Model ${activeModel} failed with status ${response.status}. Falling back to gemini-2.5-flash.`);
        activeModel = "gemini-2.5-flash";
        url = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${geminiKey}`;
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody)
        });
      }
      
      if (response.ok) {
        break; // Success
      } else {
        lastErrorDetail = await response.text();
        console.warn(`Attempt ${attempt + 1} failed: ${response.status} - ${lastErrorDetail}`);
      }
    } catch (err) {
      if (activeModel !== "gemini-2.5-flash") {
        activeModel = "gemini-2.5-flash";
        url = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${geminiKey}`;
        continue; // Retry with fallback model
      }
      lastErrorDetail = err.message;
      console.warn(`Attempt ${attempt + 1} threw error: ${err.message}`);
    }
    
    attempt++;
    if (attempt <= maxRetries) {
      // Wait briefly before retrying
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }

  if (!response || !response.ok) {
    console.error(`Gemini API Call failed after ${maxRetries} retries: ${lastErrorDetail}`);
    // Return graceful fallback preserving quant data
    return {
      sentiment: "NEUTRAL",
      summary: "Semantic Analysis temporarily unavailable due to API limits or network issues. Relying on quantitative data.",
      citations: [],
      targetPrice: quant && quant.currentPrice ? (quant.currentPrice * 1.02).toFixed(2).toString() : "N/A",
      confidence: "Low (Degraded Mode)",
      bestStrategy: "Hold (Wait for data)",
      S_semantic: 0.5,
      marketSentimentAnalysis: "N/A",
      S_market_semantic: 0.5,
      fundamentalAnalysisSummary: "N/A",
      S_fundamental_semantic: 0.5,
      news: []
    };
  }

  const responseData = await response.json();
  const text = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "";

  // Helper to clean outputs and remove markdown bold stars, outer brackets, quotes etc.
  function cleanOutputValue(value) {
    if (!value) return "";
    return value.trim().replace(/^[\*\[\s'"\(]+|[\*\]\s'"\)]+$/g, "").trim();
  }

  // Parse structured outputs using robust regex
  const sentimentMatch = text.match(/Sentiment\s*:\s*([^\r\n]+)/i);
  const targetMatch = text.match(/5-Day Target\s*:\s*([^\r\n]+)/i);
  const confidenceMatch = text.match(/Confidence\s*:\s*([^\r\n]+)/i);
  const strategyMatch = text.match(/Best Strategy\s*:\s*([^\r\n]+)/i);
  const summaryMatch = text.match(/Summary\s*:\s*([^]+?)(?=\n\s*Market Sentiment Analysis:|$)/i) || text.match(/Summary\s*:\s*([^\r\n]+)/i);
  const marketSentimentMatch = text.match(/Market Sentiment Analysis\s*:\s*([^]+?)(?=\n\s*Market Score:|$)/i) || text.match(/Market Sentiment Analysis\s*:\s*([^\r\n]+)/i);
  const marketScoreMatch = text.match(/Market Score\s*:\s*([^\r\n]+)/i);
  const fundamentalAnalysisMatch = text.match(/Fundamental Analysis Summary\s*:\s*([^]+?)(?=\n\s*Fundamental Score:|$)/i) || text.match(/Fundamental Analysis Summary\s*:\s*([^\r\n]+)/i);
  const fundamentalScoreMatch = text.match(/Fundamental Score\s*:\s*([^\r\n]+)/i);

  const sentiment = sentimentMatch ? cleanOutputValue(sentimentMatch[1]).toUpperCase() : "NEUTRAL";
  const targetPrice = targetMatch ? cleanOutputValue(targetMatch[1]) : "N/A";
  const confidence = confidenceMatch ? cleanOutputValue(confidenceMatch[1]) : "N/A";
  const bestStrategy = strategyMatch ? cleanOutputValue(strategyMatch[1]) : "Hold Shares";
  const summary = summaryMatch ? cleanOutputValue(summaryMatch[1]) : "";
  const marketSentimentAnalysis = marketSentimentMatch ? cleanOutputValue(marketSentimentMatch[1]) : "N/A";
  const fundamentalAnalysisSummary = fundamentalAnalysisMatch ? cleanOutputValue(fundamentalAnalysisMatch[1]) : "N/A";

  let S_market_semantic = 0.5;
  if (marketScoreMatch) {
    const val = parseFloat(cleanOutputValue(marketScoreMatch[1]));
    if (!isNaN(val)) S_market_semantic = val;
  }

  let S_fundamental_semantic = 0.5;
  if (fundamentalScoreMatch) {
    const val = parseFloat(cleanOutputValue(fundamentalScoreMatch[1]));
    if (!isNaN(val)) S_fundamental_semantic = val;
  }

  // Parse News list
  let news = [];
  const newsMatch = text.match(/News\s*:\s*([^]+)$/i);
  if (newsMatch) {
    const newsContent = newsMatch[1].trim();
    const lines = newsContent.split(/\n/);
    lines.forEach(line => {
      const cleanLine = line.trim().replace(/^[-\*\d\.\s]+/, "");
      if (cleanLine) {
        const parts = cleanLine.split("|");
        if (parts.length >= 1) {
          const headline = parts[0].trim();
          let impact = "NEUTRAL";
          let source = "Web Search";
          
          parts.forEach(p => {
            const low = p.toLowerCase();
            if (low.includes("impact:") || low.includes("sentiment:")) {
              const impactVal = p.split(":")[1]?.trim() || "NEUTRAL";
              impact = impactVal.toUpperCase().replace(/[\*\[\]]/g, "").trim();
            } else if (low.includes("source:")) {
              const srcVal = p.split(":")[1]?.trim() || "Web Search";
              source = srcVal.replace(/[\*\[\]]/g, "").trim();
            }
          });
          news.push({ headline, impact, source });
        }
      }
    });
  }

  // Calculate confidence-scaled semantic sentiment rating
  let parsedConfidence = 80;
  if (confidence && confidence !== "N/A") {
    const matchNum = confidence.match(/(\d+)/);
    if (matchNum) {
      parsedConfidence = parseInt(matchNum[1]);
    }
  }

  let S_semantic = 0.5;
  if (sentiment === "BULLISH") {
    S_semantic = 0.5 + (parsedConfidence / 100) * 0.5;
  } else if (sentiment === "BEARISH") {
    S_semantic = 0.5 - (parsedConfidence / 100) * 0.5;
  }
  S_semantic = parseFloat(Math.max(0.0, Math.min(1.0, S_semantic)).toFixed(4));

  // Extract grounding citations
  const citations = [];
  const groundingChunks = responseData.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  
  groundingChunks.forEach((chunk, index) => {
    if (chunk.web && chunk.web.uri) {
      citations.push({
        num: index + 1,
        title: chunk.web.title || "Source link",
        url: chunk.web.uri
      });
    }
  });

  return {
    sentiment,
    summary,
    citations,
    targetPrice,
    confidence,
    bestStrategy,
    S_semantic, // Specific Stock News Sentiment score
    marketSentimentAnalysis,
    S_market_semantic,
    fundamentalAnalysisSummary,
    S_fundamental_semantic,
    news
  };
}

// ─── Self-Learning Feedback Model Loop ────────────────────────────────────────
async function updateModelWeights(ticker, actualPrice) {
  try {
    const res = await new Promise(r => chrome.storage.local.get(["alphaPredictions", "alphaModelWeights"], r));
    let predictions = res.alphaPredictions || [];
    let weights = res.alphaModelWeights || { bias: 0.0, learningRate: 0.05, tickerCorrections: {}, w_q: 0.30, w_f: 0.30, w_s: 0.20, w_m: 0.20, quantErrorEMA: 0.10, semanticErrorEMA: 0.10 };
    
    let updatedPredictions = [];
    let hasChanges = false;
    
    const minAgeMs = 5 * 24 * 60 * 60 * 1000; // 5 days, matching prediction window
    for (let pred of predictions) {
      if (pred.ticker === ticker && !pred.resolved) {
        const ageInMs = Date.now() - pred.predictedAt;
        if (ageInMs >= minAgeMs) {
          const predPrice = parseFloat(pred.predictedPrice);
          const regPrice = parseFloat(pred.regressionPrice || pred.spotPriceAtPrediction);
          if (!isNaN(predPrice) && predPrice > 0 && !isNaN(regPrice) && regPrice > 0) {
            const error = (actualPrice - predPrice) / predPrice;
            
            // EMA calculation
            let quantErrorEMA = weights.quantErrorEMA !== undefined ? weights.quantErrorEMA : 0.10;
            let semanticErrorEMA = weights.semanticErrorEMA !== undefined ? weights.semanticErrorEMA : 0.10;
            
            const errSemantic = Math.abs(actualPrice - predPrice) / predPrice;
            const errQuant = Math.abs(actualPrice - regPrice) / regPrice;
            
            quantErrorEMA = quantErrorEMA * 0.9 + errQuant * 0.1;
            semanticErrorEMA = semanticErrorEMA * 0.9 + errSemantic * 0.1;
            
            weights.quantErrorEMA = parseFloat(quantErrorEMA.toFixed(6));
            weights.semanticErrorEMA = parseFloat(semanticErrorEMA.toFixed(6));
            
            // Adjust weights
            let w_q = weights.w_q !== undefined ? weights.w_q : 0.30;
            let w_f = weights.w_f !== undefined ? weights.w_f : 0.30;
            let w_s = weights.w_s !== undefined ? weights.w_s : 0.20;
            let w_m = weights.w_m !== undefined ? weights.w_m : 0.20;
            
            if (quantErrorEMA < semanticErrorEMA) {
              // Increase technical quant weight, decrease others
              w_q = Math.min(0.50, w_q + 0.04);
              const remaining = 1.0 - w_q;
              const ratio = remaining / (w_f + w_s + w_m);
              w_f = parseFloat((w_f * ratio).toFixed(3));
              w_s = parseFloat((w_s * ratio).toFixed(3));
              w_m = parseFloat((w_m * ratio).toFixed(3));
            } else {
              // Increase semantic/fundamental weights, decrease technical quant weight
              w_q = Math.max(0.15, w_q - 0.04);
              const remaining = 1.0 - w_q;
              const ratio = remaining / (w_f + w_s + w_m);
              w_f = parseFloat((w_f * ratio).toFixed(3));
              w_s = parseFloat((w_s * ratio).toFixed(3));
              w_m = parseFloat((w_m * ratio).toFixed(3));
            }

            // Ensure they sum to exactly 1.0
            const sum = w_q + w_f + w_s + w_m;
            const diff = 1.0 - sum;
            w_f = parseFloat((w_f + diff).toFixed(3));
            
            weights.w_q = w_q;
            weights.w_f = w_f;
            weights.w_s = w_s;
            weights.w_m = w_m;

            // Existing ticker correction logic
            const lr = weights.learningRate || 0.05;
            const tickerCorrections = weights.tickerCorrections || {};
            const currentCorr = tickerCorrections[ticker] || 0.0;
            
            let newCorr = currentCorr + (error * lr);
            newCorr = Math.max(-0.15, Math.min(0.15, newCorr));
            
            tickerCorrections[ticker] = parseFloat(newCorr.toFixed(4));
            weights.tickerCorrections = tickerCorrections;
            
            pred.resolved = true;
            pred.actualPriceObserved = actualPrice;
            pred.observedAt = Date.now();
            pred.errorPercent = parseFloat((error * 100).toFixed(2));
            hasChanges = true;
          }
        }
      }
      updatedPredictions.push(pred);
    }
    
    if (hasChanges) {
      await new Promise(r => chrome.storage.local.set({ 
        alphaPredictions: updatedPredictions, 
        alphaModelWeights: weights 
      }, r));
      console.log(`AuraTrade Adaptive Model updated weights for ${ticker}. Correction factor: ${weights.tickerCorrections[ticker]}, w_q: ${weights.w_q}, w_f: ${weights.w_f}, w_s: ${weights.w_s}, w_m: ${weights.w_m}`);
    }
  } catch (err) {
    console.error("AuraTrade self-learning model update failed:", err);
  }
}

// ─── Register Prediction for Future Backtesting ───────────────────────────────
async function registerPrediction(ticker, targetPriceStr, currentPrice, regressionPrice = null) {
  try {
    const match = targetPriceStr.match(/(\d+(?:\.\d+)?)/);
    const targetPriceFloat = match ? parseFloat(match[1]) : parseFloat(targetPriceStr.replace(/[^0-9\.]/g, ""));
    if (isNaN(targetPriceFloat) || targetPriceFloat <= 0) return;
    
    const res = await new Promise(r => chrome.storage.local.get(["alphaPredictions"], r));
    let predictions = res.alphaPredictions || [];
    
    predictions = predictions.filter(p => !(p.ticker === ticker && !p.resolved));
    
    predictions.push({
      ticker,
      predictedPrice: targetPriceFloat,
      regressionPrice: regressionPrice,
      spotPriceAtPrediction: currentPrice,
      predictedAt: Date.now(),
      resolved: false
    });
    
    if (predictions.length > 100) {
      predictions = predictions.slice(-100);
    }
    
    await new Promise(r => chrome.storage.local.set({ alphaPredictions: predictions }, r));
    console.log(`Registered prediction for ${ticker}: ${targetPriceFloat} (Spot: ${currentPrice}, Reg: ${regressionPrice})`);
  } catch (err) {
    console.error("Prediction registration failed:", err);
  }
}

// ─── Custom Price Alerts Checker ──────────────────────────────────────────────
async function checkCustomPriceAlerts(ticker, currentPrice) {
  try {
    const res = await new Promise(r => chrome.storage.local.get(["alphaPriceAlerts"], r));
    let alerts = res.alphaPriceAlerts || [];
    let updated = false;

    const updatedAlerts = alerts.map(alert => {
      if (alert.ticker === ticker && !alert.triggered) {
        const target = parseFloat(alert.targetPrice);
        let isTriggered = false;
        if (alert.condition === "ABOVE" && currentPrice >= target) {
          isTriggered = true;
        } else if (alert.condition === "BELOW" && currentPrice <= target) {
          isTriggered = true;
        }

        if (isTriggered) {
          alert.triggered = true;
          alert.triggeredAt = Date.now();
          updated = true;

          // Notification
          chrome.notifications.create(`custom-alert-${alert.id}-${Date.now()}`, {
            type: "basic",
            iconUrl: "icon.png",
            title: `🔔 Price Alert Triggered: ${ticker.split('.')[0]}`,
            message: `${ticker} went ${alert.condition.toLowerCase()} ${formatCurrencySimple(target, ticker)}. Spot price: ${formatCurrencySimple(currentPrice, ticker)}.`,
            priority: 2
          });
        }
      }
      return alert;
    });

    if (updated) {
      await new Promise(r => chrome.storage.local.set({ alphaPriceAlerts: updatedAlerts }, r));
    }
  } catch (err) {
    console.error("Custom alerts check failed:", err);
  }
}

// ─── Background Portfolio Scheduler & Risk Auditing ────────────────────────────
async function runPortfolioBackgroundCheck() {
  const settings = await getSettings();
  const res = await new Promise(r => chrome.storage.local.get(["alphaPortfolio", "alphaPortfolioAlerts"], r));
  const portfolio = res.alphaPortfolio || [];
  let alerts = res.alphaPortfolioAlerts || [];
  
  if (portfolio.length === 0) return;
  
  const enableAlerts = settings.enablePortfolioAlerts !== false;
  if (!enableAlerts) return;
  
  const stopLossThreshold = parseFloat(settings.stopLossThreshold) || 5.0;
  const sharpDropThreshold = parseFloat(settings.sharpDropThreshold) || 3.0;
  
  console.log(`Auditing portfolio of ${portfolio.length} assets...`);
  
  for (const position of portfolio) {
    try {
      const ticker = position.ticker;
      const report = await handleFetchAsset(ticker, true);
      const currentPrice = report.quant.currentPrice;
      const changePercent = report.quant.priceChangePercent;
      const crossover = report.quant.crossover;
      const fScore = report.fScore;
      
      // 1. Stop-Loss Trigger
      const avgPrice = parseFloat(position.avgPrice);
      if (avgPrice > 0 && currentPrice < avgPrice) {
        const lossPct = ((avgPrice - currentPrice) / avgPrice) * 100;
        if (lossPct >= stopLossThreshold) {
          const alertId = `stoploss-${position.id}-${new Date().toISOString().slice(0, 13)}`; // Once per hour per position
          if (!alerts.some(a => a.id === alertId)) {
            const msg = `${ticker} has dropped ${lossPct.toFixed(1)}% below your buy average price of ${formatCurrencySimple(avgPrice, ticker)}. Spot price: ${formatCurrencySimple(currentPrice, ticker)}.`;
            triggerPortfolioAlert(ticker, alertId, "Stop-Loss Limit", msg, alerts);
          }
        }
      }
      
      // 2. Sharp Daily Decline
      if (changePercent <= -sharpDropThreshold) {
        const alertId = `sharpdrop-${ticker}-${new Date().toISOString().slice(0, 10)}`; // Once per day per ticker
        if (!alerts.some(a => a.id === alertId)) {
          const msg = `${ticker} experienced a sharp daily decline of ${Math.abs(changePercent).toFixed(1)}% today. Current price: ${formatCurrencySimple(currentPrice, ticker)}.`;
          triggerPortfolioAlert(ticker, alertId, "Sharp Price Decline", msg, alerts);
        }
      }
      
      // 3. Technical Bearish Crossover (Death Cross)
      if (crossover === "Death Cross") {
        const alertId = `deathcross-${ticker}-${new Date().toISOString().slice(0, 10)}`;
        if (!alerts.some(a => a.id === alertId)) {
          const msg = `Death Cross technical crossover occurred for ${ticker}. SMA(20) has crossed below SMA(50). Spot price: ${formatCurrencySimple(currentPrice, ticker)}.`;
          triggerPortfolioAlert(ticker, alertId, "Death Cross Crossover", msg, alerts);
        }
      }
      
      // 4. Low F-Score Risk
      if (fScore <= 0.30) {
        const alertId = `lowfscore-${ticker}-${new Date().toISOString().slice(0, 10)}`;
        if (!alerts.some(a => a.id === alertId)) {
          const msg = `Risk warning: ${ticker} composite score has dropped to ${fScore.toFixed(2)} (Bearish Alignment).`;
          triggerPortfolioAlert(ticker, alertId, "Low Score Risk", msg, alerts);
        }
      }
    } catch (err) {
      console.error(`Portfolio background check failed for position ${position.ticker}:`, err);
    }
  }
}

function triggerPortfolioAlert(ticker, id, type, message, alerts) {
  alerts.unshift({
    id,
    ticker,
    type,
    message,
    timestamp: Date.now(),
    read: false
  });
  if (alerts.length > 50) alerts.splice(50);
  chrome.storage.local.set({ alphaPortfolioAlerts: alerts });
  
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: "icon.png",
    title: `⚠️ Risk Warning: ${ticker.split('.')[0]}`,
    message: message,
    priority: 2
  });
}

// ─── Calculate Timing Advice ──────────────────────────────────────────────────
function calculateTimingAdvice(price, rsi, pivotPoints, regression, ticker) {
  let action = "HOLD / WATCH";
  let range = "Consolidation Range";
  let rationale = "Indicators are in a neutral zone. Maintain existing positions and monitor key levels.";

  const s1 = pivotPoints ? pivotPoints.s1 : price * 0.98;
  const s2 = pivotPoints ? pivotPoints.s2 : price * 0.95;
  const r1 = pivotPoints ? pivotPoints.r1 : price * 1.02;
  const r2 = pivotPoints ? pivotPoints.r2 : price * 1.05;
  const slope = regression ? regression.slope : 0;
  
  if (rsi <= 35) {
    action = "ACCUMULATE / BUY DIP";
    range = `${formatCurrencySimple(s2, ticker)} - ${formatCurrencySimple(s1, ticker)}`;
    rationale = `Asset is oversold (RSI: ${rsi.toFixed(1)}). Support ranges between S2 and S1 present a high-probability reversal entry.`;
  } else if (rsi >= 65) {
    action = "TAKE PROFIT / REDUCE";
    range = `${formatCurrencySimple(r1, ticker)} - ${formatCurrencySimple(r2, ticker)}`;
    rationale = `Asset is overbought (RSI: ${rsi.toFixed(1)}). Consider scaling out or securing profits as price approaches resistance levels R1/R2.`;
  } else if (slope > 0) {
    action = "ACCUMULATE (UPTREND)";
    range = `${formatCurrencySimple(s1, ticker)} - ${formatCurrencySimple(price, ticker)}`;
    rationale = `The 20-day statistical linear regression exhibits an upward trajectory (Slope: ${slope.toFixed(4)}). Buy on dips between pivot support S1 and current price.`;
  } else if (slope < 0) {
    action = "HOLD / DEFENSIVE";
    range = `${formatCurrencySimple(price, ticker)} - ${formatCurrencySimple(r1, ticker)}`;
    rationale = `The 20-day statistical linear regression is downward sloping (Slope: ${slope.toFixed(4)}). Wait for a stable floor; next major pivot support lies near S1/S2.`;
  }

  return {
    action,
    range,
    rationale
  };
}

// ─── Synthesize Quant + Semantic Streams ──────────────────────────────────────
async function handleFetchAsset(ticker, forceRefresh = false) {
  const settings = await getSettings();
  const resolved = resolveTicker(ticker, settings);
  
  if (!forceRefresh) {
    const cachedRes = await new Promise(r => chrome.storage.local.get([`cache_${resolved}`], r));
    const cached = cachedRes[`cache_${resolved}`];
    if (cached && cached.timestamp) {
      const ageMs = Date.now() - new Date(cached.timestamp).getTime();
      if (ageMs < 3 * 60 * 1000) {
        console.log(`Returning cached asset data for ${resolved} (age: ${Math.round(ageMs / 1000)}s)`);
        return cached;
      }
    }
  }
  
  // 1. Parallel fetch of all quantitative components (Technical chart, Fundamental ratios, Benchmark index trend)
  const [quant, fundamental, benchmark] = await Promise.all([
    fetchQuantData(resolved),
    fetchFundamentalData(resolved),
    fetchBenchmarkData(resolved, settings)
  ]);

  // 2. Score intermediate pillars quantitatively
  const S_fundamental_quant = computeGranularFundamentalScore(fundamental);
  const S_market_quant = computeQuantMarketScore(benchmark);

  // Attach elements to quant payload to guide Gemini context
  quant.fundamental = fundamental;
  quant.benchmark = benchmark;
  quant.S_fundamental_quant = S_fundamental_quant;
  quant.S_market_quant = S_market_quant;

  // 3. Trigger Semantic Co-Pilot analysis
  const semantic = await fetchSemanticData(resolved, settings, quant);

  // 4. Update adaptive corrections and alerts
  await updateModelWeights(resolved, quant.currentPrice);
  await checkCustomPriceAlerts(resolved, quant.currentPrice);

  // 5. Synthesize 4-Pillar F-Score
  const weightsRes = await new Promise(r => chrome.storage.local.get(["alphaModelWeights"], r));
  const weights = weightsRes.alphaModelWeights || {};
  const tickerCorrections = weights.tickerCorrections || {};
  const correction = tickerCorrections[resolved] || 0.0;

  const w_q = weights.w_q !== undefined ? weights.w_q : 0.30;
  const w_f = weights.w_f !== undefined ? weights.w_f : 0.30;
  const w_s = weights.w_s !== undefined ? weights.w_s : 0.20;
  const w_m = weights.w_m !== undefined ? weights.w_m : 0.20;

  const S_fundamental = parseFloat((0.6 * S_fundamental_quant + 0.4 * semantic.S_fundamental_semantic).toFixed(4));
  const S_market = parseFloat((0.5 * S_market_quant + 0.5 * semantic.S_market_semantic).toFixed(4));

  let S_composite = w_q * quant.S_quant + w_f * S_fundamental + w_s * semantic.S_semantic + w_m * S_market + correction;
  S_composite = parseFloat(Math.max(0.0, Math.min(1.0, S_composite)).toFixed(2));

  const result = {
    ticker: resolved,
    quant,
    semantic,
    fScore: S_composite,
    correction,
    w_q,
    w_f,
    w_s,
    w_m,
    S_fundamental,
    S_market,
    timingAdvice: calculateTimingAdvice(quant.currentPrice, quant.rsi, quant.pivotPoints, quant.regression, resolved),
    timestamp: new Date().toISOString()
  };

  await new Promise(r => chrome.storage.local.set({ [`cache_${resolved}`]: result }, r));

  // Log scan history
  try {
    const historyRes = await new Promise(r => chrome.storage.local.get(["scanHistory"], r));
    let history = historyRes.scanHistory || [];
    
    history = history.filter(item => item.ticker !== resolved);
    
    history.unshift({
      ticker: resolved,
      price: quant.currentPrice,
      changePercent: quant.priceChangePercent,
      fScore: S_composite,
      timestamp: new Date().toISOString(),
      status: quant.status
    });
    
    if (history.length > 30) {
      history = history.slice(0, 30);
    }
    
    await new Promise(r => chrome.storage.local.set({ scanHistory: history }, r));
  } catch (historyErr) {
    console.error("Failed to log scan history:", historyErr);
  }

  await registerPrediction(resolved, semantic.targetPrice, quant.currentPrice, quant.regression?.forecast5Day);

  return result;
}

// ─── Browser Notification Dispatcher ──────────────────────────────────────────
function sendBrowserNotification(ticker, fScore, direction) {
  try {
    const isIndian = ticker.endsWith(".NS") || ticker.endsWith(".BO");
    const emoji = direction === "BUY" ? "🟢" : "🔴";
    chrome.notifications.create(`alpha-${ticker}-${Date.now()}`, {
      type: "basic",
      iconUrl: "icon.png",
      title: `${emoji} AuraTrade Breakthrough: ${ticker.split('.')[0]}`,
      message: `F-Score: ${safeToFixed(fScore, 2)} — ${direction === "BUY" ? "Strong Buy" : "Strong Sell"} signal detected. Tap to open report.`,
      priority: 2
    });
  } catch (err) {
    console.warn("Browser notification failed:", err);
  }
}

// ─── Watchlist Manipulation ───────────────────────────────────────────────────
async function addToWatchlist(ticker) {
  const settings = await getSettings();
  ticker = resolveTicker(ticker, settings);
  if (!ticker) return await getWatchlist();
  const watchlist = await getWatchlist();
  if (!watchlist.includes(ticker)) {
    watchlist.push(ticker);
    await new Promise(r => chrome.storage.local.set({ watchlist }, r));
    await syncWatchlistToFirestore(watchlist);
  }
  return watchlist;
}

async function removeFromWatchlist(ticker) {
  const settings = await getSettings();
  ticker = resolveTicker(ticker, settings);
  const watchlist = await getWatchlist();
  const index = watchlist.indexOf(ticker);
  if (index > -1) {
    watchlist.splice(index, 1);
    await new Promise(r => chrome.storage.local.set({ watchlist }, r));
    await syncWatchlistToFirestore(watchlist);
  }
  return watchlist;
}

// ─── Background Watchlist Scheduler ───────────────────────────────────────────
async function runWatchlistBackgroundCheck() {
  const settings = await getSettings();
  const watchlist = await getWatchlist();

  for (const ticker of watchlist) {
    try {
      console.log(`Analyzing ticker ${ticker} in background...`);
      const report = await handleFetchAsset(ticker, true);
      const fScore = report.fScore;

      if (fScore >= 0.85 || fScore <= 0.15) {
        const direction = fScore >= 0.85 ? "BUY" : "SELL";
        sendBrowserNotification(ticker, fScore, direction);
        await checkAndSendAlert(ticker, fScore, report, settings);
      }
    } catch (err) {
      console.error(`Background check failed for ticker ${ticker}:`, err);
    }
  }
}

// ─── Alert Cooldown Check + Gmail Send ────────────────────────────────────────
async function checkAndSendAlert(ticker, fScore, report, settings) {
  const now = Date.now();
  const lastSent = settings.lastAlertSent || {};
  const lastSentTime = lastSent[ticker] || 0;
  const cooldown = 12 * 60 * 60 * 1000;

  if (now - lastSentTime > cooldown) {
    try {
      const token = await getAuthToken(settings);
      const sent = await sendGmailAlert(token, settings, ticker, fScore, report);
      if (sent) {
        lastSent[ticker] = now;
        settings.lastAlertSent = lastSent;
        await new Promise(r => chrome.storage.local.set({ settings }, r));
      }
    } catch (tokenErr) {
      console.error(`Gmail dispatch auth failed for ${ticker}:`, tokenErr);
    }
  }
}

// ─── Fetch Trending Symbols ───────────────────────────────────────────────────
async function fetchTrendingTickers(settings) {
  const defaultExchange = settings.defaultExchange || "NSE";
  const region = (defaultExchange === "NSE" || defaultExchange === "BSE") ? "IN" : "US";
  const url = `https://query1.finance.yahoo.com/v1/finance/trending/${region}`;
  try {
    const response = await fetchWithRetry(url, {}, 2);
    const data = await response.json();
    const quotes = data?.finance?.result?.[0]?.quotes || [];
    return quotes
      .map(q => q.symbol)
      .filter(symbol => symbol && typeof symbol === 'string')
      .slice(0, 8);
  } catch (err) {
    console.error("Failed to fetch trending tickers:", err);
    return [];
  }
}

// ─── Dynamic Trend Scan Logic ─────────────────────────────────────────────────
async function runDynamicTrendScan() {
  const settings = await getSettings();
  const watchlist = await getWatchlist();
  
  let tickersToScan = [...watchlist];
  
  const includeTrending = settings.includeTrending !== false;
  if (includeTrending) {
    const trending = await fetchTrendingTickers(settings);
    trending.forEach(ticker => {
      if (!tickersToScan.includes(ticker)) {
        tickersToScan.push(ticker);
      }
    });
  }

  tickersToScan = tickersToScan.slice(0, 20);

  console.log(`Running dynamic trend scan on ${tickersToScan.length} tickers...`);

  const quantResults = await Promise.all(
    tickersToScan.map(async (ticker) => {
      try {
        const resolved = resolveTicker(ticker, settings);
        const quant = await fetchQuantData(resolved);
        return { success: true, ticker: resolved, quant };
      } catch (err) {
        return { success: false, ticker, error: err.message };
      }
    })
  );

  const successfulScans = quantResults.filter(r => r.success);
  const failures = quantResults.filter(r => !r.success);

  const ranked = successfulScans.map(item => {
    const q = item.quant;
    let trendScore = q.priceChangePercent || 0;
    if (q.S_quant >= 0.80) trendScore += 100;
    else if (q.S_quant >= 0.60) trendScore += 50;
    else if (q.S_quant <= 0.20) trendScore -= 100;
    else if (q.S_quant <= 0.40) trendScore -= 50;
    return { ...item, trendScore };
  });

  ranked.sort((a, b) => b.trendScore - a.trendScore);

  const buySuggestions = ranked.filter(r => r.quant.S_quant >= 0.70 && r.quant.priceChangePercent > 0);
  const sellSuggestions = ranked.filter(r => r.quant.S_quant <= 0.30 && r.quant.priceChangePercent < 0);

  const topCandidates = [...buySuggestions.slice(0, 2), ...sellSuggestions.slice(0, 2)];
  const semanticDetails = {};

  const weightsRes = await new Promise(r => chrome.storage.local.get(["alphaModelWeights"], r));
  const weights = weightsRes.alphaModelWeights || {};
  const tickerCorrections = weights.tickerCorrections || {};

  await Promise.all(
    topCandidates.map(async (candidate) => {
      try {
        const assetResult = await handleFetchAsset(candidate.ticker, true);
        
        semanticDetails[candidate.ticker] = {
          semantic: assetResult.semantic,
          fScore: assetResult.fScore,
          correction: assetResult.correction,
          w_q: assetResult.w_q,
          w_f: assetResult.w_f,
          w_s: assetResult.w_s,
          w_m: assetResult.w_m,
          S_fundamental: assetResult.S_fundamental,
          S_market: assetResult.S_market,
          timingAdvice: assetResult.timingAdvice,
          hasAI: true
        };
      } catch (err) {
        console.error(`Gemini background run failed for ${candidate.ticker}:`, err);
      }
    })
  );

  const cachedResults = {
    timestamp: new Date().toISOString(),
    buys: buySuggestions.map(b => ({
      ticker: b.ticker,
      price: b.quant.currentPrice,
      changePercent: b.quant.priceChangePercent,
      prices: b.quant.prices,
      smaStatus: b.quant.status,
      sma20: b.quant.sma20,
      sma50: b.quant.sma50,
      rsi: b.quant.rsi,
      currency: b.quant.currency,
      S_quant: b.quant.S_quant,
      crossover: b.quant.crossover,
      pivotPoints: b.quant.pivotPoints,
      ...(semanticDetails[b.ticker] || { hasAI: false })
    })),
    sells: sellSuggestions.map(s => ({
      ticker: s.ticker,
      price: s.quant.currentPrice,
      changePercent: s.quant.priceChangePercent,
      prices: s.quant.prices,
      smaStatus: s.quant.status,
      sma20: s.quant.sma20,
      sma50: s.quant.sma50,
      rsi: s.quant.rsi,
      currency: s.quant.currency,
      S_quant: s.quant.S_quant,
      crossover: s.quant.crossover,
      pivotPoints: s.quant.pivotPoints,
      ...(semanticDetails[s.ticker] || { hasAI: false })
    })),
    others: ranked
      .filter(r => r.quant.S_quant > 0.30 && r.quant.S_quant < 0.70)
      .map(o => ({
        ticker: o.ticker,
        price: o.quant.currentPrice,
        changePercent: o.quant.priceChangePercent,
        prices: o.quant.prices,
        smaStatus: o.quant.status,
        sma20: o.quant.sma20,
        sma50: o.quant.sma50,
        rsi: o.quant.rsi,
        currency: o.quant.currency,
        S_quant: o.quant.S_quant,
        crossover: o.quant.crossover,
        pivotPoints: o.quant.pivotPoints,
        hasAI: false
      })),
    failures: failures.map(f => ({
      ticker: f.ticker,
      error: f.error
    }))
  };

  await new Promise(r => chrome.storage.local.set({ marketScanCache: cachedResults }, r));
  return cachedResults;
}

// ─── Gmail REST API Dispatcher ────────────────────────────────────────────────
async function sendGmailAlert(token, settings, ticker, fScore, report) {
  const recipientEmail = settings.alertEmail;
  if (!recipientEmail) {
    console.warn("No recipient email specified in settings. Skipping Gmail dispatch.");
    return false;
  }

  const isIndian = ticker.endsWith(".NS") || ticker.endsWith(".BO");
  const currencySymbol = isIndian ? "₹" : "$";

  const subject = `[AuraTrade ALERT] Breakthrough: ${ticker} (F-Score: ${safeToFixed(fScore, 2)})`;
  
  const isBullish = fScore >= 0.85;
  const badgeColor = isBullish ? "#0284C7" : "#D946EF";
  const directionText = isBullish ? "STRONG BUY BREAKTHROUGH" : "STRONG SELL BREAKTHROUGH";

  const citationsHTML = report.semantic.citations.length > 0
    ? `
      <div style="margin-top: 20px; border-top: 1px solid rgba(15,23,42,0.08); padding-top: 16px;">
        <h4 style="color: #475569; font-size: 13px; margin: 0 0 8px 0; font-family: sans-serif; text-transform: uppercase; letter-spacing: 0.5px;">Grounded Citations:</h4>
        ${report.semantic.citations.map(c => `
          <div style="margin-bottom: 8px;">
            <a href="${c.url}" target="_blank" style="color: #0284C7; text-decoration: none; font-size: 12px; font-family: sans-serif; font-weight: 500;">
              [${c.num}] ${c.title}
            </a>
          </div>
        `).join('')}
      </div>
    `
    : "";

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: sans-serif; background-color: #F8FAFC; color: #0F172A; margin: 0; padding: 20px; }
        .card { background-color: rgba(255, 255, 255, 0.95); border: 1px solid rgba(15, 23, 42, 0.08); border-radius: 16px; padding: 28px; max-width: 600px; margin: 0 auto; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06); }
        .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(15, 23, 42, 0.08); padding-bottom: 16px; margin-bottom: 20px; }
        .logo { font-size: 20px; font-weight: bold; letter-spacing: 2px; color: #0F172A; }
        .ticker-badge { font-size: 24px; font-weight: 700; color: #0F172A; background: rgba(15, 23, 42, 0.03); padding: 4px 12px; border-radius: 8px; border: 1px solid rgba(15, 23, 42, 0.08); }
        .fscore-section { text-align: center; margin: 24px 0; padding: 20px; background: rgba(15, 23, 42, 0.02); border-radius: 12px; border: 1px solid rgba(15, 23, 42, 0.05); }
        .fscore-title { font-size: 14px; text-transform: uppercase; color: #475569; letter-spacing: 1px; margin-bottom: 6px; }
        .fscore-val { font-size: 52px; font-weight: 800; color: ${badgeColor}; }
        .signal-title { font-size: 16px; font-weight: 700; color: ${badgeColor}; margin-top: 8px; letter-spacing: 1px; text-transform: uppercase; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 24px 0; }
        .grid-cell { background: rgba(15, 23, 42, 0.02); border: 1px solid rgba(15, 23, 42, 0.05); border-radius: 8px; padding: 12px; }
        .cell-label { font-size: 11px; color: #475569; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
        .cell-val { font-size: 16px; font-weight: 700; color: #0F172A; }
        .summary-box { background: rgba(15, 23, 42, 0.02); border-left: 4px solid ${badgeColor}; padding: 16px; border-radius: 4px; margin: 20px 0; font-size: 14px; line-height: 1.6; }
        .footer { text-align: center; font-size: 11px; color: #475569; margin-top: 30px; border-top: 1px solid rgba(15, 23, 42, 0.08); padding-top: 16px; line-height: 1.5; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <span class="logo">AuraTrade v2.0</span>
          <span class="ticker-badge">${ticker}</span>
        </div>
        
        <div class="fscore-section">
          <div class="fscore-title">Composite F-Score</div>
          <div class="fscore-val">${safeToFixed(fScore, 2)}</div>
          <div class="signal-title">${directionText}</div>
        </div>

        <div class="summary-box">
          <strong style="color: #0F172A;">Semantic News & Updates:</strong> ${report.semantic.summary}
        </div>

        <!-- F-Score component breakdown -->
        <h3 style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; margin: 24px 0 8px 0; border-bottom: 1px dashed rgba(15,23,42,0.1); padding-bottom: 6px;">F-Score Pillars Breakdown</h3>
        <div class="grid">
          <div class="grid-cell">
            <div class="cell-label">Technical Quant (w=${(report.w_q*100).toFixed(0)}%)</div>
            <div class="cell-val" style="color: #0284C7;">${(report.quant?.S_quant * 10).toFixed(1)} / 10</div>
          </div>
          <div class="grid-cell">
            <div class="cell-label">Fundamentals (w=${(report.w_f*100).toFixed(0)}%)</div>
            <div class="cell-val" style="color: #10B981;">${(report.S_fundamental * 10).toFixed(1)} / 10</div>
          </div>
          <div class="grid-cell">
            <div class="cell-label">News Sentiment (w=${(report.w_s*100).toFixed(0)}%)</div>
            <div class="cell-val" style="color: #F59E0B;">${(report.semantic?.S_semantic * 10).toFixed(1)} / 10</div>
          </div>
          <div class="grid-cell">
            <div class="cell-label">Market & Macro (w=${(report.w_m*100).toFixed(0)}%)</div>
            <div class="cell-val" style="color: #D946EF;">${(report.S_market * 10).toFixed(1)} / 10</div>
          </div>
        </div>

        <!-- Fundamentals Panel -->
        ${report.quant.fundamental ? `
        <h3 style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; margin: 24px 0 8px 0; border-bottom: 1px dashed rgba(15,23,42,0.1); padding-bottom: 6px;">Company Key Fundamentals</h3>
        <div style="background: rgba(15, 23, 42, 0.02); padding: 12px; border-radius: 8px; border: 1px solid rgba(15, 23, 42, 0.05); font-size: 13px; margin: 16px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr style="border-bottom: 1px solid rgba(15,23,42,0.05);">
              <td style="padding: 6px 0; color: #475569;">Trailing P/E</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 700;">${report.quant.fundamental.pe !== null ? report.quant.fundamental.pe.toFixed(2) : 'N/A'}</td>
            </tr>
            <tr style="border-bottom: 1px solid rgba(15,23,42,0.05);">
              <td style="padding: 6px 0; color: #475569;">Price to Book (P/B)</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 700;">${report.quant.fundamental.pb !== null ? report.quant.fundamental.pb.toFixed(2) : 'N/A'}</td>
            </tr>
            <tr style="border-bottom: 1px solid rgba(15,23,42,0.05);">
              <td style="padding: 6px 0; color: #475569;">Debt to Equity</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 700;">${report.quant.fundamental.debtToEquity !== null ? (report.quant.fundamental.debtToEquity > 10 ? report.quant.fundamental.debtToEquity / 100 : report.quant.fundamental.debtToEquity).toFixed(2) : 'N/A'}</td>
            </tr>
            <tr style="border-bottom: 1px solid rgba(15,23,42,0.05);">
              <td style="padding: 6px 0; color: #475569;">Return on Equity (ROE)</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 700;">${report.quant.fundamental.roe !== null ? (report.quant.fundamental.roe * 100).toFixed(2) + '%' : 'N/A'}</td>
            </tr>
            <tr style="border-bottom: 1px solid rgba(15,23,42,0.05);">
              <td style="padding: 6px 0; color: #475569;">Revenue Growth (YoY)</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 700;">${report.quant.fundamental.revenueGrowth !== null ? (report.quant.fundamental.revenueGrowth * 100).toFixed(2) + '%' : 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #475569; vertical-align: top;">Fundamental Summary</td>
              <td style="padding: 6px 0; text-align: right; font-style: italic; color: #0F172A; font-size: 12px; max-width: 250px;">${report.semantic.fundamentalAnalysisSummary || ''}</td>
            </tr>
          </table>
        </div>
        ` : ''}

        <!-- Market Context Panel -->
        ${report.quant.benchmark ? `
        <h3 style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; margin: 24px 0 8px 0; border-bottom: 1px dashed rgba(15,23,42,0.1); padding-bottom: 6px;">Market & Macro Environment</h3>
        <div style="background: rgba(15, 23, 42, 0.02); padding: 12px; border-radius: 8px; border: 1px solid rgba(15, 23, 42, 0.05); font-size: 13px; margin: 16px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr style="border-bottom: 1px solid rgba(15,23,42,0.05);">
              <td style="padding: 6px 0; color: #475569;">Benchmark Index (${report.quant.benchmark.benchmarkTicker})</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 700;">
                ${report.quant.benchmark.indexPrice !== null ? report.quant.benchmark.indexPrice.toFixed(2) : 'N/A'} 
                <span style="color: ${report.quant.benchmark.indexChangePercent >= 0 ? '#10B981' : '#EF4444'}; font-size: 11px;">
                  (${report.quant.benchmark.indexChangePercent >= 0 ? '+' : ''}${report.quant.benchmark.indexChangePercent ? report.quant.benchmark.indexChangePercent.toFixed(2) + '%' : '0%'})
                </span>
              </td>
            </tr>
            <tr style="border-bottom: 1px solid rgba(15,23,42,0.05);">
              <td style="padding: 6px 0; color: #475569;">Volatility Index (${report.quant.benchmark.vixTicker})</td>
              <td style="padding: 6px 0; text-align: right; font-weight: 700; color: ${report.quant.benchmark.vixPrice > 20 ? '#EF4444' : '#10B981'};">
                ${report.quant.benchmark.vixPrice !== null ? report.quant.benchmark.vixPrice.toFixed(2) : 'N/A'}
              </td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #475569; vertical-align: top;">Macro Sentiment</td>
              <td style="padding: 6px 0; text-align: right; font-style: italic; color: #0F172A; font-size: 12px; max-width: 250px;">${report.semantic.marketSentimentAnalysis || ''}</td>
            </tr>
          </table>
        </div>
        ` : ''}

        <h3 style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; margin: 24px 0 8px 0; border-bottom: 1px dashed rgba(15,23,42,0.1); padding-bottom: 6px;">Gemini 5-Day Forecasts</h3>
        <div class="grid">
          <div class="grid-cell">
            <div class="cell-label">5-Day Target</div>
            <div class="cell-val" style="color: #0284C7;">${report.semantic.targetPrice}</div>
          </div>
          <div class="grid-cell">
            <div class="cell-label">Prediction Confidence</div>
            <div class="cell-val" style="color: #0284C7;">${report.semantic.confidence}</div>
          </div>
          <div class="grid-cell" style="grid-column: span 2;">
            <div class="cell-label">Best Trading Strategy (${settings.investmentStyle})</div>
            <div class="cell-val" style="color: ${badgeColor};">${report.semantic.bestStrategy}</div>
          </div>
        </div>

        <h3 style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; margin: 24px 0 8px 0; border-bottom: 1px dashed rgba(15,23,42,0.1); padding-bottom: 6px;">Technical Indicators</h3>
        <div class="grid">
          <div class="grid-cell">
            <div class="cell-label">Spot Price</div>
            <div class="cell-val">${currencySymbol}${safeToFixed(report.quant.currentPrice, 2)}</div>
          </div>
          <div class="grid-cell">
            <div class="cell-label">RSI (14)</div>
            <div class="cell-val">${safeToFixed(report.quant.rsi, 1)}</div>
          </div>
          <div class="grid-cell">
            <div class="cell-label">SMA(20)</div>
            <div class="cell-val">${currencySymbol}${safeToFixed(report.quant.sma20, 2)}</div>
          </div>
          <div class="grid-cell">
            <div class="cell-label">SMA(50)</div>
            <div class="cell-val">${currencySymbol}${safeToFixed(report.quant.sma50, 2)}</div>
          </div>
        </div>

        ${citationsHTML}

        <div class="footer">
          Automated forecast analysis generated on ${new Date(report.timestamp).toLocaleString()}<br>
          AuraTrade v2.0 Multi-Modal Quant-Semantic Browser Integration.
        </div>
      </div>
    </body>
    </html>
  `;

  const email = [
    `To: ${recipientEmail}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
    '',
    htmlBody
  ].join('\r\n');

  const encodedEmail = btoa(unescape(encodeURIComponent(email)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const sendResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw: encodedEmail })
  });

  if (!sendResponse.ok) {
    const detail = await sendResponse.text();
    throw new Error(`Gmail API send failed: ${sendResponse.status} - ${detail}`);
  }

  console.log(`Alert email sent successfully for ${ticker}.`);
  return true;
}

// ─── Auth Token Resolver ──────────────────────────────────────────────────────
async function getAuthToken(settings) {
  if (settings.gmailToken) {
    return settings.gmailToken;
  }

  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

// ─── Firestore Sync ──────────────────────────────────────────────────────────
async function syncWatchlistToFirestore(watchlist) {
  const settings = await getSettings();
  const { firebaseProject, firebaseKey } = settings;
  if (!firebaseProject || !firebaseKey) {
    return;
  }

  const docPath = `artifacts/${APP_ID}/public/data/watchlist`;
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseProject}/databases/(default)/documents/${docPath}?key=${firebaseKey}`;

  const requestBody = {
    fields: {
      watchlist: {
        arrayValue: {
          values: watchlist.map(ticker => ({ stringValue: ticker }))
        }
      },
      updatedAt: {
        stringValue: new Date().toISOString()
      }
    }
  };

  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Firestore Sync Error: ${response.status} - ${errText}`);
    }
  } catch (err) {
    console.error("Firestore sync fetch exception:", err);
  }
}

// ─── Test Trigger ─────────────────────────────────────────────────────────────
async function triggerTestAlert(ticker) {
  const settings = await getSettings();
  if (!settings.geminiKey) {
    throw new Error("Cannot run check: Gemini API key is missing.");
  }
  if (!settings.alertEmail) {
    throw new Error("Cannot run check: Recipient email is missing.");
  }

  console.log(`Testing manual alert for ${ticker}...`);
  const report = await handleFetchAsset(ticker, true);
  const token = await getAuthToken(settings);
  await sendGmailAlert(token, settings, ticker, report.fScore, report);
  return { fScore: report.fScore, timestamp: report.timestamp };
}

// ─── AI Advisor Chatbot ───────────────────────────────────────────────────────
async function handleSendChat(userMessage, chatHistory = []) {
  const settings = await getSettings();
  const geminiKey = settings.geminiKey;
  if (!geminiKey) {
    throw new Error("Gemini API key is not configured. Go to settings to enter your key.");
  }

  const watchlist = await getWatchlist();
  const scanCacheRes = await new Promise(r => chrome.storage.local.get(["marketScanCache"], r));
  const scanCache = scanCacheRes.marketScanCache || {};
  
  const buys = scanCache.buys || [];
  const sells = scanCache.sells || [];

  const style = settings.investmentStyle || "Growth";
  const defaultExchange = settings.defaultExchange || "NSE";

  const buysSummary = buys.map(b => `${b.ticker.split('.')[0]} (Price: ${formatCurrencySimple(b.price, b.ticker)}, Change: ${safeToFixed(b.changePercent, 2)}%, F-Score: ${safeToFixed(b.fScore, 2)}, RSI: ${safeToFixed(b.rsi, 1)})`).join(', ') || "None";
  const sellsSummary = sells.map(s => `${s.ticker.split('.')[0]} (Price: ${formatCurrencySimple(s.price, s.ticker)}, Change: ${safeToFixed(s.changePercent, 2)}%, F-Score: ${safeToFixed(s.fScore, 2)}, RSI: ${safeToFixed(s.rsi, 1)})`).join(', ') || "None";
  const watchlistSummary = watchlist.join(', ') || "Empty";

  const systemInstructionText = `You are AuraTrade Chat, a premium, intelligent stock market co-pilot tailored for the Indian stock market. 
Your goal is to guide the user in selecting stocks based on their specific conditions and real-time market data.

You have access to the user's configuration and local real-time market context:
- User Investment Profile: ${style} Focus
- Default Market Exchange: ${defaultExchange}
- User's Synced Watchlist Tickers: [${watchlistSummary}]
- Live Scanner Buy Suggestions: [${buysSummary}]
- Live Scanner Sell Suggestions: [${sellsSummary}]

You MUST follow these rules strictly:
1. Write all responses in simple, direct, non-technical language. Do not use complex financial jargon. Explain concepts simply so a regular person can easily understand.
2. Wrap critical key terms, tickers, strategies, buy/sell recommendations, and target prices in double asterisks so they are markdown bold (e.g. **RELIANCE**, **strong buy**, **₹2450.00**, **Nifty 50**).
3. If the user asks about stocks inside the scanner lists or watchlist, prioritize using the provided stats (F-Score, prices, daily changes, RSI).
4. If they ask about stocks outside this list, or for broad market trends and conditions, use the google_search tool to look up real-time news and latest prices.
5. Suggest trading strategies that match the user's investment profile (${style}). Recommend option strategies or stock buys clearly and explain simply why it is selected.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;

  const contents = chatHistory.map(msg => ({
    role: msg.role === "user" ? "user" : "model",
    parts: [{ text: msg.text }]
  }));
  
  contents.push({
    role: "user",
    parts: [{ text: userMessage }]
  });

  const requestBody = {
    contents,
    systemInstruction: {
      parts: [{ text: systemInstructionText }]
    },
    tools: [{
      google_search: {}
    }]
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorDetail = await response.text();
    throw new Error(`Gemini Chat API call failed: ${response.status} - ${errorDetail}`);
  }

  const responseData = await response.json();
  const text = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "No response received.";

  const citations = [];
  const groundingChunks = responseData.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  groundingChunks.forEach((chunk, index) => {
    if (chunk.web && chunk.web.uri) {
      citations.push({
        num: index + 1,
        title: chunk.web.title || "Source link",
        url: chunk.web.uri
      });
    }
  });

  return {
    text,
    citations
  };
}

// ─── CSV Export Generator ─────────────────────────────────────────────────────
function generateAssetCSV(data) {
  const rows = [
    ["Parameter", "Value"],
    ["Ticker", data.ticker],
    ["Timestamp", data.timestamp],
    ["F-Score", safeToFixed(data.fScore, 4)],
    ["Correction Bias", safeToFixed(data.correction, 4)],
    ["Spot Price", safeToFixed(data.quant.currentPrice, 2)],
    ["Previous Close", safeToFixed(data.quant.prevClose, 2)],
    ["Price Change", safeToFixed(data.quant.priceChange, 2)],
    ["Price Change %", safeToFixed(data.quant.priceChangePercent, 2)],
    ["SMA(20)", safeToFixed(data.quant.sma20, 2)],
    ["SMA(50)", safeToFixed(data.quant.sma50, 2)],
    ["RSI(14)", safeToFixed(data.quant.rsi, 2)],
    ["MACD Line", safeToFixed(data.quant.macd?.macdLine, 4)],
    ["MACD Signal", safeToFixed(data.quant.macd?.signalLine, 4)],
    ["MACD Histogram", safeToFixed(data.quant.macd?.histogram, 4)],
    ["Bollinger Upper", safeToFixed(data.quant.bollinger?.upper, 2)],
    ["Bollinger Middle", safeToFixed(data.quant.bollinger?.middle, 2)],
    ["Bollinger Lower", safeToFixed(data.quant.bollinger?.lower, 2)],
    ["Bollinger %B", safeToFixed(data.quant.bollinger?.percentB, 4)],
    ["ATR(14)", safeToFixed(data.quant.atr, 2)],
    ["Volume Latest", data.quant.volumeProfile?.latestVolume || "N/A"],
    ["Volume Average", data.quant.volumeProfile?.avgVolume || "N/A"],
    ["Volume Ratio", safeToFixed(data.quant.volumeProfile?.volumeRatio, 2)],
    ["Volume Trend", data.quant.volumeProfile?.trend || "N/A"],
    ["52W High", safeToFixed(data.quant.fiftyTwoWeekHigh, 2)],
    ["52W Low", safeToFixed(data.quant.fiftyTwoWeekLow, 2)],
    ["52W Position", safeToFixed(data.quant.fiftyTwoWeekPosition, 4)],
    ["Quant Score", safeToFixed(data.quant.S_quant, 4)],
    ["Quant Status", data.quant.status],
    ["Sentiment", data.semantic.sentiment],
    ["5-Day Target", data.semantic.targetPrice],
    ["Confidence", data.semantic.confidence],
    ["Best Strategy", data.semantic.bestStrategy],
    ["Summary", `"${(data.semantic.summary || '').replace(/"/g, '""')}"`]
  ];
  return rows.map(r => r.join(",")).join("\n");
}

// ─── Simple Currency Formatter ────────────────────────────────────────────────
function formatCurrencySimple(value, ticker) {
  if (value === undefined || value === null || isNaN(Number(value))) return "N/A";
  const isIndian = ticker && (ticker.endsWith(".NS") || ticker.endsWith(".BO"));
  if (isIndian) {
    return "₹" + Number(value).toFixed(2);
  } else {
    return "$" + Number(value).toFixed(2);
  }
}
