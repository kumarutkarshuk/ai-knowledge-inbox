# Functional Requirements

- User should be able to save notes and URLs
- User should be able to ask questions based on saved notes and content in URLs with citations
- User should be able to view the saved items

# Non-Functional Requirements

- Content in URLs should be extracted and saved on the server side asynchronously
    - In the only backend app, a cron job polls the knowledge_base table for rows with status 'SUBMITTED' and processes them in the background (users only enqueue jobs and exit early)
- RAG pipeline
    - Ingestion: chunking with overlap -> embedding generation -> storage
    - Retrieval: user query -> embedding generation -> similarity search -> relevant chunks with user query to LLM -> answer

# Entities

- knowledge_base (id, raw_content, status)
    - id (UUID)
    - raw_content (VARCHAR(MAX))
    - status ('SUBMITTED', 'PROCESSING', 'FAILED', 'READY')
    - created_at (timestamptz)
    - modified_at (timestamptz)

# API Design

- POST /ingest
    - submits an ingestion job
- GET /items
    - also used to poll for status of jobs
- POST /query
    - get answer to a query
    - uses SSE + token streaming

# HLD

- 

# Notes

- Frontend inspiration: Perplexity AI 
- There is only a single user of the app
- Assumptions
    - deep links in a URL can be ignored
    - URLs are of only text-based web pages


