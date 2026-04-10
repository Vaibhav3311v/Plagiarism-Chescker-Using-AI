const API_BASE_URL = "http://localhost:5000/api";

// Configure PDF.js worker (required for browser-based PDF parsing)
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

document.addEventListener('DOMContentLoaded', () => {
  const textArea = document.getElementById('main-textarea');
  const charCount = document.getElementById('char-count');
  const scanBtn = document.getElementById('scan-btn');
  const newScanBtn = document.getElementById('new-scan-btn');

  const inputSection = document.getElementById('input-section');
  const loadingSection = document.getElementById('loading-section');
  const resultsSection = document.getElementById('results-section');

  const summaryEl = document.getElementById('ai-summary');
  const loadingProgress = document.getElementById('loading-progress');
  const aiStatusBar = document.getElementById('ai-status-bar');
  const aiStatusText = document.getElementById('ai-status-text');
  const apiStatusEl = document.getElementById('api-status');

  // Score circle elements
  const aiCircle       = document.getElementById('ai-circle');
  const aiScoreValue   = document.getElementById('ai-score-value');
  const plagCircle     = document.getElementById('plag-circle');
  const plagScoreValue = document.getElementById('plag-score-value');
  const overlapCircle      = document.getElementById('overlap-circle');
  const overlapScoreValue  = document.getElementById('overlap-score-value');

  // Other result elements
  const highlightedTextOutput = document.getElementById('highlighted-text-output');
  const lowConfidenceWarning  = document.getElementById('low-confidence-warning');

  // Feature elements
  const fileInput      = document.getElementById('file-input');
  const uploadFileBtn  = document.getElementById('upload-file-btn');
  const exportBtn      = document.getElementById('export-btn');
  const historyBtn     = document.getElementById('history-btn');
  const logoutBtn      = document.getElementById('logout-btn');
  const deleteBtn      = document.getElementById('delete-account-btn');
  const historyModal   = document.getElementById('history-modal');
  const historyClose   = document.getElementById('history-close');
  const historyList    = document.getElementById('history-list');
  const historyEmpty   = document.getElementById('history-empty');
  const clearHistoryBtn = document.getElementById('clear-history-btn');
  
  const deleteModal    = document.getElementById('delete-modal');
  const deleteModalClose = document.getElementById('delete-modal-close');
  const deleteForm     = document.getElementById('delete-account-form');

  // In-memory reference to latest result for export
  let _lastResult = null;
  let _lastText = '';

  // Logout Handler
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        if (window.fbAuth) await window.fbMethods.signOut(window.fbAuth);
      } catch(err) {
        console.error("Logout failed", err);
      }
    });
  }

  // Delete Modal Visibility Handlers
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => deleteModal.classList.remove('hidden'));
  }
  if (deleteModalClose) {
    deleteModalClose.addEventListener('click', () => deleteModal.classList.add('hidden'));
  }
  if (deleteModal) {
    deleteModal.addEventListener('click', (e) => {
      if (e.target === deleteModal) deleteModal.classList.add('hidden');
    });
  }

  // Account Deletion Flow
  if (deleteForm) {
    deleteForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pwInput = document.getElementById('delete-password-input').value;
      const confirmInput = document.getElementById('delete-confirm-input').value;
      const submitBtn = document.getElementById('submit-delete-btn');

      if (confirmInput !== 'DELETE') {
        alert('Please strictly type DELETE to confirm.');
        return;
      }

      const user = window.fbAuth?.currentUser;
      if (!user) return;

      const originalHtml = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i data-lucide="loader" class="icon-sm spin-icon"></i> Deleting...';
      lucide.createIcons();

      try {
        const { 
          EmailAuthProvider, 
          reauthenticateWithCredential, 
          deleteDoc, 
          doc, 
          collection, 
          query, 
          where, 
          getDocs,
          deleteUser
        } = window.fbMethods;
        const db = window.fbDb;

        // 1. Re-authenticate
        const credential = EmailAuthProvider.credential(user.email, pwInput);
        await reauthenticateWithCredential(user, credential);

        // 2. Delete Firestore data (Scans History)
        const q = query(collection(db, "scans"), where("uid", "==", user.uid));
        const snapshots = await getDocs(q);
        const deletePromises = [];
        snapshots.forEach((document) => {
          deletePromises.push(deleteDoc(doc(db, "scans", document.id)));
        });
        await Promise.all(deletePromises);

        // 3. Delete Firestore Auth Profile
        await deleteDoc(doc(db, "users", user.uid));

        // 4. Hit Backend Endpoint
        try {
          const token = await user.getIdToken();
          await fetch(`${API_BASE_URL}/delete-user`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
        } catch(e) {
          console.warn("Backend deletion hook execution finished.");
        }

        // 5. Delete Firebase Auth User
        // Because deleteUser automatically invalidates sessions, 
        // the AuthState observer route guard immediately kicks them to auth.html.
        await deleteUser(user);

        alert('Your account and all associated data have been successfully deleted.');

      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
        lucide.createIcons();

        if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
          alert('Incorrect password. Please try again.');
        } else {
          alert(err.message.replace('Firebase:', '').trim());
        }
      }
    });
  }

  // Check server health on load
  checkHealth();

  // ── Global Cursor Track ────────────────────────────
  const cursorGlow = document.getElementById('cursor-glow');
  if (cursorGlow) {
    document.addEventListener('mousemove', (e) => {
      cursorGlow.style.left = `${e.clientX}px`;
      cursorGlow.style.top = `${e.clientY}px`;
    });
  }

  // ── Typing Engine ──────────────────────────────────
  const phrases = ["Reveal Authenticity", "Detect the Undetectable", "Analyze the Matrix", "Spot AI Synthesis"];
  let phraseIdx = 0;
  let charIdx = 0;
  let isDeleting = false;
  const typeContainer = document.getElementById('typewriter');
  
  if (typeContainer) {
    function typeEffect() {
      const currentPhrase = phrases[phraseIdx];
      
      if (isDeleting) {
        typeContainer.textContent = currentPhrase.substring(0, charIdx - 1);
        charIdx--;
      } else {
        typeContainer.textContent = currentPhrase.substring(0, charIdx + 1);
        charIdx++;
      }

      let typeSpeed = isDeleting ? 40 : 80;

      if (!isDeleting && charIdx === currentPhrase.length) {
        typeSpeed = 2000; // Pause at end
        isDeleting = true;
      } else if (isDeleting && charIdx === 0) {
        isDeleting = false;
        phraseIdx = (phraseIdx + 1) % phrases.length;
        typeSpeed = 500; // Pause before new word
      }

      setTimeout(typeEffect, typeSpeed);
    }
    typeEffect();
  }

  // ── Scroll Reveal Observer & Live Counters ─────────
  const observerOptions = { threshold: 0.1, rootMargin: "0px 0px -50px 0px" };
  const scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        
        // If it's a stats container, trigger the number counters
        if (entry.target.classList.contains('live-stats')) {
          const statNumbers = entry.target.querySelectorAll('.stat-number');
          statNumbers.forEach(counter => {
            const target = +counter.getAttribute('data-target');
            if (target > 0 && counter.textContent === "0") {
              animateCounter(counter, target);
            }
          });
        }
      }
    });
  }, observerOptions);

  document.querySelectorAll('.scroll-reveal').forEach(el => scrollObserver.observe(el));

  function animateCounter(el, target) {
    const duration = 2000;
    const step = target / (duration / 16); // 60fps
    let current = 0;
    
    function update() {
      current += step;
      if (current < target) {
        // format with commas if it's a large number
        el.textContent = target >= 1000 ? Math.floor(current).toLocaleString() : current.toFixed(1);
        requestAnimationFrame(update);
      } else {
        el.textContent = target >= 1000 ? target.toLocaleString() : target;
      }
    }
    update();
  }

  // ── Drag & Drop Logic ──────────────────────────────
  const dropZone = document.getElementById('drop-zone');
  const dropOverlay = document.getElementById('drop-overlay');

  if (dropZone && dropOverlay) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
      dropOverlay.classList.remove('hidden');
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      if (!dropZone.contains(e.relatedTarget)) {
        dropZone.classList.remove('drag-over');
        dropOverlay.classList.add('hidden');
      }
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      dropOverlay.classList.add('hidden');

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        const reader = new FileReader();
        reader.onload = function(evt) {
          textArea.value = evt.target.result;
          textArea.dispatchEvent(new Event('input')); // trigger char count update
        };
        reader.readAsText(file);
      }
    });
  }

  // ── Input (with word count gate) ────────────────────────
  const MIN_WORDS = 50;

  textArea.addEventListener('input', () => {
    const len = textArea.value.length;
    const words = textArea.value.trim().split(/\s+/).filter(w => w.length > 0).length;
    charCount.textContent = `${len} / 5000 chars  ·  ${words} words`;

    if (textArea.value.trim().length === 0) {
      scanBtn.disabled = true;
      setAiStatus('idle', 'AI Detection Engine Ready &bull; Paste or Upload Your Content');
    } else if (words < MIN_WORDS) {
      scanBtn.disabled = true;
      setAiStatus('awaiting', `Awaiting Sufficient Data &bull; ${words} / ${MIN_WORDS} words minimum`);
    } else {
      scanBtn.disabled = false;
      const isAuth = window.fbAuth?.currentUser != null;
      setAiStatus('idle', `AI Detection Engine Ready &bull; Press Enter or Click ${isAuth ? 'Scan' : 'Authenticate'}`);
    }
  });

  // ── Smart Authentication & Scan Logic ─────────────────
  async function handleScanFlow() {
    if (scanBtn.disabled) return;
    const text = textArea.value.trim();
    if (text.length <= 10) return;

    // Reject if unauthorized
    if (!window.fbAuth?.currentUser) {
      setAiStatus('error', 'Session Expired &bull; Please log in to proceed.');
      setTimeout(() => window.location.href = 'auth.html', 1500);
      return;
    }

    // Scanning Phase
    setAiStatus('scanning', 'Scanning Content &bull; Comparing Against Billions of Sources...');
    switchPanel(inputSection, loadingSection);

    const progressInterval = startFakeProgress();

    const analyzingTimer = setTimeout(() => {
      setAiStatus('analyzing', 'Running Neural Similarity Analysis &bull; Detecting Patterns...');
    }, 1500);

    try {
      const result = await analyzeText(text);
      clearInterval(progressInterval);
      clearTimeout(analyzingTimer);
      loadingProgress.style.width = '100%';

      setTimeout(() => {
        setAiStatus('completed', 'Analysis Complete &bull; Authenticity Score Generated');
        switchPanel(loadingSection, resultsSection);
        _lastResult = result;
        _lastText = text;
        renderResults(result);
        saveToHistory(text, result);
        
        // Ensure button rests in scanning mode for next time
        scanBtn.innerHTML = '<i data-lucide="fingerprint" class="icon-md"></i> Scan Content';
        lucide.createIcons();
      }, 400);

    } catch (err) {
      clearInterval(progressInterval);
      clearTimeout(analyzingTimer);
      switchPanel(loadingSection, inputSection);
      
      // Graceful error UI
      setAiStatus('error', err.message || "Analysis Failed &bull; Please Try Again");
      
      scanBtn.innerHTML = '<i data-lucide="fingerprint" class="icon-md"></i> Scan Content';
      lucide.createIcons();
    }
  }

  // Keyboard shortcut (Enter to submit)
  textArea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleScanFlow();
    }
  });

  // Manual click logic
  scanBtn.addEventListener('click', handleScanFlow);

  // ── New Scan ───────────────────────────────────────
  newScanBtn.addEventListener('click', () => {
    switchPanel(resultsSection, inputSection);
    textArea.value = '';
    charCount.textContent = '0 / 5000 characters';
    scanBtn.disabled = true;
    loadingProgress.style.width = '0%';
    setAiStatus('idle', 'AI Detection Engine Ready &bull; Paste or Upload Your Content');
  });

  // ── API call ───────────────────────────────────────
  async function analyzeText(text) {
    let token = '';
    if (window.fbAuth?.currentUser) {
      token = await window.fbAuth.currentUser.getIdToken();
    }

    const res = await fetch(`${API_BASE_URL}/analyze`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ text })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Server error occurred.');
    }

    return data;
  }

  async function checkHealth() {
    try {
      const res = await fetch(`${API_BASE_URL}/health`);
      const data = await res.json();
      if (data.status === 'ok') {
        if (data.api_configured) {
          apiStatusEl.textContent = '● Server Online · AI Ready';
          apiStatusEl.className = 'status-dot status-online';
          setAiStatus('idle', 'AI Detection Engine Ready &bull; Paste or Upload Your Content');
        } else {
          apiStatusEl.textContent = '● Server Online · API Key Missing';
          apiStatusEl.className = 'status-dot status-warn';
          setAiStatus('error', 'Backend is running but no Groq API key is set.');
        }
      }
    } catch {
      apiStatusEl.textContent = '● Server Offline – Start server.py';
      apiStatusEl.className = 'status-dot status-offline';
      setAiStatus('error', 'Cannot reach the backend server. Start server.py');
    }
  }

  // ── Results Render ──────────────────────────────────
  function renderResults(data) {
    // Low-confidence warning strip
    if (data.low_confidence_warning) {
      lowConfidenceWarning.classList.remove('hidden');
    } else {
      lowConfidenceWarning.classList.add('hidden');
    }

    // Animate the three circles
    animateScore(aiCircle,      aiScoreValue,      data.ai_score        || 0);
    animateScore(plagCircle,    plagScoreValue,    data.plagiarism_score || 0);
    animateScore(overlapCircle, overlapScoreValue, data.source_overlap   || 0);

    // ── Confidence-based headline message ──────────────
    const aiScore   = data.ai_score || 0;
    const confLevel = data.confidence_level || 'Low';

    let headline = '';
    if (confLevel === 'High') {
      if (aiScore >= 65) {
        headline = 'Strong AI indicators detected • Results are reliable';
      } else if (aiScore >= 35) {
        headline = 'Moderate AI patterns found • Results are reliable';
      } else {
        headline = 'Low AI probability detected • Results are reliable';
      }
    } else if (confLevel === 'Medium') {
      if (aiScore >= 55) {
        headline = 'AI-consistent patterns observed • Results are indicative, not definitive';
      } else {
        headline = 'Mixed writing patterns observed • Results are indicative, not definitive';
      }
    } else {
      headline = 'Low confidence • Provide more content for accurate analysis';
    }

    // Render headline + explanation in the summary box
    if (summaryEl) {
      summaryEl.innerHTML = `<strong class="summary-headline">${headline}</strong>${
        data.explanation ? `<br><span class="summary-detail">${data.explanation}</span>` : ''
      }`;
    }

    // Sentence breakdown
    if (data.sentences && Array.isArray(data.sentences)) {
      highlightedTextOutput.innerHTML = buildHighlightedHTML(data.sentences);
    }
  }

  function buildHighlightedHTML(sentences) {
    return sentences.map(s => {
      let cls = '';
      let tooltip = '';
      if (s.type === 'ai_traced') {
        cls = 'hl-ai';
        tooltip = `AI Trace: ${s.signal || 'AI-consistent patterns'}`;
      } else if (s.type === 'uncertain') {
        cls = 'hl-plag';
        tooltip = `Uncertain: ${s.signal || 'Ambiguous signals'}`;
      } else {
        tooltip = `Authentic: ${s.signal || 'Natural language patterns'}`;
      }
      return `<span class="${cls}" title="${tooltip}">${s.text}</span> `;
    }).join('');
  }

  // ── Helpers ─────────────────────────────────────────
  function switchPanel(from, to) {
    from.classList.add('hidden');
    to.classList.remove('hidden');
  }

  function setAiStatus(state, msg) {
    if (!aiStatusBar || !aiStatusText) return;
    aiStatusBar.className = 'ai-status-bar'; // reset classes
    // 'awaiting' maps to a special amber-like style
    const cssState = state === 'awaiting' ? 'state-awaiting' : `state-${state}`;
    aiStatusBar.classList.add(cssState);
    aiStatusText.innerHTML = msg;
  }

  function startFakeProgress() {
    let progress = 0;
    return setInterval(() => {
      // Advance quickly to 85% then stall (real API controls the rest)
      const step = progress < 85 ? Math.random() * 8 : Math.random() * 0.5;
      progress = Math.min(progress + step, 92);
      loadingProgress.style.width = `${progress}%`;
    }, 400);
  }

  // ── Feature 1: File Upload (TXT / PDF / DOCX) ──────────
  uploadFileBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    let extractedText = '';

    try {
      setAiStatus('scanning', `Reading file: ${file.name}`);

      if (ext === 'txt') {
        extractedText = await file.text();

      } else if (ext === 'pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          pages.push(content.items.map(s => s.str).join(' '));
        }
        extractedText = pages.join('\n\n');

      } else if (ext === 'docx') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        extractedText = result.value;

      } else {
        setAiStatus('error', 'Unsupported file type. Use .txt, .pdf, or .docx');
        return;
      }

      const truncated = extractedText.trim().slice(0, 5000);
      textArea.value = truncated;
      textArea.dispatchEvent(new Event('input')); // trigger word count update

      // Show a green file-loaded badge
      const existing = document.querySelector('.file-loaded-badge');
      if (existing) existing.remove();
      const badge = document.createElement('span');
      badge.className = 'file-loaded-badge';
      badge.innerHTML = `<i data-lucide="file-check" style="width:14px;height:14px"></i> ${file.name}`;
      uploadFileBtn.insertAdjacentElement('afterend', badge);
      lucide.createIcons();

      setAiStatus('idle', 'File loaded • Ready to scan');
    } catch (err) {
      setAiStatus('error', `Failed to read file: ${err.message}`);
    }

    fileInput.value = ''; // reset so same file can be re-selected
  });

  // ── Feature 2: Export Report ───────────────────────────
  exportBtn.addEventListener('click', () => {
    if (!_lastResult) return;

    const d = _lastResult;
    const now = new Date().toLocaleString();
    const snippet = _lastText.slice(0, 200).replace(/\n/g, ' ');

    const report = [
      '╔══════════════════════════════════════════════════╗',
      '║          VERITAS AI — ANALYSIS REPORT           ║',
      '╚══════════════════════════════════════════════════╝',
      '',
      `Generated : ${now}`,
      `Word Count : ${d.word_count || '—'}`,
      `Confidence : ${d.confidence_level}`,
      '',
      '─── SCORES ────────────────────────────────────────',
      `  AI Generated    : ${d.ai_score}%`,
      `  Plagiarism Match: ${d.plagiarism_score}%`,
      `  Source Overlap  : ${d.source_overlap}%`,
      '',
      '─── ANALYSIS ──────────────────────────────────────',
      (d.explanation || '').replace(/(.{80})/g, '$1\n'),
      '',
      '─── SENTENCE BREAKDOWN ────────────────────────────',
      ...(d.sentences || []).map(s =>
        `  [${s.type.padEnd(10)}] ${s.text.slice(0, 120)}${s.text.length > 120 ? '…' : ''}`
      ),
      '',
      '─── TEXT SNIPPET ──────────────────────────────────',
      snippet + (snippet.length === 200 ? '…' : ''),
      '',
      '──────────────────────────────────────────────────',
      'Results are analytical suggestions, not definitive verdicts.',
      'Veritas AI | Powered by Groq Llama 3.3 70B',
    ].join('\n');

    const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `VeritasAI_Report_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ── Feature 3: Scan History (Firestore) ────────────────────────────
  
  async function saveToHistory(text, result) {
    if (!window.fbAuth?.currentUser) return;
    try {
      await window.fbMethods.addDoc(window.fbMethods.collection(window.fbDb, "scans"), {
        uid: window.fbAuth.currentUser.uid,
        timestamp: Date.now(), 
        dateStr: new Date().toLocaleString(),
        snippet: text.slice(0, 120),
        fullText: text.slice(0, 5000),
        ai_score: result.ai_score,
        plagiarism_score: result.plagiarism_score,
        source_overlap: result.source_overlap,
        confidence_level: result.confidence_level,
        explanation: result.explanation,
        word_count: result.word_count
      });
    } catch(e) {
      console.error("Error saving history to cloud:", e);
    }
  }

  async function renderHistory() {
    if (!window.fbAuth?.currentUser) return;
    
    // Show Loading state
    historyEmpty.style.display = 'flex';
    historyEmpty.innerHTML = '<i data-lucide="loader" class="icon-md spin-icon"></i><p>Syncing cloud history...</p>';
    lucide.createIcons();
    
    // Clear old items
    [...historyList.querySelectorAll('.history-item')].forEach(el => el.remove());
    clearHistoryBtn.style.display = 'none'; // Hidden when using Firestore due to batch delete complexity

    try {
      const q = window.fbMethods.query(
        window.fbMethods.collection(window.fbDb, "scans"),
        window.fbMethods.where("uid", "==", window.fbAuth.currentUser.uid),
        window.fbMethods.orderBy("timestamp", "desc"),
        window.fbMethods.limit(50)
      );
      
      const querySnapshot = await window.fbMethods.getDocs(q);
      const history = [];
      querySnapshot.forEach((doc) => {
        history.push({ id: doc.id, ...doc.data() });
      });

      if (history.length === 0) {
        historyEmpty.innerHTML = '<i data-lucide="inbox"></i><p>No scans yet. Run your first analysis to see history here.</p>';
        lucide.createIcons();
        return;
      }

      historyEmpty.style.display = 'none';

      history.forEach(entry => {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
          <div class="history-scores">
            <div class="h-badge h-ai">${entry.ai_score}%<span>AI</span></div>
            <div class="h-badge h-plag">${entry.plagiarism_score}%<span>Plag</span></div>
            <div class="h-badge h-ov">${entry.source_overlap}%<span>Overlap</span></div>
          </div>
          <div class="history-meta">
            <div class="h-snippet">${entry.snippet}${entry.snippet.length >= 120 ? '\u2026' : ''}</div>
            <div class="h-timestamp">${entry.dateStr || new Date(entry.timestamp).toLocaleString()} &bull; ${entry.word_count || '?'} words</div>
          </div>
          <span class="h-conf ${entry.confidence_level}">${entry.confidence_level}</span>
        `;
        item.addEventListener('click', () => {
          textArea.value = entry.fullText;
          textArea.dispatchEvent(new Event('input'));
          historyModal.classList.add('hidden');
        });
        historyList.appendChild(item);
      });
      
    } catch(e) {
      console.error("Firestore history error:", e);
      historyEmpty.innerHTML = '<i data-lucide="alert-circle"></i><p>Could not load history. Ensure database permissions and indexes are set.</p>';
      lucide.createIcons();
    }
  }

  // Open history modal
  historyBtn.addEventListener('click', () => {
    historyModal.classList.remove('hidden');
    renderHistory();
  });

  // Close history modal
  historyClose.addEventListener('click', () => historyModal.classList.add('hidden'));
  historyModal.addEventListener('click', (e) => {
    if (e.target === historyModal) historyModal.classList.add('hidden');
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      historyModal.classList.add('hidden');
      if (deleteModal) deleteModal.classList.add('hidden');
    }
  });

  // ── Animate score circles ──────────────────────────────
  function animateScore(circleEl, textEl, finalVal) {
    if (!circleEl || !textEl) return;
    let current = 0;
    const duration = 1400;
    const stepTime = 16;
    const steps = duration / stepTime;
    const increment = finalVal / steps;

    const timer = setInterval(() => {
      current = Math.min(current + increment, finalVal);
      circleEl.style.setProperty('--prog', `${current}%`);
      textEl.textContent = `${Math.round(current)}%`;
      if (current >= finalVal) clearInterval(timer);
    }, stepTime);
  }

});
