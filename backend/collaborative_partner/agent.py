import os
from contextvars import ContextVar
from google.cloud import firestore
from google.cloud.firestore_v1.vector import Vector
from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
from google.adk import Agent
from google.genai import types
from google import genai

# Context variable to hold the current guest/user ID across request contexts
current_guest_id: ContextVar[str] = ContextVar("current_guest_id", default="default_guest")

# ==========================================
# 1. FIRESTORE KNOWLEDGE BASE & MEMORY
# ==========================================
# Lazy client getters to prevent startup container crashes
db = None
ai_client = None

def get_db():
    global db
    if db is None:
        project_id = os.getenv("GOOGLE_CLOUD_PROJECT", "visionary-agent")
        db = firestore.Client(project=project_id)
    return db

def get_ai_client():
    global ai_client
    if ai_client is None:
        ai_client = genai.Client()
    return ai_client

def search_knowledge_base(query: str) -> str:
    """Searches the organizational knowledge base for context.
    Use this to look up facts, policies, or specific organizational knowledge.
    """
    try:
        client = get_ai_client()
        firestore_db = get_db()

        # Convert the user query into a vector embedding
        response = client.models.embed_content(
            model="gemini-embedding-001",
            contents=query,
            config={"output_dimensionality": 768}
        )
        query_embedding = response.embeddings[0].values

        # Perform a similarity search in Firestore
        collection_ref = firestore_db.collection("knowledge_base")
        vector_query = collection_ref.find_nearest(
            vector_field="embedding",
            query_vector=Vector(query_embedding),
            distance_measure=DistanceMeasure.COSINE,
            limit=2
        )
        
        results = vector_query.get()
        if results:
            retrieved_texts = [doc.to_dict().get("content", "") for doc in results]
            return "\n\n---\n\n".join(retrieved_texts)
        return "No relevant information found in the knowledge base."
    except Exception as e:
        return f"Database lookup failed: {str(e)}"

def save_user_preference(key: str, value: str) -> str:
    """Saves a user preference, fact, or detail to long-term memory for the active user.
    Use this whenever the user shares facts about themselves, their preferences, name, or role.
    """
    guest_id = current_guest_id.get()
    try:
        print(f"[Firestore Memory] Saving preference for '{guest_id}': {key} = {value}")
        firestore_db = get_db()
        firestore_db.collection("user_preferences").document(guest_id).set(
            {key: value}, merge=True
        )
        print(f"[Firestore Memory] Successfully saved '{key}' for '{guest_id}'")
        return f"Saved preference: '{key}' = '{value}' for user {guest_id}."
    except Exception as e:
        print(f"[Firestore Memory Error] Failed to save preference for '{guest_id}': {e}")
        return f"Failed to save user preference: {str(e)}"

def get_user_preferences() -> str:
    """Retrieves all stored preferences, details, and facts about the active user.
    Use this to recall details about the user when asked or when personalizing responses.
    """
    guest_id = current_guest_id.get()
    try:
        print(f"[Firestore Memory] Fetching preferences for '{guest_id}'")
        firestore_db = get_db()
        doc = firestore_db.collection("user_preferences").document(guest_id).get()
        if doc.exists:
            data = doc.to_dict()
            if data:
                prefs = ", ".join([f"{k}: {v}" for k, v in data.items()])
                print(f"[Firestore Memory] Retrieved for '{guest_id}': {prefs}")
                return f"User preferences: {prefs}"
        print(f"[Firestore Memory] No stored preferences found for '{guest_id}'")
        return "No saved preferences found for this user."
    except Exception as e:
        print(f"[Firestore Memory Error] Failed to fetch preferences for '{guest_id}': {e}")
        return f"Failed to retrieve user preferences: {str(e)}"

# ==========================================
# 2. INITIALIZE THE ADK AGENT
# ==========================================
# Python functions with docstrings are automatically converted into ADK tools
collaborative_agent = Agent(
    name="Collaborative_Partner",
    model="gemini-3.5-flash",
    instruction=(
        "You are a helpful, collaborative virtual partner. "
        "1. USER MEMORY & PREFERENCES: "
        "   - Whenever the user mentions any personal detail, name, nickname, role, or preference, ALWAYS call the save_user_preference tool to save it. "
        "   - Whenever the user asks what you know about them or asks a question about their identity/preferences, ALWAYS call the get_user_preferences tool first. "
        "2. KNOWLEDGE BASE: You query the knowledge base before answering organizational or factual questions. "
        "3. IMPORTANT FOR SPEECH SYNTHESIS: "
        "   - Write in plain conversational text only—do NOT use Markdown formatting like asterisks (*), hashtags (#), or bullet points. "
        "   - Use short, clear sentences with proper periods and commas so the text-to-speech engine can parse it easily. "
        "   - Keep your answers brief and concise."
    ),
    tools=[search_knowledge_base, save_user_preference, get_user_preferences],
    generate_content_config=types.GenerateContentConfig(temperature=0.3)
)