# Veritas AI – Plagiarism Checker

A premium AI-powered plagiarism and AI-content detection web app powered by **Google Gemini AI** and **Flask**.

---

## Project Files

| File | Purpose |
|------|---------|
| `index.html` | Frontend UI (open in browser) |
| `styles.css` | Premium dark-mode design system |
| `app.js` | Frontend logic + API integration |
| `server.py` | Flask backend with Gemini AI |
| `.env` | Your secret API key (edit this) |
| `start_server.bat` | One-click server launcher |

---

## Setup (One-Time)

### Step 1 – Get a Free Gemini API Key
1. Go to: **https://aistudio.google.com/app/apikey**
2. Sign in with Google and click **"Create API Key"**
3. Copy the key

### Step 2 – Add the Key to `.env`
Open `.env` and replace `your_gemini_api_key_here`:
```
GEMINI_API_KEY=AIzaSy...your_actual_key_here
```

---

## Running the App

### Step 1 – Start the Backend
Double-click **`start_server.bat`**

Or run in terminal:
```
python server.py
```

You should see:
```
[OK] Gemini API key detected.
--> Server running at: http://localhost:5000
```

### Step 2 – Open the Frontend
Double-click **`index.html`** to open in your browser.

The status dot in the header should show **"● Server Online · AI Ready"** in green.

---

## How It Works

1. Paste your text into the textarea
2. Click **"Scan Document"**
3. Gemini AI analyzes it and returns:
   - **AI Score** – how likely the text was AI-generated
   - **Plagiarism Score** – how likely content is copied
   - **Overall Risk Score** – combined threat score
   - **Sentence breakdown** – each sentence color-coded:
     - 🟣 Purple = AI Generated
     - 🔴 Red = Plagiarized
     - No highlight = Original

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server & API key status |
| POST | `/api/analyze` | Analyze text (body: `{"text": "..."}`) |
