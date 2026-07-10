# 🤖 AutoFillQuiz - AI Quiz Assistant

> **Chrome Extension** dùng Google Gemini AI để tự động đọc câu hỏi trắc nghiệm trên bất kỳ trang web nào, highlight đáp án đúng và tự động điền câu trả lời.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![Gemini AI](https://img.shields.io/badge/Powered%20by-Gemini%20AI-8E75B2?logo=google&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## ✨ Tính năng

| Tính năng | Mô tả |
|-----------|-------|
| 🔍 **Quét thông minh** | Tự động nhận dạng radio, checkbox, dropdown, fill-blank, Google Forms |
| 🟢 **Highlight màu** | Xanh = đúng, mờ đỏ = sai — hiển thị trực tiếp trên trang |
| ⚡ **Auto-fill** | Tự động click/chọn đáp án đúng |
| 💡 **Điền từ** | Hỗ trợ dạng câu điền từ vào chỗ trống |
| 💬 **Giải thích** | AI giải thích tại sao đó là đáp án đúng |
| 🌙 **Dark UI** | Giao diện premium glassmorphism |

---

## 🚀 Cài đặt

### Bước 1 — Lấy Gemini API Key (miễn phí)

1. Truy cập [Google AI Studio](https://aistudio.google.com/apikey)
2. Đăng nhập bằng tài khoản Google
3. Click **"Create API key"** → Copy key

### Bước 2 — Load Extension vào Chrome

1. Tải repo này về máy (hoặc clone):
   ```bash
   git clone https://github.com/YOUR_USERNAME/AutoFillQuiz.git
   ```
2. Mở Chrome → gõ `chrome://extensions` trên thanh địa chỉ
3. Bật **"Developer mode"** (công tắc góc trên phải)
4. Click **"Load unpacked"** → Chọn thư mục `AutoFillQuiz`

### Bước 3 — Nhập API Key

1. Click icon extension 🤖 trên toolbar Chrome
2. Vào tab **⚙️ Cài Đặt**
3. Dán Gemini API key vào ô → Nhấn **"Lưu Cài Đặt"**

### Bước 4 — Sử dụng

1. Mở trang web có bài quiz/trắc nghiệm
2. Click icon extension → Nhấn **"Quét & Phân Tích Trang"**
3. AI sẽ highlight xanh câu đúng trực tiếp trên trang!

---

## 📁 Cấu trúc dự án

```
AutoFillQuiz/
├── manifest.json              ← Cấu hình Chrome Extension (Manifest V3)
├── assets/
│   ├── icon16.png             ← Icons (16, 32, 48, 128px)
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── background/
│   └── background.js          ← Service worker, gọi Gemini API
├── content/
│   ├── content.js             ← Đọc DOM, highlight, auto-fill
│   └── content.css            ← Styles highlight
└── popup/
    ├── popup.html             ← UI 3 tab
    ├── popup.css              ← Dark glassmorphism UI
    └── popup.js               ← Controller
```

---

## 🛠️ Các trang web được hỗ trợ

- ✅ Google Forms
- ✅ Kahoot, Quizlet
- ✅ Moodle, LMS nội bộ
- ✅ Bất kỳ trang có câu hỏi radio/checkbox/select
- ✅ Dạng điền từ (text input)

---

## ⚠️ Lưu ý

- API key được lưu trong **Chrome storage** (local, không gửi đi đâu khác ngoài Gemini API)
- Gemini API miễn phí với giới hạn **15 requests/phút**
- Extension chỉ hoạt động trên **Chrome/Edge/Brave** (hỗ trợ Manifest V3)

---

## 📄 License

MIT License — Tự do sử dụng và chỉnh sửa.
