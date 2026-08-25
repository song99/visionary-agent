# System Data Flowchart

![System Data Flowchart](system_flowchart.png)

## ASCII Flowchart

```text
[ User Interface / Voice Input ]
               │
               ▼
   [ 1. Angular Frontend ]
   • Retrieves / Stores 'guest_id' in localStorage
   • Packages payload: { "guest_id": "...", "message": "..." }
               │
               │ (Real-time WebSocket connection: /chat)
               ▼
   [ 2. FastAPI Backend (Cloud Run) ]
   • Accepts WebSocket connection
   • Sets context variable: current_guest_id = guest_id
   • Dynamically gets or creates ADK Memory Session for guest_id
               │
               ▼
   [ 3. Google ADK & Gemini 3 Agent ]
   • Evaluates prompt & selects appropriate tool:
       ├─► Factual Q&A ──► [ Firestore: Knowledge Base (RAG Vector Search) ]
       └─► User Facts ───► [ Firestore: user_preferences Document ]
   • Generates plain conversational text response
               │
               ▼
   [ 4. Audio Synthesis & Formatting ]
   • Converts text response to Base64 audio (gTTS)
   • Packages response payload: { "text": "...", "audio": "..." }
               │
               │ (WebSocket response)
               ▼
   [ 5. Angular Client ]
   • Displays response text on screen
   • Plays base64 audio stream for user
```

---

## Mermaid Flowchart

```mermaid
flowchart TD
    subgraph Frontend["1. Angular (Frontend Client)"]
        A1["User Types Message or Speaks Audio"] --> A2["Retrieve / Generate guest_id from localStorage"]
        A2 --> A3["Build JSON Payload: { guest_id, message }"]
    end

    subgraph Backend["2. FastAPI Backend (Cloud Run)"]
        B1["WebSocket Endpoint (/chat)"] --> B2["Extract guest_id & Set ContextVar"]
        B2 --> B3["ADK Session Service (Get or Create Session for guest_id)"]
    end

    subgraph AI["3. Google ADK & Gemini 3"]
        C1["Collaborative Agent (Gemini 3)"] --> C2{"Determine Action"}
        C2 -->|"Query Facts"| C3["search_knowledge_base()"]
        C2 -->|"Save/Get Memory"| C4["save_user_preference() / get_user_preferences()"]
        C2 -->|"Direct Response"| C5["Generate Plain-text Response"]
    end

    subgraph DB["4. Firestore Database"]
        D1[("Knowledge Base (Vector Search RAG)")]
        D2[("user_preferences Collection")]
    end

    subgraph Response["5. Audio Synthesis & Client Output"]
        E1["Generate Base64 Audio (TTS)"] --> E2["Send JSON { text, audio } over WebSocket"]
        E3["Render Chat Text & Play Audio Stream"]
    end

    %% Connections
    A3 -->|"WebSocket Transmit"| B1
    B3 -->|"Pass Message + Session Context"| C1
    C3 <--> D1
    C4 <--> D2
    C3 --> C5
    C4 --> C5
    C5 --> E1
    E2 -->|"WebSocket Receive"| E3
```
