# TalkBridge

Every component of **TongueSync** involves trade-offs between latency, Indic/code-mixed accuracy, cost, and demo-day reliability. Below is a bottom-up architectural decision record (ADR) that evaluates the viable options at each layer, locks in the best choice with concrete justification, and builds up to a complete, frozen system blueprint.

---

## 1. Foundational Decisions (Language Pair & Hardware Assumptions)

### Language Pair Selection

* **Options:** (A) Hindi ↔ Tamil only, (B) Hindi ↔ English only, (C) **Primary: Hindi (incl. Hinglish) ↔ English + Secondary: Hindi ↔ Tamil**.
* **Decision: Option C — Primary Hindi/Hinglish ↔ English, with Hindi ↔ Tamil as a selectable pair.**
* **Why:**
1. **Easy Verifiability:** If your primary demo is Hindi ↔ Tamil and no one in the room speaks Tamil fluently, a subtle semantic error goes unnoticed—or worse, a Tamil-speaking examiner catches an awkward phrasing you couldn't verify during testing.
2. **Natural Code-Mixing:** Real Indian code-mixing is overwhelmingly Indic + English (Hinglish: *"kal meeting 5 baje hai, right?"*). Hindi ↔ English lets you directly showcase and grade code-mixed preservation.
3. **Indic-to-Indic Credibility:** Including Hindi ↔ Tamil as a second selectable language pair proves the architecture generalizes beyond English-centric pipelines without putting your core live demo at risk. You can validate Tamil accuracy offline using AI4Bharat's **IN22-Conv** conversational benchmark and a Tamil-speaking peer.



### Compute & Budget Constraint

* **Architectural Rule:** Every AI stage (ASR, MT, TTS) must sit behind a clean **Python Adapter Interface** supporting two runtime profiles switchable from the UI:
1. **Cloud Low-Latency Profile (Primary Demo):** Free-tier/free-credit APIs for sub-1.5s latency and best code-mixed accuracy.
2. **Local Offline Profile (Backup & Benchmark):** On-device models so the app still runs cleanly over a local hotspot if internet dies, and gives you a rich **Cloud vs. Local latency/accuracy comparison** for your report.



---

## 2. Audio Capture, Format & Turn-Taking (VAD)

| Option | Noise Robustness | Bandwidth | Latency Overhead | Verdict |
| --- | --- | --- | --- | --- |
| Push-to-Talk (PTT) only | Immune to noise | Minimal | 0 ms (manual) | Fails "natural conversation" goal as primary mode |
| Energy/RMS threshold VAD | Breaks in noisy lab/viva rooms | Minimal | ~200 ms | **Rejected** — fans & chatter cause false triggers |
| Server-side Silero VAD | High | High (streams silence continuously) | Network jitter + server CPU | Unnecessary bandwidth waste on campus Wi-Fi |
| **Client-side Silero VAD (`@ricky0123/vad-web`) + PTT toggle** | **High (neural speech classifier)** | **Zero during silence** | **350–450 ms hang time** | **Winner** |

* **Decision:** Run **Silero VAD in the browser** via `@ricky0123/vad-web` (downloads a ~2 MB ONNX model + ONNX Runtime Web WASM once, then runs locally on the client CPU with zero silent audio transmitted), paired with a **Push-to-Talk override toggle** in the UI for loud environment.
* **Audio Wire Format:** Capture and transmit **16 kHz, 16-bit mono PCM (wrapped in a 44-byte WAV header)** directly from the browser's `AudioWorklet` / VAD float32 buffer.
* *Why:* Sending `audio/webm` (Opus) from `MediaRecorder` forces the backend to shell out to `ffmpeg` to decode to 16 kHz WAV before ASR—wasting 80–150 ms per turn. A 3-second 16 kHz 16-bit mono clip is only ~96 KB, which transfers in <25 ms on Wi-Fi and feeds directly into every ASR engine without transcoding.



---

## 3. Real-Time Transport Layer

| Option | Setup Complexity | Campus Wi-Fi / Firewall Risk | Bidirectional Streaming | Verdict |
| --- | --- | --- | --- | --- |
| HTTP REST + Polling | Low | None | No (high overhead) | **Rejected** |
| WebRTC (`aiortc` / LiveKit) | High (ICE/STUN/TURN) | High (UDP blocked on many college LANs) | Yes (full-duplex RTP) | Overkill for turn-based S2ST |
| **FastAPI Native WebSockets** | **Low** | **Minimal (standard HTTP/HTTPS upgrade)** | **Yes (JSON + Binary frames)** | **Winner** |

* **Decision:** Single **FastAPI WebSocket server** with in-memory Room Management (max 2 peers per room: `User A` and `User B`).
* **Why:** Because TongueSync uses VAD-segmented turns rather than simultaneous overlapping audio streams, WebRTC's NAT traversal complexity introduces high demo-day failure risk for negligible speed gain. WebSockets support multiplexing JSON control/telemetry frames and raw binary audio chunks over one persistent TCP connection, and work identically over `localhost`, LAN IP, or a phone hotspot.

---

## 4. Speech-to-Text (ASR) Engine

| Engine | Hinglish / Code-Mix | Typical Latency (3s clip) | Cost / Free Allowance | Local/Cloud |
| --- | --- | --- | --- | --- |
| **Sarvam AI Saaras (`saaras:v3`/`v4`)** | **Best-in-class** (native `codemix` output mode) | ~250–400 ms | **₹100 free signup credits** (₹0.49/min = ~200 min free) | Cloud |
| **Groq `whisper-large-v3-turbo`** | Good (occasional script drift on Hindi) | **~150–300 ms** | **Free forever tier** (20 RPM, 2,000 RPD, 28.8k audio sec/day) | Cloud |
| **`faster-whisper` (`small`, INT8)** | Moderate | 1,200–3,000 ms (laptop CPU); ~250 ms (GPU) | ₹0 (open source) | Local |
| AI4Bharat IndicConformer (30M) | Weak on heavy Hinglish | ~200–400 ms (CPU) | ₹0 (open source) | Local |
| Bhashini ASR API | Good | Variable | Free, but requires manual DIBD approval with no fixed turnaround time | Cloud |

* **Decision:**
* **Primary (Live Demo):** **Sarvam AI Speech-to-Text** in **`codemix` mode**, which explicitly retains English words in Latin script inside native Indic scripts (e.g., *"मेरा phone number है 9840950950"*) and handles noisy Indian acoustics and proper nouns.
* **High-Speed Zero-Credit Alternative:** **Groq `whisper-large-v3-turbo**` (gives you 2,000 free requests/day with no credit card and lets you run a side-by-side WER & latency benchmark against Sarvam).
* **Offline Fallback:** **`faster-whisper` (`small`, `compute_type="int8"`)** via CTranslate2 for local CPU inference.


* **Why Bhashini is rejected for core runtime:** DIBD onboarding requires manual organization review with unpublished wait times—too risky for a 14-week academic schedule. Cite Bhashini in your literature survey, not as your critical-path dependency.

---

## 5. Machine Translation (MT) & The Code-Mixed Novelty Engine

Standard neural MT models fail predictably on spoken Indian conversations for two reasons:

1. **Intra-sentential code-mixing:** Models trained on clean monolingual corpora (like raw IndicTrans2) degrade when fed mixed scripts (*"kal meeting 5 baje hai, right?"*) or romanized Hinglish idioms (*"chalega"* mistranslated literally as *"will walk"* instead of *"works/fine"*).
2. **Zero conversational context:** Isolated sentence translation mangles pronouns and replies (*"haan, wahan milte hain"* needs the previous turn's location/context).

| Engine | Code-Mix Handling | Conversational Context | Typical Latency | Cost / Free Tier |
| --- | --- | --- | --- | --- |
| **AI4Bharat IndicTrans2 (`dist-200M` / `dist-320M`)** | Weak on raw Hinglish; **strong on clean Indic ↔ Indic** | None | ~150 ms (GPU) / 800–1500 ms (CPU) | ₹0 (Local HF) |
| **Sarvam Translate (`colloquial` mode)** | **Strong** (supports colloquial Indian phrasing) | Single-turn | ~180–300 ms | ₹2.00 / 1K chars (uses same ₹100 free credits) |
| **Groq LLM (`qwen3.8-27b` / `gpt-oss-20b`)** | **Excellent** (resolves idioms, slang & entities) | **Yes (2-turn sliding window)** | ~150–250 ms | Free tier (30 RPM, 1,000 RPD, 8K TPM) |
| Google Translate API | Decent, often overly literal | None | ~200 ms | Requires billing account / unofficial scrapers break |

* **Decision: Build a "Code-Mix Aware Hybrid Translation Router" (Your Primary Technical Novelty).**
Instead of blindly calling one MT API, implement a deterministic 2-millisecond pre-processing gate in Python before translation:
1. **Script-Ratio & Code-Mix Classifier (Local Python):** Computes the ratio of Devanagari/Tamil Unicode tokens vs. Latin tokens (ignoring numbers/punctuation) and checks against a small Hinglish stopword/idiom list.
2. **Routing Logic:**
* **If Code-Mixed Detected (e.g., `0.10 < latin_ratio < 0.90`) OR Context-Dependent Short Turn (<5 words):** Route to **Groq Fast LLM (`qwen3.8-27b` or `gpt-oss-20b`)** with a strict system prompt (*"Output ONLY the spoken conversational translation in target script; preserve technical nouns/entities; resolve idioms naturally"*) plus the **last 2 conversation turns** as read-only context.
* **If Pure Monolingual Indic ↔ Indic (e.g., clean Hindi ↔ Tamil):** Route to **Sarvam Translate (`colloquial` mode)** in Cloud Profile, or **AI4Bharat IndicTrans2 (`indictrans2-indic-indic-dist-320M`)** in Local/Academic Benchmark Profile.




* **Why this wins the viva:** It gives you a genuine, measurable algorithmic contribution beyond API glue. You can run an ablation table in your report: **Raw IndicTrans2 vs. Sarvam Colloquial vs. Code-Mix Aware Contextual Router** on Hinglish test sentences.

---

## 6. Text-to-Speech (TTS) & Audio Streaming

| Engine | Voice Quality (Indic) | Time-to-First-Byte (TTFB) | Reliability Risk | Cost |
| --- | --- | --- | --- | --- |
| **Sarvam `bulbul:v4-flash` (WebSocket)** | **Natural Indian accents & Hinglish pronunciation** | **<250 ms** | Low (official API) | ₹2.00 / 1K chars (₹100 free credits = 50,000 chars!) |
| **`edge-tts` (`>=7.3.1`)** | Very good (`hi-IN-SwaraNeural`, `ta-IN-PallaviNeural`) | ~350–550 ms | **Medium-High** (unofficial; Microsoft broke `<=7.2.8` with Sec-MS-GEC v2 403 errors in Oct 2026) | ₹0 |
| **Piper TTS (ONNX Local)** | Functional / slightly synthetic (`hi_IN-pratham-medium`) | ~150–250 ms on CPU (RTF ~0.15–0.20) | **Zero** (100% offline) | ₹0 |
| Coqui XTTS-v2 | Good | >1,500 ms without GPU | Archived / no commits since Nov 2024 | ₹0 |

* **Decision:**
* **Primary (Live Demo):** **Sarvam `bulbul:v4-flash` via WebSocket streaming** (`wss://api.sarvam.ai/text-to-speech/ws`). Sub-250ms first-byte streaming plus native Indian prosody makes conversations feel noticeably snappier, and ₹100 of free credits easily covers ~50,000 characters (~700+ demo turns).
* **Zero-Credit Cloud Alternative:** **`edge-tts >= 7.3.1`** (explicitly pin `>=7.3.1` to include the Sec-MS-GEC v2 fix and ensure NTP clock sync on your demo laptop).
* **Offline Fallback:** **Piper TTS (ONNX)** (`hi_IN-pratham-medium` + `en_US-lessac-medium`).


* **Streaming Playback Optimization:** Pipe TTS audio chunks straight through your FastAPI WebSocket to User B as they arrive rather than waiting for full file synthesis, and play them sequentially via a Web Audio API playback queue. This shaves **300–500 ms** off perceived wait time on longer sentences.

---

## 7. Latency Budget & Telemetry Specification

**Processing Latency** is explicitly separate from **Perceived Turn-Gap Latency**:

$$\text{Processing Latency} = T_{\text{first\_audio\_played}} - T_{\text{vad\_end}}$$

$$\text{Perceived Turn-Gap} = T_{\text{first\_audio\_played}} - T_{\text{user\_stopped\_speaking}} = \text{VAD Hang Time} + \text{Processing Latency}$$

| Pipeline Stage | Cloud Profile Target | Local Offline Profile Target | Instrumented Via |
| --- | --- | --- | --- |
| VAD Speech-End Hang Time | 350–450 ms | 350–450 ms | Client `performance.now()` |
| Audio Upload (16 kHz WAV) | 20–40 ms | 5–15 ms (localhost/LAN) | WS timestamp delta |
| ASR (`Saaras` / `Groq` / `faster-whisper`) | 220–350 ms | 1,200–2,200 ms (CPU) | Server `time.perf_counter()` |
| Code-Mix Gate + MT (`Router`) | 180–280 ms | 600–1,200 ms (CPU) | Server `time.perf_counter()` |
| TTS TTFB (`Bulbul v4` / `Piper`) | 200–280 ms | 180–250 ms | Server `time.perf_counter()` |
| Audio Delivery + Decode | 30–50 ms | 15–30 ms | Client `AudioContext` |
| **Total Processing Latency** | **~650 – 1,000 ms** | **~2.0 – 3.7 s** | Live Dashboard + SQLite |
| **Total Perceived Turn-Gap** | **~1.05 – 1.45 s** | **~2.4 – 4.1 s** | Compared vs. Google Translate (3.5–5s+) |

---

## 8. Final Frozen Architecture & Tech Stack

### Complete System Stack

| Layer | Frozen Decision |
| --- | --- |
| **Frontend** | **React 18 + Vite + TypeScript + Tailwind CSS** (Single-Page App, zero SSR overhead) |
| **Client Audio / VAD** | `@ricky0123/vad-web` (Silero VAD ONNX) + Web Audio API playback queue + PTT override |
| **Charts / Live Metrics** | Recharts (stacked horizontal latency bar per turn + rolling P50/P95 cards) |
| **Backend** | **Python 3.11 + FastAPI + Uvicorn + Pydantic v2** |
| **Transport** | Native WebSockets (`/ws/{room_id}/{user_id}`) multiplexing JSON metadata + binary PCM/MP3 frames |
| **ASR Adapters** | `SarvamASRAdapter` (primary, `codemix`) · `GroqWhisperAdapter` (benchmark) · `FasterWhisperAdapter` (offline) |
| **MT Adapters** | `CodeMixRouter` → `GroqLLMMTAdapter` (Hinglish + 2-turn context) / `SarvamTranslateAdapter` (monolingual) / `IndicTrans2Adapter` (local benchmark) |
| **TTS Adapters** | `SarvamBulbulWSAdapter` (primary streaming) · `EdgeTTSAdapter` (`>=7.3.1`) · `PiperLocalAdapter` (offline) |
| **Persistence** | **SQLite (`aiosqlite`)** — stores session turns, transcripts, and stage-wise latency ms for CSV export to your report |
| **Evaluation Suite** | Standalone Python script using `jiwer` (WER), `sacrebleu` (chrF++ & BLEU), and latency percentile aggregation |

### WebSocket Protocol Contract

Every turn follows a strict 5-event lifecycle over `/ws/{room_id}/{user_id}`:

1. **Client A → Server (JSON):** `{"type": "turn_start", "turn_id": "uuid", "src_lang": "hi-IN", "tgt_lang": "en-IN", "vad_hang_ms": 400, "profile": "cloud_sarvam"}`
2. **Client A → Server (Binary):** Raw 16 kHz mono WAV bytes of the utterance.
3. **Server → Both Clients (JSON):** `{"type": "transcript", "turn_id": "uuid", "speaker": "A", "raw_text": "कल meeting 5 बजे है, right?", "is_codemixed": true, "translated_text": "The meeting is at 5 o'clock tomorrow, right?", "mt_route": "llm_contextual"}`
4. **Server → Client B (Binary stream):** Chunked TTS audio frames (`tts_chunk` header or binary WebSocket frames) followed by `{"type": "tts_end", "turn_id": "uuid"}`.
5. **Server → Both Clients (JSON):** `{"type": "metrics", "turn_id": "uuid", "asr_ms": 284, "codemix_gate_ms": 2, "mt_ms": 215, "tts_ttfb_ms": 230, "total_processing_ms": 731}`.

### Repository Structure

```text
tonguesync/
├── backend/
│   ├── main.py                 # FastAPI app, WebSocket router, room manager
│   ├── config.py               # Env keys & runtime profile definitions
│   ├── pipeline/
│   │   ├── orchestrator.py     # Async turn execution + perf_counter telemetry
│   │   ├── codemix_gate.py     # Unicode script-ratio detector & 2-turn memory buffer
│   │   ├── asr/                # base.py, sarvam.py, groq_whisper.py, faster_whisper.py
│   │   ├── mt/                 # base.py, groq_llm.py, sarvam.py, indictrans2.py
│   │   └── tts/                # base.py, sarvam_ws.py, edge_tts.py, piper_local.py
│   ├── storage/
│   │   └── metrics_db.py       # SQLite logger + /api/export-csv endpoint
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── hooks/
│   │   │   ├── useVadRecorder.ts   # Silero VAD + 16kHz WAV encoder + PTT fallback
│   │   │   ├── useRoomSocket.ts    # WebSocket state machine
│   │   │   └── useAudioQueue.ts    # Gapless Web Audio API chunk playback
│   │   ├── components/
│   │   │   ├── ConversationPane.tsx # Dual-language chat bubbles + script badges
│   │   │   ├── LatencyDashboard.tsx # Stacked stage-breakdown chart + P50/P95
│   │   │   └── ControlBar.tsx       # Language selector, Profile toggle, VAD slider
│   │   └── App.tsx
└── evaluation/
    ├── test_dataset.json       # 60 utterances (20 Hindi, 20 Hinglish, 20 En/Ta)
    ├── run_benchmark.py        # Computes WER (jiwer), chrF++ (sacrebleu), P50/P95 ms
    └── results/                # Auto-generated CSVs & matplotlib plots for report

```

---

## 9. Evaluation Methodology

1. **Test Set Construction (`evaluation/test_dataset.json`):** Record 60 short conversational turns (3–6 seconds each) split evenly across:
* 20 Clean Monolingual Hindi → English (and reverse)
* 20 Code-Mixed Hinglish → English (with numbers, entities, and idioms like *"kal 5 baje ka slot book kar do"*, *"ye code deploy karna padega"*)
* 20 Hindi ↔ Tamil conversational pairs (sourced/adapted from AI4Bharat's **IN22-Conv**)


2. **Metrics to Report:**
* **ASR Accuracy:** Word Error Rate (**WER**) via `jiwer` comparing Sarvam Saaras vs. Groq Whisper Turbo vs. Local `faster-whisper`.
* **Translation Quality:** **chrF++** (not just BLEU — explicitly note in your viva that chrF++ operates on character n-grams, making it far more accurate for morphologically rich Indian languages like Hindi and Tamil) via `sacrebleu`.
* **Code-Mix Ablation:** Show chrF++ & human accuracy on the 20 Hinglish sentences with **Router OFF (Raw NMT)** vs. **Router ON (Code-Mix Contextual LLM)**.
* **Latency & Baseline Comparison:** P50/P95 stage breakdown table + side-by-side turn-gap comparison against **Google Translate Conversation Mode** measured over 10 identical turns.
* **Subjective Quality:** Mean Opinion Score (MOS, 1–5 scale for naturalness & intelligibility) rated by 5–10 peers.
