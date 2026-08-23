import os
from pypdf import PdfReader
from dotenv import load_dotenv
from google.cloud import firestore
from google.cloud.firestore_v1.vector import Vector
from google import genai

# Load environment variables (API keys and credentials)
load_dotenv()

# Initialize Google Cloud and GenAI clients
db = firestore.Client()
ai_client = genai.Client()

# Directory containing your auditing PDFs
PDF_FOLDER = "./pdfs"

def seed_pdfs_to_firestore():
    print(f"Scanning for PDFs in {PDF_FOLDER}...")
    
    # Ensure the folder exists
    if not os.path.exists(PDF_FOLDER):
        os.makedirs(PDF_FOLDER)
        print(f"Created '{PDF_FOLDER}' folder. Please place your PDFs inside and run again.")
        return

    collection_ref = db.collection("knowledge_base")
    total_pages_embedded = 0

    # Loop through every file in the folder
    for filename in os.listdir(PDF_FOLDER):
        if filename.endswith(".pdf"):
            file_path = os.path.join(PDF_FOLDER, filename)
            print(f"\nProcessing: {filename}")
            
            # Read the PDF
            reader = PdfReader(file_path)
            
            # Process each page individually (Page-level chunking)
            for page_num, page in enumerate(reader.pages):
                text = page.extract_text()
                
                # Only process pages that actually contain text
                if text and text.strip():
                    try:
                        # 1. Generate the 768-dimensional vector embedding
                        response = ai_client.models.embed_content(
                            model="gemini-embedding-001",
                            contents=text,
                            config={"output_dimensionality": 768}
                        )
                        embedding_values = response.embeddings[0].values
                        
                        # 2. Save the text, metadata, and vector to Firestore
                        doc_id = f"{filename.replace('.pdf', '')}_page_{page_num + 1}"
                        doc_ref = collection_ref.document(doc_id)
                        
                        doc_ref.set({
                            "content": text,
                            "source_file": filename,
                            "page_number": page_num + 1,
                            "embedding": Vector(embedding_values)
                        })
                        
                        total_pages_embedded += 1
                        print(f"  -> Uploaded page {page_num + 1}")
                        
                    except Exception as e:
                        print(f"  -> Error embedding page {page_num + 1}: {e}")

    print(f"\nSuccess! Embedded {total_pages_embedded} total PDF pages into Firestore.")

if __name__ == "__main__":
    seed_pdfs_to_firestore()