// ==========================================
// AutoFillQuiz - Content Script
// Floating panel + DOM extractor + Highlighter
// ==========================================

(function () {
  "use strict";
  if (window.__aqzLoaded) {
    // Already loaded — just handle toggle
    chrome.runtime.onMessage.addListener(handleMessage);
    return;
  }
  window.__aqzLoaded = true;

  // ─── State ──────────────────────────────
  let panelVisible    = false;
  let panelMinimized  = false;
  let extractedQuestions = [];
  let analysisResults    = [];
  let isAnalyzing        = false;
  let settings = {
    geminiApiKey: "",
    modelName: "gemini-2.0-flash",
    autoHighlight: true,
    showExplanation: true,
    vietnamese: true
  };

  // ─── Init ────────────────────────────────
  loadSettings().then(() => {
    buildPanel();
    chrome.runtime.onMessage.addListener(handleMessage);
  });

  // ─── Message handler ─────────────────────
  function handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case "AQZ_TOGGLE_PANEL":
        togglePanel();
        sendResponse({ success: true });
        break;
      case "AQZ_EXTRACT":
        extractedQuestions = extractQuestions();
        sendResponse({ success: true, questions: extractedQuestions });
        break;
      case "AQZ_HIGHLIGHT":
        applyHighlights(message.payload.results);
        sendResponse({ success: true });
        break;
      case "AQZ_AUTO_FILL":
        autoFillAnswers(message.payload.results);
        sendResponse({ success: true });
        break;
      case "AQZ_CLEAR":
        clearHighlights();
        sendResponse({ success: true });
        break;
    }
    return true;
  }

  // ════════════════════════════════════════════
  // PART 1: FLOATING PANEL
  // ════════════════════════════════════════════

  function buildPanel() {
    // Remove if already exists
    const existing = document.getElementById("aqz-panel-host");
    if (existing) existing.remove();

    const iconUrl = chrome.runtime.getURL("assets/icon48.png");

    const host = document.createElement("div");
    host.id = "aqz-panel-host";
    host.innerHTML = `
      <div id="aqz-panel">

        <!-- Header (drag handle) -->
        <div id="aqz-panel-header">
          <img src="${iconUrl}" id="aqz-panel-logo" alt="" />
          <div id="aqz-panel-title">
            <h1>AutoFillQuiz</h1>
            <p>AI-powered quiz assistant · kéo để di chuyển</p>
          </div>
          <button class="aqz-hdr-btn minimize" id="aqz-btn-minimize" title="Thu nhỏ">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button class="aqz-hdr-btn" id="aqz-btn-refresh" title="Làm mới">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
          </button>
          <button class="aqz-hdr-btn close" id="aqz-btn-close" title="Đóng">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <!-- Tabs -->
        <nav id="aqz-panel-tabs">
          <button class="aqz-tab active" data-tab="analyze">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Phân Tích
          </button>
          <button class="aqz-tab" data-tab="results">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            Kết Quả
            <span id="aqz-results-badge" style="display:none;background:rgba(99,102,241,0.8);color:#fff;font-size:9px;padding:1px 6px;border-radius:999px;"></span>
          </button>
          <button class="aqz-tab" data-tab="settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            Cài Đặt
          </button>
        </nav>

        <!-- Body -->
        <div id="aqz-panel-body">

          <!-- TAB: Analyze -->
          <div class="aqz-tab-panel active" id="aqz-panel-analyze">
            <div class="aqz-status-card">
              <div class="aqz-status-icon" id="aqz-status-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </div>
              <div>
                <div class="aqz-status-label" id="aqz-status-label">Sẵn sàng phân tích</div>
                <div class="aqz-status-sub"   id="aqz-status-sub">Nhấn "Quét trang" để bắt đầu</div>
              </div>
            </div>

            <div class="aqz-btn-group">
              <button class="aqz-btn aqz-btn-primary" id="aqz-btn-scan">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                Quét & Phân Tích Trang
              </button>
              <div class="aqz-btn-row">
                <button class="aqz-btn aqz-btn-success" id="aqz-btn-autofill" disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                  Auto-fill
                </button>
                <button class="aqz-btn aqz-btn-ghost" id="aqz-btn-highlight" disabled>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  Highlight
                </button>
                <button class="aqz-btn aqz-btn-ghost" id="aqz-btn-clear">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                  Xóa
                </button>
              </div>
            </div>

            <div class="aqz-guide">
              <h4>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>
                Cách sử dụng
              </h4>
              <ol class="aqz-steps">
                <li><span class="aqz-step-num">1</span> Mở trang web có bài quiz/trắc nghiệm</li>
                <li><span class="aqz-step-num">2</span> Nhấn <strong style="color:#a5b4fc">"Quét & Phân Tích Trang"</strong> — AI đọc toàn bộ câu hỏi</li>
                <li><span class="aqz-step-num">3</span> AI highlight màu xanh câu đúng trực tiếp trên trang!</li>
              </ol>
            </div>
          </div>

          <!-- TAB: Results -->
          <div class="aqz-tab-panel" id="aqz-panel-results">
            <div class="aqz-results-hdr">
              <span>Kết quả phân tích</span>
              <span class="aqz-count-badge" id="aqz-count-badge">0 câu</span>
            </div>
            <div id="aqz-results-list">
              <div class="aqz-empty" id="aqz-empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#334155" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12h6M9 8h6M9 16h4"/></svg>
                <p>Chưa có kết quả.<br/>Hãy quét trang để AI phân tích.</p>
              </div>
            </div>
          </div>

          <!-- TAB: Settings -->
          <div class="aqz-tab-panel" id="aqz-panel-settings">

            <div class="aqz-settings-section">
              <label>Gemini API Key</label>
              <div class="aqz-input-wrap">
                <svg class="prefix" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <input type="password" id="aqz-api-key" placeholder="AIzaSy..." autocomplete="off" spellcheck="false" />
                <button class="aqz-eye-btn" id="aqz-eye-btn" title="Hiện/ẩn">
                  <svg id="aqz-eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
              </div>
              <p class="aqz-hint">Lấy miễn phí tại <a href="https://aistudio.google.com/apikey" id="aqz-link-key" target="_blank">aistudio.google.com/apikey</a> → Create API key</p>
            </div>

            <div class="aqz-settings-section">
              <label>AI Model</label>
              <div class="aqz-input-wrap">
                <svg class="prefix" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 0v20M2 12h20"/></svg>
                <select id="aqz-model-select">
                  <option value="gemini-2.0-flash">Gemini 2.0 Flash (Nhanh, miễn phí)</option>
                  <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                  <option value="gemini-1.5-pro">Gemini 1.5 Pro (Chính xác hơn)</option>
                </select>
              </div>
            </div>

            <div class="aqz-settings-section">
              <label>Tùy chọn</label>
              <div class="aqz-toggle-row">
                <div class="aqz-toggle-lbl">Tự động highlight<small>Hiển thị màu ngay sau khi AI trả lời</small></div>
                <label class="aqz-toggle"><input type="checkbox" id="aqz-tog-hl" checked /><span class="aqz-toggle-slider"></span></label>
              </div>
              <div class="aqz-toggle-row">
                <div class="aqz-toggle-lbl">Hiện giải thích<small>Tooltip lý do tại sao đáp án đúng</small></div>
                <label class="aqz-toggle"><input type="checkbox" id="aqz-tog-exp" checked /><span class="aqz-toggle-slider"></span></label>
              </div>
            </div>

            <button class="aqz-btn aqz-btn-primary" id="aqz-btn-save" style="margin-top:4px">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Lưu Cài Đặt
            </button>

            <div class="aqz-sep"></div>

            <div class="aqz-guide">
              <h4>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                Hướng dẫn lấy API Key
              </h4>
              <ol class="aqz-steps">
                <li><span class="aqz-step-num">1</span> Truy cập <a href="https://aistudio.google.com/apikey" id="aqz-link-guide" target="_blank" style="color:#818cf8">aistudio.google.com/apikey</a></li>
                <li><span class="aqz-step-num">2</span> Đăng nhập bằng tài khoản Google</li>
                <li><span class="aqz-step-num">3</span> Click <strong style="color:#a5b4fc">"Create API key"</strong> → Copy key</li>
                <li><span class="aqz-step-num">4</span> Dán vào ô phía trên → Lưu Cài Đặt</li>
              </ol>
            </div>
          </div>

        </div><!-- /body -->

        <div id="aqz-panel-footer">AutoFillQuiz v1.0 · Powered by <span>Google Gemini AI</span></div>
      </div>
    `;

    document.body.appendChild(host);
    setupPanelEvents(host);
    restorePanelPosition(host);
    syncSettingsToUI();
  }

  function togglePanel() {
    const host = document.getElementById("aqz-panel-host");
    if (!host) { buildPanel(); }
    panelVisible = !panelVisible;
    const h = document.getElementById("aqz-panel-host");
    if (panelVisible) {
      h.classList.add("visible");
      // Un-minimize when showing
      if (panelMinimized) {
        panelMinimized = false;
        h.classList.remove("minimized");
      }
    } else {
      h.classList.remove("visible");
    }
  }

  // ─── Panel event wiring ───────────────────
  function setupPanelEvents(host) {
    // Tabs
    host.querySelectorAll(".aqz-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        host.querySelectorAll(".aqz-tab").forEach(b => b.classList.remove("active"));
        host.querySelectorAll(".aqz-tab-panel").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        host.querySelector(`#aqz-panel-${btn.dataset.tab}`).classList.add("active");
      });
    });

    // Header buttons
    host.querySelector("#aqz-btn-close").addEventListener("click", () => {
      panelVisible = false;
      host.classList.remove("visible");
    });

    host.querySelector("#aqz-btn-minimize").addEventListener("click", () => {
      panelMinimized = !panelMinimized;
      host.classList.toggle("minimized", panelMinimized);
    });

    host.querySelector("#aqz-btn-refresh").addEventListener("click", () => {
      clearResultsUI();
      setStatus("idle", "Sẵn sàng phân tích", "Nhấn \"Quét trang\" để bắt đầu");
      host.querySelector("#aqz-btn-autofill").disabled = true;
      host.querySelector("#aqz-btn-highlight").disabled = true;
    });

    // Main buttons
    host.querySelector("#aqz-btn-scan").addEventListener("click", onScan);
    host.querySelector("#aqz-btn-autofill").addEventListener("click", onAutoFill);
    host.querySelector("#aqz-btn-highlight").addEventListener("click", onHighlightOnly);
    host.querySelector("#aqz-btn-clear").addEventListener("click", onClear);

    // Settings
    host.querySelector("#aqz-btn-save").addEventListener("click", onSaveSettings);
    host.querySelector("#aqz-eye-btn").addEventListener("click", onToggleKeyVisibility);

    // External links
    host.querySelectorAll("a[target='_blank']").forEach(a => {
      a.addEventListener("click", e => {
        e.preventDefault();
        chrome.runtime.sendMessage({ type: "OPEN_URL", url: a.href }).catch(() => {
          window.open(a.href, "_blank");
        });
      });
    });

    // Drag
    makeDraggable(host, host.querySelector("#aqz-panel-header"));
  }

  // ─── Drag logic ───────────────────────────
  function makeDraggable(panel, handle) {
    let startX, startY, startLeft, startTop;
    let isDragging = false;

    handle.addEventListener("mousedown", e => {
      // Ignore clicks on buttons inside header
      if (e.target.closest("button")) return;

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = panel.getBoundingClientRect();
      startLeft = rect.left;
      startTop  = rect.top;

      panel.style.transition = "none";
      document.body.style.userSelect = "none";

      e.preventDefault();
    });

    document.addEventListener("mousemove", e => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newLeft = startLeft + dx;
      let newTop  = startTop  + dy;

      // Clamp within viewport
      const panelW = panel.offsetWidth;
      const panelH = panel.offsetHeight;
      newLeft = Math.max(0, Math.min(window.innerWidth  - panelW, newLeft));
      newTop  = Math.max(0, Math.min(window.innerHeight - panelH, newTop));

      panel.style.left   = newLeft + "px";
      panel.style.top    = newTop  + "px";
      panel.style.right  = "auto";
      panel.style.bottom = "auto";
    });

    document.addEventListener("mouseup", () => {
      if (!isDragging) return;
      isDragging = false;
      document.body.style.userSelect = "";
      panel.style.transition = "";
      // Save position
      chrome.storage.local.set({
        aqzPanelLeft: panel.style.left,
        aqzPanelTop:  panel.style.top
      });
    });
  }

  function restorePanelPosition(panel) {
    chrome.storage.local.get(["aqzPanelLeft", "aqzPanelTop"], result => {
      if (result.aqzPanelLeft) {
        panel.style.left  = result.aqzPanelLeft;
        panel.style.top   = result.aqzPanelTop;
        panel.style.right = "auto";
      }
    });
  }

  // ════════════════════════════════════════════
  // PART 2: SCAN / ANALYZE
  // ════════════════════════════════════════════

  async function onScan() {
    if (isAnalyzing) return;
    const apiKey = document.getElementById("aqz-api-key")?.value.trim() || settings.geminiApiKey;
    if (!apiKey) {
      setStatus("error", "Thiếu API key", "Vào ⚙ Cài Đặt để nhập API key");
      switchTab("settings");
      return;
    }

    isAnalyzing = true;
    setScanLoading(true);
    setStatus("loading", "Đang quét trang...", "AI đang đọc câu hỏi");
    clearResultsUI();

    try {
      showScanFlash();
      extractedQuestions = extractQuestions();

      if (!extractedQuestions.length) {
        setStatus("warning", "Không tìm thấy câu hỏi", "Trang này không có câu trắc nghiệm nhận dạng được");
        return;
      }

      setStatus("loading", `Tìm thấy ${extractedQuestions.length} câu`, "AI đang suy luận...");

      const modelName = document.getElementById("aqz-model-select")?.value || settings.modelName;
      const response = await chrome.runtime.sendMessage({
        type: "ANALYZE_QUIZ",
        payload: {
          questions: extractedQuestions.map(q => ({
            type: q.type,
            questionText: q.questionText,
            options: (q.options || []).map(o => ({ text: o.text }))
          })),
          apiKey,
          modelName
        }
      });

      if (!response?.success) throw new Error(response?.error || "Lỗi AI");

      analysisResults = response.data;

      const autoHL = document.getElementById("aqz-tog-hl")?.checked ?? settings.autoHighlight;
      if (autoHL) applyHighlights(analysisResults);

      renderResults(analysisResults);
      updateBadge(analysisResults.length);

      const ok = analysisResults.filter(r => r.answer && !r.error).length;
      setStatus("success", `✓ Xong! ${ok}/${extractedQuestions.length} câu`, "Xem kết quả tại tab Kết Quả");

      const host = document.getElementById("aqz-panel-host");
      host.querySelector("#aqz-btn-autofill").disabled = false;
      host.querySelector("#aqz-btn-highlight").disabled = false;

      switchTab("results");

    } catch (err) {
      console.error("[AutoFillQuiz]", err);
      setStatus("error", "Lỗi xảy ra", err.message || "Kiểm tra API key và mạng");
    } finally {
      setScanLoading(false);
      isAnalyzing = false;
    }
  }

  async function onAutoFill() {
    if (!analysisResults.length) return;
    autoFillAnswers(analysisResults);
    setStatus("success", "Đã tự động điền!", "Kiểm tra các ô trả lời");
  }

  async function onHighlightOnly() {
    if (!analysisResults.length) return;
    applyHighlights(analysisResults);
    setStatus("success", "Đã highlight!", "Xanh = đúng · Mờ = sai");
  }

  function onClear() {
    clearHighlights();
    clearResultsUI();
    analysisResults = [];
    setStatus("idle", "Sẵn sàng phân tích", "Nhấn \"Quét trang\" để bắt đầu");
    updateBadge(0);
    const host = document.getElementById("aqz-panel-host");
    host.querySelector("#aqz-btn-autofill").disabled = true;
    host.querySelector("#aqz-btn-highlight").disabled = true;
  }

  // ─── Settings ────────────────────────────
  async function onSaveSettings() {
    const key   = document.getElementById("aqz-api-key")?.value.trim() || "";
    const model = document.getElementById("aqz-model-select")?.value || "gemini-2.0-flash";
    const hl    = document.getElementById("aqz-tog-hl")?.checked ?? true;
    const exp   = document.getElementById("aqz-tog-exp")?.checked ?? true;

    settings = { geminiApiKey: key, modelName: model, autoHighlight: hl, showExplanation: exp };

    await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      payload: { geminiApiKey: key, modelName: model, autoHighlight: hl, showExplanation: exp }
    });

    const btn = document.getElementById("aqz-btn-save");
    if (btn) {
      btn.textContent = "✓ Đã lưu!";
      btn.style.background = "linear-gradient(135deg,#16a34a,#22c55e)";
      setTimeout(() => {
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Lưu Cài Đặt`;
        btn.style.background = "";
      }, 2000);
    }

    showToast("✓ Đã lưu cài đặt", "success");
  }

  function onToggleKeyVisibility() {
    const input = document.getElementById("aqz-api-key");
    const icon  = document.getElementById("aqz-eye-icon");
    if (!input) return;
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    icon.innerHTML = isPassword
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  }

  async function loadSettings() {
    return new Promise(resolve => {
      chrome.storage.sync.get(
        ["geminiApiKey", "modelName", "autoHighlight", "showExplanation"],
        result => {
          if (result.geminiApiKey)    settings.geminiApiKey    = result.geminiApiKey;
          if (result.modelName)       settings.modelName       = result.modelName;
          if (result.autoHighlight !== undefined) settings.autoHighlight   = result.autoHighlight;
          if (result.showExplanation !== undefined) settings.showExplanation = result.showExplanation;
          resolve();
        }
      );
    });
  }

  function syncSettingsToUI() {
    const apiInput = document.getElementById("aqz-api-key");
    const modelSel = document.getElementById("aqz-model-select");
    const togHL    = document.getElementById("aqz-tog-hl");
    const togExp   = document.getElementById("aqz-tog-exp");
    if (apiInput && settings.geminiApiKey) apiInput.value = settings.geminiApiKey;
    if (modelSel  && settings.modelName)   modelSel.value  = settings.modelName;
    if (togHL)  togHL.checked  = settings.autoHighlight;
    if (togExp) togExp.checked = settings.showExplanation;
  }

  // ════════════════════════════════════════════
  // PART 3: DOM EXTRACTION
  // ════════════════════════════════════════════

  function extractQuestions() {
    const questions = [];
    questions.push(...extractRadioGroups());
    questions.push(...extractCheckboxGroups());
    questions.push(...extractSelectDropdowns());
    questions.push(...extractFillBlanks());
    questions.push(...extractGoogleForms());
    if (questions.length === 0) questions.push(...extractGenericQuestions());

    const seen = new Set();
    return questions.filter(q => {
      const key = q.questionText.trim().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function extractRadioGroups() {
    const questions = [], groups = {};
    document.querySelectorAll('input[type="radio"]').forEach(r => {
      const name = r.name || "g_" + Math.random();
      if (!groups[name]) groups[name] = [];
      groups[name].push(r);
    });
    for (const radios of Object.values(groups)) {
      if (radios.length < 2 || radios.length > 10) continue;
      const questionText = findQuestionText(radios[0]);
      if (!questionText) continue;
      const options = radios.map(r => ({ text: findLabelFor(r) || r.value || "", element: r, labelElement: findLabelElementFor(r) })).filter(o => o.text);
      if (options.length < 2) continue;
      questions.push({ type: "multiple_choice", questionText, options, questionElement: findQuestionElement(radios[0]), inputType: "radio" });
    }
    return questions;
  }

  function extractCheckboxGroups() {
    const questions = [], processed = new Set();
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (processed.has(cb)) return;
      const container = findCheckboxContainer(cb);
      if (!container) return;
      const cbs = Array.from(container.querySelectorAll('input[type="checkbox"]'));
      if (cbs.length < 2) return;
      cbs.forEach(c => processed.add(c));
      const questionText = findQuestionText(cbs[0]);
      if (!questionText) return;
      const options = cbs.map(c => ({ text: findLabelFor(c) || c.value || "", element: c, labelElement: findLabelElementFor(c) })).filter(o => o.text);
      if (options.length < 2) return;
      questions.push({ type: "multiple_choice", questionText, options, questionElement: findQuestionElement(cbs[0]), inputType: "checkbox" });
    });
    return questions;
  }

  function extractSelectDropdowns() {
    const questions = [];
    document.querySelectorAll("select").forEach(sel => {
      const validOpts = Array.from(sel.options).filter(o => o.value && o.text.trim());
      if (validOpts.length < 2) return;
      const questionText = findQuestionText(sel);
      if (!questionText) return;
      questions.push({ type: "multiple_choice", questionText, options: validOpts.map(o => ({ text: o.text.trim(), element: o, selectElement: sel })), questionElement: findQuestionElement(sel), inputType: "select", selectElement: sel });
    });
    return questions;
  }

  function extractFillBlanks() {
    const questions = [];
    const skipTypes = new Set(["submit", "button", "image", "hidden", "file", "radio", "checkbox"]);
    document.querySelectorAll('input[type="text"], input:not([type]), textarea').forEach(inp => {
      if (inp.type && skipTypes.has(inp.type)) return;
      if (inp.closest("#aqz-panel-host")) return;
      const questionText = findQuestionText(inp);
      if (!questionText || questionText.length < 5) return;
      questions.push({ type: "fill_blank", questionText, options: [], questionElement: findQuestionElement(inp), inputType: "text", inputElement: inp });
    });
    return questions;
  }

  function extractGoogleForms() {
    const questions = [];
    document.querySelectorAll('[role="listitem"], .Qr7Oae, .geS5n').forEach(c => {
      const qEl = c.querySelector('.M7eMe, [role="heading"], .z12JJ');
      if (!qEl) return;
      const questionText = qEl.textContent.trim();
      if (!questionText) return;
      const radioOpts = c.querySelectorAll('[role="radio"], [role="checkbox"]');
      if (radioOpts.length >= 2) {
        const options = Array.from(radioOpts).map(o => ({
          text: o.querySelector('.YEVVod')?.textContent?.trim() || o.getAttribute("aria-label") || "",
          element: o, labelElement: o
        })).filter(o => o.text);
        if (options.length >= 2) questions.push({ type: "multiple_choice", questionText, options, questionElement: c, inputType: "gforms_radio" });
      }
      const textInp = c.querySelector('input[type="text"], textarea');
      if (textInp && radioOpts.length === 0) {
        questions.push({ type: "fill_blank", questionText, options: [], questionElement: c, inputType: "text", inputElement: textInp });
      }
    });
    return questions;
  }

  function extractGenericQuestions() {
    const questions = [];
    const pat = /^(\d+[\.\)]\s+|câu\s+\d+|question\s+\d+)/i;
    document.querySelectorAll("p, li, div, span, h1,h2,h3,h4,h5, td").forEach(el => {
      const text = el.textContent.trim();
      if (!pat.test(text) || text.length < 10 || el.querySelectorAll("*").length > 20) return;
      const answers = findNearbyOptions(el);
      if (answers.length >= 2) questions.push({ type: "multiple_choice", questionText: text, options: answers, questionElement: el, inputType: "text_only" });
    });
    return questions;
  }

  // ─── DOM helpers ─────────────────────────
  function findQuestionText(element) {
    const strategies = [
      () => element.closest("fieldset")?.querySelector("legend")?.textContent?.trim(),
      () => { const id = element.getAttribute("aria-labelledby"); return id ? document.getElementById(id)?.textContent?.trim() : null; },
      () => element.id ? document.querySelector(`label[for="${element.id}"]`)?.textContent?.trim() : null,
      () => {
        let el = element.parentElement, d = 0;
        while (el && d < 8) {
          for (const h of el.querySelectorAll("h1,h2,h3,h4,h5,h6,p,strong,b")) {
            const t = h.textContent.trim();
            if (t.length > 10 && t.length < 500 && !h.querySelector("input,select,textarea")) return t;
          }
          el = el.parentElement; d++;
        }
        return null;
      },
      () => {
        let s = element.parentElement?.previousElementSibling, d = 0;
        while (s && d < 4) {
          const t = s.textContent.trim();
          if (t.length > 10 && t.length < 500) return t;
          s = s.previousElementSibling; d++;
        }
        return null;
      }
    ];
    for (const fn of strategies) {
      try { const r = fn(); if (r && r.length > 5) return r; } catch {}
    }
    return null;
  }

  function findQuestionElement(el) {
    let e = el.parentElement, d = 0;
    while (e && d < 6) {
      if (e.querySelectorAll('input[type="radio"], input[type="checkbox"]').length >= 2) return e;
      if (e.tagName === "FORM" || e.tagName === "FIELDSET") return e;
      e = e.parentElement; d++;
    }
    return el.closest("div, section, article") || el.parentElement;
  }

  function findLabelFor(input) {
    if (input.id) { const l = document.querySelector(`label[for="${input.id}"]`); if (l) return l.textContent.trim(); }
    const wrap = input.closest("label");
    if (wrap) return wrap.textContent.trim();
    if (input.getAttribute("aria-label")) return input.getAttribute("aria-label");
    const next = input.nextElementSibling;
    if (next) return next.textContent.trim();
    const p = input.parentElement;
    if (p) { const c = p.cloneNode(true); c.querySelectorAll("input").forEach(i => i.remove()); return c.textContent.trim(); }
    return input.value || "";
  }

  function findLabelElementFor(input) {
    if (input.id) { const l = document.querySelector(`label[for="${input.id}"]`); if (l) return l; }
    return input.closest("label") || input.parentElement;
  }

  function findCheckboxContainer(cb) {
    let el = cb.parentElement, d = 0;
    while (el && d < 6) {
      const c = el.querySelectorAll('input[type="checkbox"]');
      if (c.length >= 2 && c.length <= 10) return el;
      el = el.parentElement; d++;
    }
    return null;
  }

  function findNearbyOptions(qEl) {
    const opts = [];
    let el = qEl.nextElementSibling, n = 0;
    while (el && n < 10) {
      const t = el.textContent.trim();
      if (/^[A-Da-d][\.\)]\s*.+/.test(t)) opts.push({ text: t, element: el, labelElement: el });
      el = el.nextElementSibling; n++;
    }
    return opts;
  }

  // ════════════════════════════════════════════
  // PART 4: HIGHLIGHT & AUTO-FILL
  // ════════════════════════════════════════════

  function applyHighlights(results) {
    clearHighlights();
    results.forEach(result => {
      if (!result.answer) return;
      const q = extractedQuestions.find(q => q.questionText.trim() === result.questionText.trim());
      if (!q) return;
      if (result.type === "fill_blank") highlightFillBlank(q, result);
      else highlightMCQ(q, result);
    });
  }

  function highlightMCQ(question, result) {
    const { options } = question;
    const correctIndex = result.answer?.answerIndex ?? -1;
    const correctText  = (result.answer?.answerText || "").toLowerCase();
    const correctLetter = (result.answer?.answer || "").toUpperCase();
    const showExp = document.getElementById("aqz-tog-exp")?.checked ?? settings.showExplanation;

    options.forEach((opt, idx) => {
      const isCorrect = idx === correctIndex ||
        opt.text.toLowerCase().includes(correctText) ||
        opt.text.toUpperCase().startsWith(correctLetter + ".");
      const el = opt.labelElement || opt.element;
      if (!el) return;
      if (window.getComputedStyle(el).position === "static") el.style.position = "relative";

      if (isCorrect) {
        el.classList.add("aqz-highlight-correct");
        const badge = document.createElement("span");
        badge.className = "aqz-badge-correct aqz-injected";
        badge.textContent = "✓ Đúng";
        el.appendChild(badge);
        if (showExp && result.answer?.explanation) {
          const tip = document.createElement("span");
          tip.className = "aqz-injected";
          tip.style.cssText = "display:none;position:absolute;bottom:calc(100% + 6px);left:0;background:#0f172a;color:#e2e8f0;font-size:11px;padding:6px 10px;border-radius:8px;max-width:260px;white-space:normal;z-index:2147483647;border:1px solid rgba(99,102,241,0.3);line-height:1.5;";
          tip.textContent = result.answer.explanation;
          el.appendChild(tip);
          el.addEventListener("mouseenter", () => { tip.style.display = "block"; });
          el.addEventListener("mouseleave", () => { tip.style.display = "none"; });
        }
      } else {
        el.classList.add("aqz-highlight-wrong");
      }
    });
  }

  function highlightFillBlank(question, result) {
    const input = question.inputElement;
    if (!input) return;
    const answerText = result.answer?.answer || result.answer || "";
    const hint = document.createElement("span");
    hint.className = "aqz-fill-result aqz-injected";
    hint.textContent = `💡 ${answerText}`;
    input.parentElement?.insertBefore(hint, input.nextSibling);
    input.style.outline = "2px solid rgba(99,102,241,0.7)";
    input.style.outlineOffset = "2px";
  }

  function autoFillAnswers(results) {
    let filled = 0;
    results.forEach(result => {
      if (!result.answer) return;
      const q = extractedQuestions.find(q => q.questionText.trim() === result.questionText.trim());
      if (!q) return;
      if (result.type === "fill_blank") { fillTextInput(q, result); filled++; }
      else { fillMCQ(q, result); filled++; }
    });
    showToast(`⚡ Đã tự động điền ${filled} câu`, "success");
  }

  function fillMCQ(q, result) {
    const idx = result.answer?.answerIndex ?? -1;
    if (q.inputType === "select" && q.selectElement) {
      const opt = q.selectElement.options[idx];
      if (opt) { q.selectElement.value = opt.value; q.selectElement.dispatchEvent(new Event("change", { bubbles: true })); }
      return;
    }
    if (q.inputType === "gforms_radio") {
      const t = q.options[idx]?.element;
      if (t) { t.click(); setTimeout(() => t.dispatchEvent(new MouseEvent("click", { bubbles: true })), 100); }
      return;
    }
    const t = q.options[idx]?.element;
    if (t) { t.checked = true; t.click(); t.dispatchEvent(new Event("change", { bubbles: true })); }
  }

  function fillTextInput(q, result) {
    const input = q.inputElement;
    if (!input) return;
    const val = result.answer?.answer || result.answer || "";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, val); else input.value = val;
    ["input", "change", "keyup"].forEach(evt => input.dispatchEvent(new Event(evt, { bubbles: true })));
  }

  function clearHighlights() {
    document.querySelectorAll(".aqz-highlight-correct, .aqz-highlight-wrong").forEach(el => {
      el.classList.remove("aqz-highlight-correct", "aqz-highlight-wrong");
      el.style.position = "";
    });
    document.querySelectorAll(".aqz-injected").forEach(el => el.remove());
    document.querySelectorAll('input[style*="outline"]').forEach(el => { el.style.outline = ""; el.style.outlineOffset = ""; });
  }

  // ════════════════════════════════════════════
  // PART 5: UI HELPERS
  // ════════════════════════════════════════════

  function renderResults(results) {
    const list = document.getElementById("aqz-results-list");
    const empty = document.getElementById("aqz-empty-state");
    if (!list) return;
    list.querySelectorAll(".aqz-result-card").forEach(el => el.remove());
    if (!results.length) { if (empty) empty.style.display = "flex"; return; }
    if (empty) empty.style.display = "none";
    const showExp = document.getElementById("aqz-tog-exp")?.checked ?? settings.showExplanation;

    results.forEach((r, i) => {
      const card = document.createElement("div");
      card.className = `aqz-result-card ${r.error ? "error" : "correct"}`;
      card.style.animationDelay = `${i * 0.04}s`;
      const qText = esc(trunc(r.questionText, 70));
      let ansHtml = "";
      if (r.error) {
        ansHtml = `<span style="font-size:10px;color:#f87171;">⚠ ${esc(r.error)}</span>`;
      } else if (r.type === "fill_blank") {
        ansHtml = `<span class="aqz-answer-chip fill">💡 ${esc(r.answer?.answer || r.answer || "—")}</span>${confChip(r.answer?.confidence)}`;
      } else {
        ansHtml = `<span class="aqz-answer-chip">${esc(r.answer?.answer || "?")}. ${esc(trunc(r.answer?.answerText || "", 28))}</span>${confChip(r.answer?.confidence)}`;
      }
      const expHtml = showExp && r.answer?.explanation ? `<div class="aqz-result-exp">💬 ${esc(r.answer.explanation)}</div>` : "";
      card.innerHTML = `<div class="aqz-result-q">📝 <strong>${i+1}.</strong> ${qText}</div><div class="aqz-result-ans">${ansHtml}</div>${expHtml}`;
      list.appendChild(card);
    });
  }

  function confChip(level) {
    if (!level) return "";
    const labels = { high: "Chắc chắn", medium: "Có thể", low: "Không chắc" };
    return `<span class="aqz-conf ${level}">${labels[level] || level}</span>`;
  }

  function clearResultsUI() {
    const list = document.getElementById("aqz-results-list");
    if (list) list.querySelectorAll(".aqz-result-card").forEach(el => el.remove());
    const empty = document.getElementById("aqz-empty-state");
    if (empty) empty.style.display = "flex";
  }

  const statusCfg = {
    idle:    { color: "#6366f1", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>` },
    loading: { color: "#6366f1", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" style="animation:aqzSpin 0.9s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>` },
    success: { color: "#22c55e", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>` },
    warning: { color: "#eab308", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>` },
    error:   { color: "#ef4444", svg: `<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>` }
  };

  function setStatus(type, label, sub) {
    const cfg = statusCfg[type] || statusCfg.idle;
    const icon = document.getElementById("aqz-status-icon");
    if (icon) {
      icon.innerHTML = cfg.svg;
      icon.style.borderColor = cfg.color + "40";
      icon.style.background  = cfg.color + "18";
    }
    const lbl = document.getElementById("aqz-status-label");
    const s   = document.getElementById("aqz-status-sub");
    if (lbl) lbl.textContent = label;
    if (s)   s.textContent   = sub;
  }

  function setScanLoading(loading) {
    const btn = document.getElementById("aqz-btn-scan");
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading
      ? `<div class="aqz-spinner"></div>Đang phân tích...`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>Quét & Phân Tích Trang`;
  }

  function updateBadge(count) {
    const badge = document.getElementById("aqz-results-badge");
    const cnt   = document.getElementById("aqz-count-badge");
    if (badge) { badge.style.display = count > 0 ? "inline" : "none"; badge.textContent = count; }
    if (cnt)   cnt.textContent = `${count} câu`;
  }

  function switchTab(name) {
    const host = document.getElementById("aqz-panel-host");
    if (!host) return;
    host.querySelectorAll(".aqz-tab").forEach(b => b.classList.remove("active"));
    host.querySelectorAll(".aqz-tab-panel").forEach(p => p.classList.remove("active"));
    host.querySelector(`[data-tab="${name}"]`)?.classList.add("active");
    host.querySelector(`#aqz-panel-${name}`)?.classList.add("active");
  }

  function showScanFlash() {
    const el = document.createElement("div");
    el.className = "aqz-scan-flash aqz-injected";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }

  function showToast(msg, type = "info") {
    document.querySelectorAll(".aqz-toast").forEach(t => t.remove());
    const t = document.createElement("div");
    t.className = `aqz-toast ${type} aqz-injected`;
    t.innerHTML = `<span>${msg}</span>`;
    document.body.appendChild(t);
    setTimeout(() => { if (t.isConnected) { t.style.opacity = "0"; t.style.transition = "opacity 0.3s"; setTimeout(() => t.remove(), 300); } }, 3000);
  }

  function trunc(s, n) { if (!s) return ""; return s.length > n ? s.slice(0, n) + "…" : s; }
  function esc(s) { if (!s) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

})();
