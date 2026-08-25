# Visionary Agent: The Embodied AI Auditor

**Built for the DevPost Gemini 3 Hackathon (Collaborative Partner Track)**

Visionary Agent is an intelligent, embodied virtual auditor designed to guide users through complex compliance and organizational rules. Built using the **Google Agent Development Kit (ADK)** and the **Gemini 3 API**, Visionary Agent transcends standard text chatbots by providing a fully animated 3D avatar that speaks naturally, remembers your unique workflow preferences, and actively grounds its answers in real enterprise documents.

---

## Key Features

- **Embodied AI Interaction:** A Three.js and Angular frontend brings the agent to life with procedural breathing, eye saccades, and real-time Web Audio API lip-syncing driven directly by the agent's voice stream.
- **Persistent Agentic Memory:** Utilizes the ADK's native tool-calling to actively listen to user feedback and save preferences to Firestore, isolating memory per user session for a highly personalized "Collaborative Partner" experience.
- **Enterprise RAG Pipeline:** Ingests compliance PDFs, generates embeddings using `gemini-embedding-001`, and queries a Firestore Vector Database to ensure the agent's answers are strictly grounded in organizational policy.
- **Real-Time Audio Streaming:** A FastAPI server streams Google Cloud Text-to-Speech audio in base64 over WebSockets, ensuring seamless, low-latency conversations.
- **Resilient Infrastructure:** Features exponential backoff logic for API rate limits and asynchronous TTS generation to keep the conversation flowing naturally.

---

## System Architecture

Visionary Agent operates on a decoupled, serverless architecture optimized for speed and scalability:

| Layer          | Technology                   | Function                                                                                                                                                            |
| :------------- | :--------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Frontend**   | Angular, Three.js, RxJS      | Renders the 3D `facecap.glb` model, decodes base64 audio, and calculates real-time volume to drive ARKit blendshapes (`jawOpen`). Deployed on **Firebase Hosting**. |
| **Backend**    | FastAPI, WebSockets          | Manages the WebSocket connection, routes messages, and handles TTS synthesis asynchronously. Deployed on **Google Cloud Run**.                                      |
| **Agent Core** | Google Agent Development Kit | The brain. Uses `gemini-3.5-flash` to orchestrate tool calling, memory management, and RAG lookups via the `InMemoryRunner`.                                        |
| **Database**   | Google Cloud Firestore       | Stores document vector embeddings and dynamic user session memory (`user_preferences`).                                                                             |

---

## How We Built It

We knew we wanted to build a "Collaborative Partner" that felt like a real team member. Instead of relying on a standard text interface, we engineered an end-to-end loop:

1.  **The Brain:** We configured the Google ADK to enforce strict auditing personas. If a rule isn't in the Firestore database, the agent explicitly refuses to hallucinate an answer.
2.  **The Memory:** We gave the agent native tools to read/write to a `user_preferences` database. By passing a persistent, anonymous `guest_id` from the browser to the server, the agent builds a unique profile of how each user likes to work (e.g., "bullet points only," "skip the intro").
3.  **The Face:** We heavily optimized a rigged 3D model using `KTX2Loader` and `MeshoptDecoder`. By mapping Web Audio API frequency data to the avatar's jaw blendshapes, we achieved natural lip-sync without relying on heavy third-party animation libraries.

---

## Local Setup & Installation

To run Visionary Agent locally, you need a Google Cloud Project with the Gemini API, Firestore (Native Mode), and Text-to-Speech APIs enabled.

### 1. Backend (FastAPI + ADK)

Navigate to the `/backend` directory and configure your environment:

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Frontend (Angular)

Navigate to the `/frontend` directory:

```bash
cd frontend
npm install
npm start
```

---

## 🎙️ Microphone & Privacy Settings

Visionary Agent utilizes the browser's native Web Audio and MediaDevices APIs to enable seamless, voice-driven interaction. To ensure the avatar can hear you and play audio responses, you must grant the necessary privacy permissions.

### 1. Browser Permissions (Google Chrome)
Depending on your browser's security profile, clicking "Allow" on the initial URL pop-up may not be enough. To explicitly allow microphone access:
1. Click the **three vertical dots** in the top right of Chrome and select **Settings**.
2. Navigate to **Privacy and security** on the left sidebar, then click **Site settings**.
3. Under the "Permissions" section, click on **Microphone**.
4. Ensure the correct microphone device is selected in the dropdown at the top.
5. Scroll down to check if the application URL (or `http://localhost:4200`) is listed under "Allowed to use your microphone". If it is blocked, click the site and change the Microphone permission to **Allow**. 

### 2. Operating System Security
If the browser has permission but the agent still cannot hear you, your operating system may be blocking microphone access globally.
* **macOS:** Go to `System Settings > Privacy & Security > Microphone`. Find your browser in the list and ensure the toggle is turned **ON**.
* **Windows:** Go to `Settings > Privacy & security > Microphone`. Ensure both "Microphone access" and "Let desktop apps access your microphone" are turned **ON**.

### 3. Audio Playback (Autoplay Policy)
Modern browsers enforce strict autoplay policies to prevent spam. You will not hear the 3D avatar speak until you interact with the page at least once (e.g., clicking the chat input box or hitting the "Ask" button). This initial user gesture unlocks the `AudioContext` so the agent can synthesize speech.

### ⚠️ Important Note for Deployment
If you are hosting the frontend on a custom server instead of Firebase Hosting, the application **must** be served over `HTTPS`. Browsers will automatically block microphone access on standard `HTTP` connections for security reasons (with the sole exception being `localhost` during local development).
