import os
from dotenv import load_dotenv

# Load environment variables from .env before initializing clients
load_dotenv()

from google.cloud import firestore
from google import genai

# Initialize Firestore — it will now automatically detect the credentials
db = firestore.Client()
ai_client = genai.Client()

print(f"Successfully connected to Firestore project: {db.project}")