// report.js - ALPHA Full-Page Analytical Report Dashboard

document.addEventListener("DOMContentLoaded", () => {
  // Safety toFixed wrapper to prevent null/undefined property exceptions
  function safeToFixed(value, fractionDigits = 2) {
    if (value === undefined || value === null || isNaN(Number(value))) {
      return "0.00";
    }
    return Number(value).toFixed(fractionDigits);
  }

  const loadingContainer = document.getElementById("report-loading");
  const loadingText = document.getElementById("report-loading-text");
  const errorContainer = document.getElementById("report-error");
  const errorMessage = document.getElementById("report-error-msg");
  const errorRetryBtn = document.getElementById("report-error-retry");
  const contentContainer = document.getElementById("report-content");
  
  const searchInput = document.getElementById("report-search-input");
  const searchBtn = document.getElementById("report-search-btn");
  const themeToggleBtn = document.getElementById("report-theme-toggle");
  const printBtn = document.getElementById("report-print-btn");

  const assetNameEl = document.getElementById("report-asset-name");
  const spotPriceEl = document.getElementById("report-spot-price");
  const priceChangeEl = document.getElementById("report-price-change");
  const sentimentBadgeEl = document.getElementById("report-sentiment-badge");
  
  const gaugeCircle = document.getElementById("gauge-circle");
  const gaugeValueEl = document.getElementById("gauge-value");
  const gaugeStatusEl = document.getElementById("gauge-status");
  
  const sma20El = document.getElementById("report-sma20");
  const sma50El = document.getElementById("report-sma50");
  const trendAlignEl = document.getElementById("report-trend-align");
  const prevCloseEl = document.getElementById("report-prev-close");
  
  const canvas = document.getElementById("report-canvas");
  
  const bestStrategyEl = document.getElementById("report-best-strategy");
  const targetPriceEl = document.getElementById("report-target-price");
  const confidenceEl = document.getElementById("report-confidence");
  
  const semanticSummaryEl = document.getElementById("report-semantic-summary");
  const citationsContainer = document.getElementById("report-citations-container");
  const newsFeedEl = document.getElementById("report-news-feed");

  let currentTicker = null;
  let activeTheme = 'light';

  // Load configuration and initialize
  init();

  function init() {
    chrome.storage.local.get(["settings"], (res) => {
      const settings = res.settings || {};
      activeTheme = settings.theme || 'light';
      applyTheme(activeTheme);

      // Parse query params
      const params = new URLSearchParams(window.location.search);
      let ticker = params.get("ticker");
      if (ticker) {
        loadAsset(ticker.toUpperCase().trim(), false); // Use cache if fresh on initial load
      } else {
        showError("No ticker specified. Please enter a symbol in the search bar above.");
      }
    });

    // Theme Toggle click handler
    themeToggleBtn.addEventListener("click", () => {
      chrome.storage.local.get(["settings"], (res) => {
        const settings = res.settings || {};
        const newTheme = settings.theme === 'dark' ? 'light' : 'dark';
        settings.theme = newTheme;
        chrome.storage.local.set({ settings }, () => {
          activeTheme = newTheme;
          applyTheme(newTheme);
          if (currentTicker) {
            // Re-fetch or re-draw to update colors
            chrome.storage.local.get([`cache_${currentTicker}`], (caches) => {
              const cached = caches[`cache_${currentTicker}`];
              if (cached) renderAssetData(cached);
            });
          }
        });
      });
    });

    // Print button handler
    printBtn.addEventListener("click", () => {
      window.print();
    });

    // CSV Export button handler
    const csvBtn = document.getElementById("report-csv-btn");
    if (csvBtn) {
      csvBtn.addEventListener("click", () => {
        if (!currentTicker) return;
        chrome.runtime.sendMessage({ action: "EXPORT_ASSET_CSV", ticker: currentTicker }, (resp) => {
          if (chrome.runtime.lastError || !resp?.success) {
            console.warn("CSV export failed");
            return;
          }
          const blob = new Blob([resp.csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `ALPHA_${resp.ticker}_${new Date().toISOString().slice(0,10)}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        });
      });
    }

    // Search button handler
    const runSearch = () => {
      const val = searchInput.value.trim().toUpperCase();
      if (val) {
        // Update URL query parameter without page reload, then load
        const url = new URL(window.location);
        url.searchParams.set("ticker", val);
        window.history.pushState({}, '', url);
        loadAsset(val, true); // Force refresh on manual search
        searchInput.value = "";
      }
    };
    searchBtn.addEventListener("click", runSearch);
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });

    errorRetryBtn.addEventListener("click", () => {
      errorContainer.style.display = "none";
      searchInput.focus();
    });
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.body.classList.add('dark-theme');
      themeToggleBtn.textContent = '🌙';
    } else {
      document.body.classList.remove('dark-theme');
      themeToggleBtn.textContent = '☀️';
    }
  }

  function showLoading(text) {
    loadingContainer.style.display = "flex";
    loadingText.textContent = text;
    errorContainer.style.display = "none";
    contentContainer.style.display = "none";
  }

  function showError(msg) {
    loadingContainer.style.display = "none";
    errorContainer.style.display = "block";
    errorMessage.textContent = msg;
    contentContainer.style.display = "none";
  }

  function hideAllStates() {
    loadingContainer.style.display = "none";
    errorContainer.style.display = "none";
    contentContainer.style.display = "block";
  }

  function loadAsset(ticker, forceRefresh = false) {
    currentTicker = ticker;
    showLoading(`Analyzing $${ticker}...`);

    chrome.runtime.sendMessage({ action: "FETCH_ASSET", ticker, forceRefresh }, (response) => {
      if (chrome.runtime.lastError) {
        showError(chrome.runtime.lastError.message);
        return;
      }
      if (response && response.success) {
        renderAssetData(response.data);
      } else {
        showError(response ? response.error : "Unknown network connection failure.");
      }
    });
  }

  function parseMarkdown(text) {
    if (!text) return "";
    let escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return escaped.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  }

  function formatCurrency(value, ticker) {
    const num = Number(value);
    if (value === undefined || value === null || isNaN(num)) return "N/A";
    const isIndian = ticker && (ticker.endsWith(".NS") || ticker.endsWith(".BO"));
    if (isIndian) {
      return "₹" + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else {
      return "$" + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }

  function renderAssetData(data) {
    hideAllStates();

    const ticker = data.ticker;
    const cleanTicker = ticker.split(".")[0];
    
    assetNameEl.innerHTML = `${cleanTicker} <span style="font-size:16px; font-weight:400; color:var(--text-slate-dim);">(${ticker})</span>`;
    spotPriceEl.textContent = formatCurrency(data.quant.currentPrice, ticker);
    
    const isPos = data.quant?.priceChange >= 0;
    const changeSign = isPos ? "+" : "";
    priceChangeEl.className = isPos ? "asset-change positive" : "asset-change negative";
    priceChangeEl.textContent = `${changeSign}${safeToFixed(data.quant?.priceChangePercent, 2)}% (1D)`;

    // Sentiment badge
    const sentiment = data.semantic.sentiment.toUpperCase();
    if (sentiment === 'BULLISH') {
      sentimentBadgeEl.innerHTML = `<span class="badge badge-large badge-bullish">Bullish Sentiment</span>`;
    } else if (sentiment === 'BEARISH') {
      sentimentBadgeEl.innerHTML = `<span class="badge badge-large badge-bearish">Bearish Sentiment</span>`;
    } else {
      sentimentBadgeEl.innerHTML = `<span class="badge badge-large badge-neutral">Neutral Sentiment</span>`;
    }

    // Gauge meter rendering
    const radius = 48;
    const circumference = 2 * Math.PI * radius; // 301.6
    const offset = circumference - (data.fScore * circumference);
    
    const isBullishBreak = data.fScore >= 0.85;
    const isBearishBreak = data.fScore <= 0.15;
    let scoreColor = "var(--text-slate-light)";
    
    if (isBullishBreak) {
      scoreColor = "var(--accent-cyan-glow)";
      gaugeStatusEl.style.color = "var(--accent-cyan-glow)";
      gaugeStatusEl.textContent = "STRONG BUY BREAKTHROUGH";
    } else if (isBearishBreak) {
      scoreColor = "var(--accent-magenta-neon)";
      gaugeStatusEl.style.color = "var(--accent-magenta-neon)";
      gaugeStatusEl.textContent = "STRONG SELL BREAKTHROUGH";
    } else {
      gaugeStatusEl.style.color = "var(--text-slate-dim)";
      gaugeStatusEl.textContent = "STABLE CONSOLIDATION";
    }

    gaugeCircle.style.stroke = scoreColor;
    gaugeCircle.style.strokeDashoffset = offset;
    gaugeValueEl.style.color = scoreColor;
    gaugeValueEl.textContent = safeToFixed(data.fScore, 2);

    // Quant parameters
    sma20El.textContent = formatCurrency(data.quant?.sma20, ticker);
    sma50El.textContent = formatCurrency(data.quant?.sma50, ticker);
    trendAlignEl.textContent = data.quant?.status || "Neutral";
    prevCloseEl.textContent = formatCurrency(data.quant?.prevClose, ticker);

    // Render Crossover Badge
    const crossBadge = document.getElementById("report-crossover-badge");
    if (crossBadge) {
      const crossover = data.quant?.crossover || "None";
      if (crossover === "Golden Cross") {
        crossBadge.style.display = "inline-flex";
        crossBadge.textContent = "Golden Cross";
        crossBadge.className = "badge badge-bullish";
      } else if (crossover === "Death Cross") {
        crossBadge.style.display = "inline-flex";
        crossBadge.textContent = "Death Cross";
        crossBadge.className = "badge badge-bearish";
      } else {
        crossBadge.style.display = "none";
      }
    }

    // Render Pivot Points
    const pS1 = document.getElementById("pivot-s1");
    const pS2 = document.getElementById("pivot-s2");
    const pPP = document.getElementById("pivot-pp");
    const pR1 = document.getElementById("pivot-r1");
    const pR2 = document.getElementById("pivot-r2");
    if (pS1 && pS2 && pPP && pR1 && pR2) {
      if (data.quant?.pivotPoints) {
        pS1.textContent = formatCurrency(data.quant.pivotPoints.s1, ticker);
        pS2.textContent = formatCurrency(data.quant.pivotPoints.s2, ticker);
        pPP.textContent = formatCurrency(data.quant.pivotPoints.pp, ticker);
        pR1.textContent = formatCurrency(data.quant.pivotPoints.r1, ticker);
        pR2.textContent = formatCurrency(data.quant.pivotPoints.r2, ticker);
      } else {
        pS1.textContent = "N/A";
        pS2.textContent = "N/A";
        pPP.textContent = "N/A";
        pR1.textContent = "N/A";
        pR2.textContent = "N/A";
      }
    }

    // Technical Indicators updates
    const rsiEl = document.getElementById("report-rsi");
    const macdEl = document.getElementById("report-macd");
    const volumeEl = document.getElementById("report-volume");
    const bollingerEl = document.getElementById("report-bollinger");
    const atrEl = document.getElementById("report-atr");

    const rsiVal = data.quant?.rsi || 50;
    const rsiClass = rsiVal >= 70 ? 'rsi-overbought' : rsiVal <= 30 ? 'rsi-oversold' : 'rsi-neutral';
    if (rsiEl) {
      rsiEl.textContent = safeToFixed(rsiVal, 1);
      rsiEl.className = `indicator-badge ${rsiClass}`;
    }

    const macdHist = data.quant?.macd?.histogram || 0;
    const macdClass = macdHist > 0 ? 'macd-bull' : 'macd-bear';
    if (macdEl) {
      macdEl.textContent = safeToFixed(macdHist, 3);
      macdEl.className = `indicator-badge ${macdClass}`;
    }

    const volRatio = data.quant?.volumeProfile?.volumeRatio || 1.0;
    const volClass = volRatio > 1.3 ? 'volume-high' : 'volume-normal';
    if (volumeEl) {
      volumeEl.textContent = `${safeToFixed(volRatio, 1)}x`;
      volumeEl.className = `indicator-badge ${volClass}`;
    }

    if (bollingerEl) {
      bollingerEl.textContent = safeToFixed(data.quant?.bollinger?.percentB, 3);
    }

    if (atrEl) {
      atrEl.textContent = safeToFixed(data.quant?.atr, 2);
    }

    // 52-Week Range updates
    const lowEl = document.getElementById("report-52w-low");
    const highEl = document.getElementById("report-52w-high");
    const markerEl = document.getElementById("report-52w-marker");

    if (lowEl && highEl && markerEl) {
      lowEl.textContent = formatCurrency(data.quant?.fiftyTwoWeekLow, ticker);
      highEl.textContent = formatCurrency(data.quant?.fiftyTwoWeekHigh, ticker);
      const position = data.quant?.fiftyTwoWeekPosition !== undefined ? data.quant.fiftyTwoWeekPosition : 0.5;
      markerEl.style.left = `${(position * 100).toFixed(1)}%`;
    }
    
    // Render Self-Correction Weight Bias
    const correctionEl = document.getElementById("report-correction");
    if (correctionEl) {
      const correctionVal = data.correction !== undefined ? data.correction : 0.0;
      const sign = correctionVal >= 0 ? "+" : "";
      correctionEl.textContent = `${sign}${safeToFixed(correctionVal, 4)}`;
      correctionEl.style.color = correctionVal > 0 ? "var(--accent-cyan-glow)" : (correctionVal < 0 ? "var(--accent-magenta-neon)" : "var(--text-slate-dim)");
    }

    // Update 4-Pillar F-Score component progress bars, scores, and weights
    const weightQEl = document.getElementById("weight-q");
    const weightFEl = document.getElementById("weight-f");
    const weightSEl = document.getElementById("weight-s");
    const weightMEl = document.getElementById("weight-m");
    const scoreQEl = document.getElementById("score-q");
    const scoreFEl = document.getElementById("score-f");
    const scoreSEl = document.getElementById("score-s");
    const scoreMEl = document.getElementById("score-m");
    const progressQEl = document.getElementById("progress-q");
    const progressFEl = document.getElementById("progress-f");
    const progressSEl = document.getElementById("progress-s");
    const progressMEl = document.getElementById("progress-m");

    const wQ = data.w_q !== undefined ? data.w_q : 0.30;
    const wF = data.w_f !== undefined ? data.w_f : 0.30;
    const wS = data.w_s !== undefined ? data.w_s : 0.20;
    const wM = data.w_m !== undefined ? data.w_m : 0.20;

    const scoreQ = data.quant?.S_quant !== undefined ? data.quant.S_quant : 0.5;
    const scoreF = data.S_fundamental !== undefined ? data.S_fundamental : 0.5;
    const scoreS = data.semantic?.S_semantic !== undefined ? data.semantic.S_semantic : 0.5;
    const scoreM = data.S_market !== undefined ? data.S_market : 0.5;

    if (weightQEl) weightQEl.textContent = `${Math.round(wQ * 100)}%`;
    if (weightFEl) weightFEl.textContent = `${Math.round(wF * 100)}%`;
    if (weightSEl) weightSEl.textContent = `${Math.round(wS * 100)}%`;
    if (weightMEl) weightMEl.textContent = `${Math.round(wM * 100)}%`;

    if (scoreQEl) scoreQEl.textContent = `${(scoreQ * 10).toFixed(1)}/10`;
    if (scoreFEl) scoreFEl.textContent = `${(scoreF * 10).toFixed(1)}/10`;
    if (scoreSEl) scoreSEl.textContent = `${(scoreS * 10).toFixed(1)}/10`;
    if (scoreMEl) scoreMEl.textContent = `${(scoreM * 10).toFixed(1)}/10`;

    if (progressQEl) progressQEl.style.width = `${Math.round(scoreQ * 100)}%`;
    if (progressFEl) progressFEl.style.width = `${Math.round(scoreF * 100)}%`;
    if (progressSEl) progressSEl.style.width = `${Math.round(scoreS * 100)}%`;
    if (progressMEl) progressMEl.style.width = `${Math.round(scoreM * 100)}%`;

    // Render Company Key Fundamentals
    const fCard = document.getElementById("report-fundamental-card");
    if (fCard) {
      const f = data.quant?.fundamental;
      const peEl = document.getElementById("fundamental-pe");
      const pbEl = document.getElementById("fundamental-pb");
      const deEl = document.getElementById("fundamental-de");
      const roeEl = document.getElementById("fundamental-roe");
      const revEl = document.getElementById("fundamental-revenue-growth");
      const marginEl = document.getElementById("fundamental-margin");
      const summaryEl = document.getElementById("fundamental-summary-txt");

      if (f) {
        // Trailing PE
        if (peEl) {
          if (f.pe !== null && f.pe !== undefined) {
            peEl.textContent = safeToFixed(f.pe, 2);
            if (f.pe > 0 && f.pe <= 20) peEl.style.color = "var(--accent-green)";
            else if (f.pe > 40 || f.pe <= 0) peEl.style.color = "var(--accent-red)";
            else peEl.style.color = "var(--text-slate-light)";
          } else {
            peEl.textContent = "N/A";
            peEl.style.color = "var(--text-slate-dim)";
          }
        }

        // Price/Book
        if (pbEl) {
          if (f.pb !== null && f.pb !== undefined) {
            pbEl.textContent = safeToFixed(f.pb, 2);
            if (f.pb > 0 && f.pb <= 2.5) pbEl.style.color = "var(--accent-green)";
            else if (f.pb > 6.0) pbEl.style.color = "var(--accent-red)";
            else pbEl.style.color = "var(--text-slate-light)";
          } else {
            pbEl.textContent = "N/A";
            pbEl.style.color = "var(--text-slate-dim)";
          }
        }

        // Debt/Equity
        if (deEl) {
          if (f.debtToEquity !== null && f.debtToEquity !== undefined) {
            let de = f.debtToEquity;
            if (de > 10) de = de / 100;
            deEl.textContent = safeToFixed(de, 2);
            if (de <= 0.8) deEl.style.color = "var(--accent-green)";
            else if (de > 2.0) deEl.style.color = "var(--accent-red)";
            else deEl.style.color = "var(--text-slate-light)";
          } else {
            deEl.textContent = "N/A";
            deEl.style.color = "var(--text-slate-dim)";
          }
        }

        // ROE
        if (roeEl) {
          if (f.roe !== null && f.roe !== undefined) {
            roeEl.textContent = `${safeToFixed(f.roe * 100, 2)}%`;
            if (f.roe >= 0.15) roeEl.style.color = "var(--accent-green)";
            else if (f.roe <= 0.05) roeEl.style.color = "var(--accent-red)";
            else roeEl.style.color = "var(--text-slate-light)";
          } else {
            roeEl.textContent = "N/A";
            roeEl.style.color = "var(--text-slate-dim)";
          }
        }

        // Revenue Growth YoY
        if (revEl) {
          if (f.revenueGrowth !== null && f.revenueGrowth !== undefined) {
            revEl.textContent = `${safeToFixed(f.revenueGrowth * 100, 2)}%`;
            if (f.revenueGrowth >= 0.12) revEl.style.color = "var(--accent-green)";
            else if (f.revenueGrowth <= 0.0) revEl.style.color = "var(--accent-red)";
            else revEl.style.color = "var(--text-slate-light)";
          } else {
            revEl.textContent = "N/A";
            revEl.style.color = "var(--text-slate-dim)";
          }
        }

        // Operating Margin
        if (marginEl) {
          if (f.operatingMargins !== null && f.operatingMargins !== undefined) {
            marginEl.textContent = `${safeToFixed(f.operatingMargins * 100, 2)}%`;
            if (f.operatingMargins >= 0.15) marginEl.style.color = "var(--accent-green)";
            else if (f.operatingMargins <= 0.03) marginEl.style.color = "var(--accent-red)";
            else marginEl.style.color = "var(--text-slate-light)";
          } else {
            marginEl.textContent = "N/A";
            marginEl.style.color = "var(--text-slate-dim)";
          }
        }
      } else {
        if (peEl) { peEl.textContent = "N/A"; peEl.style.color = "var(--text-slate-dim)"; }
        if (pbEl) { pbEl.textContent = "N/A"; pbEl.style.color = "var(--text-slate-dim)"; }
        if (deEl) { deEl.textContent = "N/A"; deEl.style.color = "var(--text-slate-dim)"; }
        if (roeEl) { roeEl.textContent = "N/A"; roeEl.style.color = "var(--text-slate-dim)"; }
        if (revEl) { revEl.textContent = "N/A"; revEl.style.color = "var(--text-slate-dim)"; }
        if (marginEl) { marginEl.textContent = "N/A"; marginEl.style.color = "var(--text-slate-dim)"; }
      }

      if (summaryEl) {
        summaryEl.innerHTML = data.semantic?.fundamentalAnalysisSummary 
          ? parseMarkdown(data.semantic.fundamentalAnalysisSummary) 
          : "No semantic fundamentals health summary available.";
      }
    }

    // Render Market & Macro Context
    const mCard = document.getElementById("report-market-card");
    if (mCard) {
      const b = data.quant?.benchmark;
      const idxTickerEl = document.getElementById("market-index-ticker");
      const idxPriceEl = document.getElementById("market-index-price");
      const idxChangeEl = document.getElementById("market-index-change");
      const vixPriceEl = document.getElementById("market-vix-price");
      const vixStatusEl = document.getElementById("market-vix-status");
      const mSummaryEl = document.getElementById("market-summary-txt");

      if (b) {
        if (idxTickerEl) {
          let displayName = b.benchmarkTicker || "Benchmark Index";
          if (b.benchmarkTicker === "^NSEI") displayName = "Nifty 50";
          else if (b.benchmarkTicker === "^GSPC") displayName = "S&P 500";
          idxTickerEl.textContent = displayName;
        }

        if (idxPriceEl) {
          if (b.indexPrice !== null && b.indexPrice !== undefined) {
            idxPriceEl.textContent = b.indexPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          } else {
            idxPriceEl.textContent = "N/A";
          }
        }

        if (idxChangeEl) {
          if (b.indexChangePercent !== null && b.indexChangePercent !== undefined) {
            const isIdxPos = b.indexChangePercent >= 0;
            const sign = isIdxPos ? "+" : "";
            idxChangeEl.textContent = `${sign}${safeToFixed(b.indexChangePercent, 2)}%`;
            idxChangeEl.style.color = isIdxPos ? "var(--accent-green)" : "var(--accent-red)";
          } else {
            idxChangeEl.textContent = "N/A";
            idxChangeEl.style.color = "var(--text-slate-dim)";
          }
        }

        if (vixPriceEl) {
          vixPriceEl.textContent = b.vixPrice !== null && b.vixPrice !== undefined ? safeToFixed(b.vixPrice, 2) : "N/A";
        }

        if (vixStatusEl) {
          if (b.vixPrice !== null && b.vixPrice !== undefined) {
            const vix = b.vixPrice;
            if (vix < 15) {
              vixStatusEl.textContent = "Low Risk";
              vixStatusEl.className = "badge badge-bullish";
            } else if (vix <= 25) {
              vixStatusEl.textContent = "Elevated";
              vixStatusEl.className = "badge badge-neutral";
            } else {
              vixStatusEl.textContent = "High Panic";
              vixStatusEl.className = "badge badge-bearish";
            }
          } else {
            vixStatusEl.textContent = "N/A";
            vixStatusEl.className = "badge";
          }
        }
      } else {
        if (idxPriceEl) idxPriceEl.textContent = "N/A";
        if (idxChangeEl) { idxChangeEl.textContent = "N/A"; idxChangeEl.style.color = "var(--text-slate-dim)"; }
        if (vixPriceEl) vixPriceEl.textContent = "N/A";
        if (vixStatusEl) { vixStatusEl.textContent = "N/A"; vixStatusEl.className = "badge"; }
      }

      if (mSummaryEl) {
        mSummaryEl.innerHTML = data.semantic?.marketSentimentAnalysis 
          ? parseMarkdown(data.semantic.marketSentimentAnalysis) 
          : "No macro climate summary available.";
      }
    }

    // Strategy parameters
    bestStrategyEl.innerHTML = parseMarkdown(data.semantic.bestStrategy);
    confidenceEl.textContent = data.semantic.confidence;

    const displayTarget = data.semantic.targetPrice.startsWith('$') || data.semantic.targetPrice.startsWith('₹') 
      ? data.semantic.targetPrice 
      : (isNaN(parseFloat(data.semantic.targetPrice)) ? data.semantic.targetPrice : formatCurrency(parseFloat(data.semantic.targetPrice), ticker));
    
    let targetPercentHTML = "";
    const parsedTarget = parseFloat(data.semantic.targetPrice.replace(/[^\d.-]/g, ''));
    if (!isNaN(parsedTarget) && data.quant?.currentPrice) {
      const diffPercent = ((parsedTarget - data.quant.currentPrice) / data.quant.currentPrice) * 100;
      const tColor = diffPercent >= 0 ? "var(--accent-cyan-glow)" : "var(--accent-magenta-neon)";
      const sign = diffPercent >= 0 ? "+" : "";
      targetPercentHTML = `<span style="font-size:12px; margin-left:8px; color:${tColor}; font-weight:700;">(${sign}${diffPercent.toFixed(2)}%)</span>`;
    }
      
    targetPriceEl.innerHTML = `${displayTarget} ${targetPercentHTML}`;

    // Semantic text summary
    semanticSummaryEl.innerHTML = parseMarkdown(data.semantic.summary);

    // News catalysts
    if (newsFeedEl) {
      newsFeedEl.innerHTML = "";
      if (data.semantic.news && data.semantic.news.length > 0) {
        data.semantic.news.forEach(n => {
          const row = document.createElement("div");
          row.style.cssText = "border-bottom: 1px dashed var(--border-glass); padding-bottom: 8px; margin-bottom: 4px; display:flex; flex-direction:column; gap:4px;";
          
          const isBull = n.impact === "BULLISH";
          const isBear = n.impact === "BEARISH";
          const badgeColor = isBull ? "var(--accent-green)" : isBear ? "var(--accent-red)" : "var(--text-slate-dim)";
          const impactText = n.impact || "NEUTRAL";
          
          row.innerHTML = `
            <div style="display:flex; justify-content:space-between; font-size:10px; font-family:var(--font-display); font-weight:600;">
              <span style="color:var(--text-slate-dim);">Source: ${n.source}</span>
              <span style="color:${badgeColor}; font-weight:700;">● ${impactText}</span>
            </div>
            <div style="font-size:12px; font-weight:500; color:var(--text-slate-light); line-height:1.4;">${parseMarkdown(n.headline)}</div>
          `;
          newsFeedEl.appendChild(row);
        });
      } else {
        newsFeedEl.innerHTML = `<div style="font-size:12px; color:var(--text-slate-dim); text-align:center; padding:12px; border:1px dashed var(--border-glass); border-radius:8px;">No news catalysts parsed.</div>`;
      }
    }

    // Citations
    citationsContainer.innerHTML = "";
    if (data.semantic.citations && data.semantic.citations.length > 0) {
      data.semantic.citations.forEach(c => {
        const a = document.createElement("a");
        a.href = c.url;
        a.target = "_blank";
        a.className = "citation-item";
        a.innerHTML = `
          <span class="citation-num">${c.num}</span>
          <span class="citation-title" title="${c.title}">${c.title}</span>
        `;
        citationsContainer.appendChild(a);
      });
    } else {
      citationsContainer.innerHTML = `<div style="font-size:12px; color:var(--text-slate-dim); text-align:center; padding:12px; border:1px dashed var(--border-glass); border-radius:8px;">No semantic citations referenced.</div>`;
    }

    // Render Tactical Timing Guidance
    const timingCard = document.getElementById("report-timing-card");
    const timingAction = document.getElementById("report-timing-action");
    const timingRange = document.getElementById("report-timing-range");
    const timingRationale = document.getElementById("report-timing-rationale");
    
    if (timingCard && timingAction && timingRange && timingRationale) {
      if (data.timingAdvice) {
        timingCard.style.display = "block";
        timingAction.textContent = data.timingAdvice.action;
        
        // Remove old classes and add new action class
        timingAction.className = "timing-badge-action";
        const actionLower = data.timingAdvice.action.toLowerCase();
        if (actionLower.includes("accumulate")) {
          timingAction.classList.add("accumulate");
        } else if (actionLower.includes("take profit")) {
          timingAction.classList.add("take-profit");
        } else if (actionLower.includes("defensive")) {
          timingAction.classList.add("defensive");
        } else {
          timingAction.classList.add("hold");
        }
        
        timingRange.textContent = data.timingAdvice.range;
        timingRationale.textContent = data.timingAdvice.rationale;
      } else {
        timingCard.style.display = "none";
      }
    }

    // Draw Price chart with forecast parameters
    drawChart(canvas, data.quant.prices, data.fScore >= 0.70 || data.quant.priceChangePercent >= 0, data.semantic.targetPrice, data.semantic.confidence, data.quant.regression);
  }

  function drawChart(canvasEl, prices, isBullish, targetPriceStr = "", confidenceStr = "", regression = null) {
    if (!canvasEl || !prices || prices.length < 2) return;

    // Split prices into 20 days chart series, and calculate SMA20/50 for those 20 days
    const displayCount = Math.min(20, prices.length);
    const startIndex = prices.length - displayCount;
    const priceSeries = prices.slice(-displayCount);

    // Calculate SMA20 series
    const sma20Series = [];
    for (let i = startIndex; i < prices.length; i++) {
      const start = Math.max(0, i - 19);
      const slice = prices.slice(start, i + 1);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      sma20Series.push(avg);
    }

    // Calculate SMA50 series
    const sma50Series = [];
    for (let i = startIndex; i < prices.length; i++) {
      const start = Math.max(0, i - 49);
      const slice = prices.slice(start, i + 1);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      sma50Series.push(avg);
    }

    // Parse Target Price
    const currentPrice = priceSeries[priceSeries.length - 1];
    let targetPriceVal = NaN;
    if (targetPriceStr) {
      targetPriceVal = parseFloat(targetPriceStr.replace(/[^0-9\.]/g, ""));
    }
    const hasForecast = !isNaN(targetPriceVal) && targetPriceVal > 0;

    // Parse Confidence
    let parsedConfidence = 80;
    if (confidenceStr) {
      const matchNum = confidenceStr.match(/(\d+)/);
      if (matchNum) parsedConfidence = parseInt(matchNum[1]);
    }

    const rect = canvasEl.getBoundingClientRect();
    const width = rect.width;
    const height = 280;

    // Margins
    const topMargin = 40; // larger top margin for legend
    const bottomMargin = 25;
    const leftMargin = 15;
    const rightMargin = 15;
    
    const chartHeight = height - topMargin - bottomMargin;
    const chartWidth = width - leftMargin - rightMargin;

    // We extend coordinates to include 5 future forecast periods.
    // So total periods on X axis = 20 (historical) + 5 (forecast) = 25 intervals.
    // Historical is index 0..19. Forecast is index 20..24.
    const totalPeriods = hasForecast ? 25 : 20;

    // Scale calculations: Find min and max including forecast bounds to scale chart properly
    let forecastUpperLimit = currentPrice;
    let forecastLowerLimit = currentPrice;
    if (hasForecast) {
      // uncertainty range: +/- 15% scaled by confidence (higher confidence = smaller uncertainty)
      const uncertainty = ((100 - parsedConfidence) / 100) * 0.15;
      forecastUpperLimit = targetPriceVal * (1 + uncertainty);
      forecastLowerLimit = targetPriceVal * (1 - uncertainty);
    }

    const hasRegression = regression && regression.r2 !== undefined;
    const regressionSeries = [];
    if (hasRegression) {
      const slope = regression.slope;
      const intercept = regression.intercept;
      for (let i = 0; i < totalPeriods; i++) {
        regressionSeries.push(slope * i + intercept);
      }
    }

    const allValues = [...priceSeries, ...sma20Series, ...sma50Series];
    if (hasForecast) {
      allValues.push(targetPriceVal, forecastUpperLimit, forecastLowerLimit);
    }
    if (hasRegression) {
      allValues.push(...regressionSeries);
    }
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const range = max - min === 0 ? 1 : max - min;

    // Map point locations
    const points = [];
    for (let i = 0; i < priceSeries.length; i++) {
      const x = leftMargin + (i / (totalPeriods - 1)) * chartWidth;
      const yPrice = topMargin + chartHeight - ((priceSeries[i] - min) / range) * chartHeight;
      const ySma20 = topMargin + chartHeight - ((sma20Series[i] - min) / range) * chartHeight;
      const ySma50 = topMargin + chartHeight - ((sma50Series[i] - min) / range) * chartHeight;
      points.push({
        x,
        priceVal: priceSeries[i],
        sma20Val: sma20Series[i],
        sma50Val: sma50Series[i],
        yPrice,
        ySma20,
        ySma50,
        dayIndex: startIndex + i + 1,
        isForecast: false
      });
    }

    // Map forecast points (Days 21-25)
    const forecastPoints = [];
    const dividerX = points[points.length - 1].x;
    if (hasForecast) {
      for (let i = 1; i <= 5; i++) {
        const idx = 19 + i;
        const x = leftMargin + (idx / (totalPeriods - 1)) * chartWidth;
        
        const priceVal = currentPrice + (targetPriceVal - currentPrice) * (i / 5);
        const yPrice = topMargin + chartHeight - ((priceVal - min) / range) * chartHeight;
        
        const uncertainty = (i / 5) * (((100 - parsedConfidence) / 100) * 0.15);
        const upperVal = priceVal * (1 + uncertainty);
        const lowerVal = priceVal * (1 - uncertainty);
        
        const yUpper = topMargin + chartHeight - ((upperVal - min) / range) * chartHeight;
        const yLower = topMargin + chartHeight - ((lowerVal - min) / range) * chartHeight;
        
        forecastPoints.push({
          x,
          priceVal,
          yPrice,
          yUpper,
          yLower,
          dayIndex: startIndex + 20 + i,
          isForecast: true
        });
      }
    }

    const allPoints = [...points, ...forecastPoints];

    // Resolve CSS custom properties for Canvas (Canvas 2D doesn't support var())
    const canvasTextDim = activeTheme === 'dark' ? '#94A3B8' : '#4B5E78';
    const canvasTextLight = activeTheme === 'dark' ? '#F1F5F9' : '#0B111E';
    const canvasCyanGlow = activeTheme === 'dark' ? '#00FFE0' : '#0284C7';

    function drawChartState(activePoint) {
      const dpr = window.devicePixelRatio || 1;
      canvasEl.width = rect.width * dpr;
      canvasEl.height = height * dpr;
      
      const ctx = canvasEl.getContext("2d");
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // Draw horizontal reference lines (grid)
      ctx.strokeStyle = activeTheme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.04)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      
      const gridLines = 4;
      for (let i = 0; i <= gridLines; i++) {
        const y = topMargin + (i / gridLines) * chartHeight;
        ctx.beginPath();
        ctx.moveTo(leftMargin, y);
        ctx.lineTo(leftMargin + chartWidth, y);
        ctx.stroke();
        
        const priceVal = max - (i / gridLines) * range;
        ctx.fillStyle = canvasTextDim;
        ctx.font = "9px Outfit";
        ctx.setLineDash([]);
        ctx.fillText(safeToFixed(priceVal, 1), leftMargin + 5, y - 4);
        ctx.setLineDash([5, 5]);
      }
      
      ctx.setLineDash([]);

      // Draw Vertical Dividers (Historic vs Forecast)
      if (hasForecast) {
        ctx.strokeStyle = activeTheme === 'dark' ? 'rgba(0, 255, 224, 0.25)' : 'rgba(2, 132, 199, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(dividerX, topMargin);
        ctx.lineTo(dividerX, topMargin + chartHeight);
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.fillStyle = canvasCyanGlow;
        ctx.font = "bold 9px Space Grotesk";
        ctx.fillText("FORECAST", dividerX + 8, topMargin + 10);
      }

      // Draw active hover vertical bar
      if (activePoint) {
        ctx.beginPath();
        ctx.strokeStyle = activeTheme === 'dark' ? 'rgba(0, 255, 224, 0.15)' : 'rgba(2, 132, 199, 0.15)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.moveTo(activePoint.x, topMargin);
        ctx.lineTo(activePoint.x, topMargin + chartHeight);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw SMA50 Line
      ctx.beginPath();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#D946EF';
      ctx.setLineDash([4, 4]);
      points.forEach((pt, idx) => {
        if (idx === 0) {
          ctx.moveTo(pt.x, pt.ySma50);
        } else {
          ctx.lineTo(pt.x, pt.ySma50);
        }
      });
      ctx.stroke();

      // Draw SMA20 Line
      ctx.beginPath();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#0284C7';
      ctx.setLineDash([2, 2]);
      points.forEach((pt, idx) => {
        if (idx === 0) {
          ctx.moveTo(pt.x, pt.ySma20);
        } else {
          ctx.lineTo(pt.x, pt.ySma20);
        }
      });
      ctx.stroke();
      
      ctx.setLineDash([]);

      // Draw Regression Line
      if (hasRegression) {
        ctx.beginPath();
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = '#F59E0B';
        ctx.setLineDash([6, 4]);
        
        allPoints.forEach((pt, idx) => {
          const regVal = regressionSeries[idx];
          const yReg = topMargin + chartHeight - ((regVal - min) / range) * chartHeight;
          
          pt.regressionVal = regVal;
          pt.yRegression = yReg;
          
          if (idx === 0) {
            ctx.moveTo(pt.x, yReg);
          } else {
            ctx.lineTo(pt.x, yReg);
          }
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw Confidence Cone for Forecast
      if (hasForecast) {
        ctx.beginPath();
        ctx.moveTo(points[points.length - 1].x, points[points.length - 1].yPrice);
        forecastPoints.forEach(pt => {
          ctx.lineTo(pt.x, pt.yUpper);
        });
        for (let i = forecastPoints.length - 1; i >= 0; i--) {
          ctx.lineTo(forecastPoints[i].x, forecastPoints[i].yLower);
        }
        ctx.closePath();
        
        const coneGrad = ctx.createLinearGradient(dividerX, 0, leftMargin + chartWidth, 0);
        coneGrad.addColorStop(0, 'rgba(0, 255, 224, 0.03)');
        coneGrad.addColorStop(1, 'rgba(0, 255, 224, 0.12)');
        ctx.fillStyle = coneGrad;
        ctx.fill();
        
        ctx.strokeStyle = 'rgba(0, 255, 224, 0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        
        ctx.beginPath();
        ctx.moveTo(points[points.length - 1].x, points[points.length - 1].yPrice);
        forecastPoints.forEach(pt => ctx.lineTo(pt.x, pt.yUpper));
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(points[points.length - 1].x, points[points.length - 1].yPrice);
        forecastPoints.forEach(pt => ctx.lineTo(pt.x, pt.yLower));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw main price line
      ctx.beginPath();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = isBullish ? '#10B981' : '#EF4444';
      points.forEach((pt, idx) => {
        if (idx === 0) {
          ctx.moveTo(pt.x, pt.yPrice);
        } else {
          ctx.lineTo(pt.x, pt.yPrice);
        }
      });
      ctx.stroke();

      // Fill area under price line
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].yPrice);
      points.forEach((pt) => {
        ctx.lineTo(pt.x, pt.yPrice);
      });
      ctx.lineTo(points[points.length - 1].x, topMargin + chartHeight);
      ctx.lineTo(points[0].x, topMargin + chartHeight);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, topMargin, 0, topMargin + chartHeight);
      grad.addColorStop(0, isBullish ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fill();

      // Draw forecast prediction path (Dotted neon line)
      if (hasForecast) {
        ctx.beginPath();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#00FFE0';
        ctx.setLineDash([4, 4]);
        ctx.moveTo(points[points.length - 1].x, points[points.length - 1].yPrice);
        forecastPoints.forEach(pt => {
          ctx.lineTo(pt.x, pt.yPrice);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw highlighting points
      if (activePoint) {
        ctx.beginPath();
        ctx.arc(activePoint.x, activePoint.yPrice, 6, 0, 2 * Math.PI);
        ctx.fillStyle = activePoint.isForecast ? '#00FFE0' : (isBullish ? '#10B981' : '#EF4444');
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = activeTheme === 'dark' ? '#05070B' : '#ffffff';
        ctx.stroke();

        // Regression Point
        if (activePoint.regressionVal !== undefined) {
          ctx.beginPath();
          ctx.arc(activePoint.x, activePoint.yRegression, 5, 0, 2 * Math.PI);
          ctx.fillStyle = '#F59E0B';
          ctx.fill();
          ctx.stroke();
        }

        if (!activePoint.isForecast) {
          // SMA20 Point
          ctx.beginPath();
          ctx.arc(activePoint.x, activePoint.ySma20, 5, 0, 2 * Math.PI);
          ctx.fillStyle = '#0284C7';
          ctx.fill();
          ctx.stroke();

          // SMA50 Point
          ctx.beginPath();
          ctx.arc(activePoint.x, activePoint.ySma50, 5, 0, 2 * Math.PI);
          ctx.fillStyle = '#D946EF';
          ctx.fill();
          ctx.stroke();
        }
      } else {
        const lastPt = points[points.length - 1];
        ctx.beginPath();
        ctx.arc(lastPt.x, lastPt.yPrice, 5, 0, 2 * Math.PI);
        ctx.fillStyle = isBullish ? '#10B981' : '#EF4444';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = activeTheme === 'dark' ? '#05070B' : '#ffffff';
        ctx.stroke();

        if (hasForecast) {
          const targetPt = forecastPoints[forecastPoints.length - 1];
          ctx.beginPath();
          ctx.arc(targetPt.x, targetPt.yPrice, 6, 0, 2 * Math.PI);
          ctx.fillStyle = '#00FFE0';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = activeTheme === 'dark' ? '#05070B' : '#ffffff';
          ctx.stroke();
        }
      }

      // Draw Legend in header zone
      ctx.font = "10px Outfit";
      ctx.textAlign = "left";
      
      // Price Legend
      ctx.fillStyle = isBullish ? '#10B981' : '#EF4444';
      ctx.fillRect(leftMargin, 15, 10, 6);
      ctx.fillStyle = canvasTextLight;
      ctx.fillText("Price (Hist)", leftMargin + 15, 21);

      // SMA20 Legend
      ctx.fillStyle = '#0284C7';
      ctx.fillRect(leftMargin + 80, 15, 10, 6);
      ctx.fillStyle = canvasTextLight;
      ctx.fillText("SMA(20)", leftMargin + 95, 21);

      // SMA50 Legend
      ctx.fillStyle = '#D946EF';
      ctx.fillRect(leftMargin + 145, 15, 10, 6);
      ctx.fillStyle = canvasTextLight;
      ctx.fillText("SMA(50)", leftMargin + 160, 21);

      // Forecast Legend
      if (hasForecast) {
        ctx.fillStyle = '#00FFE0';
        ctx.fillRect(leftMargin + 210, 15, 10, 6);
        ctx.fillStyle = canvasTextLight;
        ctx.fillText("AI Forecast", leftMargin + 225, 21);
      }

      // Regression Legend
      if (hasRegression) {
        ctx.fillStyle = '#F59E0B';
        ctx.fillRect(leftMargin + 285, 15, 10, 6);
        ctx.fillStyle = canvasTextLight;
        ctx.fillText(`Regression (R²: ${regression.r2})`, leftMargin + 300, 21);
      }
    }

    drawChartState(null);

    // Bind mouse event handlers
    canvasEl.onmousemove = (e) => {
      const bbox = canvasEl.getBoundingClientRect();
      const mouseX = e.clientX - bbox.left;
      
      let closestPoint = allPoints[0];
      let minDist = Math.abs(mouseX - allPoints[0].x);
      for (let i = 1; i < allPoints.length; i++) {
        const dist = Math.abs(mouseX - allPoints[i].x);
        if (dist < minDist) {
          minDist = dist;
          closestPoint = allPoints[i];
        }
      }

      if (closestPoint) {
        drawChartState(closestPoint);
        
        const tooltip = document.getElementById("chart-tooltip");
        if (tooltip) {
          tooltip.style.display = "block";
          tooltip.style.left = `${closestPoint.x + 15}px`;
          const tooltipWidth = 145;
          if (closestPoint.x + 15 + tooltipWidth > bbox.width) {
            tooltip.style.left = `${closestPoint.x - 15 - tooltipWidth}px`;
          }
          tooltip.style.top = `${Math.min(bbox.height - 100, Math.max(10, closestPoint.yPrice - 30))}px`;
          
          if (closestPoint.isForecast) {
            const daysAhead = closestPoint.dayIndex - (startIndex + 20);
            tooltip.innerHTML = `
              <div style="font-weight: 700; border-bottom: 1px dashed var(--border-glass); padding-bottom: 4px; margin-bottom: 4px; font-family: var(--font-display); color: #00FFE0;">AI Forecast (Day +${daysAhead})</div>
              <div style="display:flex; justify-content:space-between; gap:12px; font-family: var(--font-body);"><span>Proj Price:</span><span style="font-weight: 600; color: #00FFE0;">${formatCurrency(closestPoint.priceVal, currentTicker)}</span></div>
              ${closestPoint.regressionVal !== undefined ? `<div style="display:flex; justify-content:space-between; gap:12px; font-family: var(--font-body);"><span>Reg Price:</span><span style="font-weight: 600; color: #F59E0B;">${formatCurrency(closestPoint.regressionVal, currentTicker)}</span></div>` : ''}
              <div style="display:flex; justify-content:space-between; gap:12px; font-family: var(--font-body); font-size: 9px; color: var(--text-slate-dim);"><span>Confidence:</span><span>${parsedConfidence}%</span></div>
            `;
          } else {
            tooltip.innerHTML = `
              <div style="font-weight: 700; border-bottom: 1px dashed var(--border-glass); padding-bottom: 4px; margin-bottom: 4px; font-family: var(--font-display);">Day ${closestPoint.dayIndex}</div>
              <div style="display:flex; justify-content:space-between; gap:12px; font-family: var(--font-body);"><span>Price:</span><span style="font-weight: 600; color: ${isBullish ? 'var(--accent-green)' : 'var(--accent-red)'};">${formatCurrency(closestPoint.priceVal, currentTicker)}</span></div>
              ${closestPoint.regressionVal !== undefined ? `<div style="display:flex; justify-content:space-between; gap:12px; font-family: var(--font-body);"><span>Reg Trend:</span><span style="font-weight: 600; color: #F59E0B;">${formatCurrency(closestPoint.regressionVal, currentTicker)}</span></div>` : ''}
              <div style="display:flex; justify-content:space-between; gap:12px; font-family: var(--font-body);"><span>SMA(20):</span><span style="font-weight: 600; color: #0284C7;">${formatCurrency(closestPoint.sma20Val, currentTicker)}</span></div>
              <div style="display:flex; justify-content:space-between; gap:12px; font-family: var(--font-body);"><span>SMA(50):</span><span style="font-weight: 600; color: #D946EF;">${formatCurrency(closestPoint.sma50Val, currentTicker)}</span></div>
            `;
          }
        }
      }
    };

    canvasEl.onmouseleave = () => {
      const tooltip = document.getElementById("chart-tooltip");
      if (tooltip) {
        tooltip.style.display = "none";
      }
      drawChartState(null);
    };
  }
});
