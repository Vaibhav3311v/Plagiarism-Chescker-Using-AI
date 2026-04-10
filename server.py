import os
import json
import re
import math
import hashlib
import random
import time
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from functools import wraps
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from groq import Groq

# Firebase Admin Setup
FIREBASE_ENABLED = False
try:
    import firebase_admin
    from firebase_admin import credentials, auth as firebase_auth

    if not firebase_admin._apps:
        if os.path.exists('serviceAccountKey.json'):
            cred = credentials.Certificate('serviceAccountKey.json')
            firebase_admin.initialize_app(cred)
            FIREBASE_ENABLED = True
        else:
            print("  [!] WARNING: serviceAccountKey.json not found! Backend Auth verification is disabled.")
except ImportError:
    print("  [!] WARNING: firebase-admin package not installed. Run: pip install firebase-admin")
except Exception as e:
    print(f"  [!] WARNING: Firebase Admin SDK failed to initialize: {e}")

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not FIREBASE_ENABLED:
            return f(*args, **kwargs)
            
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({"error": "Missing or invalid authorization header. Please log in first."}), 401
            
        token = auth_header.split(' ')[1]
        try:
            decoded_token = firebase_auth.verify_id_token(token)
            request.user = decoded_token 
        except Exception as e:
            return jsonify({"error": f"Invalid or expired token: {str(e)}"}), 401
            
        return f(*args, **kwargs)
    return decorated

# Always load `.env` from the folder that contains this file (not from whatever cwd Python was started in)
_ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(_ROOT)
# override=True: a stale GROQ_API_KEY in the Windows/User environment must not hide the real key from .env
load_dotenv(os.path.join(_ROOT, ".env"), override=True)

app = Flask(__name__)
CORS(app)

# ── Serve Frontend Files ───────────────────────────────────
# Whitelist safe extensions so we don't accidentally expose .env or .py files
ALLOWED_EXTENSIONS = {'.html', '.js', '.css', '.png', '.jpg', '.webp', '.svg'}

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/firebase-env.js')
def serve_firebase_env():
    """Serve Firebase environment variables as global JavaScript variables."""
    firebase_vars = f"""
window.FIREBASE_API_KEY = '{os.getenv('FIREBASE_API_KEY', '')}';
window.FIREBASE_AUTH_DOMAIN = '{os.getenv('FIREBASE_AUTH_DOMAIN', '')}';
window.FIREBASE_PROJECT_ID = '{os.getenv('FIREBASE_PROJECT_ID', '')}';
window.FIREBASE_STORAGE_BUCKET = '{os.getenv('FIREBASE_STORAGE_BUCKET', '')}';
window.FIREBASE_MESSAGING_SENDER_ID = '{os.getenv('FIREBASE_MESSAGING_SENDER_ID', '')}';
window.FIREBASE_APP_ID = '{os.getenv('FIREBASE_APP_ID', '')}';
window.FIREBASE_MEASUREMENT_ID = '{os.getenv('FIREBASE_MEASUREMENT_ID', '')}';
"""
    return firebase_vars, 200, {'Content-Type': 'application/javascript'}

@app.route('/<path:path>')
def serve_static(path):
    ext = os.path.splitext(path)[1]
    if ext in ALLOWED_EXTENSIONS and os.path.exists(path):
        return send_from_directory('.', path)
    
    # Block sensitive files completely
    if path == ".env" or path.endswith(".py") or path.endswith(".bat"):
        return "Forbidden", 403
        
    # If path exists but has no extension (e.g. some asset), allow if not sensitive
    if os.path.exists(path):
        return send_from_directory('.', path)
        
    # Fallback SPA-style redirect
    return send_from_directory('.', 'index.html')

# ── End Frontend Routing ───────────────────────────────────


GROQ_API_KEY = (os.getenv("GROQ_API_KEY") or "").strip()

# Groq model to use — llama-3.3-70b is fast and highly capable
GROQ_MODEL = "llama-3.3-70b-versatile"

MIN_WORD_COUNT = 50

# ── Singleton thread-pool for concurrent work ──────────────
_EXECUTOR = ThreadPoolExecutor(max_workers=4)

# ── Singleton Groq client (created once, reused per request) ─
_groq_client: Groq | None = None


def get_groq_client() -> Groq:
    """Return the singleton Groq client, raising if the key is missing."""
    global _groq_client
    if _groq_client is None:
        if not GROQ_API_KEY or GROQ_API_KEY == "your_groq_api_key_here":
            raise ValueError("GROQ_API_KEY is not configured in the .env file.")
        _groq_client = Groq(api_key=GROQ_API_KEY)
    return _groq_client


# ── Result cache (keyed by SHA-256 of text, max 128 entries) ─
_result_cache: dict = {}
_CACHE_MAX = 128


def _cache_key(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _cache_get(text: str):
    return _result_cache.get(_cache_key(text))


def _cache_set(text: str, value: dict) -> None:
    key = _cache_key(text)
    if len(_result_cache) >= _CACHE_MAX:
        # Evict oldest entry (insertion-ordered dict in Python 3.7+)
        _result_cache.pop(next(iter(_result_cache)))
    _result_cache[key] = value


def count_words(text: str) -> int:
    """Returns the word count of a text string."""
    return len(text.split())


def compute_human_signals(text: str) -> dict:
    """
    Lightweight local heuristic pass — runs concurrently with the API call.
    """
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    sentences = [s for s in sentences if len(s.split()) >= 2]

    if not sentences:
        return {"human_score": 50, "signals": []}

    lengths = [len(s.split()) for s in sentences]
    mean_len = sum(lengths) / len(lengths)
    variance = sum((l - mean_len) ** 2 for l in lengths) / len(lengths)
    burstiness = math.sqrt(variance)

    words = re.findall(r"\b[a-zA-Z']+\b", text.lower())
    sample = words[:200]
    ttr = len(set(sample)) / len(sample) if sample else 0.5

    personal_re = re.compile(
        r"\b(i|me|my|mine|myself|we|our|us|i'm|i've|i'd|i'll|we're|we've|"
        r"don't|doesn't|can't|isn't|aren't|won't)\b", re.I)
    personal_count = len(personal_re.findall(text))
    personal_density = personal_count / max(len(words), 1) * 100

    hedge_re = re.compile(
        r"\b(think|believe|feel|maybe|perhaps|seem|appears|likely|possibly|"
        r"probably|i guess|in my opinion|honestly|frankly|although|however|but|yet)\b", re.I)
    hedge_count = len(hedge_re.findall(text))

    irregular = len(re.findall(r'[—–…()\[\]]', text))

    score = 50.0
    if burstiness > 8:    score += 25
    elif burstiness > 5:  score += 15
    elif burstiness > 3:  score += 8
    else:                 score -= 5
    if ttr > 0.65:        score += 20
    elif ttr > 0.55:      score += 10
    elif ttr < 0.45:      score -= 10
    if personal_density > 2:   score += 15
    elif personal_density > 1: score += 8
    if hedge_count > 5:  score += 10
    elif hedge_count > 2: score += 5
    score += min(irregular * 1.5, 5)

    human_score = max(5, min(95, score))
    signals = []
    if burstiness > 5:       signals.append("high sentence length variation")
    if ttr > 0.55:           signals.append("rich vocabulary diversity")
    if personal_density > 1: signals.append("personal voice detected")
    if hedge_count > 2:      signals.append("hedging/subjective language")
    if irregular > 2:        signals.append("natural punctuation patterns")

    return {"human_score": human_score, "signals": signals,
            "burstiness": round(burstiness, 2), "ttr": round(ttr, 3)}


def calibrate_scores(result: dict, human_signals: dict, word_count: int) -> dict:
    """
    Post-processes LLM scores using measured human writing signals.
    Applies weighted adjustments to reduce false positives.
    """
    raw_ai = result["ai_score"]
    human_score = human_signals["human_score"]  # 0-100, higher = more human

    # --- Step 1: Human-signal weighted reduction ---
    # The stronger the human signals, the more we pull the AI score down.
    # Weight: 0.0 (no human signal) to 0.5 (very strong human signal)
    human_weight = (human_score - 50) / 100  # -0.45 to +0.45
    adjustment = raw_ai * human_weight * 0.7  # scaled reduction factor
    adjusted_ai = raw_ai - adjustment

    # --- Step 2: Word count scaling ---
    # Very long texts with strong human signals get an extra reduction
    if word_count > 400 and human_score > 65:
        adjusted_ai *= 0.80
    elif word_count > 200 and human_score > 60:
        adjusted_ai *= 0.88

    # --- Step 3: Confidence-based floor/ceiling ---
    conf = result.get("confidence_level", "Low")
    if conf == "Low":
        # Clamp to conservative range for short text
        adjusted_ai = max(15, min(55, adjusted_ai))
    elif conf == "Medium":
        adjusted_ai = max(8, min(80, adjusted_ai))
    else:
        # High confidence — avoid extremes (0% or 100%)
        adjusted_ai = max(5, min(90, adjusted_ai))

    result["ai_score"] = round(adjusted_ai)

    # --- Step 4: Keep plagiarism/overlap in realistic ranges ---
    # These don't benefit from the same human-signal correction
    result["plagiarism_score"] = max(3, min(85, result["plagiarism_score"]))
    result["source_overlap"]   = max(3, min(80, result["source_overlap"]))

    # Attach calibration metadata (useful for debugging)
    result["_calibration"] = {
        "raw_ai_score": raw_ai,
        "human_score": round(human_score),
        "human_signals": human_signals["signals"],
    }

    return result


def build_prompt(text: str) -> str:
    """Compact, token-efficient prompt for the Groq LLM."""
    word_count = count_words(text)

    if word_count < 100:
        conf_note = "Text is SHORT — assign confidence_level='Low'; keep all scores 15-50."
    elif word_count < 250:
        conf_note = "Text is MEDIUM length — assign confidence_level='Medium'."
    else:
        conf_note = "Text is LONG — assign confidence_level='High'."

    return f"""Analyze the text below as an expert AI-content and linguistic analyst. Output ONLY valid JSON.

{conf_note}

RULES:
- Formal/clear human writing ≠ AI writing. Do NOT penalise clarity or structure.
- Raise ai_score only when MULTIPLE strong AI signals appear together.
- Contractions, first-person voice, hedging, sentence length variation ALL reduce ai_score.
- Human long-form text typically scores 10-35. Reserve 65+ for overwhelming AI patterns.
- Never return 0 or 100 for any score.

SCHEMA (return exactly this, no extra keys):
{{"confidence_level":"Low|Medium|High","ai_score":<int 0-100>,"plagiarism_score":<int 0-100>,"source_overlap":<int 0-100>,"explanation":"<2-3 sentences using: suggests/consistent with/may indicate>","low_confidence_warning":<bool>,"sentences":[{{"text":"<s>","type":"ai_traced|authentic|uncertain","signal":"<short phrase>"}}]}}

SCORING:
| ai_score | meaning |
|---|---|
| 65-90 | Robotic uniformity, zero personal voice, formulaic transitions |
| 40-64 | Mixed — AI patterns with some natural variation |
| 15-39 | Mostly human — some structured phrases |
| 5-14  | Strong human — varied rhythm, personal voice, natural quirks |

AI signals ↑: "Furthermore/Moreover/In conclusion", paragraph uniformity, no contractions, repetitive openers.
Human signals ↓: short+long sentence mix, I/we/contractions, hedging, em-dashes, parentheses.
plagiarism_score: how encyclopedic/generic is the phrasing? source_overlap ≈ 5-10pts below plagiarism_score.

TEXT:
\"\"\"
{text}
\"\"\""""



@app.route("/api/health", methods=["GET"])
def health():
    """Health check endpoint."""
    api_configured = bool(GROQ_API_KEY and GROQ_API_KEY != "your_groq_api_key_here")
    return jsonify({
        "status": "ok",
        "api_configured": api_configured,
        "provider": "Groq",
        "model": GROQ_MODEL
    })


@app.route("/api/delete-user", methods=["DELETE"])
@require_auth
def delete_user():
    """
    Secure hook for deleting a user. 
    The decorator (@require_auth) automatically validates the Firebase ID token in the Header.
    Any future local Flask-based user data tied to request.user["uid"] can be deleted here securely.
    Presently, the Flask server acts amnesiacally and Firebase handles all Database deletion seamlessly on the frontend.
    """
    uid = request.user["uid"]
    print(f"[DELETION HOOK] Verified deletion request for uid: {uid}")
    return jsonify({"message": "User securely verified and backend deletion hook executed."}), 200


@app.route("/api/analyze", methods=["POST"])
@require_auth
def analyze():
    """
    Main endpoint: accepts text and returns heuristic-based plagiarism/AI analysis.
    Expects JSON body: { "text": "..." }
    """
    try:
        data = request.get_json()
        if not data or "text" not in data:
            return jsonify({"error": "Request body must contain a 'text' field."}), 400

        text = data["text"].strip()

        if len(text) < 10:
            return jsonify({"error": "Text is too short. Please provide at least a few sentences."}), 400

        word_count = count_words(text)
        if word_count < MIN_WORD_COUNT:
            return jsonify({
                "error": f"Insufficient data. Please provide at least {MIN_WORD_COUNT} words for a meaningful analysis. Current word count: {word_count}."
            }), 400

        if len(text) > 10000:
            return jsonify({"error": "Text is too long. Please limit to 10,000 characters."}), 400

        # Check cache first — instant return for duplicate submissions
        cached = _cache_get(text)
        if cached:
            return jsonify(cached)

        client = get_groq_client()
        prompt = build_prompt(text)

        # Run local heuristic analysis CONCURRENTLY with the API call
        future_signals = _EXECUTOR.submit(compute_human_signals, text)

        chat_completion = client.chat.completions.create(
            messages=[
                {
                    "role": "system",
                    "content": "JSON-only AI content analyst. Output valid JSON only. Calibrated, honest scoring — never inflate AI scores."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            model=GROQ_MODEL,
            temperature=0.1,
            max_tokens=1800,   # reduced from 4096 — actual output is ~400-800 tokens
            response_format={"type": "json_object"}
        )

        raw_text = chat_completion.choices[0].message.content.strip()
        raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
        raw_text = re.sub(r"\s*```$", "", raw_text)

        result = json.loads(raw_text)

        required_fields = ["confidence_level", "ai_score", "plagiarism_score", "source_overlap", "explanation", "sentences"]
        for field in required_fields:
            if field not in result:
                raise ValueError(f"Missing field in AI response: {field}")

        for key in ["ai_score", "plagiarism_score", "source_overlap"]:
            result[key] = max(0, min(100, int(result[key])))

        valid_levels = {"Low", "Medium", "High"}
        if result.get("confidence_level") not in valid_levels:
            result["confidence_level"] = "Low"

        result["low_confidence_warning"] = result["confidence_level"] == "Low"

        # Collect the concurrent human-signals result (already computed while API was running)
        human_signals = future_signals.result()
        result = calibrate_scores(result, human_signals, word_count)

        result["word_count"] = word_count

        # Store in cache before returning
        _cache_set(text, result)

        return jsonify(result)

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except json.JSONDecodeError:
        return jsonify({"error": "AI returned an unexpected response format. Please try again."}), 500
    except Exception as e:
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500


# ── Simple Email OTP System ─────────────────────────────────
# We use an in-memory dictionary. In production, use Redis or a DB.
_otp_store = {}

SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")

@app.route('/api/send-otp', methods=['POST'])
def handle_send_otp():
    try:
        data = request.get_json()
        email_addr = data.get('email')
        if not email_addr:
            return jsonify({"error": "Email is required"}), 400
            
        # Generate 6 digit OTP
        otp_code = str(random.randint(100000, 999999))
        
        # Store securely with expiry (5 mins)
        _otp_store[email_addr] = {
            "code": otp_code,
            "expires_at": time.time() + 300
        }
        
        # Skip actual sending if credentials aren't set (Dev Mode)
        if not SMTP_USER or not SMTP_PASS:
            print(f"\n[DEV MODE] OTP generated for {email_addr}: {otp_code} (Add SMTP_USER/PASS to .env to send real emails)\n")
            return jsonify({"message": "OTP generated (Dev Mode, check terminal line)"})

        # Real Email Send Mode
        msg = MIMEMultipart()
        msg['From'] = SMTP_USER
        msg['To'] = email_addr
        msg['Subject'] = "Veritas AI - Verification Code"
        
        body = f"Your verification code is: {otp_code}\n\nThis code will expire in 5 minutes."
        msg.attach(MIMEText(body, 'plain'))
        
        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
        server.starttls()
        server.login(SMTP_USER, SMTP_PASS)
        server.send_message(msg)
        server.quit()
        
        return jsonify({"message": "OTP sent successfully"})
        
    except Exception as e:
        print(f"OTP Error: {e}")
        return jsonify({"error": f"Failed to send email: {str(e)}"}), 500

@app.route('/api/verify-otp', methods=['POST'])
def handle_verify_otp():
    data = request.get_json()
    email_addr = data.get('email')
    user_otp = data.get('otp')
    
    if not email_addr or not user_otp:
        return jsonify({"error": "Email and OTP required."}), 400
        
    record = _otp_store.get(email_addr)
    if not record:
        return jsonify({"error": "No pending OTP for this email."}), 404
        
    if time.time() > record["expires_at"]:
        del _otp_store[email_addr]
        return jsonify({"error": "OTP has expired."}), 400
        
    if record["code"] != user_otp:
        return jsonify({"error": "Invalid OTP code."}), 400
        
    # Verification successful
    del _otp_store[email_addr]
    return jsonify({"message": "Email verified successfully."})


if __name__ == "__main__":
    print("=" * 55)
    print("  Veritas AI - Plagiarism Checker Backend")
    print("  Provider: Groq  |  Model: " + GROQ_MODEL)
    print("=" * 55)
    if not GROQ_API_KEY or GROQ_API_KEY == "your_groq_api_key_here":
        print("  [!] WARNING: GROQ_API_KEY is not set in .env!")
        print("  --> Get your free key at: https://console.groq.com/")
        print("  --> Then paste it in the .env file.")
    else:
        print("  [OK] Groq API key detected.")
        
    if not SMTP_USER:
        print("  [!] SMTP_USER not set. OTPs will print to terminal instead of emailing.")
        
    print(f"  [OK] Minimum word count: {MIN_WORD_COUNT} words required.")
    print("  --> Server running at: http://localhost:5000")
    print("=" * 55)
    app.run(host="0.0.0.0", port=5000, debug=True)
