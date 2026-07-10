// ==========================================
// AutoFillQuiz - Popup Controller
// ==========================================

(function () {
  "use strict";

  // ─── DOM References ───────────────────────
  const $ = id => document.getElementById(id);

  const btnScan         = $("btn-scan");
  const btnAutofill     = $("btn-autofill");
  const btnHighlight    = $("btn-highlight-only");
  const btnClear        = $("btn-clear");
  const btnRefresh      = $("btn-refresh-page");
  const btnSaveSettings = $("btn-save-settings");
  const toggleKeyVis    = $("toggle-key-visibility");

  const statusLabel     = $("status-label");
  const statusSub       = $("status-sub");
  const statusIcon      = $("status-icon");
  const resultsBadge    = $("results-badge");
  const resultsCountBadge = $("results-count-badge");
  const resultsList     = $("results-list");
  const emptyResults    = $("empty-results");

  const apiKeyInput     = $("api-key-input");
  const modelSelect     = $("model-select");
  const toggleAutoHL    = $("toggle-auto-highlight");
  const toggleExplain   = $("toggle-show-explanation");
  const toggleVietnamese = $("toggle-vietnamese");

  // ─── State ───────────────────────────────
  let analysisResults = [];
  let extractedCount  = 0;
  let isAnalyzing     = false;

  // ─── Init ────────────────────────────────
  async function init() {
    await loadSettings();
    setupTabs();
    setupEventListeners();
    setupExternalLinks();
  }

  // ─── Settings persistence ─────────────────
  async function loadSettings() {
    return new Promise(resolve => {
      chrome.storage.sync.get(
        ["geminiApiKey", "modelName", "autoHighlight", "showExplanation", "vietnamese"],
        result => {
          if (result.geminiApiKey) apiKeyInput.value = result.geminiApiKey;
          if (result.modelName)    modelSelect.value  = result.modelName;
          if (result.autoHighlight !== undefined) toggleAutoHL.checked = result.autoHighlight;
          if (result.showExplanation !== undefined) toggleExplain.checked = result.showExplanation;
          if (result.vietnamese !== undefined) toggleVietnamese.checked = result.vietnamese;
          resolve();
        }
      );
    });
  }

  async function saveSettings() {
    const key = apiKeyInput.value.trim();
    return new Promise(resolve => {
      chrome.storage.sync.set({
        geminiApiKey:    key,
        modelName:       modelSelect.value,
        autoHighlight:   toggleAutoHL.checked,
        showExplanation: toggleExplain.checked,
        vietnamese:      toggleVietnamese.checked
      }, () => {
        resolve();
      });
    });
  }

  // ─── Tab system ───────────────────────────
  function setupTabs() {
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.tab;
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(`panel-${target}`).classList.add("active");
      });
    });
  }

  // ─── Event listeners ──────────────────────
  function setupEventListeners() {
    btnScan.addEventListener("click", onScan);
    btnAutofill.addEventListener("click", onAutoFill);
    btnHighlight.addEventListener("click", onHighlightOnly);
    btnClear.addEventListener("click", onClear);
    btnRefresh.addEventListener("click", () => location.reload());
    btnSaveSettings.addEventListener("click", onSaveSettings);
    toggleKeyVis.addEventListener("click", onToggleKeyVisibility);
  }

  function setupExternalLinks() {
    // Open external links in browser (not popup)
    document.querySelectorAll("a[target='_blank']").forEach(link => {
      link.addEventListener("click", e => {
        e.preventDefault();
        chrome.tabs.create({ url: link.href });
      });
    });
  }

  // ─── Main: Scan & Analyze ─────────────────
  async function onScan() {
    if (isAnalyzing) return;

    const apiKey = apiKeyInput.value.trim() || await getStoredApiKey();
    if (!apiKey) {
      setStatus("error", "Thiếu API key", "Vui lòng nhập API key trong tab Cài Đặt");
      switchTab("settings");
      return;
    }

    isAnalyzing = true;
    setStatus("loading", "Đang quét trang...", "AI đang đọc câu hỏi");
    setScanButtonLoading(true);
    clearResults();

    try {
      // Step 1: Flash scan overlay
      await sendToContent({ type: "AQZ_SCAN_FLASH" });

      // Step 2: Extract questions from page
      const extracted = await sendToContent({ type: "AQZ_EXTRACT" });
      if (!extracted?.questions?.length) {
        setStatus("warning", "Không tìm thấy câu hỏi", "Trang này không có câu trắc nghiệm hoặc dạng chưa được hỗ trợ");
        setScanButtonLoading(false);
        isAnalyzing = false;
        return;
      }

      extractedCount = extracted.questions.length;
      setStatus("loading", `Đã tìm thấy ${extractedCount} câu hỏi`, "AI đang suy luận đáp án...");

      // Step 3: Send to background for Gemini API
      const modelName = modelSelect.value || "gemini-2.0-flash";
      const response = await chrome.runtime.sendMessage({
        type: "ANALYZE_QUIZ",
        payload: {
          questions: extracted.questions.map(q => ({
            type: q.type,
            questionText: q.questionText,
            options: (q.options || []).map(o => ({ text: o.text }))
          })),
          apiKey,
          modelName
        }
      });

      if (!response?.success) {
        throw new Error(response?.error || "Lỗi không xác định từ AI");
      }

      analysisResults = response.data;

      // Step 4: Auto-highlight if enabled
      if (toggleAutoHL.checked) {
        await sendToContent({ type: "AQZ_HIGHLIGHT", payload: { results: analysisResults } });
      }

      // Step 5: Display results
      renderResults(analysisResults, extracted.questions);
      updateResultsBadge(analysisResults.length);

      const successCount = analysisResults.filter(r => r.answer && !r.error).length;
      setStatus("success", `Hoàn thành! ${successCount}/${extractedCount} câu`, "Xem kết quả tại tab Kết Quả");
      btnAutofill.disabled = false;
      btnHighlight.disabled = false;

      switchTab("results");

    } catch (err) {
      console.error("[AutoFillQuiz]", err);
      setStatus("error", "Đã xảy ra lỗi", err.message || "Kiểm tra API key và kết nối mạng");
    } finally {
      setScanButtonLoading(false);
      isAnalyzing = false;
    }
  }

  async function onAutoFill() {
    if (!analysisResults.length) return;
    await sendToContent({ type: "AQZ_AUTO_FILL", payload: { results: analysisResults } });
    setStatus("success", "Đã tự động điền!", "Kiểm tra các ô trả lời trên trang");
  }

  async function onHighlightOnly() {
    if (!analysisResults.length) return;
    await sendToContent({ type: "AQZ_HIGHLIGHT", payload: { results: analysisResults } });
    setStatus("success", "Đã highlight đáp án đúng!", "Màu xanh = đúng, mờ = sai");
  }

  async function onClear() {
    await sendToContent({ type: "AQZ_CLEAR" });
    clearResults();
    setStatus("idle", "Sẵn sàng phân tích", "Nhấn \"Quét trang\" để bắt đầu");
    btnAutofill.disabled = true;
    btnHighlight.disabled = true;
    updateResultsBadge(0);
  }

  async function onSaveSettings() {
    await saveSettings();
    btnSaveSettings.textContent = "✓ Đã lưu!";
    btnSaveSettings.style.background = "linear-gradient(135deg, #16a34a, #22c55e)";
    setTimeout(() => {
      btnSaveSettings.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Lưu Cài Đặt`;
      btnSaveSettings.style.background = "";
    }, 2000);
  }

  function onToggleKeyVisibility() {
    const isPassword = apiKeyInput.type === "password";
    apiKeyInput.type = isPassword ? "text" : "password";
    $("eye-icon").innerHTML = isPassword
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  }

  // ─── Render Results ───────────────────────
  function renderResults(results, questions) {
    // Clear existing result cards (keep empty state)
    resultsList.querySelectorAll(".result-card").forEach(el => el.remove());

    if (!results.length) {
      emptyResults.style.display = "flex";
      return;
    }

    emptyResults.style.display = "none";

    results.forEach((result, index) => {
      const card = document.createElement("div");
      const hasError = result.error || !result.answer;
      card.className = `result-card ${hasError ? "error" : "correct"}`;
      card.style.animationDelay = `${index * 0.05}s`;

      const qNum = index + 1;
      const qText = truncate(result.questionText, 80);
      const answer = result.answer;
      const isError = result.error;

      let answerHtml = "";
      if (isError) {
        answerHtml = `<span style="font-size:11px;color:#f87171;">⚠ ${result.error}</span>`;
      } else if (result.type === "fill_blank") {
        const fillText = answer?.answer || answer || "—";
        answerHtml = `
          <span class="answer-chip fill">💡 ${escHtml(fillText)}</span>
          ${renderConfidence(answer?.confidence)}
        `;
      } else {
        const letter   = answer?.answer || "?";
        const ansText  = answer?.answerText || "";
        answerHtml = `
          <span class="answer-chip">${escHtml(letter)}. ${escHtml(truncate(ansText, 30))}</span>
          ${renderConfidence(answer?.confidence)}
        `;
      }

      const explanationHtml = (toggleExplain.checked && answer?.explanation)
        ? `<div class="result-explanation">💬 ${escHtml(answer.explanation)}</div>`
        : "";

      card.innerHTML = `
        <div class="result-q">📝 <strong>${qNum}.</strong> ${escHtml(qText)}</div>
        <div class="result-answer">${answerHtml}</div>
        ${explanationHtml}
      `;

      resultsList.appendChild(card);
    });
  }

  function renderConfidence(level) {
    if (!level) return "";
    const labels = { high: "Chắc chắn", medium: "Có thể", low: "Không chắc" };
    return `<span class="confidence-chip ${level}">${labels[level] || level}</span>`;
  }

  // ─── Status Display ───────────────────────
  const statusConfigs = {
    idle: {
      color: "#6366f1",
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`
    },
    loading: {
      color: "#6366f1",
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`
    },
    success: {
      color: "#22c55e",
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>`
    },
    warning: {
      color: "#eab308",
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>`
    },
    error: {
      color: "#ef4444",
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
    }
  };

  function setStatus(type, label, sub) {
    const cfg = statusConfigs[type] || statusConfigs.idle;
    statusIcon.innerHTML = cfg.icon;
    statusIcon.style.borderColor = cfg.color + "40";
    statusIcon.style.background  = cfg.color + "18";
    statusLabel.textContent = label;
    statusSub.textContent   = sub;
  }

  function setScanButtonLoading(loading) {
    if (loading) {
      btnScan.disabled  = true;
      btnScan.innerHTML = `<div class="spinner"></div>Đang phân tích...`;
    } else {
      btnScan.disabled  = false;
      btnScan.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>Quét & Phân Tích Trang`;
    }
  }

  function clearResults() {
    resultsList.querySelectorAll(".result-card").forEach(el => el.remove());
    emptyResults.style.display = "flex";
    analysisResults = [];
  }

  function updateResultsBadge(count) {
    if (count > 0) {
      resultsBadge.style.display = "inline";
      resultsBadge.textContent   = count;
      resultsCountBadge.textContent = `${count} câu`;
    } else {
      resultsBadge.style.display = "none";
      resultsCountBadge.textContent = "0 câu";
    }
  }

  // ─── Utilities ───────────────────────────
  function switchTab(tabName) {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    document.querySelector(`[data-tab="${tabName}"]`)?.classList.add("active");
    document.getElementById(`panel-${tabName}`)?.classList.add("active");
  }

  async function sendToContent(message) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("Không tìm thấy tab hiện tại");

    // Ensure content script is injected (in case it failed to load)
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/content.js"]
      });
    } catch {}

    return chrome.tabs.sendMessage(tab.id, message);
  }

  async function getStoredApiKey() {
    return new Promise(resolve => {
      chrome.storage.sync.get(["geminiApiKey"], r => resolve(r.geminiApiKey || ""));
    });
  }

  function truncate(str, len) {
    if (!str) return "";
    return str.length > len ? str.slice(0, len) + "…" : str;
  }

  function escHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ─── Start ───────────────────────────────
  init();
})();
