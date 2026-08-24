import os
import asyncio
import base64
import json
from dotenv import load_dotenv

# 1. Load environment variables BEFORE importing Google SDKs and ADK
load_dotenv()

# Verify required keys and credentials are present
if not os.getenv("GEMINI_API_KEY"):
    print("[Warning] GEMINI_API_KEY is missing from .env!")
if not os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
    print("[Warning] GOOGLE_APPLICATION_CREDENTIALS is not explicitly set in .env")

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import texttospeech

# 2. Import ADK Runner, Google GenAI types, and error types
from google.adk.runners import InMemoryRunner
from google.genai import types 
from google.genai.errors import ServerError, APIError

# 3. Import your agent definition & context variable
from collaborative_partner.agent import collaborative_agent, current_guest_id

# Initialize FastAPI App & CORS
app = FastAPI(title="VerityLens Agent Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
@app.get("/health")
def health_check():
    return {"status": "ok", "service": "VerityLens Agent Server"}

# Initialize the Text-to-Speech client
tts_client = texttospeech.TextToSpeechClient()

import re
from google.cloud import texttospeech

def sanitize_and_chunk_text(text: str, max_chars_per_chunk: int = 250) -> list[str]:
    """Cleans markdown symbols and splits text into natural sentences."""
    # 1. Remove markdown characters that confuse TTS (asterisks, hashes, backticks)
    cleaned = re.sub(r"[\*#`_~>\[\]]", " ", text)
    # Collapse multiple whitespaces
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    if not cleaned:
        return []

    # 2. Split by standard sentence terminators (. ! ? \n)
    sentences = re.split(r"(?<=[.!?])\s+", cleaned)
    
    chunks = []
    current_chunk = ""

    for s in sentences:
        s = s.strip()
        if not s:
            continue
            
        # If a single sentence without punctuation is still too long, force-split it by words
        if len(s) > max_chars_per_chunk:
            words = s.split(" ")
            sub_chunk = ""
            for w in words:
                if len(sub_chunk) + len(w) + 1 > max_chars_per_chunk:
                    if sub_chunk:
                        chunks.append(sub_chunk.strip() + ".")
                    sub_chunk = w
                else:
                    sub_chunk = f"{sub_chunk} {w}".strip()
            if sub_chunk:
                chunks.append(sub_chunk.strip() + ".")
        else:
            if len(current_chunk) + len(s) + 1 > max_chars_per_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = s
            else:
                current_chunk = f"{current_chunk} {s}".strip()

    if current_chunk:
        chunks.append(current_chunk.strip())

    return chunks

def generate_audio(text: str) -> str:
    """Converts text to speech and returns a base64 encoded MP3 string."""
    if not text or not text.strip():
        return ""

    chunks = sanitize_and_chunk_text(text)
    if not chunks:
        return ""

    try:
        audio_byte_segments = []

        voice = texttospeech.VoiceSelectionParams(
            language_code="en-US", 
            name="en-US-Journey-D"
        )
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3
        )

        for chunk in chunks:
            synthesis_input = texttospeech.SynthesisInput(text=chunk)
            response = tts_client.synthesize_speech(
                input=synthesis_input, 
                voice=voice, 
                audio_config=audio_config
            )
            audio_byte_segments.append(response.audio_content)

        # Combine MP3 segments together
        combined_audio = b"".join(audio_byte_segments)
        return base64.b64encode(combined_audio).decode("utf-8")

    except Exception as e:
        print(f"[Error] TTS Synthesis failed: {e}")
        return ""


# 4. Create the Execution Runner for the Agent
runner = InMemoryRunner(app_name="hackathon_app", agent=collaborative_agent)


@app.websocket("/chat")
async def chat_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("Frontend connected via WebSocket.")
    
    try:
        while True:
            raw_data = await websocket.receive_text()
            if not raw_data.strip():
                continue
                
            # 1. Parse the JSON sent from Angular
            try:
                payload = json.loads(raw_data)
                guest_id = payload.get("guest_id", "demo_user")
                user_message = payload.get("message", "")
            except json.JSONDecodeError:
                # Fallback just in case plain text is sent during testing
                guest_id = "demo_user"
                user_message = raw_data

            if not user_message.strip():
                continue
                
            print(f"\n[{guest_id}] asked: {user_message}")
            
            # 2. Set the context variable so save_user_preference() can access it!
            current_guest_id.set(guest_id)
            
            # 3. Create or retrieve the ADK memory session dynamically for THIS guest
            existing_sessions = await runner.session_service.list_sessions(
                app_name="hackathon_app", 
                user_id=guest_id
            )
            
            if hasattr(existing_sessions, "sessions") and len(existing_sessions.sessions) > 0:
                session = existing_sessions.sessions[0]
            elif isinstance(existing_sessions, list) and len(existing_sessions) > 0:
                session = existing_sessions[0]
            else:
                session = await runner.session_service.create_session(
                    app_name="hackathon_app", 
                    user_id=guest_id
                )
            
            # Format the raw string into the Content payload the ADK expects
            content = types.Content(
                role='user', 
                parts=[types.Part(text=user_message)]
            )
            
            # Run the agent with exponential backoff retries
            answer_text = ""
            max_retries = 3
            backoff = 2

            try:
                for attempt in range(1, max_retries + 1):
                    try:
                        answer_text = ""
                        async for event in runner.run_async(
                            session_id=session.id, 
                            user_id=session.user_id, 
                            new_message=content
                        ):
                            # Extract final text chunks from ADK event stream
                            if event.content and event.content.parts:
                                for part in event.content.parts:
                                    if part.text:
                                        answer_text += part.text
                        break  # Successfully finished generation
                    except ServerError as e:
                        print(f"[Warning] Gemini API Server Error (attempt {attempt}/{max_retries}): {e}")
                        if attempt == max_retries:
                            raise e
                        await asyncio.sleep(backoff)
                        backoff *= 2

                print(f"Agent answered: {answer_text}")
                
                # Generate the Audio bytes asynchronously in a worker thread
                audio_base64 = await asyncio.to_thread(generate_audio, answer_text)
                
                # Package and transmit back to Angular
                response_payload = {
                    "text": answer_text,
                    "audio": audio_base64
                }
                await websocket.send_text(json.dumps(response_payload))

            except (ServerError, APIError) as e:
                print(f"[Error] Gemini API failure: {e}")
                err_payload = {
                    "text": "Sorry, the AI service encountered a temporary error. Please try again.",
                    "audio": ""
                }
                await websocket.send_text(json.dumps(err_payload))
                
            except Exception as e:
                print(f"[Error] Unexpected agent execution error: {e}")
                err_payload = {
                    "text": "An error occurred while processing your request.",
                    "audio": ""
                }
                await websocket.send_text(json.dumps(err_payload))
            
    except WebSocketDisconnect:
        print("Frontend disconnected.")
    except Exception as e:
        print(f"WebSocket session closed with error: {e}")