document.addEventListener("DOMContentLoaded", () => {
  const statusEl = document.getElementById("status");
  const resultEl = document.getElementById("result");

  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    statusEl.textContent = "Speech recognition not supported in this browser.";
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-IN'; // defaults to Indian English format

  recognition.onstart = () => {
    statusEl.textContent = "Listening... Please speak now.";
  };

  let finalTranscript = "";

  recognition.onresult = (e) => {
    let interimTranscript = "";
    for (let i = e.resultIndex; i < e.results.length; ++i) {
      if (e.results[i].isFinal) {
        finalTranscript += e.results[i][0].transcript;
      } else {
        interimTranscript += e.results[i][0].transcript;
      }
    }
    resultEl.textContent = finalTranscript + interimTranscript;
  };

  recognition.onerror = (e) => {
    console.error("Speech Recognition Error:", e.error);
    if (e.error === 'not-allowed') {
      statusEl.textContent = "Microphone access denied. Please allow it in the top right of the URL bar.";
    } else {
      statusEl.textContent = `Error: ${e.error}`;
    }
  };

  recognition.onend = () => {
    statusEl.textContent = "Processing...";
    if (finalTranscript.trim()) {
      // Send the result to background/popup
      chrome.runtime.sendMessage({ action: "VOICE_INPUT_RESULT", text: finalTranscript.trim() }, () => {
        // Close this tab after a brief moment
        setTimeout(() => window.close(), 1000);
      });
    } else {
      statusEl.textContent = "No voice detected. Closing...";
      setTimeout(() => window.close(), 2000);
    }
  };

  // Start immediately when the tab loads
  recognition.start();
});
