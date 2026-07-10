// ==========================================
// AutoFillQuiz - Content Script
// Runs on every page - extracts quiz questions,
// highlights correct answers, auto-fills inputs
// ==========================================

(function () {
  "use strict";

  // Prevent double injection
  if (window.__aqzLoaded) return;
  window.__aqzLoaded = true;

  // ─── State ────────────────────────────────────
  let extractedQuestions = [];
  let analysisResults = [];

  // ─── Listen for messages from popup ───────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case "AQZ_EXTRACT":
        extractedQuestions = extractQuestions();
        sendResponse({ success: true, questions: extractedQuestions });
        break;

      case "AQZ_HIGHLIGHT":
        applyHighlights(message.payload.results);
        analysisResults = message.payload.results;
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

      case "AQZ_SCAN_FLASH":
        showScanningOverlay();
        sendResponse({ success: true });
        break;
    }
    return true;
  });

  // ═══════════════════════════════════════════════
  // PART 1: QUESTION EXTRACTION
  // Universal DOM parser for any quiz format
  // ═══════════════════════════════════════════════

  function extractQuestions() {
    clearHighlights();
    const questions = [];

    // Strategy 1: Radio button groups (most common MCQ format)
    questions.push(...extractRadioGroups());

    // Strategy 2: Checkbox groups
    questions.push(...extractCheckboxGroups());

    // Strategy 3: Select dropdowns
    questions.push(...extractSelectDropdowns());

    // Strategy 4: Fill-in-the-blank (text inputs near labels)
    questions.push(...extractFillBlanks());

    // Strategy 5: Google Forms specific
    questions.push(...extractGoogleForms());

    // Strategy 6: Numbered question blocks (fallback)
    if (questions.length === 0) {
      questions.push(...extractGenericQuestions());
    }

    // Deduplicate by question text
    const seen = new Set();
    return questions.filter(q => {
      const key = q.questionText.trim().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Strategy 1: Radio button groups
  function extractRadioGroups() {
    const questions = [];
    const radioGroups = {};

    document.querySelectorAll('input[type="radio"]').forEach(radio => {
      const name = radio.name || radio.getAttribute("data-name") || radio.closest("form")?.id || "group_" + Math.random();
      if (!radioGroups[name]) radioGroups[name] = [];
      radioGroups[name].push(radio);
    });

    for (const [groupName, radios] of Object.entries(radioGroups)) {
      if (radios.length < 2 || radios.length > 10) continue;

      // Find question text: look for nearest heading/label above the group
      const questionText = findQuestionText(radios[0]);
      if (!questionText) continue;

      const options = radios.map(radio => {
        const label = findLabelFor(radio);
        return {
          text: label || radio.value || "",
          element: radio,
          labelElement: findLabelElementFor(radio)
        };
      }).filter(o => o.text);

      if (options.length < 2) continue;

      questions.push({
        type: "multiple_choice",
        questionText,
        options,
        questionElement: findQuestionElement(radios[0]),
        inputType: "radio"
      });
    }

    return questions;
  }

  // Strategy 2: Checkbox groups
  function extractCheckboxGroups() {
    const questions = [];
    const processed = new Set();

    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (processed.has(cb)) return;

      const container = findCheckboxContainer(cb);
      if (!container) return;

      const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
      if (checkboxes.length < 2) return;
      checkboxes.forEach(c => processed.add(c));

      const questionText = findQuestionText(checkboxes[0]);
      if (!questionText) return;

      const options = checkboxes.map(c => ({
        text: findLabelFor(c) || c.value || "",
        element: c,
        labelElement: findLabelElementFor(c)
      })).filter(o => o.text);

      if (options.length < 2) return;

      questions.push({
        type: "multiple_choice",
        questionText,
        options,
        questionElement: findQuestionElement(checkboxes[0]),
        inputType: "checkbox"
      });
    });

    return questions;
  }

  // Strategy 3: Select dropdowns
  function extractSelectDropdowns() {
    const questions = [];

    document.querySelectorAll("select").forEach(select => {
      const validOptions = Array.from(select.options).filter(o => o.value && o.text.trim());
      if (validOptions.length < 2) return;

      const questionText = findQuestionText(select);
      if (!questionText) return;

      questions.push({
        type: "multiple_choice",
        questionText,
        options: validOptions.map(o => ({ text: o.text.trim(), element: o, selectElement: select })),
        questionElement: findQuestionElement(select),
        inputType: "select",
        selectElement: select
      });
    });

    return questions;
  }

  // Strategy 4: Fill-in-the-blank text inputs
  function extractFillBlanks() {
    const questions = [];
    const skipTypes = new Set(["submit", "button", "image", "hidden", "file", "radio", "checkbox"]);

    document.querySelectorAll('input[type="text"], input:not([type]), input[type="search"], textarea').forEach(input => {
      if (input.type && skipTypes.has(input.type)) return;
      if (input.closest(".aqz-toast, .aqz-badge-correct")) return;

      const questionText = findQuestionText(input);
      if (!questionText || questionText.length < 5) return;

      questions.push({
        type: "fill_blank",
        questionText,
        options: [],
        questionElement: findQuestionElement(input),
        inputType: "text",
        inputElement: input
      });
    });

    return questions;
  }

  // Strategy 5: Google Forms
  function extractGoogleForms() {
    const questions = [];

    // Google Forms question containers
    const containers = document.querySelectorAll('[role="listitem"], .Qr7Oae, .geS5n');
    containers.forEach(container => {
      const questionEl = container.querySelector('.M7eMe, [role="heading"], .z12JJ');
      if (!questionEl) return;
      const questionText = questionEl.textContent.trim();
      if (!questionText) return;

      // Radio options
      const radioOptions = container.querySelectorAll('[role="radio"], [role="checkbox"]');
      if (radioOptions.length >= 2) {
        const options = Array.from(radioOptions).map(opt => ({
          text: opt.querySelector('.YEVVod, [data-value]')?.textContent?.trim() || opt.getAttribute("data-value") || opt.getAttribute("aria-label") || "",
          element: opt,
          labelElement: opt
        })).filter(o => o.text);

        if (options.length >= 2) {
          questions.push({
            type: "multiple_choice",
            questionText,
            options,
            questionElement: container,
            inputType: "gforms_radio"
          });
        }
      }

      // Short answer input
      const textInput = container.querySelector('input[type="text"], textarea');
      if (textInput && radioOptions.length === 0) {
        questions.push({
          type: "fill_blank",
          questionText,
          options: [],
          questionElement: container,
          inputType: "text",
          inputElement: textInput
        });
      }
    });

    return questions;
  }

  // Strategy 6: Generic - scan page for numbered questions
  function extractGenericQuestions() {
    const questions = [];
    const questionPattern = /^(\d+[\.\)]\s+|câu\s+\d+[\.\):]?\s*|question\s+\d+[\.\):]?\s*)/i;
    const allText = document.querySelectorAll("p, li, div, span, h1, h2, h3, h4, h5, td, th");

    allText.forEach(el => {
      const text = el.textContent.trim();
      if (!questionPattern.test(text) || text.length < 10) return;
      if (el.querySelectorAll("*").length > 20) return; // Skip containers

      const answers = findNearbyOptions(el);
      if (answers.length >= 2) {
        questions.push({
          type: "multiple_choice",
          questionText: text,
          options: answers,
          questionElement: el,
          inputType: "text_only"
        });
      }
    });

    return questions;
  }

  // ─── Helper: find question text above an input ───
  function findQuestionText(element) {
    const strategies = [
      // Look for fieldset legend
      () => element.closest("fieldset")?.querySelector("legend")?.textContent?.trim(),
      // Look for aria-labelledby
      () => {
        const id = element.getAttribute("aria-labelledby");
        return id ? document.getElementById(id)?.textContent?.trim() : null;
      },
      // Look for label[for] pointing to this element
      () => element.id ? document.querySelector(`label[for="${element.id}"]`)?.textContent?.trim() : null,
      // Traverse up to find question-like text
      () => {
        let el = element.parentElement;
        let depth = 0;
        while (el && depth < 8) {
          const headings = el.querySelectorAll("h1,h2,h3,h4,h5,h6,p,strong,b");
          for (const h of headings) {
            const t = h.textContent.trim();
            if (t.length > 10 && t.length < 500 && !h.querySelector('input,select,textarea')) return t;
          }
          el = el.parentElement;
          depth++;
        }
        return null;
      },
      // Look at previous siblings
      () => {
        let sib = element.parentElement?.previousElementSibling;
        let depth = 0;
        while (sib && depth < 4) {
          const t = sib.textContent.trim();
          if (t.length > 10 && t.length < 500) return t;
          sib = sib.previousElementSibling;
          depth++;
        }
        return null;
      }
    ];

    for (const strategy of strategies) {
      try {
        const result = strategy();
        if (result && result.length > 5) return result;
      } catch {}
    }
    return null;
  }

  function findQuestionElement(element) {
    // Try to find the container that holds both question and options
    let el = element.parentElement;
    let depth = 0;
    while (el && depth < 6) {
      if (el.querySelectorAll('input[type="radio"], input[type="checkbox"]').length >= 2) return el;
      if (el.tagName === "FORM" || el.tagName === "FIELDSET") return el;
      el = el.parentElement;
      depth++;
    }
    return element.closest("div, section, article") || element.parentElement;
  }

  function findLabelFor(input) {
    // 1. <label for="id">
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) return label.textContent.trim();
    }
    // 2. Wrapping <label>
    const wrappingLabel = input.closest("label");
    if (wrappingLabel) {
      return wrappingLabel.textContent.replace(input.value || "", "").trim() || wrappingLabel.textContent.trim();
    }
    // 3. aria-label
    if (input.getAttribute("aria-label")) return input.getAttribute("aria-label");
    // 4. Next sibling text
    const next = input.nextElementSibling;
    if (next) return next.textContent.trim();
    // 5. Parent text without sub-elements
    const parent = input.parentElement;
    if (parent) {
      const clone = parent.cloneNode(true);
      clone.querySelectorAll("input").forEach(i => i.remove());
      return clone.textContent.trim();
    }
    return input.value || "";
  }

  function findLabelElementFor(input) {
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) return label;
    }
    return input.closest("label") || input.parentElement;
  }

  function findCheckboxContainer(cb) {
    let el = cb.parentElement;
    let depth = 0;
    while (el && depth < 6) {
      const cbs = el.querySelectorAll('input[type="checkbox"]');
      if (cbs.length >= 2 && cbs.length <= 10) return el;
      el = el.parentElement;
      depth++;
    }
    return null;
  }

  function findNearbyOptions(questionEl) {
    const options = [];
    const optionPattern = /^[A-Da-d][\.\)]\s*.+/;
    let el = questionEl.nextElementSibling;
    let count = 0;
    while (el && count < 10) {
      const text = el.textContent.trim();
      if (optionPattern.test(text)) {
        options.push({ text, element: el, labelElement: el });
      }
      el = el.nextElementSibling;
      count++;
    }
    return options;
  }

  // ═══════════════════════════════════════════════
  // PART 2: HIGHLIGHT CORRECT ANSWERS
  // ═══════════════════════════════════════════════

  function applyHighlights(results) {
    clearHighlights();

    results.forEach(result => {
      if (!result.answer) return;

      const question = extractedQuestions.find(q => q.questionText.trim() === result.questionText.trim());
      if (!question) return;

      if (result.type === "fill_blank") {
        highlightFillBlank(question, result);
      } else {
        highlightMultipleChoice(question, result);
      }
    });

    showToast(`✅ Đã phân tích ${results.length} câu hỏi`, "success");
  }

  function highlightMultipleChoice(question, result) {
    const { options } = question;
    const correctIndex = result.answer?.answerIndex ?? -1;
    const correctText = (result.answer?.answerText || "").toLowerCase();
    const correctLetter = (result.answer?.answer || "").toUpperCase();

    options.forEach((option, index) => {
      const isCorrect =
        index === correctIndex ||
        option.text.toLowerCase().includes(correctText) ||
        option.text.toUpperCase().startsWith(correctLetter + ".");

      const el = option.labelElement || option.element;
      if (!el) return;

      // Make positioning context
      if (el.style) {
        const pos = window.getComputedStyle(el).position;
        if (pos === "static") el.style.position = "relative";
      }

      if (isCorrect) {
        el.classList.add("aqz-highlight-correct");

        // Add badge
        const badge = document.createElement("span");
        badge.className = "aqz-badge-correct aqz-injected";
        badge.textContent = "✓ Đúng";

        // Add tooltip with explanation
        if (result.answer?.explanation) {
          const tooltip = document.createElement("span");
          tooltip.className = "aqz-tooltip aqz-injected";
          tooltip.textContent = result.answer.explanation;
          el.appendChild(tooltip);
        }

        el.appendChild(badge);
      } else {
        el.classList.add("aqz-highlight-wrong");
      }
    });
  }

  function highlightFillBlank(question, result) {
    const input = question.inputElement;
    if (!input) return;

    const answerText = result.answer?.answer || result.answer || "";

    // Show answer hint next to input
    const hint = document.createElement("span");
    hint.className = "aqz-fill-result aqz-injected";
    hint.textContent = `💡 ${answerText}`;
    input.parentElement?.insertBefore(hint, input.nextSibling);

    input.style.outline = "2px solid rgba(99, 102, 241, 0.7)";
    input.style.outlineOffset = "2px";
  }

  // ═══════════════════════════════════════════════
  // PART 3: AUTO-FILL
  // ═══════════════════════════════════════════════

  function autoFillAnswers(results) {
    let filled = 0;

    results.forEach(result => {
      if (!result.answer) return;

      const question = extractedQuestions.find(q => q.questionText.trim() === result.questionText.trim());
      if (!question) return;

      if (result.type === "fill_blank") {
        fillTextInput(question, result);
        filled++;
      } else {
        fillMultipleChoice(question, result);
        filled++;
      }
    });

    showToast(`⚡ Đã tự động điền ${filled} câu`, "success");
  }

  function fillMultipleChoice(question, result) {
    const correctIndex = result.answer?.answerIndex ?? -1;
    const { options, inputType } = question;

    if (inputType === "select" && question.selectElement) {
      const opt = question.selectElement.options[correctIndex];
      if (opt) {
        question.selectElement.value = opt.value;
        question.selectElement.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }

    if (inputType === "gforms_radio") {
      const target = options[correctIndex]?.element;
      if (target) {
        target.click();
        setTimeout(() => target.dispatchEvent(new MouseEvent("click", { bubbles: true })), 100);
      }
      return;
    }

    // Standard radio / checkbox
    const target = options[correctIndex]?.element;
    if (target) {
      target.checked = true;
      target.click();
      target.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function fillTextInput(question, result) {
    const input = question.inputElement;
    if (!input) return;

    const answerText = result.answer?.answer || result.answer || "";

    // Simulate real typing
    const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set ||
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;

    if (nativeInputSetter) {
      nativeInputSetter.call(input, answerText);
    } else {
      input.value = answerText;
    }

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  }

  // ═══════════════════════════════════════════════
  // PART 4: UTILITIES
  // ═══════════════════════════════════════════════

  function clearHighlights() {
    document.querySelectorAll(".aqz-highlight-correct, .aqz-highlight-wrong").forEach(el => {
      el.classList.remove("aqz-highlight-correct", "aqz-highlight-wrong");
      el.style.position = "";
    });
    document.querySelectorAll(".aqz-injected").forEach(el => el.remove());
    document.querySelectorAll('input[style*="outline"]').forEach(el => {
      el.style.outline = "";
      el.style.outlineOffset = "";
    });
  }

  function showScanningOverlay() {
    const overlay = document.createElement("div");
    overlay.className = "aqz-scanning-overlay aqz-injected";
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 1000);
  }

  function showToast(message, type = "info") {
    // Remove existing toasts
    document.querySelectorAll(".aqz-toast").forEach(t => t.remove());

    const toast = document.createElement("div");
    toast.className = `aqz-toast ${type} aqz-injected`;

    const iconSvg = {
      success: `<svg class="aqz-toast-icon" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>`,
      error:   `<svg class="aqz-toast-icon" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
      info:    `<svg class="aqz-toast-icon" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="#6366f1"/></svg>`
    };

    toast.innerHTML = `${iconSvg[type] || iconSvg.info}<span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
      if (toast.isConnected) {
        toast.style.animation = "aqzSlideOut 0.3s ease forwards";
        setTimeout(() => toast.remove(), 300);
      }
    }, 3500);
  }

  // ─── Notify popup that content script is ready ──
  chrome.runtime.sendMessage({ type: "AQZ_CONTENT_READY" }).catch(() => {});
})();
