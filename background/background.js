// ==========================================
// AutoFillQuiz - Background Service Worker
// ==========================================

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

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

// ─── Gemini API call ───────────────────────
async function handleAnalyzeQuiz({ questions, apiKey, modelName }) {
  if (!apiKey) throw new Error("Chưa có API key. Vào ⚙️ Cài Đặt để nhập.");
  const model = modelName || "gemini-1.5-flash";
  const results = [];
  for (const q of questions) {
    try {
      const answer = await callGemini(q, apiKey, model);
      results.push({ ...q, answer });
    } catch (err) {
      results.push({ ...q, answer: null, error: err.message });
    }
  }
  return results;
}

async function callGemini(question, apiKey, model) {
  const prompt = buildPrompt(question);
  const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 512, responseMimeType: "application/json" }
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Không có phản hồi từ AI");

  try { return JSON.parse(text); }
  catch { return { answer: text.trim(), explanation: "", confidence: "medium" }; }
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
