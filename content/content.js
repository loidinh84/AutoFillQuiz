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

  const isMainFrame = window === window.top;

  // ─── State ──────────────────────────────
  let panelVisible = false;
  let panelMinimized = false;
  let extractedQuestions = [];
  let analysisResults = [];
  let isAnalyzing = false;
  let settings = {
    geminiApiKey: "",
    modelName: "gemini-1.5-flash",
    autoHighlight: true,
    showExplanation: true,
    vietnamese: true,
  };

  // ─── Init ────────────────────────────────
  if (isMainFrame) {
    loadSettings().then(() => {
      buildPanel();
      chrome.runtime.onMessage.addListener(handleMessage);
    });
  } else {
    chrome.runtime.onMessage.addListener(handleMessage);
  }

  // ─── Message handler ─────────────────────
  function handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case "AQZ_TOGGLE_PANEL":
        if (isMainFrame) togglePanel();
        sendResponse({ success: true });
        break;
      case "AQZ_FRAME_EXTRACT":
        extractedQuestions = extractQuestions();
        // Return serializable question data (without DOM element references)
        const serializableQuestions = extractedQuestions.map((q) => ({
          type: q.type,
          questionText: q.questionText,
          options: (q.options || []).map((o) => ({ text: o.text })),
        }));
        sendResponse({ success: true, questions: serializableQuestions });
        break;
      case "AQZ_FRAME_HIGHLIGHT":
        applyHighlights(message.payload.results);
        sendResponse({ success: true });
        break;
      case "AQZ_FRAME_AUTO_FILL":
        autoFillAnswers(message.payload.results);
        sendResponse({ success: true });
        break;
      case "AQZ_FRAME_CLEAR":
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

    const host = document.createElement("div");
    host.id = "aqz-panel-host";
    host.innerHTML = `
      <div id="aqz-panel">

        <!-- Header -->
        <div id="aqz-panel-header">
          <svg id="aqz-panel-logo" viewBox="0 0 32 32">
            <defs>
              <linearGradient id="aqz-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#818cf8"/>
                <stop offset="100%" stop-color="#34d399"/>
              </linearGradient>
            </defs>
            <rect width="32" height="32" rx="8" fill="url(#aqz-logo-grad)"/>
            <path d="M9 16l5 5 9-9" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div id="aqz-panel-title">
            <h1>AutoFillQuiz</h1>
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
            </div>

            <div class="aqz-settings-section">
              <label>AI Model</label>
              <div class="aqz-input-wrap">
                <svg class="prefix" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 0v20M2 12h20"/></svg>
                <select id="aqz-model-select">
                  <option value="gemini-1.5-flash" selected>Gemini 1.5 Flash (Khuyên dùng, ổn định)</option>
                  <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
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

            <button class="aqz-btn" id="aqz-btn-test-key" style="margin-top:4px;width:100%;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.4);color:#a5b4fc;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>
              Kiểm tra API Key
            </button>
            <div id="aqz-key-test-result" style="display:none;margin-top:8px;padding:8px 10px;border-radius:8px;font-size:11px;line-height:1.6;border:1px solid rgba(99,102,241,0.3);background:rgba(15,23,42,0.8);color:#cbd5e1;max-height:120px;overflow-y:auto;"></div>

            <button class="aqz-btn aqz-btn-primary" id="aqz-btn-save" style="margin-top:4px">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Lưu Cài Đặt
            </button>
          </div>

        </div><!-- /body -->

        <div id="aqz-panel-footer">AutoFillQuiz v1.0 · Powered by <span>Google Gemini AI</span></div>
        <div id="aqz-panel-resize-handle" title="Kéo để thay đổi kích thước"></div>
      </div>
    `;

    document.body.appendChild(host);
    setupPanelEvents(host);
    makeResizable(host, host.querySelector("#aqz-panel-resize-handle"));
    restorePanelPosition(host);
    syncSettingsToUI();
  }

  function togglePanel() {
    const host = document.getElementById("aqz-panel-host");
    if (!host) {
      buildPanel();
    }
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
    host.querySelectorAll(".aqz-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        host
          .querySelectorAll(".aqz-tab")
          .forEach((b) => b.classList.remove("active"));
        host
          .querySelectorAll(".aqz-tab-panel")
          .forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        host
          .querySelector(`#aqz-panel-${btn.dataset.tab}`)
          .classList.add("active");
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
      setStatus("idle", "Sẵn sàng phân tích", 'Nhấn "Quét trang" để bắt đầu');
      host.querySelector("#aqz-btn-autofill").disabled = true;
      host.querySelector("#aqz-btn-highlight").disabled = true;
    });

    // Main buttons
    host.querySelector("#aqz-btn-scan").addEventListener("click", onScan);
    host
      .querySelector("#aqz-btn-autofill")
      .addEventListener("click", onAutoFill);
    host
      .querySelector("#aqz-btn-highlight")
      .addEventListener("click", onHighlightOnly);
    host.querySelector("#aqz-btn-clear").addEventListener("click", onClear);

    // Settings
    host
      .querySelector("#aqz-btn-save")
      .addEventListener("click", onSaveSettings);
    host
      .querySelector("#aqz-eye-btn")
      .addEventListener("click", onToggleKeyVisibility);

    // Test API Key
    host.querySelector("#aqz-btn-test-key").addEventListener("click", async () => {
      const key = document.getElementById("aqz-api-key")?.value.trim() || settings.geminiApiKey;
      const resultEl = document.getElementById("aqz-key-test-result");
      const btn = host.querySelector("#aqz-btn-test-key");
      if (!key) {
        resultEl.style.display = "block";
        resultEl.style.borderColor = "rgba(239,68,68,0.4)";
        resultEl.innerHTML = "❌ Chưa nhập API Key!";
        return;
      }
      btn.textContent = "⏳ Đang kiểm tra...";
      btn.disabled = true;
      resultEl.style.display = "none";

      try {
        const response = await chrome.runtime.sendMessage({ type: "LIST_MODELS", payload: { apiKey: key } });
        resultEl.style.display = "block";
        if (response?.models?.length) {
          const modelList = response.models.slice(0, 10).join("\n");
          resultEl.style.borderColor = "rgba(34,197,94,0.4)";
          resultEl.innerHTML = `✅ <strong>API Key hợp lệ!</strong><br>Model khả dụng (${response.models.length}):<br><code style="font-size:10px;white-space:pre;display:block;margin-top:4px;">${response.models.slice(0, 8).join('\n')}</code>`;
          // Auto-select first flash model if current not in list
          const selEl = document.getElementById("aqz-model-select");
          const cur = selEl?.value;
          if (selEl && !response.models.includes(cur)) {
            const best = response.models.find(m => m.includes("flash")) || response.models[0];
            if (best) {
              // Add option if not already in dropdown
              if (!selEl.querySelector(`option[value="${best}"]`)) {
                const opt = document.createElement("option");
                opt.value = best;
                opt.textContent = best + " (tự động phát hiện)";
                selEl.insertBefore(opt, selEl.firstChild);
              }
              selEl.value = best;
            }
          }
        } else {
          resultEl.style.borderColor = "rgba(239,68,68,0.4)";
          resultEl.innerHTML = "❌ <strong>API Key không hợp lệ</strong> hoặc chưa kích hoạt Gemini API.<br><small>Vào <a href='https://aistudio.google.com/app/apikey' target='_blank' style='color:#a5b4fc'>aistudio.google.com</a> để lấy key mới.</small>";
        }
      } catch (err) {
        resultEl.style.display = "block";
        resultEl.style.borderColor = "rgba(239,68,68,0.4)";
        resultEl.innerHTML = `❌ Lỗi: ${err.message}`;
      } finally {
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg> Kiểm tra API Key`;
        btn.disabled = false;
      }
    });

    // External links
    host.querySelectorAll("a[target='_blank']").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.runtime
          .sendMessage({ type: "OPEN_URL", url: a.href })
          .catch(() => {
            window.open(a.href, "_blank");
          });
      });
    });

    // Drag
    makeDraggable(host, host.querySelector("#aqz-panel-header"));
  } // ← end setupPanelEvents

  // ─── Drag logic (Bulletproof left/top) ──────
  function makeDraggable(panel, handle) {
    let isDragging = false;
    let startX = 0,
      startY = 0;
    let startLeft = 0,
      startTop = 0;

    handle.style.setProperty("touch-action", "none", "important");

    handle.addEventListener(
      "pointerdown",
      (e) => {
        if (e.target.closest("button, a, input, select, textarea")) return;
        e.preventDefault();

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        const rect = panel.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;

        // Instantly switch from CSS right/top to absolute left/top inline styles
        panel.style.setProperty("left", startLeft + "px", "important");
        panel.style.setProperty("top", startTop + "px", "important");
        panel.style.setProperty("right", "auto", "important");
        panel.style.setProperty("bottom", "auto", "important");

        panel.style.transition = "none";
        panel.style.animation = "none";
        handle.style.cursor = "grabbing";
      },
      true,
    ); // ← Use capture phase to intercept

    window.addEventListener(
      "pointermove",
      (e) => {
        if (!isDragging) return;
        e.preventDefault();

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let newLeft = startLeft + dx;
        let newTop = startTop + dy;

        // Clamp within viewport
        newLeft = Math.max(
          0,
          Math.min(window.innerWidth - panel.offsetWidth, newLeft),
        );
        newTop = Math.max(0, Math.min(window.innerHeight - 44, newTop));

        panel.style.setProperty("left", newLeft + "px", "important");
        panel.style.setProperty("top", newTop + "px", "important");
      },
      { capture: true, passive: false },
    );

    window.addEventListener(
      "pointerup",
      () => {
        if (!isDragging) return;
        isDragging = false;
        handle.style.cursor = "";
        panel.style.transition = "";

        const left = panel.style.getPropertyValue("left");
        const top = panel.style.getPropertyValue("top");

        if (left && top) {
          chrome.storage.local.set({
            aqzPanelLeft: left,
            aqzPanelTop: top,
          });
        }
      },
      { capture: true },
    );
  }

  function restorePanelPosition(panel) {
    chrome.storage.local.get(
      ["aqzPanelLeft", "aqzPanelTop", "aqzPanelWidth", "aqzPanelHeight"],
      (result) => {
        if (result.aqzPanelLeft && result.aqzPanelTop) {
          panel.style.setProperty("left", result.aqzPanelLeft, "important");
          panel.style.setProperty("top", result.aqzPanelTop, "important");
          panel.style.setProperty("right", "auto", "important");
          panel.style.setProperty("bottom", "auto", "important");
        }
        if (result.aqzPanelWidth && result.aqzPanelHeight) {
          panel.style.setProperty("width", result.aqzPanelWidth, "important");
          panel.style.setProperty("height", result.aqzPanelHeight, "important");
        }
      },
    );
  }

  // ─── Resize logic (Pointer Capture) ────────
  function makeResizable(panel, handle) {
    let isResizing = false;
    let startWidth = 0,
      startHeight = 0;
    let startX = 0,
      startY = 0;

    handle.addEventListener(
      "pointerdown",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;

        const rect = panel.getBoundingClientRect();
        startWidth = rect.width;
        startHeight = rect.height;

        panel.style.transition = "none";
        document.body.style.userSelect = "none";
      },
      true,
    );

    window.addEventListener(
      "pointermove",
      (e) => {
        if (!isResizing) return;
        e.preventDefault();

        const dw = e.clientX - startX;
        const dh = e.clientY - startY;

        // Restrict size bounds: Min width/height, max width/height
        const newWidth = Math.max(
          300,
          Math.min(window.innerWidth * 0.9, startWidth + dw),
        );
        const newHeight = Math.max(
          250,
          Math.min(window.innerHeight * 0.95, startHeight + dh),
        );

        panel.style.setProperty("width", newWidth + "px", "important");
        panel.style.setProperty("height", newHeight + "px", "important");
      },
      { capture: true, passive: false },
    );

    window.addEventListener(
      "pointerup",
      () => {
        if (!isResizing) return;
        isResizing = false;
        document.body.style.userSelect = "";
        panel.style.transition = "";

        const w = panel.style.getPropertyValue("width");
        const h = panel.style.getPropertyValue("height");

        if (w && h) {
          chrome.storage.local.set({
            aqzPanelWidth: w,
            aqzPanelHeight: h,
          });
        }
      },
      { capture: true },
    );
  }

  // ════════════════════════════════════════════
  // PART 2: SCAN / ANALYZE
  // ════════════════════════════════════════════

  // ─── Frame Dispatcher ────────────────────
  function dispatchToFrames(targetType, results) {
    const resultsByFrame = {};
    results.forEach((res) => {
      const fId = res.frameId !== undefined ? res.frameId : 0;
      if (!resultsByFrame[fId]) resultsByFrame[fId] = [];
      resultsByFrame[fId].push(res);
    });
    chrome.runtime.sendMessage({
      type: "AQZ_SEND_ALL_FRAMES_DATA",
      payload: { targetType, resultsByFrame },
    });
  }

  async function onScan() {
    if (isAnalyzing) return;
    const apiKey =
      document.getElementById("aqz-api-key")?.value.trim() ||
      settings.geminiApiKey;
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

      // Request questions from all frames (including child iframes)
      const frameResponse = await chrome.runtime.sendMessage({
        type: "AQZ_REQUEST_ALL_FRAMES_DATA",
      });

      if (frameResponse && frameResponse.success && frameResponse.questions) {
        extractedQuestions = frameResponse.questions;
      } else {
        // Fallback to local frame only
        extractedQuestions = extractQuestions().map((q) => ({
          ...q,
          frameId: 0,
        }));
      }

      if (!extractedQuestions.length) {
        let diag = "Diagnostic: ";
        const possibleEl = Array.from(
          document.querySelectorAll("p, div, span, td, h1, h2, h3, h4, h5, li"),
        ).find((el) => {
          const txt = el.textContent;
          return (
            txt.includes("Theo c mác") ||
            txt.includes("tư bản là") ||
            txt.includes("Câu 1")
          );
        });
        if (possibleEl) {
          diag += `[Tag: ${possibleEl.tagName}] [Class: ${possibleEl.className}] [HTML: ${possibleEl.outerHTML.slice(0, 150).replace(/</g, "&lt;").replace(/>/g, "&gt;")}]`;
        } else {
          diag += "No matching elements found for 'Theo c mác' or 'Câu 1'";
        }
        setStatus("warning", "Không tìm thấy câu hỏi", diag.slice(0, 200));
        return;
      }

      setStatus(
        "loading",
        `Tìm thấy ${extractedQuestions.length} câu`,
        "AI đang suy luận...",
      );

      const modelName =
        document.getElementById("aqz-model-select")?.value ||
        settings.modelName;
      const response = await chrome.runtime.sendMessage({
        type: "ANALYZE_QUIZ",
        payload: {
          questions: extractedQuestions.map((q) => ({
            type: q.type,
            questionText: q.questionText,
            options: (q.options || []).map((o) => ({ text: o.text })),
          })),
          apiKey,
          modelName,
        },
      });

      if (!response?.success) throw new Error(response?.error || "Lỗi AI");

      // Attach frameId back to results to maintain frame routing
      analysisResults = response.data.map((res, idx) => ({
        ...res,
        frameId: extractedQuestions[idx]?.frameId,
      }));

      const autoHL =
        document.getElementById("aqz-tog-hl")?.checked ??
        settings.autoHighlight;
      if (autoHL) dispatchToFrames("AQZ_FRAME_HIGHLIGHT", analysisResults);

      renderResults(analysisResults);
      updateBadge(analysisResults.length);

      const ok = analysisResults.filter((r) => r.answer && !r.error).length;
      if (ok === 0) {
        const firstErr =
          analysisResults.find((r) => r.error)?.error || "Kiểm tra API key";
        setStatus(
          "warning",
          `0/${extractedQuestions.length} câu thành công`,
          firstErr.slice(0, 60),
        );
      } else {
        setStatus(
          "success",
          `✓ Xong! ${ok}/${extractedQuestions.length} câu`,
          "Xem kết quả tại tab Kết Quả",
        );
        switchTab("results");
      }

      const host = document.getElementById("aqz-panel-host");
      host.querySelector("#aqz-btn-autofill").disabled = false;
      host.querySelector("#aqz-btn-highlight").disabled = false;
    } catch (err) {
      console.error("[AutoFillQuiz]", err);
      setStatus(
        "error",
        "Lỗi xảy ra",
        err.message || "Kiểm tra API key và mạng",
      );
    } finally {
      setScanLoading(false);
      isAnalyzing = false;
    }
  }

  async function onAutoFill() {
    if (!analysisResults.length) return;
    dispatchToFrames("AQZ_FRAME_AUTO_FILL", analysisResults);
    setStatus("success", "Đã tự động điền!", "Kiểm tra các ô trả lời");
  }

  async function onHighlightOnly() {
    if (!analysisResults.length) return;
    dispatchToFrames("AQZ_FRAME_HIGHLIGHT", analysisResults);
    setStatus("success", "Đã highlight!", "Xanh = đúng · Mờ = sai");
  }

  function onClear() {
    dispatchToFrames("AQZ_FRAME_CLEAR", analysisResults);
    clearResultsUI();
    analysisResults = [];
    setStatus("idle", "Sẵn sàng phân tích", 'Nhấn "Quét trang" để bắt đầu');
    updateBadge(0);
    const host = document.getElementById("aqz-panel-host");
    host.querySelector("#aqz-btn-autofill").disabled = true;
    host.querySelector("#aqz-btn-highlight").disabled = true;
  }

  // ─── Settings ────────────────────────────
  async function onSaveSettings() {
    const key = document.getElementById("aqz-api-key")?.value.trim() || "";
    const model =
      document.getElementById("aqz-model-select")?.value || "gemini-2.0-flash";
    const hl = document.getElementById("aqz-tog-hl")?.checked ?? true;
    const exp = document.getElementById("aqz-tog-exp")?.checked ?? true;

    settings = {
      geminiApiKey: key,
      modelName: model,
      autoHighlight: hl,
      showExplanation: exp,
    };

    await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      payload: {
        geminiApiKey: key,
        modelName: model,
        autoHighlight: hl,
        showExplanation: exp,
      },
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
    const icon = document.getElementById("aqz-eye-icon");
    if (!input) return;
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    icon.innerHTML = isPassword
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  }

  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        ["geminiApiKey", "modelName", "autoHighlight", "showExplanation"],
        (result) => {
          if (result.geminiApiKey) settings.geminiApiKey = result.geminiApiKey;

          // Auto-migrate from rate-limited 2.0-flash to stable 1.5-flash for existing settings
          if (result.modelName && result.modelName !== "gemini-2.0-flash") {
            settings.modelName = result.modelName;
          } else {
            settings.modelName = "gemini-1.5-flash";
          }

          if (result.autoHighlight !== undefined)
            settings.autoHighlight = result.autoHighlight;
          if (result.showExplanation !== undefined)
            settings.showExplanation = result.showExplanation;
          resolve();
        },
      );
    });
  }

  function syncSettingsToUI() {
    const apiInput = document.getElementById("aqz-api-key");
    const modelSel = document.getElementById("aqz-model-select");
    const togHL = document.getElementById("aqz-tog-hl");
    const togExp = document.getElementById("aqz-tog-exp");
    if (apiInput && settings.geminiApiKey)
      apiInput.value = settings.geminiApiKey;
    if (modelSel && settings.modelName) modelSel.value = settings.modelName;
    if (togHL) togHL.checked = settings.autoHighlight;
    if (togExp) togExp.checked = settings.showExplanation;
  }

  // ════════════════════════════════════════════
  // PART 3: DOM EXTRACTION
  // ════════════════════════════════════════════

  function extractQuestions() {
    const questions = [];

    // 1. Extract from the current frame's document
    questions.push(...extractFromDoc(document));

    // 2. Extract from any same-origin iframes recursively
    try {
      document.querySelectorAll("iframe").forEach((iframe) => {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc) {
            questions.push(...extractFromDoc(doc));
          }
        } catch (e) {
          // Cross-origin iframe, will be scanned by its own content script if injected
        }
      });
    } catch (e) {}

    // Deduplicate
    const seen = new Set();
    return questions.filter((q) => {
      const key = q.questionText.trim().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function extractFromDoc(rootDoc) {
    const list = [];
    list.push(...extractRadioGroups(rootDoc));
    list.push(...extractCheckboxGroups(rootDoc));
    list.push(...extractSelectDropdowns(rootDoc));
    list.push(...extractFillBlanks(rootDoc));
    list.push(...extractGoogleForms(rootDoc));
    if (list.length === 0) {
      list.push(...extractGenericQuestions(rootDoc));
    }
    return list;
  }

  function extractRadioGroups(rootDoc = document) {
    const questions = [],
      groups = {};
    rootDoc.querySelectorAll('input[type="radio"]').forEach((r) => {
      if (r.closest("#aqz-panel-host")) return; // skip our own panel
      const name = r.name || "g_" + Math.random();
      if (!groups[name]) groups[name] = [];
      groups[name].push(r);
    });
    for (const radios of Object.values(groups)) {
      if (radios.length < 2 || radios.length > 10) continue;
      const questionText = findQuestionText(radios[0]);
      if (!questionText) continue;
      const options = radios
        .map((r) => ({
          text: findLabelFor(r) || r.value || "",
          element: r,
          labelElement: findLabelElementFor(r),
        }))
        .filter((o) => o.text);
      if (options.length < 2) continue;
      questions.push({
        type: "multiple_choice",
        questionText,
        options,
        questionElement: findQuestionElement(radios[0]),
        inputType: "radio",
      });
    }
    return questions;
  }

  function extractCheckboxGroups(rootDoc = document) {
    const questions = [],
      processed = new Set();
    rootDoc.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      if (cb.closest("#aqz-panel-host")) return; // skip our own panel
      if (processed.has(cb)) return;
      const container = findCheckboxContainer(cb);
      if (!container) return;
      const cbs = Array.from(
        container.querySelectorAll('input[type="checkbox"]'),
      );
      if (cbs.length < 2) return;
      cbs.forEach((c) => processed.add(c));
      const questionText = findQuestionText(cbs[0]);
      if (!questionText) return;
      const options = cbs
        .map((c) => ({
          text: findLabelFor(c) || c.value || "",
          element: c,
          labelElement: findLabelElementFor(c),
        }))
        .filter((o) => o.text);
      if (options.length < 2) return;
      questions.push({
        type: "multiple_choice",
        questionText,
        options,
        questionElement: findQuestionElement(cbs[0]),
        inputType: "checkbox",
      });
    });
    return questions;
  }

  function extractSelectDropdowns(rootDoc = document) {
    const questions = [];
    rootDoc.querySelectorAll("select").forEach((sel) => {
      if (sel.closest("#aqz-panel-host")) return; // skip our own panel
      const validOpts = Array.from(sel.options).filter(
        (o) => o.value && o.text.trim(),
      );
      if (validOpts.length < 2) return;
      const questionText = findQuestionText(sel);
      if (!questionText) return;
      questions.push({
        type: "multiple_choice",
        questionText,
        options: validOpts.map((o) => ({
          text: o.text.trim(),
          element: o,
          selectElement: sel,
        })),
        questionElement: findQuestionElement(sel),
        inputType: "select",
        selectElement: sel,
      });
    });
    return questions;
  }

  function extractFillBlanks(rootDoc = document) {
    const questions = [];
    const skipTypes = new Set([
      "submit",
      "button",
      "image",
      "hidden",
      "file",
      "radio",
      "checkbox",
    ]);
    rootDoc
      .querySelectorAll('input[type="text"], input:not([type]), textarea')
      .forEach((inp) => {
        if (inp.type && skipTypes.has(inp.type)) return;
        if (inp.closest("#aqz-panel-host")) return;
        const questionText = findQuestionText(inp);
        if (!questionText || questionText.length < 5) return;
        questions.push({
          type: "fill_blank",
          questionText,
          options: [],
          questionElement: findQuestionElement(inp),
          inputType: "text",
          inputElement: inp,
        });
      });
    return questions;
  }

  function extractGoogleForms(rootDoc = document) {
    const questions = [];
    rootDoc
      .querySelectorAll('[role="listitem"], .Qr7Oae, .geS5n')
      .forEach((c) => {
        const qEl = c.querySelector('.M7eMe, [role="heading"], .z12JJ');
        if (!qEl) return;
        const questionText = qEl.textContent.trim();
        if (!questionText) return;
        const radioOpts = c.querySelectorAll(
          '[role="radio"], [role="checkbox"]',
        );
        if (radioOpts.length >= 2) {
          const options = Array.from(radioOpts)
            .map((o) => ({
              text:
                o.querySelector(".YEVVod")?.textContent?.trim() ||
                o.getAttribute("aria-label") ||
                "",
              element: o,
              labelElement: o,
            }))
            .filter((o) => o.text);
          if (options.length >= 2)
            questions.push({
              type: "multiple_choice",
              questionText,
              options,
              questionElement: c,
              inputType: "gforms_radio",
            });
        }
        const textInp = c.querySelector('input[type="text"], textarea');
        if (textInp && radioOpts.length === 0) {
          questions.push({
            type: "fill_blank",
            questionText,
            options: [],
            questionElement: c,
            inputType: "text",
            inputElement: textInp,
          });
        }
      });
    return questions;
  }

  function extractGenericQuestions(rootDoc = document) {
    const questions = [];
    const pat = /^\s*(\d+[\.\)]|câu\s+\d+|question\s+\d+)/i;

    rootDoc
      .querySelectorAll("p, li, div, span, h1,h2,h3,h4,h5, td, strong, b")
      .forEach((el) => {
        if (el.closest("#aqz-panel-host")) return; // skip our own panel

        let text = el.textContent.trim();
        if (!pat.test(text)) return;

        let targetEl = el;
        // If the matched element is too short (e.g. just a split "Câu 1:"), walk up to merge text
        if (text.length < 12) {
          let parent = el.parentElement;
          let depth = 0;
          while (parent && depth < 3) {
            const parentText = parent.textContent.trim();
            if (parentText.length >= 12 && parentText.length < 500) {
              targetEl = parent;
              text = parentText;
              break;
            }
            parent = parent.parentElement;
            depth++;
          }
        }

        if (text.length < 10 || text.length > 500) return;

        const answers = findNearbyOptions(targetEl);
        if (answers.length >= 2) {
          questions.push({
            type: "multiple_choice",
            questionText: text,
            options: answers,
            questionElement: targetEl,
            inputType: "text_only",
          });
        }
      });
    return questions;
  }

  // ─── DOM helpers ─────────────────────────
  function findQuestionText(element) {
    const strategies = [
      () =>
        element
          .closest("fieldset")
          ?.querySelector("legend")
          ?.textContent?.trim(),
      () => {
        const id = element.getAttribute("aria-labelledby");
        return id ? document.getElementById(id)?.textContent?.trim() : null;
      },
      () =>
        element.id
          ? document
              .querySelector(`label[for="${element.id}"]`)
              ?.textContent?.trim()
          : null,
      () => {
        let el = element.parentElement,
          d = 0;
        while (el && d < 8) {
          for (const h of el.querySelectorAll("h1,h2,h3,h4,h5,h6,p,strong,b")) {
            const t = h.textContent.trim();
            if (
              t.length > 10 &&
              t.length < 500 &&
              !h.querySelector("input,select,textarea")
            )
              return t;
          }
          el = el.parentElement;
          d++;
        }
        return null;
      },
      () => {
        let s = element.parentElement?.previousElementSibling,
          d = 0;
        while (s && d < 4) {
          const t = s.textContent.trim();
          if (t.length > 10 && t.length < 500) return t;
          s = s.previousElementSibling;
          d++;
        }
        return null;
      },
    ];
    for (const fn of strategies) {
      try {
        const r = fn();
        if (r && r.length > 5) return r;
      } catch {}
    }
    return null;
  }

  function findQuestionElement(el) {
    let e = el.parentElement,
      d = 0;
    while (e && d < 6) {
      if (
        e.querySelectorAll('input[type="radio"], input[type="checkbox"]')
          .length >= 2
      )
        return e;
      if (e.tagName === "FORM" || e.tagName === "FIELDSET") return e;
      e = e.parentElement;
      d++;
    }
    return el.closest("div, section, article") || el.parentElement;
  }

  function findLabelFor(input) {
    if (input.id) {
      const l = document.querySelector(`label[for="${input.id}"]`);
      if (l) return l.textContent.trim();
    }
    const wrap = input.closest("label");
    if (wrap) return wrap.textContent.trim();
    if (input.getAttribute("aria-label"))
      return input.getAttribute("aria-label");
    const next = input.nextElementSibling;
    if (next) return next.textContent.trim();
    const p = input.parentElement;
    if (p) {
      const c = p.cloneNode(true);
      c.querySelectorAll("input").forEach((i) => i.remove());
      return c.textContent.trim();
    }
    return input.value || "";
  }

  function findLabelElementFor(input) {
    if (input.id) {
      const l = document.querySelector(`label[for="${input.id}"]`);
      if (l) return l;
    }
    return input.closest("label") || input.parentElement;
  }

  function findCheckboxContainer(cb) {
    let el = cb.parentElement,
      d = 0;
    while (el && d < 6) {
      const c = el.querySelectorAll('input[type="checkbox"]');
      if (c.length >= 2 && c.length <= 10) return el;
      el = el.parentElement;
      d++;
    }
    return null;
  }

  function findNearbyOptions(qEl) {
    const opts = [];
    const optPat = /^\s*[a-d]([\.\)]\s*|\s+)/i;

    // Strategy 1: Sibling elements starting with options pattern directly
    let sibling = qEl.nextElementSibling;
    let n = 0;
    while (sibling && n < 10) {
      const text = sibling.textContent.trim();
      if (optPat.test(text)) {
        opts.push({ text: text, element: sibling, labelElement: sibling });
      }
      sibling = sibling.nextElementSibling;
      n++;
    }
    if (opts.length >= 2) return opts;

    // Strategy 2: Sibling is an options container — search elements inside it
    opts.length = 0;
    sibling = qEl.nextElementSibling;
    if (sibling) {
      const items = sibling.querySelectorAll("div, p, span, label, li");
      for (const item of items) {
        if (item.children.length > 3) continue;
        const text = item.textContent.trim();
        if (optPat.test(text)) {
          if (
            !opts.some(
              (o) => o.element.contains(item) || item.contains(o.element),
            )
          ) {
            opts.push({ text: text, element: item, labelElement: item });
          }
        }
      }
    }
    if (opts.length >= 2) return opts;

    // Strategy 3: Check inside question parent scope (excluding qEl itself)
    opts.length = 0;
    const parent = qEl.parentElement;
    if (parent) {
      const items = parent.querySelectorAll("div, p, span, label, li");
      for (const item of items) {
        if (item === qEl || qEl.contains(item)) continue;
        if (item.children.length > 3) continue;
        const text = item.textContent.trim();
        if (optPat.test(text)) {
          if (
            !opts.some(
              (o) => o.element.contains(item) || item.contains(o.element),
            )
          ) {
            opts.push({ text: text, element: item, labelElement: item });
          }
        }
      }
    }
    return opts;
  }

  // ════════════════════════════════════════════
  // PART 4: HIGHLIGHT & AUTO-FILL
  // ════════════════════════════════════════════

  function applyHighlights(results) {
    clearHighlights();
    if (!extractedQuestions.length) {
      extractedQuestions = extractQuestions();
    }
    results.forEach((result) => {
      if (!result.answer) return;
      const q = extractedQuestions.find(
        (q) => q.questionText.trim() === result.questionText.trim(),
      );
      if (!q) return;
      if (result.type === "fill_blank") highlightFillBlank(q, result);
      else highlightMCQ(q, result);
    });
  }

  function highlightMCQ(question, result) {
    const { options } = question;
    const correctIndex = result.answer?.answerIndex ?? -1;
    const correctText = (result.answer?.answerText || "").toLowerCase();
    const correctLetter = (result.answer?.answer || "").toUpperCase();
    const showExp = settings.showExplanation;

    options.forEach((opt, idx) => {
      const isCorrect =
        idx === correctIndex ||
        opt.text.toLowerCase().includes(correctText) ||
        opt.text.toUpperCase().startsWith(correctLetter + ".");
      const el = opt.labelElement || opt.element;
      if (!el) return;
      if (window.getComputedStyle(el).position === "static")
        el.style.position = "relative";

      if (isCorrect) {
        el.classList.add("aqz-highlight-correct");
        const badge = document.createElement("span");
        badge.className = "aqz-badge-correct aqz-injected";
        badge.textContent = "✓ Đúng";
        el.appendChild(badge);
        if (showExp && result.answer?.explanation) {
          const tip = document.createElement("span");
          tip.className = "aqz-injected";
          tip.style.cssText =
            "display:none;position:absolute;bottom:calc(100% + 6px);left:0;background:#0f172a;color:#e2e8f0;font-size:11px;padding:6px 10px;border-radius:8px;max-width:260px;white-space:normal;z-index:2147483647;border:1px solid rgba(99,102,241,0.3);line-height:1.5;";
          tip.textContent = result.answer.explanation;
          el.appendChild(tip);
          el.addEventListener("mouseenter", () => {
            tip.style.display = "block";
          });
          el.addEventListener("mouseleave", () => {
            tip.style.display = "none";
          });
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
    if (!extractedQuestions.length) {
      extractedQuestions = extractQuestions();
    }
    results.forEach((result) => {
      if (!result.answer) return;
      const q = extractedQuestions.find(
        (q) => q.questionText.trim() === result.questionText.trim(),
      );
      if (!q) return;
      if (result.type === "fill_blank") {
        fillTextInput(q, result);
        filled++;
      } else {
        fillMCQ(q, result);
        filled++;
      }
    });
    if (isMainFrame) {
      showToast(`⚡ Đã tự động điền ${filled} câu`, "success");
    }
  }

  function fillMCQ(q, result) {
    const idx = result.answer?.answerIndex ?? -1;
    if (q.inputType === "select" && q.selectElement) {
      const opt = q.selectElement.options[idx];
      if (opt) {
        q.selectElement.value = opt.value;
        q.selectElement.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }
    if (q.inputType === "gforms_radio") {
      const t = q.options[idx]?.element;
      if (t) {
        t.click();
        setTimeout(
          () => t.dispatchEvent(new MouseEvent("click", { bubbles: true })),
          100,
        );
      }
      return;
    }
    const t = q.options[idx]?.element;
    if (t) {
      t.checked = true;
      t.click();
      t.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function fillTextInput(q, result) {
    const input = q.inputElement;
    if (!input) return;
    const val = result.answer?.answer || result.answer || "";
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    if (setter) setter.call(input, val);
    else input.value = val;
    ["input", "change", "keyup"].forEach((evt) =>
      input.dispatchEvent(new Event(evt, { bubbles: true })),
    );
  }

  function clearHighlights() {
    document
      .querySelectorAll(".aqz-highlight-correct, .aqz-highlight-wrong")
      .forEach((el) => {
        el.classList.remove("aqz-highlight-correct", "aqz-highlight-wrong");
        el.style.position = "";
      });
    document.querySelectorAll(".aqz-injected").forEach((el) => el.remove());
    document.querySelectorAll('input[style*="outline"]').forEach((el) => {
      el.style.outline = "";
      el.style.outlineOffset = "";
    });
  }

  // ════════════════════════════════════════════
  // PART 5: UI HELPERS
  // ════════════════════════════════════════════

  function renderResults(results) {
    const list = document.getElementById("aqz-results-list");
    const empty = document.getElementById("aqz-empty-state");
    if (!list) return;
    list.querySelectorAll(".aqz-result-card").forEach((el) => el.remove());
    if (!results.length) {
      if (empty) empty.classList.remove("aqz-hidden");
      return;
    }
    if (empty) empty.classList.add("aqz-hidden");
    const showExp = settings.showExplanation;

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
      const expHtml =
        showExp && r.answer?.explanation
          ? `<div class="aqz-result-exp">💬 ${esc(r.answer.explanation)}</div>`
          : "";
      card.innerHTML = `<div class="aqz-result-q">📝 <strong>${i + 1}.</strong> ${qText}</div><div class="aqz-result-ans">${ansHtml}</div>${expHtml}`;
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
    if (list)
      list.querySelectorAll(".aqz-result-card").forEach((el) => el.remove());
    const empty = document.getElementById("aqz-empty-state");
    if (empty) empty.classList.remove("aqz-hidden");
  }

  const statusCfg = {
    idle: {
      color: "#6366f1",
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    },
    loading: {
      color: "#6366f1",
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" style="animation:aqzSpin 0.9s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
    },
    success: {
      color: "#22c55e",
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>`,
    },
    warning: {
      color: "#eab308",
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>`,
    },
    error: {
      color: "#ef4444",
      svg: `<svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    },
  };

  function setStatus(type, label, sub) {
    const cfg = statusCfg[type] || statusCfg.idle;
    const icon = document.getElementById("aqz-status-icon");
    if (icon) {
      icon.innerHTML = cfg.svg;
      icon.style.borderColor = cfg.color + "40";
      icon.style.background = cfg.color + "18";
    }
    const lbl = document.getElementById("aqz-status-label");
    const s = document.getElementById("aqz-status-sub");
    if (lbl) lbl.textContent = label;
    if (s) s.textContent = sub;
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
    const cnt = document.getElementById("aqz-count-badge");
    if (badge) {
      badge.style.display = count > 0 ? "inline" : "none";
      badge.textContent = count;
    }
    if (cnt) cnt.textContent = `${count} câu`;
  }

  function switchTab(name) {
    const host = document.getElementById("aqz-panel-host");
    if (!host) return;
    host
      .querySelectorAll(".aqz-tab")
      .forEach((b) => b.classList.remove("active"));
    host
      .querySelectorAll(".aqz-tab-panel")
      .forEach((p) => p.classList.remove("active"));
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
    document.querySelectorAll(".aqz-toast").forEach((t) => t.remove());
    const t = document.createElement("div");
    t.className = `aqz-toast ${type} aqz-injected`;
    t.innerHTML = `<span>${msg}</span>`;
    document.body.appendChild(t);
    setTimeout(() => {
      if (t.isConnected) {
        t.style.opacity = "0";
        t.style.transition = "opacity 0.3s";
        setTimeout(() => t.remove(), 300);
      }
    }, 3000);
  }

  function trunc(s, n) {
    if (!s) return "";
    return s.length > n ? s.slice(0, n) + "…" : s;
  }
  function esc(s) {
    if (!s) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
