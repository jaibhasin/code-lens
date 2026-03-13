# CodeLens — Cheating Detection Strategy

> Anti-cheating threat landscape & detection roadmap for proctored online coding assessments.
> Assumes: **camera is on** and **tab switching is already blocked**.

---

## Table of Contents

- [Threat Landscape Overview](#threat-landscape-overview)
- [Threat 1: Invisible AI Overlay Apps](#threat-1-invisible-ai-overlay-apps)
- [Threat 2: Second Device Usage](#threat-2-second-device-usage)
- [Threat 3: Remote Desktop / Screen Sharing](#threat-3-remote-desktop--screen-sharing)
- [Threat 4: Person Physically in the Room](#threat-4-person-physically-in-the-room)
- [Other Known Cheating Methods](#other-known-cheating-methods)
- [Implementation Roadmap](#implementation-roadmap)
- [Architecture Overview](#architecture-overview)
- [References & Resources](#references--resources)

---

## Threat Landscape Overview

| Cheating Method                     | Detection Difficulty | Digital Footprint |
| ----------------------------------- | -------------------- | ----------------- |
| Invisible AI overlays               | Very Hard            | Minimal           |
| Hardened VMs (CloakBox)             | Hard                 | Low               |
| Bluetooth earpiece + remote helper  | Hard                 | None              |
| Second device (phone/tablet)        | Medium               | None              |
| Remote desktop tools                | Medium               | Moderate          |
| Deepfake impersonation              | Medium–Hard          | Low               |
| Person in the room                  | Medium               | Low (audio only)  |
| Copy-paste bypass                   | Easy–Medium          | High              |
| Question leaks / pre-knowledge      | Hard                 | None during test  |

### Top 4 Prioritized Threats

These are the highest-impact threats we're focusing on first:

1. **Invisible AI Overlay Apps** — fastest growing, hardest to detect
2. **Second Device Usage** — extremely common, subtle
3. **Remote Desktop / Screen Sharing** — gives full control to an accomplice
4. **Person Physically in the Room** — low-tech but effective

---

## Threat 1: Invisible AI Overlay Apps

### What It Is

Commercial tools like **Interview Coder**, **StealthCoder**, **Shadecoder**, **Cluely**, and **NotchGPT** run as native desktop apps that are **completely invisible to screen capture and screen sharing**. They use OS-level APIs to:

- Exclude themselves from the screen capture layer
- Show no dock icon, taskbar entry, or visible window
- OCR the coding problem from the screen
- Return AI-generated solutions via a transparent overlay only the candidate can see
- Avoid clipboard spikes (no paste events triggered)

### Why It's Dangerous

- Zero digital footprint in screen recordings
- No process visible in standard task managers
- Designed specifically to bypass proctoring software
- Growing commercial market with multiple competing products

### Detection Strategies

#### A. Keystroke Dynamics Analysis ⭐ (Recommended First)

```
Signal: How the code is typed, not what is typed.
```

- Track typing rhythm, pause patterns, correction habits in the Monaco editor
- AI-pasted code shows unnatural patterns:
  - Large blocks appear instantly with no iterative development
  - No backspacing, debugging, or trial-and-error
  - Suspiciously low typo rate
  - Pause → burst patterns (reading overlay → typing answer)
- **Libraries:** Built-in Monaco editor events (already captured in our timeline)
- **Accuracy:** Keystroke dynamics can detect unnatural patterns with 95%+ accuracy when combined with other signals

#### B. Code Development Pattern Analysis ⭐ (Recommended First)

```
Signal: Authentic coding is messy. AI-assisted coding is suspiciously clean.
```

- Replay the entire coding session — authentic coding shows:
  - Incremental building and testing
  - Edit → run → debug cycles
  - Variable renames and refactoring mid-stream
  - Commented-out experiments
- AI-assisted coding shows:
  - Complete functions appearing in one go
  - Minimal or no corrections
  - Unnaturally structured code on first attempt
- **Libraries:** Build on existing timeline recording system

#### C. Process / Window Enumeration

```
Signal: Overlay windows registered at OS level even if invisible to screen capture.
```

- **macOS:** `CGWindowListCopyWindowInfo` API enumerates all windows including overlay-level ones
- **Windows:** `EnumWindows` API finds transparent/topmost windows
- Flag any unknown process with overlay-level windows
- Maintain a blocklist of known cheating tool process names and bundle IDs
- **Libraries:** `find-process` (npm), Electron `desktopCapturer`

#### D. Screenshot Comparison

```
Signal: What the candidate sees ≠ what the proctoring stream captures.
```

- Take periodic OS-level screenshots and compare against the proctoring stream
- Pixel-level discrepancies indicate hidden overlays
- HackerRank does this with screenshots every 5 seconds during suspicious activity
- **Libraries:** Electron screenshot APIs, canvas-based comparison

#### E. Network Traffic Monitoring

```
Signal: API calls to AI providers during the exam.
```

- Detect outbound requests to `api.openai.com`, `api.anthropic.com`, etc.
- Can be bypassed with VPNs — use as supplementary signal only
- **Libraries:** `netstat`/`lsof` via shell, or a lightweight network monitor agent

---

## Threat 2: Second Device Usage

### What It Is

Candidate places a phone, tablet, or second laptop **outside the webcam's field of view** — typically:

- Below the monitor
- Behind the laptop screen
- Just outside the webcam frame to one side

Used to Google answers, paste problems into ChatGPT, or communicate with a remote helper via text.

### Why It's Dangerous

- Zero digital footprint on the exam machine
- Extremely easy to set up
- Hard to catch with traditional proctoring

### Detection Strategies

#### A. Head Pose Estimation ⭐ (Recommended First)

```
Signal: Candidate's head repeatedly tilts down or sideways to look at a hidden device.
```

- **MediaPipe Face Mesh** provides 468 facial landmarks in real-time
- Derive pitch (up/down), yaw (left/right), roll (tilt) angles
- Flag when:
  - Cumulative off-screen time exceeds threshold
  - Head tilts beyond 30° for sustained periods
  - Repeated pattern: look away → pause → rapid typing
- **Libraries:** `@mediapipe/face_mesh` (npm), TensorFlow.js
- **Runs:** Client-side in browser, no backend needed

#### B. Gaze Tracking ⭐ (Recommended)

```
Signal: Eyes consistently looking away from the code editor area.
```

- **WebGazer.js** — browser-based eye tracking using the webcam
- Estimates where on the screen the user is looking
- Detects when gaze leaves the screen area consistently (looking at a second device)
- Practical accuracy: ~4–10 degrees angular error — sufficient for detecting repeated downward/sideways gaze
- **Libraries:** WebGazer.js (pure JS, MIT license)
- **Caveat:** Users can move only their eyes without moving their head — combine with head pose for better coverage

#### C. Phone Detection via Object Detection

```
Signal: Phone visible in the webcam frame.
```

- **YOLOv8** pre-trained on COCO dataset already detects `cell phone` as a class
- Run on periodic webcam snapshots (every few seconds)
- Catches phones visible in the frame but not those hidden below the monitor
- **Libraries:** Ultralytics YOLOv8 (`pip install ultralytics`)
- **Runs:** Server-side on uploaded webcam frames

#### D. Behavioral Correlation

```
Signal: "Look away → pause → type correct code" pattern repeats.
```

- Correlate gaze/head data with keystroke data
- Pattern: eyes leave screen → typing stops → eyes return → burst of correct code
- Multiple occurrences = strong signal
- **Libraries:** Custom logic combining signals from A + B + keystroke data

---

## Threat 3: Remote Desktop / Screen Sharing

### What It Is

An accomplice connects via **TeamViewer, AnyDesk, Chrome Remote Desktop, or custom RDP tools** to either:

- **Watch** the candidate's screen and provide guidance via text/voice
- **Take full control** of the machine and solve the problem while the candidate pretends to type

### Why It's Dangerous

- Accomplice can be a professional problem solver
- Full control mode is indistinguishable from candidate typing (on basic proctoring)
- Custom/self-hosted tools evade blocklists
- New tools constantly emerge

### Detection Strategies

#### A. Process Scanning ⭐ (Recommended First)

```
Signal: Known remote access tools running on the machine.
```

| Tool                  | Process Names                               | Port  |
| --------------------- | ------------------------------------------- | ----- |
| TeamViewer            | `TeamViewer.exe`, `TeamViewer_Service.exe`  | 5938  |
| AnyDesk               | `AnyDesk.exe`                               | 7070  |
| Windows RDP           | `mstsc.exe`, `rdpclip.exe`                  | 3389  |
| Chrome Remote Desktop | `remoting_host.exe`                         | —     |
| VNC                   | various                                     | 5900+ |
| Parsec                | `parsecd.exe`                               | —     |
| Splashtop             | `SplashtopStreamer.exe`                      | —     |

- Scan before exam starts and periodically during
- Block exam start if flagged processes are found
- **Libraries:** `find-process` (npm), or `ps aux` / `tasklist` via shell

#### B. Network Port Monitoring ⭐ (Recommended First)

```
Signal: Active connections on known remote access ports.
```

- Check for connections on ports listed above
- Baseline network connections at exam start, flag new sustained connections
- **Libraries:** `netstat`/`lsof` via `child_process`, `systeminformation` (npm)

#### C. Bandwidth Anomaly Detection

```
Signal: Screen sharing produces sustained ~1–5 Mbps outbound traffic.
```

- Monitor for sustained high-bandwidth outbound streams during the exam
- Catches custom/unknown tools that don't use standard ports
- **Libraries:** Network monitoring via OS tools, `systeminformation` (npm)

#### D. Mouse / Input Anomaly Detection

```
Signal: Remote control produces subtly different input patterns.
```

- Remote-controlled mouse movements are perfectly smooth with no inertia or micro-corrections
- Click timing patterns differ from natural human input
- Unusual DPI or acceleration profiles
- **Libraries:** Custom event listeners on Monaco editor + canvas

#### E. Virtual Display Detection

```
Signal: Virtual display adapters indicate remote access setup.
```

- Detect virtual displays or unexpected display configurations
- **macOS:** `system_profiler SPDisplaysDataType`
- **Windows:** `EnumDisplayDevices` API
- Virtual display adapters have identifiable names
- **Libraries:** `systeminformation` (npm)

---

## Threat 4: Person Physically in the Room

### What It Is

A helper sits **out of camera view** and assists by:

- Whispering answers
- Passing handwritten notes
- Speaking solutions aloud (candidate has only one earphone in)
- Typing on a shared keyboard when candidate moves aside

### Why It's Dangerous

- No digital footprint whatsoever
- Very hard to detect with standard screen monitoring
- Low-tech and requires no setup

### Detection Strategies

#### A. Voice Activity Detection (VAD) ⭐ (Recommended First)

```
Signal: Speech detected when the candidate should be silent.
```

- **Silero VAD** — enterprise-grade, processes 30ms audio chunks in <1ms on CPU
- Browser implementation: `@ricky0123/vad` (npm) — runs via ONNX Runtime in browser
- Detects any speech (including whispers) during the exam
- Flag audio segments with detected voice activity for review
- **Libraries:** `@ricky0123/vad` (browser), `avr-vad` (Node.js)
- **Runs:** Client-side, real-time

#### B. Multi-Face Detection ⭐ (Recommended First)

```
Signal: More than one face appears in the webcam frame.
```

- Use MediaPipe Face Detection or YOLOv8 on webcam frames
- Flag when >1 face is detected, even briefly
- Can piggyback on the existing Face Mesh pipeline (Threat 2)
- **Libraries:** `@mediapipe/face_detection` (npm), TensorFlow.js

#### C. Speaker Diarization (Post-Session Analysis)

```
Signal: Audio contains voices from multiple speakers.
```

- **pyannote.audio** — state-of-the-art open-source speaker diarization:
  - Voice activity detection
  - Speaker segmentation
  - Overlapped speech detection (2+ people speaking simultaneously)
  - Speaker embedding (voice fingerprints)
- Workflow: Enroll candidate's voice at session start → flag non-matching voices
- Best for post-session review rather than real-time
- **Libraries:** `pyannote.audio` (Python, pip install)

#### D. Audio Baseline Comparison

```
Signal: Room sounds change significantly during the exam.
```

- Record ambient noise baseline at session start
- Flag significant deviations: new sounds, voices, rustling papers
- Use Web Audio API for spectral analysis
- **Libraries:** Web Audio API (browser-native)

#### E. Behavioral Correlation

```
Signal: Candidate appears to listen, then suddenly types correct code.
```

- Head tilted as if listening
- Typing pauses that correlate with detected audio events
- Candidate's lips moving (repeating whispered instructions)
- Sudden bursts of correct code after periods of apparent inactivity
- **Libraries:** Combine Face Mesh data + VAD data + keystroke data

---

## Other Known Cheating Methods

These are lower priority but worth noting:

| Method                          | Description                                                                 | Mitigation                                    |
| ------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| **Virtual Machines**            | CloakBox/VM-Undetected hide VM artifacts from proctoring                    | VM artifact detection, hardware fingerprinting |
| **Proxy Test-Taking**           | Someone else takes the test with shared credentials                         | Live identity verification, deepfake detection |
| **Deepfake Video Feeds**        | Real-time face swap via virtual camera                                      | Liveness detection, challenge-response         |
| **Question Leaks**              | Leaked question banks shared on forums/Telegram                             | Dynamic question pools, time-limited questions |
| **Code Plagiarism**             | Copying from GitHub repos with variable renaming                            | AST-based similarity detection, AI analysis    |
| **Physical Notes**              | Cheat sheets behind webcam or on monitor bezel                              | Room scan requirement, gaze tracking           |
| **Bluetooth Earpiece**          | Micro earpiece with remote helper whispering answers                        | Audio analysis, behavioral correlation         |
| **Browser Dev Tools**           | Using console/network tab without leaving the page                          | Disable dev tools, monitor keyboard shortcuts  |
| **Virtual Desktops**            | OS-level desktop switching doesn't trigger browser blur events              | Monitor OS-level focus events, not just browser |
| **Auto-Typer Tools**            | Simulate natural keystrokes to type pre-written solutions                   | Keystroke dynamics ML model                    |

---

## Implementation Roadmap

### Phase 1 — Quick Wins (Low Effort, High Impact)

| Feature                          | Target Threat           | Tech Stack                            | Effort |
| -------------------------------- | ----------------------- | ------------------------------------- | ------ |
| Keystroke dynamics scoring       | AI Overlays             | Monaco editor events (existing)       | Medium |
| Code playback pattern analysis   | AI Overlays             | Timeline recording (existing)         | Medium |
| MediaPipe Face Mesh              | Second Device + Helper  | `@mediapipe/face_mesh`, TensorFlow.js | Low    |
| Silero VAD in browser            | Room Helper             | `@ricky0123/vad`                      | Low    |

### Phase 2 — Strengthen Detection

| Feature                          | Target Threat           | Tech Stack                            | Effort |
| -------------------------------- | ----------------------- | ------------------------------------- | ------ |
| WebGazer.js gaze tracking        | Second Device           | WebGazer.js                           | Low    |
| Pre-exam process scan            | Remote Desktop          | `find-process`, shell commands        | Medium |
| Network port check               | Remote Desktop          | `netstat`/`lsof`, `systeminformation` | Medium |
| Multi-face detection             | Room Helper             | MediaPipe (piggyback on Phase 1)      | Low    |

### Phase 3 — Advanced Detection

| Feature                          | Target Threat           | Tech Stack                            | Effort |
| -------------------------------- | ----------------------- | ------------------------------------- | ------ |
| Screenshot comparison            | AI Overlays             | Electron, canvas diff                 | High   |
| Speaker diarization              | Room Helper             | pyannote.audio (server-side)          | Medium |
| Bandwidth anomaly detection      | Remote Desktop          | Network monitoring                    | Medium |
| Phone detection (YOLO)           | Second Device           | YOLOv8 (server-side)                  | Medium |
| Mouse input anomaly detection    | Remote Desktop          | Custom event analysis                 | Medium |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENT (Browser)                      │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Monaco Editor │  │  Webcam Feed │  │  Microphone   │  │
│  │              │  │              │  │               │  │
│  │ • Keystroke  │  │ • Face Mesh  │  │ • Silero VAD  │  │
│  │   dynamics   │  │ • Head pose  │  │ • Audio       │  │
│  │ • Code       │  │ • Gaze track │  │   baseline    │  │
│  │   playback   │  │ • Multi-face │  │ • Speech      │  │
│  │ • Paste      │  │ • Phone      │  │   detection   │  │
│  │   detection  │  │   detection  │  │               │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                   │          │
│         └────────────┬────┴───────────────────┘          │
│                      │                                   │
│              ┌───────▼────────┐                          │
│              │  Signal Fusion │                          │
│              │  (Integrity    │                          │
│              │   Score Engine)│                          │
│              └───────┬────────┘                          │
│                      │                                   │
└──────────────────────┼───────────────────────────────────┘
                       │  Events + Snapshots
                       ▼
┌──────────────────────────────────────────────────────────┐
│                   SERVER (Next.js API)                    │
│                                                          │
│  ┌───────────────┐  ┌────────────────┐  ┌─────────────┐ │
│  │ Session Store │  │ AI Plagiarism  │  │  pyannote   │ │
│  │ • Events log  │  │ Detection      │  │  Speaker    │ │
│  │ • Integrity   │  │ • Code pattern │  │  Diarization│ │
│  │   score       │  │   analysis     │  │  (post-     │ │
│  │ • Alerts      │  │ • LLM output   │  │   session)  │ │
│  │               │  │   fingerprint  │  │             │ │
│  └───────────────┘  └────────────────┘  └─────────────┘ │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Recruiter Dashboard                    │  │
│  │  • Integrity score per candidate                    │  │
│  │  • Flagged sessions with evidence                   │  │
│  │  • Code playback with annotations                   │  │
│  │  • Audio/video highlights                           │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## Integrity Scoring System

All signals feed into a **weighted integrity score** (0–100) rather than binary pass/fail.

```
Integrity Score = 100 - Σ(signal_weight × signal_severity)
```

| Signal Category       | Weight | Example Triggers                                    |
| --------------------- | ------ | --------------------------------------------------- |
| Keystroke anomaly     | 25%    | Code appears in complete blocks, no corrections     |
| Gaze / head pose      | 20%    | Repeated off-screen gaze, sustained head tilt       |
| Audio anomaly         | 20%    | Voice detected, multiple speakers, whispers         |
| Process / network     | 15%    | Remote access tool detected, suspicious connections |
| Code pattern          | 10%    | AI-like code structure, no iterative development    |
| Multi-face            | 10%    | Additional face detected in frame                   |

**Thresholds:**

- **80–100:** No concerns — session looks clean
- **60–79:** Review recommended — some suspicious signals
- **Below 60:** Flagged — strong indicators of potential cheating, human review required

---

## References & Resources

### Libraries & Tools

| Library                | Purpose                    | Platform    | License |
| ---------------------- | -------------------------- | ----------- | ------- |
| `@mediapipe/face_mesh` | Face landmarks + head pose | Browser     | Apache  |
| `WebGazer.js`          | Browser-based gaze tracking| Browser     | GPL     |
| `@ricky0123/vad`       | Voice activity detection   | Browser     | MIT     |
| `find-process`         | Process enumeration        | Node.js     | MIT     |
| `systeminformation`    | System info + displays     | Node.js     | MIT     |
| `pyannote.audio`       | Speaker diarization        | Python      | MIT     |
| YOLOv8 (Ultralytics)  | Object/phone detection     | Python      | AGPL    |
| L2CS-Net               | Gaze estimation            | Python      | MIT     |
| SixDRepNet             | Head pose estimation       | Python      | MIT     |
| Silero VAD             | Voice activity detection   | Python      | MIT     |

### Research & Industry Sources

- [HackerRank — Fighting Invisible Threats](https://www.hackerrank.com/blog/putting-integrity-to-the-test-in-fighting-invisible-threats/)
- [HackerRank — AI Plagiarism Detection](https://support.hackerrank.com/articles/8000786908-ai-plagiarism-detection)
- [HackerRank — Detecting Suspicious Typing Patterns](https://www.hackerrank.com/writing/ai-detect-suspicious-typing-patterns-real-time)
- [CoderPad — Cheating Prevention & Detection](https://coderpad.io/resources/docs/screen/tests/cheating-prevention-detection/)
- [Proctorio — How Proctorio Blocks Cluely](https://proctorio.com/about/blog/how-proctorio-blocks-cluely)
- [Talview — 6 Ways Students Cheat in Proctored Exams](https://blog.talview.com/en/6-ways-students-cheat-in-online-proctored-exams)
- [Research Paper — Cheating Detection by Head Pose & Gaze Estimation](https://www.researchgate.net/publication/351077616)
- [Research Paper — CNN-BiLSTM Multimodal Cheating Detection (87.5% accuracy)](https://journal.esrgroups.org/jes/article/download/7480/5132/13709)

---

*Last updated: March 2026*
