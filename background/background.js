// ==========================================
// AutoFillQuiz - Background Service Worker
// Handles Gemini API calls
// ==========================================

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ANALYZE_QUIZ") {
    handleAnalyzeQuiz(message.payload)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }

  if (message.type === "SAVE_API_KEY") {
    chrome.storage.sync.set({ geminiApiKey: message.payload.apiKey }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === "GET_API_KEY") {
    chrome.storage.sync.get(["geminiApiKey"], (result) => {
      sendResponse({ success: true, apiKey: result.geminiApiKey || "" });
    });
    return true;
  }
});

async function handleAnalyzeQuiz({ questions, apiKey }) {
  if (!apiKey) throw new Error("Chưa có API key. Vui lòng nhập API key trong phần Settings.");

  const results = [];

  for (const q of questions) {
    try {
      const answer = await callGeminiAPI(q, apiKey);
      results.push({ ...q, answer });
    } catch (err) {
      results.push({ ...q, answer: null, error: err.message });
    }
  }

  return results;
}

async function callGeminiAPI(question, apiKey) {
  const prompt = buildPrompt(question);

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const errMsg = errBody?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Gemini API lỗi: ${errMsg}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) throw new Error("Không nhận được phản hồi từ AI");

  try {
    return JSON.parse(text);
  } catch {
    // If not valid JSON, try to extract answer from raw text
    return { answer: text.trim(), explanation: "", confidence: "medium" };
  }
}

function buildPrompt(question) {
  const { type, questionText, options } = question;

  if (type === "fill_blank") {
    return `Bạn là trợ lý học tập thông minh. Hãy điền vào chỗ trống phù hợp nhất cho câu sau.

CÂU HỎI: "${questionText}"

Trả về JSON theo format:
{
  "answer": "từ hoặc cụm từ cần điền",
  "explanation": "giải thích ngắn gọn tại sao",
  "confidence": "high|medium|low"
}`;
  }

  // Multiple choice
  const optionsList = options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o.text}`).join("\n");

  return `Bạn là trợ lý học tập thông minh. Hãy phân tích câu hỏi trắc nghiệm sau và chọn đáp án đúng nhất.

CÂU HỎI: "${questionText}"

CÁC LỰA CHỌN:
${optionsList}

Trả về JSON theo format:
{
  "answer": "chữ cái của đáp án đúng (A, B, C hoặc D...)",
  "answerIndex": số thứ tự 0-based của đáp án đúng,
  "answerText": "nội dung đáp án đúng",
  "explanation": "giải thích ngắn gọn tại sao đây là đáp án đúng",
  "confidence": "high|medium|low"
}`;
}
