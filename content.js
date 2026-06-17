// content.js - AuraTrade Quant-Semantic Forecast Content Script

(function() {
  if (window.alphaTerminalLoaded) return;
  window.alphaTerminalLoaded = true;

  const TICKER_REGEX = /^\$?([A-Z]{1,5})$/;

  // Safety toFixed wrapper to prevent null/undefined property exceptions
  function safeToFixed(value, fractionDigits = 2) {
    if (value === undefined || value === null || isNaN(Number(value))) {
      return "0.00";
    }
    return Number(value).toFixed(fractionDigits);
  }

  // Create isolated Shadow Host
  const host = document.createElement('div');
  host.id = 'alpha-terminal-host';

  // Guard against script executing before <body> exists
  function mountHost() {
    if (document.body) {
      document.body.appendChild(host);
    } else {
      document.addEventListener('DOMContentLoaded', () => document.body.appendChild(host));
    }
  }
  mountHost();

  const shadow = host.attachShadow({ mode: 'open' });

  // Load stylesheet inside Shadow DOM
  const link = document.createElement('link');
  link.setAttribute('rel', 'stylesheet');
  link.setAttribute('href', chrome.runtime.getURL('styles.css'));
  shadow.appendChild(link);

  // Inject additional Shadow DOM scoped reset styles
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
    }
    #alpha-sidebar-root {
      font-family: 'Outfit', sans-serif !important;
      position: fixed;
      top: 0;
      right: 0;
      width: 440px;
      height: 100vh;
      z-index: 2147483647;
      background: var(--bg-obsidian-deep) !important;
      backdrop-filter: blur(16px) !important;
      -webkit-backdrop-filter: blur(16px) !important;
      border-left: 1px solid var(--border-glass) !important;
      box-shadow: -10px 0 40px rgba(15, 23, 42, 0.08) !important;
      transform: translateX(100%);
      transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), background 0.3s ease !important;
      display: flex;
      flex-direction: column;
      color: var(--text-slate-light) !important;
      padding: 24px !important;
      box-sizing: border-box !important;
    }
    #alpha-sidebar-root.dark-theme {
      box-shadow: -10px 0 40px rgba(0, 0, 0, 0.6) !important;
    }
    #alpha-sidebar-root.visible {
      transform: translateX(0);
    }
    .sb-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--border-glass);
      padding-bottom: 16px;
    }
    .sb-title {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 1px;
      color: var(--text-slate-light);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .sb-close {
      cursor: pointer;
      background: var(--bg-input);
      border: 1px solid var(--border-glass);
      color: var(--text-slate-dim);
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      font-size: 16px;
      line-height: 1;
    }
    .sb-close:hover {
      background: rgba(15, 23, 42, 0.08);
      color: var(--text-slate-light);
    }
    .dark-theme .sb-close:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
    }
    .sb-content {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
      padding-right: 4px;
    }
    .loading-pulse {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 250px;
      gap: 16px;
      color: var(--text-slate-dim);
    }
    .loading-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(2, 132, 199, 0.1);
      border-radius: 50%;
      border-top-color: var(--accent-cyan-glow);
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .section-title {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: var(--text-slate-dim);
      margin-bottom: 10px;
      font-weight: 600;
    }
    .search-inline-container {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    .search-inline-input {
      flex: 1;
      background: var(--bg-input);
      border: 1px solid var(--border-glass);
      border-radius: 8px;
      color: var(--text-slate-light);
      padding: 8px 12px;
      outline: none;
      font-size: 14px;
    }
    .search-inline-btn {
      background: var(--accent-cyan-glow);
      color: #ffffff;
      border: none;
      font-weight: 600;
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
    }
    .search-inline-btn:hover {
      box-shadow: 0 0 10px var(--accent-cyan-glow);
    }
  `;
  shadow.appendChild(style);

  // Sidebar container DOM
  const sidebar = document.createElement('div');
  sidebar.id = 'alpha-sidebar-root';
  shadow.appendChild(sidebar);

  // Overlay container DOM
  const overlay = document.createElement('div');
  overlay.className = 'alpha-backdrop-overlay';
  shadow.appendChild(overlay);

  // Floating AI Assistant Badge (FAB)
  const fab = document.createElement('button');
  fab.className = 'alpha-floating-badge';
  fab.innerHTML = `📊 <span>AuraTrade</span>`;
  fab.title = "Toggle AuraTrade Terminal";
  shadow.appendChild(fab);

  let currentActiveTicker = null;
  let activeTheme = 'light';
  let sidebarScanData = null;
  let sidebarScannerFilter = 'all';



  // Initialize event listeners
  document.addEventListener('dblclick', handleDoubleClick);
  document.addEventListener('keydown', handleKeyDown);
  overlay.addEventListener('click', closeTerminal);
  
  fab.addEventListener('click', () => {
    if (sidebar.classList.contains('visible')) {
      closeTerminal();
    } else {
      openTerminal(null);
    }
  });

  // Parse highlighted selection on double click
  function handleDoubleClick() {
    let selection = window.getSelection().toString().trim();
    if (!selection) return;

    const cleaned = selection.replace(/^[^\w\$]+|[^\w]+$/g, "");
    const match = cleaned.match(TICKER_REGEX);
    if (match) {
      const ticker = match[1].toUpperCase();
      openTerminal(ticker);
    }
  }

  // Keyboard shortcut Ctrl+Shift+A & Escape to close
  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      if (sidebar.classList.contains('visible')) {
        closeTerminal();
      }
    } else if (e.ctrlKey && e.shiftKey && e.code === 'KeyA') {
      e.preventDefault();
      let selection = window.getSelection().toString().trim();
      const cleaned = selection.replace(/^[^\w\$]+|[^\w]+$/g, "");
      const match = cleaned.match(TICKER_REGEX);
      if (match) {
        openTerminal(match[1].toUpperCase());
      } else {
        openTerminal(null);
      }
    }
  }

  // Resolve and apply active theme
  function loadAndApplyTheme() {
    chrome.storage.local.get(["settings"], (res) => {
      const settings = res.settings || {};
      activeTheme = settings.theme || 'light';
      applyThemeClass(activeTheme);
    });
  }

  function applyThemeClass(theme) {
    if (theme === 'dark') {
      sidebar.classList.add('dark-theme');
    } else {
      sidebar.classList.remove('dark-theme');
    }
  }

  // Currency formatting helper
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

  // Markdown Bold Keyword parser helper
  function parseMarkdown(text) {
    if (!text) return "";
    let escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return escaped.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  }

  // Canvas Sparkline drawer helper
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

  // Renders the persistent outer frame with headers and tabs
  function renderSidebarFrame() {
    const sunMoonIcon = activeTheme === 'dark' ? '🌙' : '☀️';
    sidebar.innerHTML = `
      <div class="sb-header">
        <div class="sb-title">
          <img src="${chrome.runtime.getURL('icon.png')}" style="width:20px; height:20px; border-radius:4px; margin-right:4px;">
          AuraTrade // FORECAST
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="theme-toggle-btn" id="alpha-theme-toggle" title="Toggle Theme" style="background:none; border:none; cursor:pointer;">${sunMoonIcon}</button>
          <div class="sb-close" id="alpha-close-btn">&times;</div>
        </div>
      </div>
      <div class="tab-bar">
        <button class="tab-btn active" id="tab-btn-scan">Asset Scan</button>
        <button class="tab-btn" id="tab-btn-scanner">Market Scanner</button>
        <button class="tab-btn" id="tab-btn-chat">AI Chat</button>
      </div>
      <div class="sb-content" id="alpha-content-area">
        <!-- TAB PANELS LOAD HERE -->
      </div>
    `;

    shadow.getElementById('alpha-close-btn').addEventListener('click', closeTerminal);
    shadow.getElementById('alpha-theme-toggle').addEventListener('click', toggleThemeSettings);
  }

  // Bind tab navigation click events
  function bindTabClicks() {
    const scanBtn = shadow.getElementById('tab-btn-scan');
    const scannerBtn = shadow.getElementById('tab-btn-scanner');
    const chatBtn = shadow.getElementById('tab-btn-chat');

    scanBtn.addEventListener('click', () => {
      switchTab('scan');
      if (currentActiveTicker) {
        chrome.storage.local.get([`cache_${currentActiveTicker}`], (res) => {
          const cached = res[`cache_${currentActiveTicker}`];
          if (cached) renderAssetData(cached);
          else renderSearchMode();
        });
      } else {
        renderSearchMode();
      }
    });

    scannerBtn.addEventListener('click', () => {
      switchTab('scanner');
      chrome.storage.local.get(["marketScanCache"], (res) => {
        if (res.marketScanCache) {
          renderScannerResults(res.marketScanCache);
        } else {
          renderMarketScanner();
        }
      });
    });

    chatBtn.addEventListener('click', () => {
      switchTab('chat');
      renderSidebarChat();
    });
  }

  function switchTab(tab) {
    const scanBtn = shadow.getElementById('tab-btn-scan');
    const scannerBtn = shadow.getElementById('tab-btn-scanner');
    const chatBtn = shadow.getElementById('tab-btn-chat');

    scanBtn.classList.remove('active');
    scannerBtn.classList.remove('active');
    chatBtn.classList.remove('active');

    if (tab === 'scan') {
      scanBtn.classList.add('active');
    } else if (tab === 'scanner') {
      scannerBtn.classList.add('active');
    } else if (tab === 'chat') {
      chatBtn.classList.add('active');
    }
  }

  // Main UI controller to boot terminal
  function openTerminal(ticker) {
    sidebar.classList.add('visible');
    overlay.classList.add('visible');
    loadAndApplyTheme();
    
    // Render the layout frame
    renderSidebarFrame();
    bindTabClicks();

    if (!ticker) {
      switchTab('scan');
      renderSearchMode();
    } else {
      switchTab('scan');
      currentActiveTicker = ticker;
      renderLoadingState(ticker);
      
      chrome.runtime.sendMessage({ action: "FETCH_ASSET", ticker }, (response) => {
        if (chrome.runtime.lastError) {
          renderErrorState(chrome.runtime.lastError.message);
          return;
        }
        if (response && response.success) {
          renderAssetData(response.data);
        } else {
          renderErrorState(response ? response.error : "Unknown network error");
        }
      });
    }
  }

  function closeTerminal() {
    sidebar.classList.remove('visible');
    overlay.classList.remove('visible');
  }

  function toggleThemeSettings() {
    chrome.storage.local.get(["settings"], (res) => {
      const settings = res.settings || {};
      const newTheme = settings.theme === 'dark' ? 'light' : 'dark';
      settings.theme = newTheme;
      chrome.storage.local.set({ settings }, () => {
        activeTheme = newTheme;
        applyThemeClass(newTheme);
        const toggleBtn = shadow.getElementById('alpha-theme-toggle');
        if (toggleBtn) {
          toggleBtn.textContent = newTheme === 'dark' ? '🌙' : '☀️';
        }
      });
    });
  }

  // TAB PANELS IMPLEMENTATIONS

  function renderSearchMode() {
    const contentArea = shadow.getElementById('alpha-content-area');
    contentArea.innerHTML = `
      <div class="glass-card" style="padding: 20px;">
        <h3 style="margin-bottom: 12px; font-size: 15px; color: var(--text-slate-light);">Asset Investigation</h3>
        <p style="color: var(--text-slate-dim); font-size: 13px; margin-bottom: 16px;">Select a ticker from the page, or enter one manually below:</p>
        <div class="search-inline-container" style="margin-bottom: 8px;">
          <input type="text" id="alpha-manual-ticker" placeholder="e.g. RELIANCE, TCS, AAPL" class="search-inline-input">
          <button id="alpha-manual-search" class="search-inline-btn">Scan</button>
        </div>
        <span style="font-size:11px; color:var(--text-slate-dim);">Indian market default: exchange suffix (.NS) is auto-appended if missing.</span>
      </div>
    `;
    
    const input = shadow.getElementById('alpha-manual-ticker');
    const button = shadow.getElementById('alpha-manual-search');
    
    const executeSearch = () => {
      const val = input.value.trim().toUpperCase();
      if (val) openTerminal(val);
    };

    button.addEventListener('click', executeSearch);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') executeSearch();
    });
  }

  function renderLoadingState(ticker) {
    const contentArea = shadow.getElementById('alpha-content-area');
    contentArea.innerHTML = `
      <div class="loading-pulse">
        <div class="loading-spinner"></div>
        <div>Synthesizing data stream for $${ticker}...</div>
      </div>
    `;
  }

  function renderErrorState(message) {
    const contentArea = shadow.getElementById('alpha-content-area');
    contentArea.innerHTML = `
      <div class="glass-card" style="border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.05);">
        <h4 style="color: var(--accent-red); margin-bottom: 8px; display:flex; align-items:center; gap: 8px;">
           Analysis Terminated
        </h4>
        <p style="color: var(--text-slate-dim); font-size: 13px;">${message}</p>
        <button id="alpha-back-search" class="secondary" style="margin-top: 14px; width: 100%;">Return to Search</button>
      </div>
    `;
    shadow.getElementById('alpha-back-search').addEventListener('click', () => renderSearchMode());
  }

  // Renders live market scanner tab
  function renderMarketScanner() {
    const contentArea = shadow.getElementById('alpha-content-area');
    contentArea.innerHTML = `
      <div class="loading-pulse">
        <div class="loading-spinner"></div>
        <div>Scanning top Indian equities in real-time...</div>
      </div>
    `;

    chrome.runtime.sendMessage({ action: "SCAN_MARKET" }, (response) => {
      if (chrome.runtime.lastError) {
        contentArea.innerHTML = `<div class="glass-card" style="color:var(--accent-red); padding:12px;">Scanner Error: ${chrome.runtime.lastError.message}</div>`;
        return;
      }
      if (response && response.success) {
        renderScannerResults(response.results);
      } else {
        contentArea.innerHTML = `<div class="glass-card" style="color:var(--accent-red); padding:12px;">Scanner Error: ${response ? response.error : "Unknown error"}</div>`;
      }
    });
  }

  function renderScannerResults(scanData) {
    const contentArea = shadow.getElementById('alpha-content-area');
    if (!scanData) {
      contentArea.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <span style="font-size:12px; color:var(--text-slate-dim);">Top Indian Stocks Screen</span>
          <button id="sidebar-scanner-refresh-btn" class="primary" style="padding:6px 12px; font-size:11px; font-weight:700;">Scan Now</button>
        </div>
        <div class="empty-state">No dynamic scan data available. Click 'Scan Now' to run real-time market analysis.</div>
      `;
      const refreshBtn = contentArea.querySelector("#sidebar-scanner-refresh-btn");
      if (refreshBtn) {
        refreshBtn.addEventListener("click", () => renderMarketScanner());
      }
      return;
    }
    
    sidebarScanData = scanData;
    contentArea.innerHTML = "";

    // Sub-header with refresh button
    const subHeader = document.createElement("div");
    subHeader.style.cssText = "display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;";
    subHeader.innerHTML = `
      <span style="font-size:12px; color:var(--text-slate-dim);">Top Indian Stocks Screen</span>
      <button id="sidebar-scanner-refresh-btn" class="primary" style="padding:6px 12px; font-size:11px; font-weight:700;">Scan Now</button>
    `;
    contentArea.appendChild(subHeader);
    
    subHeader.querySelector("#sidebar-scanner-refresh-btn").addEventListener("click", () => {
      renderMarketScanner();
    });

    // Create the filter chips container
    const chipsDiv = document.createElement("div");
    chipsDiv.className = "chat-chips-container";
    chipsDiv.id = "sidebar-scanner-filter-chips";
    chipsDiv.style.marginBottom = "12px";
    chipsDiv.innerHTML = `
      <span class="chat-chip ${sidebarScannerFilter === 'all' ? 'active' : ''}" data-filter="all">All</span>
      <span class="chat-chip ${sidebarScannerFilter === 'best' ? 'active' : ''}" data-filter="best">🏆 Best Picks</span>
      <span class="chat-chip ${sidebarScannerFilter === 'under100' ? 'active' : ''}" data-filter="under100">🪙 Under 100</span>
      <span class="chat-chip ${sidebarScannerFilter === 'short' ? 'active' : ''}" data-filter="short">⚡ Short Term</span>
      <span class="chat-chip ${sidebarScannerFilter === 'long' ? 'active' : ''}" data-filter="long">📈 Long Term</span>
      <span class="chat-chip ${sidebarScannerFilter === 'gainer' ? 'active' : ''}" data-filter="gainer">🚀 Gainers</span>
      <span class="chat-chip ${sidebarScannerFilter === 'loser' ? 'active' : ''}" data-filter="loser">📉 Losers</span>
    `;
    contentArea.appendChild(chipsDiv);

    chipsDiv.querySelectorAll(".chat-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        chipsDiv.querySelectorAll(".chat-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        sidebarScannerFilter = chip.getAttribute("data-filter");
        renderFilteredScannerResults(scanData, sidebarScannerFilter);
      });
    });

    const listDiv = document.createElement("div");
    listDiv.id = "sidebar-scanner-list";
    contentArea.appendChild(listDiv);

    renderFilteredScannerResults(scanData, sidebarScannerFilter);
  }

  function renderFilteredScannerResults(scanData, filter) {
    const listDiv = shadow.getElementById("sidebar-scanner-list");
    if (!listDiv) return;
    listDiv.innerHTML = "";

    const { timestamp, buys, sells, others, failures } = scanData;

    // Build timestamp note
    if (timestamp) {
      const timeStr = new Date(timestamp).toLocaleTimeString();
      const infoText = document.createElement("div");
      infoText.style.cssText = "font-size:10px; color:var(--text-slate-dim); text-align:right; margin-bottom:12px;";
      infoText.textContent = `Last scanned: ${timeStr}`;
      listDiv.appendChild(infoText);
    }

    // Helper to render a group list
    function renderGroupList(title, group, isFilteredCategory = false) {
      if (!group || group.length === 0) {
        if (!isFilteredCategory) return;
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "No stocks matching this filter.";
        listDiv.appendChild(empty);
        return;
      }

      if (title) {
        const header = document.createElement("div");
        let headerColorClass = "neutral";
        if (filter === 'all') {
          if (title.includes("Buy")) headerColorClass = "buy";
          else if (title.includes("Sell")) headerColorClass = "sell";
        }
        header.className = `suggestion-header ${headerColorClass}`;
        header.innerHTML = `<span class="suggestion-header-dot"></span> ${title} (${group.length})`;
        listDiv.appendChild(header);
      }

      const groupDiv = document.createElement("div");
      groupDiv.className = "suggestion-group";

      group.forEach((item, index) => {
        const cleanTicker = item.ticker.split(".")[0];
        const isPos = item.changePercent >= 0;
        const changeClass = isPos ? "positive" : "negative";
        const changeSign = isPos ? "+" : "";
        
        const priceFormatted = formatCurrency(item.price, item.ticker);
        const changeFormatted = `${changeSign}${safeToFixed(item.changePercent, 2)}%`;
        
        const canvasId = `spark-side-${filter}-${index}`;

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
        badgeHTML = `<span class="badge ${recColorClass}" style="padding:2px 6px; font-size:10px; font-weight:700;">${recText} [${scoreLabel}]</span>`;

        let crossoverBadgeHTML = "";
        if (item.crossover && item.crossover !== "None") {
          const crossClass = item.crossover === "Golden Cross" ? "badge-bullish" : "badge-bearish";
          crossoverBadgeHTML = `<span class="badge ${crossClass}" style="padding:2px 4px; font-size:9px; margin-left:4px;">${item.crossover}</span>`;
        }

        let pivotPointsHTML = "";
        if (item.pivotPoints) {
          pivotPointsHTML = `
            <div style="border-top:1px dashed var(--border-glass); padding-top:6px; margin-top:4px; display:flex; justify-content:space-between; font-size:9px; color:var(--text-slate-dim);">
              <span>PP: <strong style="color:var(--text-slate-light);">${formatCurrency(item.pivotPoints.pp, item.ticker)}</strong></span>
              <span>S1: <strong style="color:var(--accent-red);">${formatCurrency(item.pivotPoints.s1, item.ticker)}</strong></span>
              <span>R1: <strong style="color:var(--accent-green);">${formatCurrency(item.pivotPoints.r1, item.ticker)}</strong></span>
            </div>
          `;
        }

        const card = document.createElement("div");
        card.className = "asset-row-expandable";
        card.innerHTML = `
          <div class="asset-row-header">
            <div class="asset-info">
              <div class="asset-name" style="font-size:13px; font-weight:700; display:flex; align-items:center; gap:4px;">
                ${cleanTicker} 
                <span style="font-size:9px; font-weight:400; color:var(--text-slate-dim);">(${item.ticker})</span>
              </div>
              <div class="asset-price-group">
                <span class="asset-price">${priceFormatted}</span>
                <span class="asset-change ${changeClass}">${changeFormatted}</span>
              </div>
            </div>
            
            <div class="sparkline-container">
              <canvas id="${canvasId}" class="sparkline-canvas" width="70" height="26"></canvas>
            </div>
            
            <div style="display:flex; align-items:center; gap:8px;">
              ${badgeHTML}
              <button class="primary scanner-side-ai-btn" data-ticker="${item.ticker}" style="padding:4px 8px; font-size:10px; border-radius:4px; font-weight:700;">AI</button>
            </div>
          </div>
          <div class="asset-row-details">
            <div style="font-size:11px; display:flex; flex-direction:column; gap:5px; padding: 6px 0;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="color:var(--text-slate-dim);">SMA Alignment Status:</span>
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
              <div style="border-top:1px dashed var(--border-glass); padding-top:6px; margin-top:4px;">
                <div style="color:var(--accent-cyan-glow); font-weight:700; display:flex; justify-content:space-between; margin-bottom:2px;">
                  <span>5-Day Target Forecast:</span>
                  <span>${item.semantic.targetPrice}</span>
                </div>
                <div style="color:var(--text-slate-light); line-height:1.4;">
                  "${parseMarkdown(item.semantic.summary)}"
                </div>
              </div>` : ''}
              <button class="secondary run-side-ai-forecast-btn" data-ticker="${item.ticker}" style="width:100%; margin-top:6px; padding:6px; font-size:11px; font-weight:600;">
                ${item.hasAI ? 'Re-run Gemini Forecast' : 'AI Semantic Forecast'}
              </button>
            </div>
          </div>
        `;
        groupDiv.appendChild(card);
        
        // Draw sparkline
        const canvas = shadow.getElementById(canvasId);
        // We must append groupDiv to DOM before drawing to canvas, but appending inside the loop causes issues.
        // We can draw to the canvas in-memory before it's attached.
        drawSparkline(canvas, item.prices, score >= 0.70 || item.changePercent >= 0);

        // Accordion expand
        const cardHeader = card.querySelector(".asset-row-header");
        const details = card.querySelector(".asset-row-details");
        cardHeader.addEventListener("click", (e) => {
          if (e.target.tagName === "BUTTON") return;
          details.classList.toggle("expanded");
        });
      });
      listDiv.appendChild(groupDiv);
    }

    // Map scanner results into a unified flat list with indicator flags
    const allItems = [
      ...(buys || []).map(x => ({ ...x, group: 'buy' })),
      ...(sells || []).map(x => ({ ...x, group: 'sell' })),
      ...(others || []).map(x => ({ ...x, group: 'neutral' }))
    ];

    if (filter === 'all') {
      // Grouped rendering matching original format
      renderGroupList("Buy Suggestions", buys, false);
      renderGroupList("Sell Suggestions", sells, false);
      renderGroupList("Active Market Trends", others, false);
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

      renderGroupList(listTitle, filtered, true);
    }

    // Render failures
    if (failures && failures.length > 0 && filter === 'all') {
      const errHeader = document.createElement("div");
      errHeader.className = "suggestion-header";
      errHeader.style.color = "var(--accent-red)";
      errHeader.textContent = "Failures & Rate Limits";
      listDiv.appendChild(errHeader);
      
      failures.forEach(f => {
        const div = document.createElement("div");
        div.className = "glass-card";
        div.style.cssText = "padding:8px; font-size:11px; margin-bottom:6px; border-color:rgba(239,68,68,0.2);";
        div.innerHTML = `<strong>${f.ticker}</strong>: <span style="color:var(--text-slate-dim);">${f.error}</span>`;
        listDiv.appendChild(div);
      });
    }

    // Bind AI buttons
    shadow.querySelectorAll(".scanner-side-ai-btn, .run-side-ai-forecast-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const ticker = e.target.getAttribute("data-ticker");
        const forceRefresh = e.target.classList.contains("run-side-ai-forecast-btn") || e.target.classList.contains("scanner-side-ai-btn");
        switchTab('scan');
        currentActiveTicker = ticker;
        renderLoadingState(ticker);
        chrome.runtime.sendMessage({ action: "FETCH_ASSET", ticker, forceRefresh }, (response) => {
          if (chrome.runtime.lastError) {
            renderErrorState(chrome.runtime.lastError.message);
            return;
          }
          if (response && response.success) {
            renderAssetData(response.data);
          } else {
            renderErrorState(response ? response.error : "Unknown network error");
          }
        });
      });
    });
  }

  // Renders detailed asset calculations
  function renderAssetData(data) {
    const contentArea = shadow.getElementById('alpha-content-area');
    const isBullishBreakthrough = data.fScore >= 0.85;
    const isBearishBreakthrough = data.fScore <= 0.15;
    
    let cardPulseClass = "";
    let scoreColor = "var(--text-slate-light)";
    if (isBullishBreakthrough) {
      cardPulseClass = "pulse-cyan";
      scoreColor = "var(--accent-cyan-glow)";
    } else if (isBearishBreakthrough) {
      cardPulseClass = "pulse-magenta";
      scoreColor = "var(--accent-magenta-neon)";
    }

    const radius = 48;
    const circumference = 2 * Math.PI * radius; // 301.6
    const offset = circumference - (data.fScore * circumference);

    const sentiment = data.semantic.sentiment.toUpperCase();
    let badgeHTML = `<span class="badge badge-neutral">Neutral</span>`;
    if (sentiment === 'BULLISH') {
      badgeHTML = `<span class="badge badge-bullish">Bullish</span>`;
    } else if (sentiment === 'BEARISH') {
      badgeHTML = `<span class="badge badge-bearish">Bearish</span>`;
    }

    // Build grounding citations list
    let citationsHTML = "";
    if (data.semantic.citations && data.semantic.citations.length > 0) {
      citationsHTML = `
        <div>
          <div class="section-title">Google Search Grounding Citations</div>
          <div class="citations-list">
            ${data.semantic.citations.map(c => `
              <a href="${c.url}" target="_blank" class="citation-item">
                <span class="citation-num">${c.num}</span>
                <span class="citation-title">${c.title}</span>
              </a>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Handle target price display prefix formatting
    const displayTarget = data.semantic.targetPrice.startsWith('$') || data.semantic.targetPrice.startsWith('₹') 
      ? data.semantic.targetPrice 
      : (isNaN(parseFloat(data.semantic.targetPrice)) ? data.semantic.targetPrice : formatCurrency(parseFloat(data.semantic.targetPrice), data.ticker));

    contentArea.innerHTML = `
      <!-- Composite Decision Gauge -->
      <div class="glass-card ${cardPulseClass}" style="text-align: center; padding: 20px; position:relative; margin-bottom: 16px;">
        <div class="section-title">Composite F-Score</div>
        <div class="fscore-gauge">
          <svg viewBox="0 0 120 120">
            <circle class="bg-circle" cx="60" cy="60" r="${radius}"></circle>
            <circle class="progress-circle" cx="60" cy="60" r="${radius}" 
                    style="stroke: ${scoreColor}; stroke-dashoffset: ${offset}; stroke-width: 8; stroke-dasharray: ${circumference};"></circle>
          </svg>
          <div class="fscore-value" style="color: ${scoreColor};">${safeToFixed(data.fScore, 2)}</div>
        </div>
        <div style="margin-top: 10px; font-weight: 700; letter-spacing: 0.05em; font-size:12px; color: ${scoreColor};">
          ${isBullishBreakthrough ? 'STRONG BUY BREAKTHROUGH' : isBearishBreakthrough ? 'STRONG SELL BREAKTHROUGH' : 'STABLE CONSOLIDATION'}
        </div>
        <div style="margin-top: 6px; font-size:10px; color:var(--text-slate-dim);">
          Self-Correction Bias: <span style="font-weight:600; color:${(data.correction ?? 0) >= 0 ? 'var(--accent-cyan-glow)' : 'var(--accent-magenta-neon)'}">${(data.correction ?? 0) >= 0 ? '+' : ''}${safeToFixed(data.correction, 4)}</span>
        </div>
      </div>

      <!-- 5-Day Prediction Forecast Card -->
      <div style="margin-bottom: 16px;">
        <div class="section-title">Gemini 5-Day Algorithmic Forecast</div>
        <div class="glass-card" style="display:flex; flex-direction:column; gap:4px;">
          <div class="metric-row">
            <span class="metric-label">5-Day Target Forecast</span>
            <span class="metric-value" style="color: var(--accent-cyan-glow); font-size:14px; font-weight:700;">${displayTarget}</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Prediction Confidence</span>
            <span class="metric-value" style="color: var(--accent-cyan-glow);">${data.semantic.confidence}</span>
          </div>
          <div class="metric-row" style="border-bottom:none;">
            <span class="metric-label">Best Trading Strategy</span>
            <span class="metric-value" style="color: ${scoreColor}; text-align:right;">${parseMarkdown(data.semantic.bestStrategy)}</span>
          </div>
        </div>
      </div>

      <!-- Quantitative Analysis Panel -->
      <div style="margin-bottom: 16px;">
        <div class="section-title">On-The-Fly Quant Indicators</div>
        <div class="glass-card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <div>
              <div style="font-size: 11px; color: var(--text-slate-dim);">Spot Price</div>
              <div style="font-size: 18px; font-weight: 700; color: var(--text-slate-light);">${formatCurrency(data.quant.currentPrice, data.ticker)}</div>
            </div>
            <canvas id="details-sparkline" width="90" height="35" style="opacity:0.9;"></canvas>
          </div>
          <div class="grid-2" style="border-top: 1px solid var(--border-glass); padding-top: 10px;">
            <div>
              <div style="font-size: 10px; color: var(--text-slate-dim);">SMA Status</div>
              <div style="font-size: 11px; font-weight: 600; color: var(--text-slate-light); margin-top: 2px;">${data.quant.status}</div>
            </div>
            <div>
              <div style="font-size: 10px; color: var(--text-slate-dim);">Daily Change</div>
              <div style="font-size: 11px; font-weight: 600; margin-top: 2px;" class="${data.quant?.priceChange >= 0 ? 'positive' : 'negative'}">
                ${data.quant?.priceChange >= 0 ? '+' : ''}${safeToFixed(data.quant?.priceChangePercent, 2)}%
              </div>
            </div>
            <div style="border-top: 1px dashed var(--border-glass); padding-top: 6px; margin-top: 4px;">
              <div style="font-size: 9px; color: var(--text-slate-dim);">SMA 20</div>
              <div style="font-size: 12px; font-weight: 600; color: var(--text-slate-light);">${formatCurrency(data.quant.sma20, data.ticker)}</div>
            </div>
            <div style="border-top: 1px dashed var(--border-glass); padding-top: 6px; margin-top: 4px;">
              <div style="font-size: 9px; color: var(--text-slate-dim);">SMA 50</div>
              <div style="font-size: 12px; font-weight: 600; color: var(--text-slate-light);">${formatCurrency(data.quant.sma50, data.ticker)}</div>
            </div>
          </div>

          <!-- Advanced Technical Indicators Grid -->
          <div style="font-family:var(--font-display); font-size:9px; color:var(--text-slate-dim); text-transform:uppercase; margin-top:12px; margin-bottom:8px; font-weight:600;">Technical Indicators</div>
          <div class="grid-3" style="gap:6px;">
            <div style="text-align:center;">
              <div style="font-size:8px; color:var(--text-slate-dim);">RSI(14)</div>
              <div class="indicator-badge ${data.quant?.rsi >= 70 ? 'rsi-overbought' : data.quant?.rsi <= 30 ? 'rsi-oversold' : 'rsi-neutral'}" style="margin-top:2px;">${safeToFixed(data.quant?.rsi, 1)}</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:8px; color:var(--text-slate-dim);">MACD</div>
              <div class="indicator-badge ${(data.quant?.macd?.histogram || 0) > 0 ? 'macd-bull' : 'macd-bear'}" style="margin-top:2px;">${safeToFixed(data.quant?.macd?.histogram, 3)}</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:8px; color:var(--text-slate-dim);">Volume</div>
              <div class="indicator-badge ${(data.quant?.volumeProfile?.volumeRatio || 1) > 1.3 ? 'volume-high' : 'volume-normal'}" style="margin-top:2px;">${safeToFixed(data.quant?.volumeProfile?.volumeRatio, 1)}x</div>
            </div>
          </div>
          <div class="grid-2" style="margin-top:8px; gap:6px;">
            <div>
              <span style="color:var(--text-slate-dim); font-size:8px;">Bollinger %B:</span>
              <span style="font-weight:600; font-size:10px; margin-left:4px; color: var(--text-slate-light);">${safeToFixed(data.quant?.bollinger?.percentB, 3)}</span>
            </div>
            <div>
              <span style="color:var(--text-slate-dim); font-size:8px;">ATR(14):</span>
              <span style="font-weight:600; font-size:10px; margin-left:4px; color: var(--text-slate-light);">${safeToFixed(data.quant?.atr, 2)}</span>
            </div>
          </div>

          <!-- 52-Week Range Bar -->
          ${data.quant?.fiftyTwoWeekHigh ? `
          <div style="margin-top:10px; border-top:1px dashed var(--border-glass); padding-top:8px;">
            <div style="font-size:8px; color:var(--text-slate-dim); margin-bottom:4px; font-weight:600; text-transform:uppercase;">52-Week Range</div>
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
      </div>

      <!-- Semantic Analysis Panel -->
      <div style="margin-bottom: 16px;">
        <div class="section-title" style="display:flex; justify-content:space-between; align-items:center;">
          <span>Semantic News Intelligence</span>
          ${badgeHTML}
        </div>
        <div class="glass-card" style="font-size: 13px; line-height: 1.6; color: var(--text-slate-light);">
          ${parseMarkdown(data.semantic.summary)}
        </div>
      </div>

      <!-- Grounding Citations -->
      <div style="margin-bottom: 16px;">
        ${citationsHTML}
      </div>

      <!-- Action Panel Buttons -->
      <div style="display:flex; flex-direction:column; gap:10px; margin-top: 10px; padding-bottom: 20px;">
        <button id="alpha-report-btn" class="primary" style="width: 100%; background: linear-gradient(135deg, var(--accent-cyan-glow), var(--accent-magenta-neon)); border: none; color: #ffffff;">
          Open Report in New Tab
        </button>
        <button id="alpha-watchlist-btn" class="primary" style="width: 100%;">
          Watchlist Action
        </button>
        <button id="alpha-back-search-btn" class="secondary" style="width: 100%;">
          Scan Another Asset
        </button>
      </div>
    `;

    // Render Canvas Sparkline
    const detailsCanvas = shadow.getElementById('details-sparkline');
    drawSparkline(detailsCanvas, data.quant.prices, data.fScore >= 0.70 || data.quant.priceChangePercent >= 0);

    shadow.getElementById('alpha-back-search-btn').addEventListener('click', () => renderSearchMode());

    shadow.getElementById('alpha-report-btn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: "OPEN_REPORT_TAB", ticker: data.ticker });
    });

    const watchlistBtn = shadow.getElementById('alpha-watchlist-btn');
    chrome.runtime.sendMessage({ action: "GET_WATCHLIST" }, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn("Get watchlist failed in sidebar:", chrome.runtime.lastError.message);
        return;
      }
      if (resp && resp.success) {
        const isWatched = resp.list.includes(data.ticker);
        updateWatchlistButton(watchlistBtn, isWatched, data.ticker);
      }
    });
  }

  function updateWatchlistButton(btn, isWatched, ticker) {
    if (isWatched) {
      btn.textContent = `Remove ${ticker.split('.')[0]} from Watchlist`;
      btn.style.background = "rgba(239, 68, 68, 0.15)";
      btn.style.color = "var(--accent-red)";
      btn.style.border = "1px solid rgba(239, 68, 68, 0.3)";
      btn.onclick = () => {
        chrome.runtime.sendMessage({ action: "REMOVE_WATCHLIST", ticker }, (resp) => {
          if (chrome.runtime.lastError) {
            console.warn("Remove watchlist failed in sidebar:", chrome.runtime.lastError.message);
            return;
          }
          if (resp && resp.success) {
            updateWatchlistButton(btn, false, ticker);
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
            console.warn("Add watchlist failed in sidebar:", chrome.runtime.lastError.message);
            return;
          }
          if (resp && resp.success) {
            updateWatchlistButton(btn, true, ticker);
          }
        });
      };
    }
  }

  // AI Chat Implementation for sidebar
  function renderSidebarChat() {
    const contentArea = shadow.getElementById('alpha-content-area');
    contentArea.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
        <span style="font-size:11px; color:var(--text-slate-dim);">AuraTrade AI Market Advisor</span>
        <button id="chat-sidebar-clear-btn" class="secondary" style="padding:4px 10px; font-size:11px; font-weight:700; border-radius:4px;">Clear Chat</button>
      </div>
      <div class="chat-container">
        <div id="chat-sidebar-messages" class="chat-messages">
          <!-- Messages render here -->
        </div>
        
        <!-- Suggestion chips container -->
        <div class="chat-chips-container" id="chat-sidebar-chips-container">
          <span class="chat-chip" data-query="Suggest top bullish stocks from my watchlist">🔍 Watchlist Picks</span>
          <span class="chat-chip" data-query="Suggest high-growth stocks in IT/Banking sectors under ₹1000">📈 Sector Trends</span>
          <span class="chat-chip" data-query="Which stock shows the strongest buy momentum and why?">🔥 Best Momentum</span>
          <span class="chat-chip" data-query="Give me a simple option strategy recommendation matching Speculative Momentum">📊 Option Strategy</span>
        </div>

        <div class="chat-input-area">
          <button id="chat-sidebar-mic-btn" class="secondary mic-btn" title="Voice Input" style="padding: 6px 10px; border-radius: 8px;">🎤</button>
          <input type="text" id="chat-sidebar-user-input" placeholder="Ask about stocks..." class="search-inline-input">
          <button id="chat-sidebar-send-btn" class="search-inline-btn">Send</button>
        </div>
      </div>
    `;

    const chatMessagesEl = shadow.getElementById("chat-sidebar-messages");
    const chatUserInputEl = shadow.getElementById("chat-sidebar-user-input");
    const chatSendBtnEl = shadow.getElementById("chat-sidebar-send-btn");
    const chatClearBtnEl = shadow.getElementById("chat-sidebar-clear-btn");
    const chatChipsContainerEl = shadow.getElementById("chat-sidebar-chips-container");
    const chatMicBtnEl = shadow.getElementById("chat-sidebar-mic-btn");

    const scrollChatToBottom = () => {
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    };

    const renderChatHistory = () => {
      chrome.storage.local.get(["alphaChatHistory"], (res) => {
        const history = res.alphaChatHistory || [];
        chatMessagesEl.innerHTML = "";
        
        if (history.length === 0) {
          const welcome = document.createElement("div");
          welcome.className = "chat-bubble model";
          welcome.innerHTML = `
            <span class="chat-bubble-author">AuraTrade</span>
            <div>Hello! I am your **AuraTrade AI Market Advisor**. How can I assist you with your investment decisions today?</div>
          `;
          chatMessagesEl.appendChild(welcome);
        } else {
          history.forEach(msg => {
            const bubble = document.createElement("div");
            bubble.className = `chat-bubble ${msg.role}`;
            
            let author = msg.role === 'user' ? 'You' : 'AuraTrade';
            let bubbleHTML = `<span class="chat-bubble-author">${author}</span>`;
            bubbleHTML += `<div>${parseMarkdown(msg.text)}</div>`;
            
            if (msg.citations && msg.citations.length > 0) {
              bubbleHTML += `<div class="chat-citations">`;
              msg.citations.forEach(c => {
                bubbleHTML += `<a href="${c.url}" target="_blank" class="chat-citation-link" title="${c.title}">[${c.num}] ${c.title}</a>`;
              });
              bubbleHTML += `</div>`;
            }
            
            bubble.innerHTML = bubbleHTML;
            chatMessagesEl.appendChild(bubble);
          });
        }
        scrollChatToBottom();
      });
    };

    const submitChatMessage = () => {
      const text = chatUserInputEl.value.trim();
      if (!text) return;

      chatUserInputEl.value = "";
      chatUserInputEl.disabled = true;
      chatSendBtnEl.disabled = true;

      const userBubble = document.createElement("div");
      userBubble.className = "chat-bubble user";
      userBubble.innerHTML = `<span class="chat-bubble-author">You</span><div>${parseMarkdown(text)}</div>`;
      chatMessagesEl.appendChild(userBubble);
      scrollChatToBottom();

      const loadBubble = document.createElement("div");
      loadBubble.className = "chat-bubble model chat-loading-bubble";
      loadBubble.id = "chat-sidebar-loading-bubble";
      loadBubble.innerHTML = `
        <span class="chat-bubble-author">AuraTrade</span>
        <div class="loading-pulse" style="flex-direction:row; justify-content:flex-start; gap:8px; align-items:center;">
          <div class="loading-spinner" style="width:14px; height:14px; border-width:1.5px; margin:0;"></div>
          <span style="font-size:11px;">Analysing market conditions...</span>
        </div>
      `;
      chatMessagesEl.appendChild(loadBubble);
      scrollChatToBottom();

      chrome.storage.local.get(["alphaChatHistory"], (res) => {
        const history = res.alphaChatHistory || [];
        
        chrome.runtime.sendMessage({ action: "SEND_CHAT", message: text, history }, (response) => {
          const spinner = shadow.getElementById("chat-sidebar-loading-bubble");
          if (spinner) spinner.remove();

          chatUserInputEl.disabled = false;
          chatSendBtnEl.disabled = false;
          chatUserInputEl.focus();

          if (chrome.runtime.lastError) {
            showChatError(chrome.runtime.lastError.message);
            return;
          }

          if (response && response.success) {
            const aiResponse = response.response;
            history.push({ role: "user", text });
            history.push({ role: "model", text: aiResponse.text, citations: aiResponse.citations });
            
            chrome.storage.local.set({ alphaChatHistory: history }, () => {
              renderChatHistory();
            });
          } else {
            const errMsg = response ? response.error : "Failed to fetch response from Gemini.";
            showChatError(errMsg);
          }
        });
      });
    };

    const showChatError = (message) => {
      const errorBubble = document.createElement("div");
      errorBubble.className = "chat-bubble model";
      errorBubble.style.borderColor = "rgba(239, 68, 68, 0.3)";
      errorBubble.style.background = "rgba(239, 68, 68, 0.05)";
      errorBubble.innerHTML = `
        <span class="chat-bubble-author" style="color:var(--accent-red);">System Error</span>
        <div style="color:var(--accent-red); font-weight:600;">${message}</div>
      `;
      chatMessagesEl.appendChild(errorBubble);
      scrollChatToBottom();
    };

    const showSidebarChatMicPermissionError = () => {
      const errorBubble = document.createElement("div");
      errorBubble.className = "chat-bubble model";
      errorBubble.style.borderColor = "rgba(239, 68, 68, 0.3)";
      errorBubble.style.background = "rgba(239, 68, 68, 0.05)";
      errorBubble.innerHTML = `
        <span class="chat-bubble-author" style="color:var(--accent-red);">Voice Input Blocked</span>
        <div style="color:var(--text-slate-light); margin-bottom: 8px; font-size:12px;">Microphone access is blocked on this page. Click below to enable microphone access:</div>
        <button id="enable-mic-sidebar-btn" class="primary" style="padding: 6px 12px; font-size: 11px; font-weight: 700; width: 100%;">Setup Voice Access</button>
      `;
      chatMessagesEl.appendChild(errorBubble);
      scrollChatToBottom();

      const enableMicBtn = errorBubble.querySelector("#enable-mic-sidebar-btn");
      enableMicBtn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ action: "OPEN_VOICE_PERMISSION" });
      });
    };

    chatSendBtnEl.addEventListener("click", submitChatMessage);
    chatUserInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitChatMessage();
    });
    chatClearBtnEl.addEventListener("click", () => {
      chrome.storage.local.set({ alphaChatHistory: [] }, () => {
        renderChatHistory();
      });
    });
    if (chatMicBtnEl) {
      chatMicBtnEl.addEventListener("click", () => {
        toggleSidebarVoiceInput();
      });
    }

    if (chatChipsContainerEl) {
      chatChipsContainerEl.querySelectorAll(".chat-chip").forEach(chip => {
        chip.addEventListener("click", () => {
          chatUserInputEl.value = chip.getAttribute("data-query");
          submitChatMessage();
        });
      });
    }

    // Web Speech API Voice-to-text for sidebar
    let sidebarSpeechRecognition = null;
    let sidebarIsListening = false;

    const initSidebarVoiceRecognition = () => {
      if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
        console.warn("Speech recognition not supported in this browser.");
        return;
      }
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      sidebarSpeechRecognition = new SpeechRecognition();
      sidebarSpeechRecognition.continuous = false;
      sidebarSpeechRecognition.interimResults = false;
      sidebarSpeechRecognition.lang = 'en-IN'; // defaults to Indian English format

      sidebarSpeechRecognition.onstart = () => {
        sidebarIsListening = true;
        if (chatMicBtnEl) {
          chatMicBtnEl.classList.add("listening");
          chatMicBtnEl.title = "Listening... Click to stop";
        }
        chatUserInputEl.placeholder = "Listening...";
      };

      sidebarSpeechRecognition.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        chatUserInputEl.value = transcript;
      };

      sidebarSpeechRecognition.onerror = (e) => {
        console.error("Speech Recognition Error:", e.error);
        if (e.error === 'not-allowed') {
          showSidebarChatMicPermissionError();
        } else {
          showChatError(`Voice Input Error: ${e.error}`);
        }
      };

      sidebarSpeechRecognition.onend = () => {
        sidebarIsListening = false;
        if (chatMicBtnEl) {
          chatMicBtnEl.classList.remove("listening");
          chatMicBtnEl.title = "Voice Input";
        }
        chatUserInputEl.placeholder = "Ask about stocks...";
      };
    };

    const toggleSidebarVoiceInput = () => {
      if (!sidebarSpeechRecognition) {
        initSidebarVoiceRecognition();
      }
      if (!sidebarSpeechRecognition) return;

      if (sidebarIsListening) {
        sidebarSpeechRecognition.stop();
      } else {
        sidebarSpeechRecognition.start();
      }
    };

    renderChatHistory();
  }

})();

