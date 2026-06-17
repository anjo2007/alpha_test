// settings.js - ALPHA Configurator Script

document.addEventListener("DOMContentLoaded", () => {
  const geminiInput = document.getElementById("gemini-key");
  const geminiModelSelect = document.getElementById("gemini-model");
  const emailInput = document.getElementById("alert-email");
  const tokenInput = document.getElementById("gmail-token");
  const fbProjectInput = document.getElementById("fb-project");
  const fbKeyInput = document.getElementById("fb-key");
  const watchlistInput = document.getElementById("watchlist-input");
  
  const styleSelect = document.getElementById("investment-style");
  const themeSelect = document.getElementById("system-theme");
  const exchangeSelect = document.getElementById("default-exchange");
  const scannerTickersInput = document.getElementById("scanner-tickers");
  const includeTrendingSelect = document.getElementById("include-trending");
  const scanFrequencySelect = document.getElementById("scan-frequency");
  
  const portfolioAlertsEnabledSelect = document.getElementById("portfolio-alerts-enabled");
  const stopLossThresholdInput = document.getElementById("stop-loss-threshold");
  const sharpDropThresholdInput = document.getElementById("sharp-drop-threshold");
  
  const saveBtn = document.getElementById("save-btn");
  const testAlertBtn = document.getElementById("test-alert-btn");
  const testTickerInput = document.getElementById("test-ticker");
  const toast = document.getElementById("status-toast");

  // Load current configuration
  chrome.storage.local.get(["settings", "watchlist"], (result) => {
    const settings = result.settings || {};
    const watchlist = result.watchlist || [];

    if (settings.geminiKey) geminiInput.value = settings.geminiKey;
    if (settings.geminiModel) geminiModelSelect.value = settings.geminiModel;
    if (settings.alertEmail) emailInput.value = settings.alertEmail;
    if (settings.gmailToken) tokenInput.value = settings.gmailToken;
    if (settings.firebaseProject) fbProjectInput.value = settings.firebaseProject;
    if (settings.firebaseKey) fbKeyInput.value = settings.firebaseKey;
    
    if (settings.investmentStyle) styleSelect.value = settings.investmentStyle;
    if (settings.defaultExchange) exchangeSelect.value = settings.defaultExchange;
    if (settings.scannerTickers) {
      scannerTickersInput.value = settings.scannerTickers.join(", ");
    }
    
    includeTrendingSelect.value = settings.includeTrending !== false ? "true" : "false";
    if (settings.scanFrequency) scanFrequencySelect.value = settings.scanFrequency;
    
    portfolioAlertsEnabledSelect.value = settings.enablePortfolioAlerts !== false ? "true" : "false";
    stopLossThresholdInput.value = settings.stopLossThreshold || "5.0";
    sharpDropThresholdInput.value = settings.sharpDropThreshold || "3.0";
    
    if (settings.theme) {
      themeSelect.value = settings.theme;
      applyTheme(settings.theme);
    } else {
      applyTheme('light');
    }
    
    watchlistInput.value = watchlist.join(", ");
  });

  // Apply theme class to current page
  function applyTheme(theme) {
    if (theme === 'dark') {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  }

  // Save Config handler
  saveBtn.addEventListener("click", () => {
    const listRaw = watchlistInput.value || "";
    const parsedWatchlist = listRaw
      .split(",")
      .map(item => item.trim().toUpperCase())
      .filter(item => item.length > 0);

    const scannerRaw = scannerTickersInput.value || "";
    const parsedScannerTickers = scannerRaw
      .split(",")
      .map(item => item.trim().toUpperCase())
      .filter(item => item.length > 0);

    // Preserve existing lastAlertSent cooldown map from current settings
    chrome.storage.local.get(["settings"], (prev) => {
      const prevSettings = prev.settings || {};

      const settings = {
        geminiKey: geminiInput.value.trim(),
        geminiModel: geminiModelSelect.value,
        alertEmail: emailInput.value.trim(),
        gmailToken: tokenInput.value.trim(),
        firebaseProject: fbProjectInput.value.trim(),
        firebaseKey: fbKeyInput.value.trim(),
        investmentStyle: styleSelect.value,
        theme: themeSelect.value,
        defaultExchange: exchangeSelect.value,
        scannerTickers: parsedScannerTickers,
        includeTrending: includeTrendingSelect.value === "true",
        scanFrequency: scanFrequencySelect.value,
        lastAlertSent: prevSettings.lastAlertSent || {},
        enablePortfolioAlerts: portfolioAlertsEnabledSelect.value === "true",
        stopLossThreshold: stopLossThresholdInput.value.trim() || "5.0",
        sharpDropThreshold: sharpDropThresholdInput.value.trim() || "3.0"
      };

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";

      // Save watchlist and settings
      chrome.storage.local.set({ settings, watchlist: parsedWatchlist }, () => {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Settings";
        applyTheme(settings.theme);
        showToast("System configurations saved successfully.", "success");

        // Request background.js to sync the watchlist immediately to Firestore
        chrome.runtime.sendMessage({ action: "SYNC_WATCHLIST" }, () => {
          if (chrome.runtime.lastError) {
            console.warn("Watchlist Firestore sync skipped or failed:", chrome.runtime.lastError.message);
          }
        });
      });
    });
  });

  // Test Alert Dispatch validator
  testAlertBtn.addEventListener("click", () => {
    const ticker = testTickerInput.value.trim().toUpperCase();
    if (!ticker) {
      showToast("Please enter a ticker symbol to test.", "error");
      return;
    }

    testAlertBtn.disabled = true;
    testAlertBtn.textContent = "Dispatching...";
    showToast(`Initializing F-Score run and alert for ${ticker}...`, "success");

    chrome.runtime.sendMessage({ action: "TRIGGER_TEST_ALERT", ticker }, (response) => {
      testAlertBtn.disabled = false;
      testAlertBtn.textContent = "Dispatch Test Alert";

      if (chrome.runtime.lastError) {
        showToast(`Dispatch failed: ${chrome.runtime.lastError.message}`, "error");
        return;
      }

      if (response && response.success) {
        showToast(`Breakthrough Alert sent! F-Score computed: ${response.details.fScore}. Check Gmail inbox.`, "success");
      } else {
        const errMsg = response ? response.error : "Unknown validation failure.";
        showToast(`Dispatch failed: ${errMsg}`, "error");
      }
    });
  });

  function showToast(message, type) {
    toast.textContent = message;
    toast.className = `status-toast toast-${type}`;
    toast.style.display = "block";
    
    setTimeout(() => {
      toast.style.display = "none";
    }, 6000);
  }
});
