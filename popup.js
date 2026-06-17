// popup.js - ALPHA Extension Dashboard Controller

document.addEventListener("DOMContentLoaded", () => {
  // Safety toFixed wrapper to prevent null/undefined property exceptions
  function safeToFixed(value, fractionDigits = 2) {
    if (value === undefined || value === null || isNaN(Number(value))) {
      return "0.00";
    }
    return Number(value).toFixed(fractionDigits);
  }

  const watchlistContainer = document.getElementById("watchlist-container");
  const searchInput = document.getElementById("popup-search-input");
  const searchBtn = document.getElementById("popup-search-btn");
  
  const analysisPanel = document.getElementById("popup-analysis-panel");
  const closeAnalysisBtn = document.getElementById("close-analysis-btn");
  const analysisTickerTitle = document.getElementById("analysis-ticker-title");
  const analysisBody = document.getElementById("analysis-body");
  
  const openSettingsBtn = document.getElementById("open-settings");
  const themeToggleBtn = document.getElementById("popup-theme-toggle");

  // Tab navigation elements
  const tabBtnWatchlist = document.getElementById("tab-btn-watchlist");
  const tabBtnIntraday = document.getElementById("tab-btn-intraday");
  const tabBtnScanner = document.getElementById("tab-btn-scanner");
  const tabBtnPortfolio = document.getElementById("tab-btn-portfolio");
  const tabBtnHistory = document.getElementById("tab-btn-history");
  const tabBtnChat = document.getElementById("tab-btn-chat");
  const panelWatchlist = document.getElementById("panel-watchlist");
  const panelIntraday = document.getElementById("panel-intraday");
  const panelScanner = document.getElementById("panel-scanner");
  const panelPortfolio = document.getElementById("panel-portfolio");
  const panelHistory = document.getElementById("panel-history");
  const panelChat = document.getElementById("panel-chat");
  const scannerContainer = document.getElementById("scanner-container");
  const scannerRefreshBtn = document.getElementById("scanner-refresh-btn");
  const scannerAutoBtn = document.getElementById("scanner-auto-btn");
  
  // Intraday elements
  const intradayContainer = document.getElementById("intraday-container");
  const intradaySearchInput = document.getElementById("intraday-search-input");
  const intradaySearchBtn = document.getElementById("intraday-search-btn");
  const intradayRefreshBtn = document.getElementById("intraday-refresh-btn");
  const intradayAutoBtn = document.getElementById("intraday-auto-btn");
  const historyContainer = document.getElementById("history-container");
  const historyClearBtn = document.getElementById("history-clear-btn");
  
  // Portfolio elements
  const portfolioContainer = document.getElementById("portfolio-container");
  const portfolioSearchInput = document.getElementById("portfolio-search-input");
  const portfolioSearchBtn = document.getElementById("portfolio-search-btn");
  const portfolioSearchLoading = document.getElementById("portfolio-search-loading");
  const portfolioSearchError = document.getElementById("portfolio-search-error");
  const portfolioQuickAddCard = document.getElementById("portfolio-quick-add-card");
  const quickAddTicker = document.getElementById("quick-add-ticker");
  const quickAddCurrentPrice = document.getElementById("quick-add-current-price");
  const quickAddQty = document.getElementById("quick-add-qty");
  const quickAddPrice = document.getElementById("quick-add-price");
  const quickAddConfirmBtn = document.getElementById("quick-add-confirm-btn");
  const portfolioTotalValue = document.getElementById("portfolio-total-value");
  const portfolioTotalPnl = document.getElementById("portfolio-total-pnl");
  
  // Portfolio alerts & custom price alert elements
  const portfolioAlertsSection = document.getElementById("portfolio-alerts-section");
  const portfolioAlertsContainer = document.getElementById("portfolio-alerts-container");
  const portfolioAlertsClearBtn = document.getElementById("portfolio-alerts-clear-btn");
  const alertTickerInput = document.getElementById("alert-ticker-input");
  const alertConditionSelect = document.getElementById("alert-condition-select");
  const alertPriceInput = document.getElementById("alert-price-input");
  const alertAddBtn = document.getElementById("alert-add-btn");
  const priceAlertsContainer = document.getElementById("price-alerts-container");
  
  const chatMessages = document.getElementById("chat-messages");
  const chatUserInput = document.getElementById("chat-user-input");
  const chatSendBtn = document.getElementById("chat-send-btn");
  const chatClearBtn = document.getElementById("chat-clear-btn");
  const chatMicBtn = document.getElementById("chat-mic-btn");
  const chatChipsContainer = document.getElementById("chat-chips-container");
  const scannerFilterChips = document.getElementById("scanner-filter-chips");

  let activeTheme = 'light';
  let currentScanData = null;
  let currentScannerFilter = 'all';

  // Keyboard shortcut: Escape closes analysis panel
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && analysisPanel.style.display === "block") {
      analysisPanel.style.display = "none";
      renderWatchlist();
    }
  });

  // Load and apply theme and watchlist on startup
  initializeDashboard();

  async function initializeDashboard() {
    chrome.storage.local.get(["settings"], (res) => {
      const settings = res.settings || {};
      activeTheme = settings.theme || 'light';
      applyTheme(activeTheme);
      setupTabs();
      renderWatchlist();
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

  // Bind Theme Toggle click
  themeToggleBtn.addEventListener("click", () => {
    chrome.storage.local.get(["settings"], (res) => {
      const settings = res.settings || {};
      const newTheme = settings.theme === 'dark' ? 'light' : 'dark';
      settings.theme = newTheme;
      chrome.storage.local.set({ settings }, () => {
        activeTheme = newTheme;
        applyTheme(newTheme);
        // Re-render to update sparkline colors if necessary
        renderWatchlist();
        if (panelScanner.classList.contains("active")) {
          runMarketScan();
        }
      });
    });
  });

  // Setup tabs
  function setupTabs() {
    const allTabBtns = [tabBtnWatchlist, tabBtnIntraday, tabBtnScanner, tabBtnPortfolio, tabBtnHistory, tabBtnChat];
    const allPanels = [panelWatchlist, panelIntraday, panelScanner, panelPortfolio, panelHistory, panelChat];

    function switchTab(activeBtn, activePanel, callback) {
      allTabBtns.forEach(b => b.classList.remove("active"));
      allPanels.forEach(p => p.classList.remove("active"));
      activeBtn.classList.add("active");
      activePanel.classList.add("active");
      if (callback) callback();
    }

    tabBtnWatchlist.addEventListener("click", () => switchTab(tabBtnWatchlist, panelWatchlist, renderWatchlist));

    tabBtnIntraday.addEventListener("click", () => switchTab(tabBtnIntraday, panelIntraday, () => {
      if (!currentIntradayTicker) {
        currentIntradayTicker = "^NSEI"; // default to Nifty 50
        runIntradayAnalysis();
      }
    }));

    tabBtnScanner.addEventListener("click", () => switchTab(tabBtnScanner, panelScanner, () => {
      chrome.storage.local.get(["marketScanCache"], (res) => {
        if (res.marketScanCache) renderScannerItems(res.marketScanCache);
        else runMarketScan();
      });
    }));

    tabBtnPortfolio.addEventListener("click", () => switchTab(tabBtnPortfolio, panelPortfolio, renderPortfolio));
    tabBtnHistory.addEventListener("click", () => switchTab(tabBtnHistory, panelHistory, renderHistory));
    tabBtnChat.addEventListener("click", () => switchTab(tabBtnChat, panelChat, renderChat));

    historyClearBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "CLEAR_HISTORY" }, (res) => {
        if (res && res.success) renderHistory();
      });
    });

    scannerRefreshBtn.addEventListener("click", runMarketScan);
    
    // Auto Refresh Logic
    let scannerAutoRefreshInterval = null;
    scannerAutoBtn.addEventListener("click", () => {
      if (scannerAutoRefreshInterval) {
        clearInterval(scannerAutoRefreshInterval);
        scannerAutoRefreshInterval = null;
        scannerAutoBtn.textContent = "Auto: OFF";
        scannerAutoBtn.classList.replace("primary", "secondary");
      } else {
        runMarketScan();
        scannerAutoRefreshInterval = setInterval(() => {
          if (panelScanner.classList.contains("active")) runMarketScan();
        }, 60000); // 1 minute
        scannerAutoBtn.textContent = "Auto: ON";
        scannerAutoBtn.classList.replace("secondary", "primary");
      }
    });

    intradaySearchBtn.addEventListener("click", () => {
      currentIntradayTicker = intradaySearchInput.value.trim().toUpperCase();
      runIntradayAnalysis();
    });
    intradaySearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        currentIntradayTicker = intradaySearchInput.value.trim().toUpperCase();
        runIntradayAnalysis();
      }
    });
    intradayRefreshBtn.addEventListener("click", runIntradayAnalysis);

    let intradayAutoRefreshInterval = null;
    intradayAutoBtn.addEventListener("click", () => {
      if (intradayAutoRefreshInterval) {
        clearInterval(intradayAutoRefreshInterval);
        intradayAutoRefreshInterval = null;
        intradayAutoBtn.textContent = "Auto: OFF";
        intradayAutoBtn.classList.replace("primary", "secondary");
      } else {
        if (!currentIntradayTicker) currentIntradayTicker = "^NSEI";
        runIntradayAnalysis();
        intradayAutoRefreshInterval = setInterval(() => {
          if (panelIntraday.classList.contains("active")) runIntradayAnalysis();
        }, 60000);
        intradayAutoBtn.textContent = "Auto: ON";
        intradayAutoBtn.classList.replace("secondary", "primary");
      }
    });
    
    // Bind chat events
    chatSendBtn.addEventListener("click", submitChatMessage);
    chatUserInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitChatMessage();
    });
    chatClearBtn.addEventListener("click", clearChatHistory);
    if (chatMicBtn) chatMicBtn.addEventListener("click", toggleVoiceInput);
    
    // Suggestion chips handler
    if (chatChipsContainer) {
      chatChipsContainer.querySelectorAll(".chat-chip").forEach(chip => {
        chip.addEventListener("click", () => {
          chatUserInput.value = chip.getAttribute("data-query");
          submitChatMessage();
        });
      });
    }

    // Live Scanner Category Filter Chips Handler
    if (scannerFilterChips) {
      scannerFilterChips.querySelectorAll(".chat-chip").forEach(chip => {
        chip.addEventListener("click", () => {
          scannerFilterChips.querySelectorAll(".chat-chip").forEach(c => c.classList.remove("active"));
          chip.classList.add("active");
          currentScannerFilter = chip.getAttribute("data-filter");
          if (currentScanData) {
            renderFilteredScannerItems(currentScanData, currentScannerFilter);
          }
        });
      });
    }

    // Portfolio search button and confirm handlers
    portfolioSearchBtn.addEventListener("click", searchPortfolioAsset);
    portfolioSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") searchPortfolioAsset();
    });
    quickAddConfirmBtn.addEventListener("click", confirmQuickAddPosition);

    // Price Alert add button handler
    alertAddBtn.addEventListener("click", addPriceAlert);
    
    // Portfolio alerts clear handler
    portfolioAlertsClearBtn.addEventListener("click", clearPortfolioAlerts);
  }

  // Settings redirect
  openSettingsBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('settings.html'));
    }
  });

  // Close Analysis View
  closeAnalysisBtn.addEventListener("click", () => {
    analysisPanel.style.display = "none";
    renderWatchlist();
  });

  // Search Scan Handlers
  const executeScan = () => {
    const ticker = searchInput.value.trim().toUpperCase();
    if (ticker) {
      triggerAnalysis(ticker);
      searchInput.value = "";
    }
  };

  searchBtn.addEventListener("click", executeScan);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") executeScan();
  });

  // Format currency based on NSE/BSE exchange suffix
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

  let currentIntradayTicker = "";
  
  const runIntradayAnalysis = () => {
    const ticker = currentIntradayTicker || "^NSEI";
    currentIntradayTicker = ticker;
    
    intradayContainer.innerHTML = `
      <div class="loading-pulse" style="height: 120px;">
        <div class="loading-spinner" style="width:20px; height:20px; border-width:2px;"></div>
        <div style="font-size:11px;">Fetching live intraday data for ${ticker}...</div>
      </div>
    `;

    chrome.runtime.sendMessage({ action: "FETCH_ASSET", ticker, forceRefresh: true }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        intradayContainer.innerHTML = `<div class="empty-state" style="color:var(--accent-red);">Intraday fetch failed for ${ticker}.</div>`;
        return;
      }
      renderIntradayData(response.data);
    });
  };

  function renderIntradayData(data) {
    if (!data.quant || !data.quant.intraday) {
      intradayContainer.innerHTML = `<div class="empty-state">No intraday data available for ${data.ticker}.</div>`;
      return;
    }
    
    const ind = data.quant.intraday;
    const price = data.quant.currentPrice;
    
    let vwapClass = price > ind.vwap ? "positive" : "negative";
    let stochClass = ind.stochasticK > 80 ? "negative" : (ind.stochasticK < 20 ? "positive" : "neutral");
    let obvClass = ind.obv > 0 ? "positive" : "negative";
    
    let actionSignal = "HOLD / CONSOLIDATE";
    let actionColor = "var(--text-slate-light)";
    if (price > ind.vwap && ind.obv > 0 && ind.stochasticK < 80) { actionSignal = "BUY / ACCUMULATE"; actionColor = "var(--accent-cyan-glow)"; }
    else if (price < ind.vwap && ind.obv < 0 && ind.stochasticK > 20) { actionSignal = "SELL / DISTRIBUTE"; actionColor = "var(--accent-magenta-neon)"; }

    intradayContainer.innerHTML = `
      <div class="glass-card" style="padding:12px; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:16px; font-weight:700; color:var(--text-slate-light);">${data.ticker}</div>
            <div style="font-size:12px; color:var(--text-slate-dim);">Live Spot: <span style="font-weight:700; color:var(--text-slate-light);">${formatCurrency(price, data.ticker)}</span></div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:9px; color:var(--text-slate-dim); text-transform:uppercase;">Intraday Action</div>
            <div style="font-size:14px; font-weight:700; color:${actionColor};">${actionSignal}</div>
          </div>
        </div>
      </div>
      
      <div class="grid-2" style="gap:10px;">
        <div class="glass-card" style="padding:10px; text-align:center;">
          <div style="font-size:9px; color:var(--text-slate-dim);">VWAP</div>
          <div style="font-size:14px; font-weight:700;" class="${vwapClass}">${formatCurrency(ind.vwap, data.ticker)}</div>
          <div style="font-size:9px; color:var(--text-slate-dim); margin-top:4px;">${price > ind.vwap ? 'Bullish' : 'Bearish'} (vs Spot)</div>
        </div>
        <div class="glass-card" style="padding:10px; text-align:center;">
          <div style="font-size:9px; color:var(--text-slate-dim);">Stochastic %K</div>
          <div style="font-size:14px; font-weight:700;" class="${stochClass}">${ind.stochasticK.toFixed(2)}</div>
          <div style="font-size:9px; color:var(--text-slate-dim); margin-top:4px;">${ind.stochasticK > 80 ? 'Overbought' : (ind.stochasticK < 20 ? 'Oversold' : 'Neutral')}</div>
        </div>
        <div class="glass-card" style="padding:10px; text-align:center; grid-column: span 2;">
          <div style="font-size:9px; color:var(--text-slate-dim);">On-Balance Volume (Trend)</div>
          <div style="font-size:14px; font-weight:700;" class="${obvClass}">${ind.obv.toLocaleString()}</div>
          <div style="font-size:9px; color:var(--text-slate-dim); margin-top:4px;">${ind.obv > 0 ? 'Net Accumulation' : 'Net Distribution'}</div>
        </div>
      </div>
      
      <div class="glass-card" style="padding:10px; margin-top:10px;">
        <div style="font-size:9px; color:var(--text-slate-dim); text-transform:uppercase; margin-bottom:6px;">Intraday Price Action</div>
        <canvas id="intraday-sparkline" class="sparkline-canvas" width="300" height="40" style="width:100%; height:40px;"></canvas>
      </div>
    `;
    
    // Draw Intraday Sparkline
    if (ind.intradayPrices && ind.intradayPrices.length > 0) {
      const canvas = document.getElementById("intraday-sparkline");
      drawSparkline(canvas, ind.intradayPrices, price >= ind.intradayPrices[0]);
    }
  }

  // Markdown parser
  function parseMarkdown(text) {
    if (!text) return "";
    let escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return escaped.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  }

  // Render Scan History Logs
  function renderHistory() {
    historyContainer.innerHTML = `
      <div class="loading-pulse" style="height: 100px;">
        <div class="loading-spinner" style="width:20px; height:20px; border-width:2px;"></div>
      </div>
    `;

    chrome.runtime.sendMessage({ action: "GET_HISTORY" }, (response) => {
      if (chrome.runtime.lastError) {
        historyContainer.innerHTML = `<div class="empty-state">Failed to load history: ${chrome.runtime.lastError.message}</div>`;
        return;
      }
      if (!response || !response.success) {
        historyContainer.innerHTML = `<div class="empty-state">Failed to load history</div>`;
        return;
      }

      const history = response.history || [];
      if (history.length === 0) {
        historyContainer.innerHTML = `<div class="empty-state">No scan history recorded.</div>`;
        return;
      }

      historyContainer.innerHTML = "";
      history.forEach(item => {
        const row = document.createElement("div");
        row.className = "watchlist-item";
        row.style.padding = "8px 10px";

        let scoreClass = "neutral";
        if (item.fScore >= 0.85) scoreClass = "bullish";
        else if (item.fScore <= 0.15) scoreClass = "bearish";

        const isPos = item.changePercent >= 0;
        const changeSign = isPos ? "+" : "";
        const changeClass = isPos ? "positive" : "negative";

        const priceText = formatCurrency(item.price, item.ticker);
        const cleanTicker = item.ticker.split(".")[0];
        
        // Display time
        const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        row.innerHTML = `
          <div class="watchlist-left">
            <span class="watchlist-ticker" style="font-size:13px; font-weight:700;">
              ${cleanTicker} <span style="font-size:9px; font-weight:400; color:var(--text-slate-dim);">(${timeStr})</span>
            </span>
            <div style="display:flex; align-items:baseline;">
              <span class="watchlist-item-price" style="font-size:12px; font-weight:600; color:var(--text-slate-light);">${priceText}</span>
              <span class="asset-change ${changeClass}" style="font-size:10px; font-weight:600; margin-left:4px;">${changeSign}${safeToFixed(item.changePercent, 2)}%</span>
            </div>
          </div>
          
          <div class="watchlist-right">
            <span class="watchlist-score-tag ${scoreClass}">${safeToFixed(item.fScore, 2)}</span>
            <button class="history-scan-btn secondary" style="padding:4px 6px; font-size:10px; font-weight:700;" data-ticker="${item.ticker}">Scan</button>
            <button class="btn-icon history-delete-btn" data-ticker="${item.ticker}" title="Remove Log" style="padding:2px 4px; font-size:14px;">&times;</button>
          </div>
        `;

        row.querySelector(".history-scan-btn").addEventListener("click", () => {
          triggerAnalysis(item.ticker);
        });

        row.querySelector(".history-delete-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          chrome.runtime.sendMessage({ action: "REMOVE_HISTORY_ITEM", ticker: item.ticker }, () => {
            if (chrome.runtime.lastError) {
              console.warn("Remove history item failed:", chrome.runtime.lastError.message);
            }
            renderHistory();
          });
        });

        historyContainer.appendChild(row);
      });
    });
  }

  // Draw sparkline on canvas
  function drawSparkline(canvas, prices, isBullish) {
    if (!canvas || !prices || prices.length < 2) return;
    const sliced = prices.slice(-20);
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const min = Math.min(...sliced);
    const max = Math.max(...sliced);
    const range = max - min === 0 ? 1 : max - min;

    ctx.beginPath();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = isBullish ? '#10B981' : '#EF4444'; // Green or Red
    
    for (let i = 0; i < sliced.length; i++) {
      const x = (i / (sliced.length - 1)) * width;
      const y = height - ((sliced[i] - min) / range) * height;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Fill area under sparkline
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, isBullish ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Load and render Watchlist from local storage & cache
  async function renderWatchlist() {
    chrome.runtime.sendMessage({ action: "GET_WATCHLIST" }, async (response) => {
      if (chrome.runtime.lastError) {
        watchlistContainer.innerHTML = `<div class="empty-state">Failed to load watchlist: ${chrome.runtime.lastError.message}</div>`;
        return;
      }
      if (!response || !response.success) {
        watchlistContainer.innerHTML = `<div class="empty-state">Failed to load watchlist</div>`;
        return;
      }

      const list = response.list || [];
      if (list.length === 0) {
        watchlistContainer.innerHTML = `<div class="empty-state">No assets in watchlist. Run a search to populate.</div>`;
        return;
      }

      const cacheKeys = list.map(ticker => `cache_${ticker}`);
      chrome.storage.local.get(cacheKeys, (caches) => {
        watchlistContainer.innerHTML = "";
        
        list.forEach(ticker => {
          const cached = caches[`cache_${ticker}`];
          const item = document.createElement("div");
          item.className = "watchlist-item";
          item.style.padding = "8px 10px";

          let scoreText = "--";
          let scoreClass = "neutral";
          let priceText = "No data";
          let changeHTML = "";
          let cleanTicker = ticker.split(".")[0];
          const sparkCanvasId = `watchlist-spark-${ticker.replace(/\./g, '_')}`;

          if (cached) {
            scoreText = safeToFixed(cached.fScore, 2);
            priceText = formatCurrency(cached.quant?.currentPrice, ticker);
            if (cached.fScore >= 0.85) scoreClass = "bullish";
            else if (cached.fScore <= 0.15) scoreClass = "bearish";
            
            const isPos = cached.quant?.priceChange >= 0;
            const changeSign = isPos ? "+" : "";
            const changeClass = isPos ? "positive" : "negative";
            changeHTML = `<span class="asset-change ${changeClass}" style="font-size:10px; font-weight:600; margin-left:4px;">${changeSign}${safeToFixed(cached.quant?.priceChangePercent, 2)}%</span>`;
          }

          item.innerHTML = `
            <div class="watchlist-left">
              <span class="watchlist-ticker" style="font-size:13px; font-weight:700;">${cleanTicker} <span style="font-size:9px; font-weight:400; color:var(--text-slate-dim);">(${ticker})</span></span>
              <div style="display:flex; align-items:baseline;">
                <span class="watchlist-item-price" style="font-size:12px; font-weight:600; color:var(--text-slate-light);">${priceText}</span>
                ${changeHTML}
              </div>
            </div>
            
            <div class="sparkline-container" style="width:70px; margin:0 6px;">
              <canvas id="${sparkCanvasId}" class="sparkline-canvas" width="70" height="24"></canvas>
            </div>
            
            <div class="watchlist-right">
              <span class="watchlist-score-tag ${scoreClass}">${scoreText}</span>
              <button class="watchlist-scan-btn secondary" style="padding:4px 6px; font-size:10px; font-weight:700;" data-ticker="${ticker}">Scan</button>
              <button class="btn-icon delete-btn" data-ticker="${ticker}" title="Remove Ticker" style="padding:2px 4px; font-size:14px;">&times;</button>
            </div>
          `;

          item.querySelector(".watchlist-scan-btn").addEventListener("click", () => {
            triggerAnalysis(ticker);
          });

          item.querySelector(".delete-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            chrome.runtime.sendMessage({ action: "REMOVE_WATCHLIST", ticker }, () => {
              if (chrome.runtime.lastError) {
                console.warn("Remove watchlist item failed:", chrome.runtime.lastError.message);
              }
              renderWatchlist();
            });
          });

          watchlistContainer.appendChild(item);

          // Draw sparkline if cache contains data
          if (cached && cached.quant.prices) {
            const canvas = document.getElementById(sparkCanvasId);
            drawSparkline(canvas, cached.quant.prices, cached.fScore >= 0.70 || cached.quant.priceChangePercent >= 0);
          }
        });
      });
    });
  }

  // Market Scanner Execution logic
  function runMarketScan() {
    scannerContainer.innerHTML = `
      <div class="loading-pulse" style="height: 120px;">
        <div class="loading-spinner" style="width:20px; height:20px; border-width:2px;"></div>
        <div style="font-size:11px;">Auditing top equities in real-time...</div>
      </div>
    `;

    chrome.runtime.sendMessage({ action: "SCAN_MARKET" }, (response) => {
      if (chrome.runtime.lastError) {
        scannerContainer.innerHTML = `<div class="empty-state" style="color:var(--accent-red);">Scan failed: ${chrome.runtime.lastError.message}</div>`;
        return;
      }
      if (response && response.success) {
        renderScannerItems(response.results);
      } else {
        scannerContainer.innerHTML = `<div class="empty-state" style="color:var(--accent-red);">Scan failed: ${response ? response.error : "Unknown error"}</div>`;
      }
    });
  }

  function renderScannerItems(scanData) {
    currentScanData = scanData;
    if (scannerFilterChips) {
      scannerFilterChips.style.display = scanData ? "flex" : "none";
    }
    renderFilteredScannerItems(scanData, currentScannerFilter);
  }

  function renderFilteredScannerItems(scanData, filter) {
    scannerContainer.innerHTML = "";
    
    if (!scanData) {
      scannerContainer.innerHTML = `<div class="empty-state">No dynamic scan data available. Click 'Scan Now'.</div>`;
      return;
    }

    const { timestamp, buys, sells, others, failures } = scanData;

    // Build timestamp note
    if (timestamp) {
      const timeStr = new Date(timestamp).toLocaleTimeString();
      const infoText = document.createElement("div");
      infoText.style.cssText = "font-size:9px; color:var(--text-slate-dim); text-align:right; margin-bottom:8px;";
      infoText.textContent = `Last scanned: ${timeStr}`;
      scannerContainer.appendChild(infoText);
    }

    // Helper to render a filtered category list
    function renderList(title, list, isFilteredCategory = false) {
      if (!list || list.length === 0) {
        if (!isFilteredCategory) return;
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "No stocks matching this filter.";
        scannerContainer.appendChild(empty);
        return;
      }

      if (title) {
        const header = document.createElement("div");
        // Use standard buy/sell/neutral colors for headers
        let headerColorClass = "neutral";
        if (filter === 'all') {
          if (title.includes("Buy")) headerColorClass = "buy";
          else if (title.includes("Sell")) headerColorClass = "sell";
        }
        header.className = `suggestion-header ${headerColorClass}`;
        header.innerHTML = `<span class="suggestion-header-dot"></span> ${title} (${list.length})`;
        scannerContainer.appendChild(header);
      }

      const groupDiv = document.createElement("div");
      groupDiv.className = "suggestion-group";

      list.forEach((item, index) => {
        const cleanTicker = item.ticker.split(".")[0];
        const isPos = item.changePercent >= 0;
        const changeClass = isPos ? "positive" : "negative";
        const changeSign = isPos ? "+" : "";
        
        const priceFormatted = formatCurrency(item.price, item.ticker);
        const changeFormatted = `${changeSign}${safeToFixed(item.changePercent, 2)}%`;
        
        const canvasId = `spark-pop-${filter}-${index}`;

        // Determine recommendation status badge dynamically
        let badgeHTML = "";
        let recText = "HOLD";
        let recColorClass = "badge-neutral";
        
        const score = item.hasAI ? item.fScore : (item.S_quant !== undefined ? item.S_quant : (item.smaStatus === "Strong Bullish Alignment" ? 1.0 : (item.smaStatus === "Strong Bearish Alignment" ? 0.0 : 0.5)));
        
        if (score >= 0.70) {
          recText = "BUY";
          recColorClass = "badge-bullish";
        } else if (score <= 0.30) {
          recText = "SELL";
          recColorClass = "badge-bearish";
        }
        
        const scoreLabel = item.hasAI ? `F:${safeToFixed(item.fScore, 2)}` : `Q:${safeToFixed(score, 2)}`;
        badgeHTML = `<span class="badge ${recColorClass}" style="padding:2px 4px; font-size:9px; font-weight:700;">${recText} [${scoreLabel}]</span>`;

        let crossoverBadgeHTML = "";
        if (item.crossover && item.crossover !== "None") {
          const crossClass = item.crossover === "Golden Cross" ? "badge-bullish" : "badge-bearish";
          crossoverBadgeHTML = `<span class="badge ${crossClass}" style="padding:1px 3px; font-size:8px; margin-left:4px;">${item.crossover}</span>`;
        }

        let pivotPointsHTML = "";
        if (item.pivotPoints) {
          pivotPointsHTML = `
            <div style="border-top:1px dashed var(--border-glass); padding-top:4px; margin-top:2px; display:flex; justify-content:space-between; font-size:8px; color:var(--text-slate-dim);">
              <span>PP: <strong style="color:var(--text-slate-light);">${formatCurrency(item.pivotPoints.pp, item.ticker)}</strong></span>
              <span>S1: <strong style="color:var(--accent-red);">${formatCurrency(item.pivotPoints.s1, item.ticker)}</strong></span>
              <span>R1: <strong style="color:var(--accent-green);">${formatCurrency(item.pivotPoints.r1, item.ticker)}</strong></span>
            </div>
          `;
        }

        const card = document.createElement("div");
        card.className = "asset-row-expandable";
        card.innerHTML = `
          <div class="asset-row-header" style="padding: 6px 8px;">
            <div class="asset-info">
              <div class="asset-name" style="font-size:11px; font-weight:700;">
                ${cleanTicker} <span style="font-size:8px; font-weight:400; color:var(--text-slate-dim);">(${item.ticker})</span>
              </div>
              <div class="asset-price-group">
                <span class="asset-price" style="font-size:10px; font-weight:600;">${priceFormatted}</span>
                <span class="asset-change ${changeClass}" style="font-size:9px; font-weight:600;">${changeFormatted}</span>
              </div>
            </div>
            
            <div class="sparkline-container" style="width:55px; margin:0 4px;">
              <canvas id="${canvasId}" class="sparkline-canvas" width="55" height="20"></canvas>
            </div>
            
            <div style="display:flex; align-items:center; gap:6px;">
              ${badgeHTML}
              <button class="primary scanner-popup-ai-btn" data-ticker="${item.ticker}" style="padding:3px 5px; font-size:8px; font-weight:700; border-radius:4px;">AI</button>
            </div>
          </div>
          <div class="asset-row-details" style="padding: 0 8px;">
            <div style="font-size:9px; display:flex; flex-direction:column; gap:3px; padding: 4px 0;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="color:var(--text-slate-dim);">SMA Status:</span>
                <span style="font-weight:600; color:var(--accent-cyan-glow); display:flex; align-items:center;">${item.smaStatus}${crossoverBadgeHTML}</span>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-slate-dim);">SMA(20):</span>
                <span>${formatCurrency(item.sma20, item.ticker)}</span>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span style="color:var(--text-slate-dim);">SMA(50):</span>
                <span>${formatCurrency(item.sma50, item.ticker)}</span>
              </div>
              ${pivotPointsHTML}
              ${item.hasAI ? `
              <div style="border-top:1px dashed var(--border-glass); padding-top:4px; margin-top:2px;">
                <div style="color:var(--accent-cyan-glow); font-weight:700; display:flex; justify-content:space-between;">
                  <span>5-Day Target:</span>
                  <span>${item.semantic.targetPrice}</span>
                </div>
                <div style="color:var(--text-slate-light); font-style:italic; margin-top:2px; line-height:1.3;">
                  "${parseMarkdown(item.semantic.summary)}"
                </div>
              </div>` : ''}
              <button class="secondary run-popup-ai-forecast-btn" data-ticker="${item.ticker}" style="width:100%; margin-top:4px; padding:3px; font-size:9px; font-weight:600;">
                ${item.hasAI ? 'Re-run Gemini Forecast' : 'AI Semantic Forecast'}
              </button>
            </div>
          </div>
        `;

        groupDiv.appendChild(card);

        // Draw sparkline
        const canvas = document.getElementById(canvasId);
        drawSparkline(canvas, item.prices, score >= 0.70 || item.changePercent >= 0);

        // Accordion expand
        const cardHeader = card.querySelector(".asset-row-header");
        const details = card.querySelector(".asset-row-details");
        cardHeader.addEventListener("click", (e) => {
          if (e.target.tagName === "BUTTON") return;
          details.classList.toggle("expanded");
        });
      });
      scannerContainer.appendChild(groupDiv);
    }

    // Map scanner results into a unified flat list with indicator flags
    const allItems = [
      ...(buys || []).map(x => ({ ...x, group: 'buy' })),
      ...(sells || []).map(x => ({ ...x, group: 'sell' })),
      ...(others || []).map(x => ({ ...x, group: 'neutral' }))
    ];

    if (filter === 'all') {
      // Grouped rendering matching original format
      renderList("Buy Suggestions", buys, false);
      renderList("Sell Suggestions", sells, false);
      renderList("Active Market Trends", others, false);
    } else {
      let filtered = [];
      let listTitle = "";

      if (filter === 'best') {
        listTitle = "🏆 Best Momentum Picks";
        filtered = allItems.filter(item => {
          const score = item.hasAI ? item.fScore : (item.S_quant !== undefined ? item.S_quant : (item.smaStatus === "Strong Bullish Alignment" ? 1.0 : 0.5));
          return score >= 0.70;
        });
        filtered.sort((a, b) => {
          const scoreA = a.hasAI ? a.fScore : (a.S_quant !== undefined ? a.S_quant : 0.5);
          const scoreB = b.hasAI ? b.fScore : (b.S_quant !== undefined ? b.S_quant : 0.5);
          return scoreB - scoreA || b.changePercent - a.changePercent;
        });
      } else if (filter === 'under100') {
        listTitle = "🪙 Budget Equities (Under 100)";
        filtered = allItems.filter(item => item.price < 100);
        filtered.sort((a, b) => b.changePercent - a.changePercent);
      } else if (filter === 'short') {
        listTitle = "⚡ Short-Term Breakouts";
        filtered = allItems.filter(item => item.smaStatus === "Strong Bullish Alignment" || item.changePercent > 1.5);
        filtered.sort((a, b) => b.changePercent - a.changePercent);
      } else if (filter === 'long') {
        listTitle = "📈 Long-Term Growth Compounds";
        filtered = allItems.filter(item => {
          const score = item.hasAI ? item.fScore : (item.S_quant !== undefined ? item.S_quant : 0.5);
          return score >= 0.60 || item.smaStatus === "Strong Bullish Alignment";
        });
        filtered.sort((a, b) => {
          const scoreA = a.hasAI ? a.fScore : (a.S_quant !== undefined ? a.S_quant : 0.5);
          const scoreB = b.hasAI ? b.fScore : (b.S_quant !== undefined ? b.S_quant : 0.5);
          return scoreB - scoreA;
        });
      } else if (filter === 'gainer') {
        listTitle = "🚀 Daily Top Gainers";
        filtered = allItems.filter(item => item.changePercent > 0);
        filtered.sort((a, b) => b.changePercent - a.changePercent);
      } else if (filter === 'loser') {
        listTitle = "📉 Daily Top Losers";
        filtered = allItems.filter(item => item.changePercent < 0);
        filtered.sort((a, b) => a.changePercent - b.changePercent);
      }

      renderList(listTitle, filtered, true);
    }

    // Render failures
    if (failures && failures.length > 0 && filter === 'all') {
      const errHeader = document.createElement("div");
      errHeader.className = "suggestion-header";
      errHeader.style.color = "var(--accent-red)";
      errHeader.textContent = "Failures & Rate Limits";
      scannerContainer.appendChild(errHeader);
      
      failures.forEach(f => {
        const div = document.createElement("div");
        div.className = "glass-card";
        div.style.cssText = "padding:6px; font-size:10px; margin-bottom:4px; border-color:rgba(239,68,68,0.2);";
        div.innerHTML = `<strong>${f.ticker}</strong>: <span style="color:var(--text-slate-dim);">${f.error}</span>`;
        scannerContainer.appendChild(div);
      });
    }

    // Bind AI buttons inside list
    scannerContainer.querySelectorAll(".scanner-popup-ai-btn, .run-popup-ai-forecast-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const ticker = e.target.getAttribute("data-ticker");
        const forceRefresh = e.target.classList.contains("run-popup-ai-forecast-btn") || e.target.classList.contains("scanner-popup-ai-btn");
        triggerAnalysis(ticker, forceRefresh);
      });
    });
  }



  // Trigger inline F-Score scan details in popup
  function triggerAnalysis(ticker, forceRefresh = false) {
    analysisPanel.style.display = "block";
    analysisTickerTitle.textContent = `Analysis // ${ticker}`;
    
    analysisBody.innerHTML = `
      <div class="loading-pulse" style="height: 120px;">
        <div class="loading-spinner" style="width:24px; height:24px; border-width:2.5px;"></div>
        <div style="font-size:11px;">Fetching quant-semantic forecasting matrix...</div>
      </div>
    `;

    chrome.runtime.sendMessage({ action: "FETCH_ASSET", ticker, forceRefresh }, (response) => {
      if (chrome.runtime.lastError) {
        renderPopupError(chrome.runtime.lastError.message);
        return;
      }
      if (response && response.success) {
        renderPopupAssetData(response.data);
      } else {
        const errorMsg = response ? response.error : "Failed to load asset details.";
        renderPopupError(errorMsg);
      }
    });
  }

  function renderPopupError(message) {
    analysisBody.innerHTML = `
      <div class="glass-card" style="border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.05); padding:12px;">
        <div style="color:var(--accent-red); font-size:13px; font-weight:600; margin-bottom:4px;">Execution Error</div>
        <div style="color:var(--text-slate-dim); font-size:12px;">${message}</div>
      </div>
    `;
  }

  function renderPopupAssetData(data) {
    const isBullish = data.fScore >= 0.85;
    const isBearish = data.fScore <= 0.15;
    let scoreColor = "var(--text-slate-light)";
    let pulseClass = "";
    
    if (isBullish) {
      scoreColor = "var(--accent-cyan-glow)";
      pulseClass = "pulse-cyan";
    } else if (isBearish) {
      scoreColor = "var(--accent-magenta-neon)";
      pulseClass = "pulse-magenta";
    }

    // Determine indicator badge classes
    const rsi = data.quant?.rsi || 50;
    const rsiClass = rsi >= 70 ? 'rsi-overbought' : rsi <= 30 ? 'rsi-oversold' : 'rsi-neutral';
    const macdHist = data.quant?.macd?.histogram || 0;
    const macdClass = macdHist > 0 ? 'macd-bull' : 'macd-bear';
    const volRatio = data.quant?.volumeProfile?.volumeRatio || 1;
    const volClass = volRatio > 1.3 ? 'volume-high' : 'volume-normal';

    const radius = 32;
    const circumference = 2 * Math.PI * radius; // 201.06
    const offset = circumference - (data.fScore * circumference);

    const sentiment = data.semantic.sentiment.toUpperCase();
    let badgeHTML = `<span class="badge badge-neutral">Neutral</span>`;
    if (sentiment === 'BULLISH') {
      badgeHTML = `<span class="badge badge-bullish">Bullish</span>`;
    } else if (sentiment === 'BEARISH') {
      badgeHTML = `<span class="badge badge-bearish">Bearish</span>`;
    }

    const displayTarget = data.semantic.targetPrice.startsWith('$') || data.semantic.targetPrice.startsWith('₹') 
      ? data.semantic.targetPrice 
      : (isNaN(parseFloat(data.semantic.targetPrice)) ? data.semantic.targetPrice : formatCurrency(parseFloat(data.semantic.targetPrice), data.ticker));

    // Calculate prediction percentage offset
    let targetPercentHTML = "";
    const parsedTarget = parseFloat(data.semantic.targetPrice.replace(/[^\d.-]/g, ''));
    if (!isNaN(parsedTarget) && data.quant && data.quant.currentPrice) {
      const diffPercent = ((parsedTarget - data.quant.currentPrice) / data.quant.currentPrice) * 100;
      const tColor = diffPercent >= 0 ? "var(--accent-cyan-glow)" : "var(--accent-magenta-neon)";
      const sign = diffPercent >= 0 ? "+" : "";
      targetPercentHTML = `<span style="font-size:10px; margin-left:6px; color:${tColor}; font-weight:600;">(${sign}${diffPercent.toFixed(2)}%)</span>`;
    }

    // Render detailed forecast parameters inside popup body
    analysisBody.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px;">
        <!-- Gauge Header -->
        <div class="glass-card ${pulseClass}" style="display:flex; align-items:center; gap:16px; padding:12px;">
          <div class="fscore-gauge" style="width:70px; height:70px; flex-shrink:0;">
            <svg viewBox="0 0 70 70">
              <circle class="bg-circle" cx="35" cy="35" r="${radius}"></circle>
              <circle class="progress-circle" cx="35" cy="35" r="${radius}" 
                      style="stroke: ${scoreColor}; stroke-dashoffset: ${offset}; stroke-width: 6; stroke-dasharray: ${circumference};"></circle>
            </svg>
            <div class="fscore-value" style="font-size:16px; color: ${scoreColor};">${safeToFixed(data.fScore, 2)}</div>
          </div>
          <div>
            <div style="font-size:9px; text-transform:uppercase; color:var(--text-slate-dim);">Composite Decision</div>
            <div style="font-size:11px; font-weight:700; color: ${scoreColor}; margin-top:2px;">
              ${isBullish ? 'STRONG BUY breakthrough' : isBearish ? 'STRONG SELL breakthrough' : 'CONSOLIDATION PHASE'}
            </div>
            <div style="font-size:9px; color:var(--text-slate-dim); margin-top:2px;">
              Self-Correction Bias: <span style="font-weight:600; color:${(data.correction ?? 0) >= 0 ? 'var(--accent-cyan-glow)' : 'var(--accent-magenta-neon)'}">${(data.correction ?? 0) >= 0 ? '+' : ''}${safeToFixed(data.correction, 4)}</span>
            </div>
          </div>
        </div>

        <!-- F-Score component breakdown -->
        <div class="glass-card" style="padding:10px; font-size:11px;">
          <div style="font-family:var(--font-display); font-size:9px; color:var(--text-slate-dim); text-transform:uppercase; margin-bottom:8px;">Composite F-Score Pillars</div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <div>
              <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
                <span>Technical Quant (w=${((data.w_q || 0.30) * 100).toFixed(0)}%)</span>
                <strong style="color:var(--accent-cyan-glow);">${((data.quant?.S_quant || 0.5) * 10).toFixed(1)}/10</strong>
              </div>
              <div style="height:4px; background:var(--bg-circle-track); border-radius:2px; overflow:hidden;">
                <div style="height:100%; width:${((data.quant?.S_quant || 0.5) * 100).toFixed(0)}%; background:var(--accent-cyan-glow);"></div>
              </div>
            </div>
            <div>
              <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
                <span>Fundamentals (w=${((data.w_f || 0.30) * 100).toFixed(0)}%)</span>
                <strong style="color:var(--accent-green);">${((data.S_fundamental || 0.5) * 10).toFixed(1)}/10</strong>
              </div>
              <div style="height:4px; background:var(--bg-circle-track); border-radius:2px; overflow:hidden;">
                <div style="height:100%; width:${((data.S_fundamental || 0.5) * 100).toFixed(0)}%; background:var(--accent-green);"></div>
              </div>
            </div>
            <div>
              <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
                <span>News Sentiment (w=${((data.w_s || 0.20) * 100).toFixed(0)}%)</span>
                <strong style="color:var(--accent-amber);">${((data.semantic?.S_semantic || 0.5) * 10).toFixed(1)}/10</strong>
              </div>
              <div style="height:4px; background:var(--bg-circle-track); border-radius:2px; overflow:hidden;">
                <div style="height:100%; width:${((data.semantic?.S_semantic || 0.5) * 100).toFixed(0)}%; background:var(--accent-amber);"></div>
              </div>
            </div>
            <div>
              <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
                <span>Market & Macro (w=${((data.w_m || 0.20) * 100).toFixed(0)}%)</span>
                <strong style="color:var(--accent-magenta-neon);">${((data.S_market || 0.5) * 10).toFixed(1)}/10</strong>
              </div>
              <div style="height:4px; background:var(--bg-circle-track); border-radius:2px; overflow:hidden;">
                <div style="height:100%; width:${((data.S_market || 0.5) * 100).toFixed(0)}%; background:var(--accent-magenta-neon);"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 5-Day Forecasts -->
        <div class="glass-card" style="padding:10px; font-size:12px;">
          <div style="font-family:var(--font-display); font-size:9px; color:var(--text-slate-dim); text-transform:uppercase; margin-bottom:6px;">5-Day Forecast Targets</div>
          <div class="metric-row" style="padding: 6px 0;">
            <span class="metric-label">5-Day Price Target</span>
            <span class="metric-value" style="color:var(--accent-cyan-glow); font-weight:700;">${displayTarget} ${targetPercentHTML}</span>
          </div>
          <div class="metric-row" style="padding: 6px 0;">
            <span class="metric-label">Prediction Confidence</span>
            <span class="metric-value" style="color:var(--accent-cyan-glow);">${data.semantic.confidence}</span>
          </div>
          <div class="metric-row" style="border-bottom:none; padding: 6px 0;">
            <span class="metric-label">Best Strategy Action</span>
            <span class="metric-value" style="color:${scoreColor}; text-align:right;">${parseMarkdown(data.semantic.bestStrategy)}</span>
          </div>
        </div>

        <!-- Fundamentals Card -->
        ${data.quant?.fundamental ? `
        <div class="glass-card" style="padding:10px; font-size:11px;">
          <div style="font-family:var(--font-display); font-size:9px; color:var(--text-slate-dim); text-transform:uppercase; margin-bottom:6px;">Fundamental Valuation & Health</div>
          <div class="grid-2" style="gap:6px 12px; margin-bottom:6px;">
            <div style="display:flex; justify-content:space-between; border-bottom:1px dashed var(--border-glass); padding-bottom:4px;">
              <span style="color:var(--text-slate-dim);">Trailing P/E:</span>
              <strong style="color:var(--text-slate-light);">${data.quant.fundamental.pe !== null ? data.quant.fundamental.pe.toFixed(1) : 'N/A'}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; border-bottom:1px dashed var(--border-glass); padding-bottom:4px;">
              <span style="color:var(--text-slate-dim);">Price / Book:</span>
              <strong style="color:var(--text-slate-light);">${data.quant.fundamental.pb !== null ? data.quant.fundamental.pb.toFixed(1) : 'N/A'}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; border-bottom:1px dashed var(--border-glass); padding-bottom:4px;">
              <span style="color:var(--text-slate-dim);">Debt / Equity:</span>
              <strong style="color:var(--text-slate-light);">${data.quant.fundamental.debtToEquity !== null ? (data.quant.fundamental.debtToEquity > 10 ? data.quant.fundamental.debtToEquity / 100 : data.quant.fundamental.debtToEquity).toFixed(2) : 'N/A'}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; border-bottom:1px dashed var(--border-glass); padding-bottom:4px;">
              <span style="color:var(--text-slate-dim);">ROE:</span>
              <strong style="color:var(--text-slate-light);">${data.quant.fundamental.roe !== null ? (data.quant.fundamental.roe * 100).toFixed(1) + '%' : 'N/A'}</strong>
            </div>
          </div>
          <div style="border-top:1px dashed var(--border-glass); padding-top:6px; font-style:italic; color:var(--text-slate-dim); line-height:1.3;">
            "${data.semantic.fundamentalAnalysisSummary || ''}"
          </div>
        </div>
        ` : ''}

        <!-- Market Sentiment & Benchmark Context Card -->
        ${data.quant?.benchmark ? `
        <div class="glass-card" style="padding:10px; font-size:11px;">
          <div style="font-family:var(--font-display); font-size:9px; color:var(--text-slate-dim); text-transform:uppercase; margin-bottom:6px;">Macro & Market Environment</div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <div>
              <span style="color:var(--text-slate-dim); font-size:8px;">Benchmark (${data.quant.benchmark.benchmarkTicker})</span>
              <div style="font-weight:700; color:var(--text-slate-light);">${data.quant.benchmark.indexPrice !== null ? data.quant.benchmark.indexPrice.toLocaleString(undefined, {maximumFractionDigits:1}) : 'N/A'}
                <span style="font-size:9px; font-weight:600; color:${data.quant.benchmark.indexChangePercent >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">
                  (${data.quant.benchmark.indexChangePercent >= 0 ? '+' : ''}${data.quant.benchmark.indexChangePercent ? data.quant.benchmark.indexChangePercent.toFixed(2) + '%' : '0%'})
                </span>
              </div>
            </div>
            <div style="text-align:right;">
              <span style="color:var(--text-slate-dim); font-size:8px;">Volatility (${data.quant.benchmark.vixTicker})</span>
              <div style="font-weight:700; color:${data.quant.benchmark.vixPrice > 20 ? 'var(--accent-red)' : 'var(--accent-green)'};">${data.quant.benchmark.vixPrice !== null ? data.quant.benchmark.vixPrice.toFixed(2) : 'N/A'}</div>
            </div>
          </div>
          <div style="border-top:1px dashed var(--border-glass); padding-top:6px; font-style:italic; color:var(--text-slate-dim); line-height:1.3;">
            "${data.semantic.marketSentimentAnalysis || ''}"
          </div>
        </div>
        ` : ''}

        <!-- Tactical Timing Guidance -->
        ${data.timingAdvice ? `
        <div class="timing-advice-card">
          <div class="timing-header">
            <span class="timing-title">Tactical Entry/Exit Guidance</span>
            <span class="timing-badge-action ${data.timingAdvice.action.toLowerCase().includes('accumulate') ? 'accumulate' : data.timingAdvice.action.toLowerCase().includes('take profit') ? 'take-profit' : data.timingAdvice.action.toLowerCase().includes('defensive') ? 'defensive' : 'hold'}">${data.timingAdvice.action}</span>
          </div>
          <div class="timing-range-label">Optimal Action Range</div>
          <div class="timing-range-value">${data.timingAdvice.range}</div>
          <div class="timing-rationale">${data.timingAdvice.rationale}</div>
        </div>` : ''}

        <!-- Prices and SMA -->
        <div class="glass-card" style="padding:10px; font-size:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div>
              <div style="color:var(--text-slate-dim); font-size:9px;">Spot Price</div>
              <div style="font-weight:700; font-size:14px; color:var(--text-slate-light);">${formatCurrency(data.quant.currentPrice, data.ticker)}</div>
            </div>
            <canvas id="details-spark-popup" width="80" height="28" style="opacity:0.9;"></canvas>
          </div>
          
          <div class="grid-2" style="border-top: 1px solid var(--border-glass); padding-top:6px; margin-top:4px;">
            <div>
              <span style="color:var(--text-slate-dim); font-size:9px;">SMA Status:</span>
              <div style="font-weight:600; font-size:10px; margin-top:2px;">${data.quant.status}</div>
            </div>
            <div>
              <span style="color:var(--text-slate-dim); font-size:9px;">Daily Change:</span>
              <div style="font-weight:600; font-size:10px; margin-top:2px;" class="${data.quant?.priceChange >= 0 ? 'positive' : 'negative'}">
                ${data.quant?.priceChange >= 0 ? '+' : ''}${safeToFixed(data.quant?.priceChangePercent, 2)}%
              </div>
            </div>
          </div>
          
          <div class="grid-2" style="margin-top: 6px;">
            <div style="border-top: 1px dashed var(--border-glass); padding-top:4px;">
              <span style="color:var(--text-slate-dim); font-size:8px;">SMA(20):</span>
              <div style="font-weight:600; font-size:10px;">${formatCurrency(data.quant.sma20, data.ticker)}</div>
            </div>
            <div style="border-top: 1px dashed var(--border-glass); padding-top:4px;">
              <span style="color:var(--text-slate-dim); font-size:8px;">SMA(50):</span>
              <div style="font-weight:600; font-size:10px;">${formatCurrency(data.quant.sma50, data.ticker)}</div>
            </div>
          </div>
        </div>

        <!-- Advanced Technical Indicators -->
        <div class="glass-card" style="padding:10px; font-size:12px;">
          <div style="font-family:var(--font-display); font-size:9px; color:var(--text-slate-dim); text-transform:uppercase; margin-bottom:8px;">Technical Indicators</div>
          <div class="grid-3" style="gap:6px;">
            <div style="text-align:center;">
              <div style="font-size:8px; color:var(--text-slate-dim);">RSI(14)</div>
              <div class="indicator-badge ${rsiClass}" style="margin-top:2px;">${safeToFixed(data.quant.rsi, 1)}</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:8px; color:var(--text-slate-dim);">MACD</div>
              <div class="indicator-badge ${macdClass}" style="margin-top:2px;">${safeToFixed(data.quant.macd?.histogram, 3)}</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:8px; color:var(--text-slate-dim);">Volume</div>
              <div class="indicator-badge ${volClass}" style="margin-top:2px;">${safeToFixed(data.quant.volumeProfile?.volumeRatio, 1)}x</div>
            </div>
          </div>
          <div class="grid-2" style="margin-top:8px; gap:6px;">
            <div>
              <span style="color:var(--text-slate-dim); font-size:8px;">Bollinger %B:</span>
              <div style="font-weight:600; font-size:10px;">${safeToFixed(data.quant.bollinger?.percentB, 3)}</div>
            </div>
            <div>
              <span style="color:var(--text-slate-dim); font-size:8px;">ATR(14):</span>
              <div style="font-weight:600; font-size:10px;">${safeToFixed(data.quant.atr, 2)}</div>
            </div>
          </div>
          ${data.quant.fiftyTwoWeekHigh ? `
          <div style="margin-top:8px; border-top:1px dashed var(--border-glass); padding-top:6px;">
            <div style="font-size:8px; color:var(--text-slate-dim); margin-bottom:4px;">52-Week Range</div>
            <div class="range-bar-container">
              <div class="range-bar-labels">
                <span>${formatCurrency(data.quant.fiftyTwoWeekLow, data.ticker)}</span>
                <span>${formatCurrency(data.quant.fiftyTwoWeekHigh, data.ticker)}</span>
              </div>
              <div class="range-bar-track">
                <div class="range-bar-fill" style="width:100%;"></div>
                <div class="range-bar-marker" style="left:${(data.quant.fiftyTwoWeekPosition * 100).toFixed(1)}%;"></div>
              </div>
            </div>
          </div>` : ''}
        </div>

        <!-- Semantic summary card -->
        <div class="glass-card" style="padding:12px; font-size:12px; line-height:1.5;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-family:var(--font-display); font-size:9px; color:var(--text-slate-dim); text-transform:uppercase;">Semantic Context</span>
            ${badgeHTML}
          </div>
          <div style="color:var(--text-slate-light);">${parseMarkdown(data.semantic.summary)}</div>
        </div>

        <!-- News Catalysts card in popup -->
        ${data.semantic.news && data.semantic.news.length > 0 ? `
        <div class="glass-card" style="padding:10px; font-size:11px;">
          <div style="font-family:var(--font-display); font-size:9px; color:var(--text-slate-dim); text-transform:uppercase; margin-bottom:6px;">Breaking Catalysts</div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${data.semantic.news.map(n => {
              const impactClass = n.impact === 'BULLISH' ? 'positive' : n.impact === 'BEARISH' ? 'negative' : 'neutral';
              const impactDot = n.impact === 'BULLISH' ? '🟢' : n.impact === 'BEARISH' ? '🔴' : '⚪';
              return `
                <div style="border-bottom:1px solid rgba(255,255,255,0.03); padding-bottom:4px; margin-bottom:2px;">
                  <div style="display:flex; justify-content:space-between; font-size:8px; color:var(--text-slate-dim); margin-bottom:2px;">
                    <span>Source: <strong>${n.source}</strong></span>
                    <span class="${impactClass}">${impactDot} ${n.impact}</span>
                  </div>
                  <div style="color:var(--text-slate-light); font-weight:500; line-height:1.3;">${parseMarkdown(n.headline)}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>` : ''}

        <!-- Watchlist, Report & Export Buttons -->
        <div style="display:flex; gap:6px;">
          <button id="popup-report-btn" class="primary" style="flex:1; padding: 8px 10px; font-size:11px; font-weight:700; background: linear-gradient(135deg, var(--accent-cyan-glow), var(--accent-magenta-neon)); border: none; color: #ffffff;">
            Full Report
          </button>
          <button id="popup-csv-export-btn" class="btn-export" style="padding: 8px 10px; font-size:10px;">
            📥 CSV
          </button>
        </div>
        <button id="popup-watchlist-action-btn" class="primary" style="width: 100%; padding: 8px 10px; font-size:12px; font-weight:700;">
          Watchlist Action
        </button>
      </div>
    `;

    // Render details sparkline in popup
    const canvas = document.getElementById("details-spark-popup");
    drawSparkline(canvas, data.quant.prices, data.fScore >= 0.70 || data.quant.priceChangePercent >= 0);

    const reportBtn = document.getElementById("popup-report-btn");
    reportBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "OPEN_REPORT_TAB", ticker: data.ticker });
    });

    // CSV Export button
    const csvBtn = document.getElementById("popup-csv-export-btn");
    if (csvBtn) {
      csvBtn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "EXPORT_ASSET_CSV", ticker: data.ticker }, (resp) => {
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

    const actionBtn = document.getElementById("popup-watchlist-action-btn");
    chrome.runtime.sendMessage({ action: "GET_WATCHLIST" }, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn("Get watchlist failed in popup details:", chrome.runtime.lastError.message);
        return;
      }
      if (resp && resp.success) {
        const isWatched = resp.list.includes(data.ticker);
        updateWatchlistActionButton(actionBtn, isWatched, data.ticker);
      }
    });
  }

  function updateWatchlistActionButton(btn, isWatched, ticker) {
    if (isWatched) {
      btn.textContent = `Remove ${ticker.split('.')[0]} from Watchlist`;
      btn.style.background = "rgba(239, 68, 68, 0.15)";
      btn.style.color = "var(--accent-red)";
      btn.style.border = "1px solid rgba(239, 68, 68, 0.3)";
      btn.onclick = () => {
        chrome.runtime.sendMessage({ action: "REMOVE_WATCHLIST", ticker }, (resp) => {
          if (chrome.runtime.lastError) {
            console.warn("Remove watchlist failed:", chrome.runtime.lastError.message);
            return;
          }
          if (resp && resp.success) {
            updateWatchlistActionButton(btn, false, ticker);
            renderWatchlist();
          }
        });
      };
    } else {
      btn.textContent = `Add ${ticker.split('.')[0]} to Watchlist`;
      btn.style.background = "linear-gradient(135deg, var(--accent-cyan-glow), #0284C7)";
      btn.style.color = "#ffffff";
      btn.style.border = "none";
      btn.onclick = () => {
        chrome.runtime.sendMessage({ action: "ADD_WATCHLIST", ticker }, (resp) => {
          if (chrome.runtime.lastError) {
            console.warn("Add watchlist failed:", chrome.runtime.lastError.message);
            return;
          }
          if (resp && resp.success) {
            updateWatchlistActionButton(btn, true, ticker);
            renderWatchlist();
          }
        });
      };
    }
  }

  // ─── Portfolio Tab Implementation ──────────────────────────────────────────
  function searchPortfolioAsset() {
    const query = portfolioSearchInput.value.trim().toUpperCase();
    if (!query) return;

    portfolioSearchLoading.style.display = "flex";
    portfolioSearchError.style.display = "none";
    portfolioQuickAddCard.style.display = "none";

    chrome.runtime.sendMessage({
      action: "FETCH_PRICE_ONLY",
      ticker: query
    }, (resp) => {
      portfolioSearchLoading.style.display = "none";
      if (chrome.runtime.lastError) {
        portfolioSearchError.textContent = chrome.runtime.lastError.message;
        portfolioSearchError.style.display = "block";
        return;
      }

      if (resp && resp.success) {
        quickAddTicker.textContent = resp.ticker;
        quickAddCurrentPrice.textContent = formatCurrency(resp.price, resp.ticker);
        quickAddPrice.value = resp.price;
        quickAddQty.value = "1";
        portfolioQuickAddCard.style.display = "block";
      } else {
        portfolioSearchError.textContent = resp ? resp.error : "Failed to find asset.";
        portfolioSearchError.style.display = "block";
      }
    });
  }

  function confirmQuickAddPosition() {
    const ticker = quickAddTicker.textContent.trim().toUpperCase();
    const qty = parseFloat(quickAddQty.value);
    const avgPrice = parseFloat(quickAddPrice.value);

    if (!ticker || isNaN(qty) || qty <= 0 || isNaN(avgPrice) || avgPrice <= 0) return;

    chrome.runtime.sendMessage({
      action: "ADD_PORTFOLIO_POSITION",
      position: { ticker, qty, avgPrice }
    }, (resp) => {
      if (chrome.runtime.lastError) { console.warn(chrome.runtime.lastError.message); return; }
      if (resp && resp.success) {
        portfolioSearchInput.value = "";
        portfolioQuickAddCard.style.display = "none";
        renderPortfolio();
      }
    });
  }

  function renderPortfolio() {
    chrome.runtime.sendMessage({ action: "GET_PORTFOLIO" }, (resp) => {
      if (chrome.runtime.lastError || !resp?.success) {
        portfolioContainer.innerHTML = `<div class="empty-state">Failed to load portfolio.</div>`;
        return;
      }
      const portfolio = resp.portfolio || [];
      if (portfolio.length === 0) {
        portfolioContainer.innerHTML = `<div class="empty-state">No positions. Add your first holding above.</div>`;
        portfolioTotalValue.textContent = "--";
        portfolioTotalPnl.textContent = "--";
        return;
      }

      // Get cached prices for P&L computation
      const cacheKeys = portfolio.map(p => `cache_${p.ticker}`);
      chrome.storage.local.get(cacheKeys, (caches) => {
        portfolioContainer.innerHTML = "";
        let totalInvested = 0;
        let totalCurrent = 0;

        portfolio.forEach(pos => {
          const cached = caches[`cache_${pos.ticker}`];
          const currentPrice = cached?.quant?.currentPrice || 0;
          const invested = pos.qty * pos.avgPrice;
          const current = pos.qty * currentPrice;
          const pnl = current - invested;
          const pnlPercent = invested > 0 ? (pnl / invested) * 100 : 0;
          const isProfit = pnl >= 0;
          totalInvested += invested;
          totalCurrent += current;

          const cleanTicker = pos.ticker.split(".")[0];
          const card = document.createElement("div");
          card.className = "portfolio-position-card";
          card.style.marginBottom = "6px";
          card.innerHTML = `
            <div style="flex:1;">
              <div style="font-weight:700; font-size:12px; font-family:var(--font-display);">${cleanTicker}
                <span style="font-size:9px; color:var(--text-slate-dim); font-weight:400;">${pos.qty} × ${formatCurrency(pos.avgPrice, pos.ticker)}</span>
              </div>
              <div style="font-size:10px; color:var(--text-slate-dim); margin-top:2px;">Current: ${currentPrice > 0 ? formatCurrency(currentPrice, pos.ticker) : 'No data'}</div>
            </div>
            <div style="text-align:right; display:flex; align-items:center; gap:8px;">
              <div>
                <div class="portfolio-pnl ${isProfit ? 'profit' : 'loss'}">${isProfit ? '+' : ''}${formatCurrency(pnl, pos.ticker)}</div>
                <div style="font-size:9px; color:${isProfit ? 'var(--accent-green)' : 'var(--accent-red)'};">${isProfit ? '+' : ''}${safeToFixed(pnlPercent, 2)}%</div>
              </div>
              <button class="secondary portfolio-remove-btn" data-id="${pos.id}" style="padding:2px 6px; font-size:11px; border-radius:4px;" title="Remove">×</button>
            </div>
          `;
          card.querySelector(".portfolio-remove-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            chrome.runtime.sendMessage({ action: "REMOVE_PORTFOLIO_POSITION", positionId: pos.id }, () => renderPortfolio());
          });
          card.addEventListener("click", () => triggerAnalysis(pos.ticker));
          portfolioContainer.appendChild(card);
        });

        const totalPnl = totalCurrent - totalInvested;
        const isProfit = totalPnl >= 0;
        portfolioTotalValue.textContent = totalCurrent > 0 ? formatCurrency(totalCurrent, portfolio[0]?.ticker) : '--';
        portfolioTotalPnl.textContent = totalCurrent > 0 ? `${isProfit ? '+' : ''}${formatCurrency(totalPnl, portfolio[0]?.ticker)}` : '--';
        portfolioTotalPnl.style.color = isProfit ? 'var(--accent-green)' : 'var(--accent-red)';
      });
    });
    
    renderPortfolioAlerts();
    renderPriceAlerts();
  }

  function renderPortfolioAlerts() {
    chrome.runtime.sendMessage({ action: "GET_PORTFOLIO_ALERTS" }, (resp) => {
      if (chrome.runtime.lastError || !resp?.success) {
        portfolioAlertsSection.style.display = "none";
        return;
      }
      const alerts = resp.alerts || [];
      if (alerts.length === 0) {
        portfolioAlertsSection.style.display = "none";
        return;
      }

      portfolioAlertsSection.style.display = "block";
      portfolioAlertsContainer.innerHTML = "";
      alerts.forEach(alert => {
        const item = document.createElement("div");
        item.className = "glass-card";
        item.style.cssText = "padding:8px; font-size:10px; margin-bottom:4px; border-color:rgba(239,68,68,0.2); background:rgba(239,68,68,0.03); display:flex; flex-direction:column; gap:2px;";
        
        const timeStr = new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        item.innerHTML = `
          <div style="display:flex; justify-content:space-between; font-weight:700;">
            <span style="color:var(--accent-red);">${alert.type} (${alert.ticker.split('.')[0]})</span>
            <span style="color:var(--text-slate-dim); font-size:8px;">${timeStr}</span>
          </div>
          <div style="color:var(--text-slate-light); line-height:1.3;">${alert.message}</div>
        `;
        portfolioAlertsContainer.appendChild(item);
      });
    });
  }

  function clearPortfolioAlerts() {
    chrome.runtime.sendMessage({ action: "CLEAR_PORTFOLIO_ALERTS" }, (resp) => {
      if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError);
      renderPortfolioAlerts();
    });
  }

  function renderPriceAlerts() {
    chrome.runtime.sendMessage({ action: "GET_ALERTS" }, (resp) => {
      if (chrome.runtime.lastError || !resp?.success) {
        priceAlertsContainer.innerHTML = `<div class="empty-state">Failed to load price alerts.</div>`;
        return;
      }
      const alerts = resp.alerts || [];
      if (alerts.length === 0) {
        priceAlertsContainer.innerHTML = `<div class="empty-state">No custom price alerts set.</div>`;
        return;
      }

      priceAlertsContainer.innerHTML = "";
      alerts.forEach(alert => {
        const item = document.createElement("div");
        item.className = "watchlist-item";
        item.style.padding = "6px 8px";
        
        const isTriggered = alert.triggered;
        const conditionBadge = alert.condition === "ABOVE" ? "▲ ABOVE" : "▼ BELOW";
        const conditionClass = alert.condition === "ABOVE" ? "positive" : "negative";
        
        item.innerHTML = `
          <div class="watchlist-left">
            <span class="watchlist-ticker" style="font-size:11px; font-weight:700;">${alert.ticker.split('.')[0]}</span>
            <div style="display:flex; align-items:center; gap:4px; font-size:10px;">
              <span class="asset-change ${conditionClass}" style="font-size:9px; font-weight:600;">${conditionBadge}</span>
              <span style="color:var(--text-slate-light); font-weight:600;">${formatCurrency(alert.targetPrice, alert.ticker)}</span>
            </div>
          </div>
          <div class="watchlist-right" style="gap:6px;">
            <span class="watchlist-score-tag ${isTriggered ? 'bearish' : 'neutral'}" style="font-size:9px; padding:1px 4px; min-width:unset;">
              ${isTriggered ? 'Triggered' : 'Active'}
            </span>
            <button class="btn-icon delete-alert-btn" data-id="${alert.id}" title="Remove Alert" style="padding:2px; font-size:12px;">&times;</button>
          </div>
        `;
        
        item.querySelector(".delete-alert-btn").addEventListener("click", (e) => {
          e.stopPropagation();
          chrome.runtime.sendMessage({ action: "REMOVE_PRICE_ALERT", alertId: alert.id }, () => renderPriceAlerts());
        });
        
        priceAlertsContainer.appendChild(item);
      });
    });
  }

  function addPriceAlert() {
    const ticker = alertTickerInput.value.trim().toUpperCase();
    const condition = alertConditionSelect.value;
    const targetPrice = parseFloat(alertPriceInput.value);

    if (!ticker || isNaN(targetPrice) || targetPrice <= 0) return;

    chrome.runtime.sendMessage({
      action: "ADD_PRICE_ALERT",
      ticker,
      condition,
      targetPrice
    }, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn(chrome.runtime.lastError);
        return;
      }
      if (resp && resp.success) {
        alertTickerInput.value = "";
        alertPriceInput.value = "";
        renderPriceAlerts();
      }
    });
  }

  // AI Chat implementation
  function renderChat() {
    chrome.storage.local.get(["alphaChatHistory"], (res) => {
      const history = res.alphaChatHistory || [];
      chatMessages.innerHTML = "";
      
      if (history.length === 0) {
        // Welcome message
        const welcome = document.createElement("div");
        welcome.className = "chat-bubble model";
        welcome.innerHTML = `
          <span class="chat-bubble-author">ALPHA</span>
          <div>Hello! I am your **ALPHA AI Market Advisor**. How can I assist you with your investment decisions today? 
          You can specify stock filters, watchlist conditions, or ask for sector analysis.</div>
        `;
        chatMessages.appendChild(welcome);
      } else {
        history.forEach(msg => {
          const bubble = document.createElement("div");
          bubble.className = `chat-bubble ${msg.role}`;
          
          let author = msg.role === 'user' ? 'You' : 'ALPHA';
          let bubbleHTML = `<span class="chat-bubble-author">${author}</span>`;
          bubbleHTML += `<div>${parseMarkdown(msg.text)}</div>`;
          
          // Render citations if present
          if (msg.citations && msg.citations.length > 0) {
            bubbleHTML += `<div class="chat-citations">`;
            msg.citations.forEach(c => {
              bubbleHTML += `<a href="${c.url}" target="_blank" class="chat-citation-link" title="${c.title}">[${c.num}] ${c.title}</a>`;
            });
            bubbleHTML += `</div>`;
          }
          
          bubble.innerHTML = bubbleHTML;
          chatMessages.appendChild(bubble);
        });
      }
      scrollChatToBottom();
    });
  }

  function submitChatMessage() {
    const text = chatUserInput.value.trim();
    if (!text) return;

    chatUserInput.value = "";
    chatUserInput.disabled = true;
    chatSendBtn.disabled = true;

    // Display user message in UI immediately
    const userBubble = document.createElement("div");
    userBubble.className = "chat-bubble user";
    userBubble.innerHTML = `<span class="chat-bubble-author">You</span><div>${parseMarkdown(text)}</div>`;
    chatMessages.appendChild(userBubble);
    scrollChatToBottom();

    // Show loading spinner
    const loadBubble = document.createElement("div");
    loadBubble.className = "chat-bubble model chat-loading-bubble";
    loadBubble.id = "chat-loading-bubble";
    loadBubble.innerHTML = `
      <span class="chat-bubble-author">ALPHA</span>
      <div class="loading-pulse" style="flex-direction:row; justify-content:flex-start; gap:8px; align-items:center;">
        <div class="loading-spinner" style="width:14px; height:14px; border-width:1.5px; margin:0;"></div>
        <span style="font-size:11px;">Analysing market conditions...</span>
      </div>
    `;
    chatMessages.appendChild(loadBubble);
    scrollChatToBottom();

    chrome.storage.local.get(["alphaChatHistory"], (res) => {
      const history = res.alphaChatHistory || [];
      
      // Call background SEND_CHAT message
      chrome.runtime.sendMessage({ action: "SEND_CHAT", message: text, history }, (response) => {
        // Remove loading spinner
        const spinner = document.getElementById("chat-loading-bubble");
        if (spinner) spinner.remove();

        chatUserInput.disabled = false;
        chatSendBtn.disabled = false;
        chatUserInput.focus();

        if (chrome.runtime.lastError) {
          showChatError(chrome.runtime.lastError.message);
          return;
        }

        if (response && response.success) {
          const aiResponse = response.response;
          
          // Save turn to history
          history.push({ role: "user", text });
          history.push({ role: "model", text: aiResponse.text, citations: aiResponse.citations });
          
          chrome.storage.local.set({ alphaChatHistory: history }, () => {
            renderChat();
          });
        } else {
          const errMsg = response ? response.error : "Failed to fetch response from Gemini.";
          showChatError(errMsg);
        }
      });
    });
  }

  function showChatError(message) {
    const errorBubble = document.createElement("div");
    errorBubble.className = "chat-bubble model";
    errorBubble.style.borderColor = "rgba(239, 68, 68, 0.3)";
    errorBubble.style.background = "rgba(239, 68, 68, 0.05)";
    errorBubble.innerHTML = `
      <span class="chat-bubble-author" style="color:var(--accent-red);">System Error</span>
      <div style="color:var(--accent-red); font-weight:600;">${message}</div>
    `;
    chatMessages.appendChild(errorBubble);
    scrollChatToBottom();
  }

  function showChatMicPermissionError() {
    const errorBubble = document.createElement("div");
    errorBubble.className = "chat-bubble model";
    errorBubble.style.borderColor = "rgba(239, 68, 68, 0.3)";
    errorBubble.style.background = "rgba(239, 68, 68, 0.05)";
    errorBubble.innerHTML = `
      <span class="chat-bubble-author" style="color:var(--accent-red);">Voice Input Blocked</span>
      <div style="color:var(--text-slate-light); margin-bottom: 8px; font-size:12px;">Microphone access is blocked in this popup. Click below to enable microphone access:</div>
      <button id="enable-mic-popup-btn" class="primary" style="padding: 6px 12px; font-size: 11px; font-weight: 700; width: 100%;">Setup Voice Access</button>
    `;
    chatMessages.appendChild(errorBubble);
    scrollChatToBottom();

    const enableMicBtn = errorBubble.querySelector("#enable-mic-popup-btn");
    enableMicBtn.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("voice-permission.html") });
    });
  }

  function clearChatHistory() {
    chrome.storage.local.set({ alphaChatHistory: [] }, () => {
      renderChat();
    });
  }

  function scrollChatToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // Voice-to-text workaround
  function toggleVoiceInput() {
    chrome.tabs.create({ url: chrome.runtime.getURL('voice.html') });
  }

  // Listen for the voice result from the voice.html tab
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "VOICE_INPUT_RESULT" && message.text) {
      chatUserInput.value = message.text;
      submitChatMessage(); // Auto-submit when voice is returned
      sendResponse({ success: true });
    }
  });
});
