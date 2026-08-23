FROM python:3.11-slim

# Prevent Python from writing bytecode and enable unbuffered logs
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY main.py .
COPY collaborative_partner/ ./collaborative_partner/
COPY pdfs/ ./pdfs/

EXPOSE 8080

# Run FastAPI app with Uvicorn
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT}
