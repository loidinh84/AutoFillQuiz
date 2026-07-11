// ==========================================
// AutoFillQuiz - Background Service Worker
// ==========================================

const GEMINI_BASE_V1     = "https://generativelanguage.googleapis.com/v1/models";
const GEMINI_BASE_V1BETA = "https://generativelanguage.googleapis.com/v1beta/models";

// Choose correct API endpoint version based on model
function getGeminiBase(model) {
  // gemini-2.x requires v1beta; gemini-1.x works on stable v1
  if (model && model.startsWith("gemini-2")) return GEMINI_BASE_V1BETA;
  return GEMINI_BASE_V1;
}

// ─── Icon click → toggle floating panel ────
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  // Inject content script in case it's not loaded yet (e.g. on chrome:// pages it won't work)
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["content/content.js"]
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id, allFrames: true },
      files: ["content/content.css"]
    });
  } catch (e) {
    // Already injected or restricted page — ignore
  }

  // Only toggle panel in the main frame (frame 0)
  chrome.tabs.sendMessage(tab.id, { type: "AQZ_TOGGLE_PANEL" }, { frameId: 0 }).catch(() => {});
});

// ─── Message router ────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ANALYZE_QUIZ") {
    handleAnalyzeQuiz(message.payload)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err  => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "SAVE_SETTINGS") {
    chrome.storage.sync.set(message.payload, () => sendResponse({ success: true }));
    return true;
  }

  if (message.type === "GET_SETTINGS") {
    chrome.storage.sync.get(
      ["geminiApiKey", "modelName", "autoHighlight", "showExplanation", "vietnamese"],
      result => sendResponse({ success: true, data: result })
    );
    return true;
  }

  if (message.type === "LIST_MODELS") {
    listAvailableModels(message.payload.apiKey)
      .then(models => sendResponse({ success: true, models }))
      .catch(() => sendResponse({ success: true, models: [] }));
    return true;
  }

  if (message.type === "GEMINI_REQUEST") {
    geminiRequestDirect(message.payload)
      .then(text => sendResponse({ success: true, text }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }


  // Gather questions from all frames in the tab
  if (message.type === "AQZ_REQUEST_ALL_FRAMES_DATA") {
    chrome.webNavigation.getAllFrames({ tabId: sender.tab.id }, (frames) => {
      if (!frames || frames.length === 0) {
        sendResponse({ success: true, questions: [] });
        return;
      }

      const promises = frames.map(frame => {
        return new Promise(resolve => {
          chrome.tabs.sendMessage(
            sender.tab.id,
            { type: "AQZ_FRAME_EXTRACT" },
            { frameId: frame.frameId },
            response => {
              if (chrome.runtime.lastError || !response || !response.questions) {
                resolve([]);
              } else {
                // Attach frameId so we can send actions back to the correct frame
                resolve(response.questions.map(q => ({ ...q, frameId: frame.frameId })));
              }
            }
          );
        });
      });

      Promise.all(promises).then(results => {
        const allQuestions = results.flat();
        sendResponse({ success: true, questions: allQuestions });
      });
    });
    return true;
  }

  // Dispatch highlights/autofill to specific frames
  if (message.type === "AQZ_SEND_ALL_FRAMES_DATA") {
    const { targetType, resultsByFrame } = message.payload;
    
    Object.entries(resultsByFrame).forEach(([frameIdStr, data]) => {
      const frameId = parseInt(frameIdStr, 10);
      chrome.tabs.sendMessage(
        sender.tab.id,
        { type: targetType, payload: { results: data } },
        { frameId: frameId },
        () => {
          if (chrome.runtime.lastError) {
            // Ignore error for frames that might have unloaded
          }
        }
      );
    });

    sendResponse({ success: true });
    return true;
  }
});

// Model fallback chain: prefer stable, widely-available models
// Note: gemini-2.5-flash is NOT available to new users, excluded intentionally
const MODEL_FALLBACK_CHAIN = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash-001",
  "gemini-1.0-pro",
  "gemini-pro"
];

// Models that appear in LIST but are restricted or deprecated for new users
const EXCLUDED_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-preview"
];
async function listAvailableModels(apiKey) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      { method: "GET" }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || [])
      .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
      .map(m => m.name.replace("models/", ""))
      .filter(m => !EXCLUDED_MODELS.some(ex => m.startsWith(ex)));
  } catch {
    return [];
  }
}

const INTER_REQUEST_DELAY_MS = 4500; // 4.5s between requests → ~13 RPM, safely under free-tier 15 RPM limit

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Extract retry-after seconds from Gemini quota error message
function parseRetryAfter(msg) {
  const match = msg.match(/retry in (\d+(?:\.\d+)?)s/i);
  return match ? Math.ceil(parseFloat(match[1]) * 1000) : 30000;
}

async function handleAnalyzeQuiz({ questions, apiKey, modelName }) {
  if (!apiKey) throw new Error("Chưa có API key. Vào ⚙️ Cài Đặt để nhập.");

  // Build list of models to try: preferred first, then fallbacks
  const preferred = modelName || "gemini-2.0-flash";
  const toTry = [preferred, ...MODEL_FALLBACK_CHAIN.filter(m => m !== preferred)];

  // Find working model upfront (try first question to confirm model availability)
  let workingModel = null;
  for (const model of toTry) {
    try {
      await callGemini(questions[0], apiKey, model);
      workingModel = model;
      break;
    } catch (err) {
      if (!err.message.includes("not found") && !err.message.includes("not supported") && !err.message.includes("no longer available")) {
        // Rate limit or quota error — use this model but handle quota below
        workingModel = model;
        break;
      }
      // Model not available → try next
    }
  }
  if (!workingModel) workingModel = preferred; // fallback

  const results = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    
    // Add delay between requests to stay within free-tier rate limit (15 RPM)
    if (i > 0) {
      await sleep(INTER_REQUEST_DELAY_MS);
    }

    let answered = false;
    let retries = 2;
    while (retries >= 0) {
      try {
        const answer = await callGemini(q, apiKey, workingModel);
        results.push({ ...q, answer });
        answered = true;
        break;
      } catch (err) {
        const isRateLimit = err.message.includes("quota") || err.message.includes("Quota") || err.message.includes("429") || err.message.includes("RESOURCE_EXHAUSTED");
        if (isRateLimit && retries > 0) {
          // Wait the suggested retry-after period then retry
          const waitMs = parseRetryAfter(err.message);
          await sleep(Math.min(waitMs, 60000)); // cap at 60s
          retries--;
        } else {
          results.push({ ...q, answer: null, error: err.message });
          answered = true; // mark as handled (with error)
          break;
        }
      }
    }
  }
  return results;
}

async function callGemini(question, apiKey, model) {
  const prompt = buildPrompt(question);

  // Try primary endpoint first, then fallback
  const endpoints = model.startsWith("gemini-2")
    ? [GEMINI_BASE_V1BETA, GEMINI_BASE_V1]
    : [GEMINI_BASE_V1, GEMINI_BASE_V1BETA];

  let lastErr = null;
  for (const base of endpoints) {
    try {
      const res = await fetch(`${base}/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 512 }
        })
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody?.error?.message || `HTTP ${res.status}`;
        // If model not found on this endpoint version, try next endpoint
        if (msg.includes("not found") || msg.includes("not supported") || res.status === 404) {
          lastErr = new Error(msg);
          continue;
        }
        throw new Error(msg);
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Không có phản hồi từ AI");

      try { return JSON.parse(text); }
      catch { return { answer: text.trim(), explanation: "", confidence: "medium" }; }
    } catch (err) {
      if (err.message.includes("not found") || err.message.includes("not supported")) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  // Both endpoints failed - propagate for outer model fallback to try next model
  throw lastErr || new Error("Không thể kết nối đến Gemini API");
}

function buildPrompt({ type, questionText, options }) {
  if (type === "fill_blank") {
    return `Bạn là trợ lý học tập. Điền vào chỗ trống phù hợp nhất.
CÂU HỎI: "${questionText}"
Trả về JSON: {"answer":"từ cần điền","explanation":"lý do ngắn","confidence":"high|medium|low"}`;
  }
  const list = (options || []).map((o, i) => `${String.fromCharCode(65+i)}. ${o.text}`).join("\n");
  return `Bạn là trợ lý học tập. Chọn đáp án đúng nhất cho câu trắc nghiệm sau.
CÂU HỎI: "${questionText}"
CÁC LỰA CHỌN:\n${list}
Trả về JSON: {"answer":"chữ cái A/B/C...","answerIndex":số_0_based,"answerText":"nội dung đáp án","explanation":"lý do ngắn","confidence":"high|medium|low"}`;
}

async function geminiRequestDirect({ prompt, apiKey, model, maxTokens }) {
  const GEMINI_BASE_V1 = "https://generativelanguage.googleapis.com/v1/models";
  const GEMINI_BASE_V1BETA = "https://generativelanguage.googleapis.com/v1beta/models";
  
  // Prioritize v1beta because it supports JSON mode and all new models.
  // Fall back to v1 without JSON mode if v1beta fails or doesn't support the model.
  const endpoints = [
    { base: GEMINI_BASE_V1BETA, useJson: true },
    { base: GEMINI_BASE_V1, useJson: false }
  ];

  let lastErr = null;
  for (const ep of endpoints) {
    try {
      const genConfig = { 
        temperature: 0.1, 
        maxOutputTokens: maxTokens || 2048
      };
      if (ep.useJson) {
        genConfig.responseMimeType = "application/json";
      }

      const res = await fetch(`${ep.base}/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: genConfig
        })
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody?.error?.message || `HTTP ${res.status}`;
        
        // If endpoint is not found, or responseMimeType is not supported, fall back
        const isFallbackError = 
          msg.includes("not found") || 
          msg.includes("not supported") || 
          msg.includes("no longer available") || 
          msg.includes("responseMimeType") || 
          msg.includes("Unknown name") ||
          res.status === 404;

        if (isFallbackError) {
          lastErr = new Error(msg);
          continue;
        }
        throw new Error(msg);
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Không có phản hồi từ AI");
      return text;
    } catch (err) {
      const isFallbackError = 
        err.message.includes("not found") || 
        err.message.includes("not supported") || 
        err.message.includes("no longer available") || 
        err.message.includes("responseMimeType") || 
        err.message.includes("Unknown name");

      if (isFallbackError) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error("Không thể kết nối đến Gemini API");
}

