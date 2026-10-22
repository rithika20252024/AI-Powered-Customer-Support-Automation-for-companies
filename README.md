# AI-Powered Customer Support Automation System
### Live site

[Open ABC Customer Support](https://ai-powered-customer-support-automation-for-companies-1tw5uzjq1.vercel.app/)

## Description
A LangGraph-based multi-agent customer support system for ABC Technologies.
Classifies customer queries, routes them to the correct department agent,
retrieves relevant knowledge base context (RAG), maintains SQLite conversation
memory, and applies human-in-the-loop approval for billing/refund requests.

## Setup

### Install dependencies
```
pip install langgraph langchain-core langchain-ollama rich langgraph-checkpoint-sqlite
```

### Run
```
python abc_support_system.py
```


---

## Architecture Summary 

```
Customer Query
      │
      ▼
[classify_intent]  ← LLM classifies: sales / technical / billing / account / memory
      │
      ▼ (conditional routing )
┌─────┬──────────┬─────────┬─────────┬────────┐
│Sales│Technical │ Billing │ Account │ Memory │
└──┬──┴────┬─────┴────┬────┴────┬────┴───┬────┘
   │       │          │         │        │
   └───────┴──────────┴─────────┴────────┘
                      │
              (RAG retrieval of respective agent document from knowledge database)
                      │
              [human_approval_gate]  
                /           \
      (high-risk)         (normal)
           │                  │
  [await_human_approval]       │
           │                  │
           └──────────────────┘
                      │
           [supervisor_review]   (Approval & Validation if risk value is high)
                      │
            [send_response]
                      │
                   (END)
         Persisted to SQLite 
```

---
## File Structure

```
abc_support/
├── abc_support_system.py       # Main application (all 10 tasks)
├── knowledge_base/
│   ├── company_policy.txt      # Refund, cancellation, SLA policies
│   ├── pricing_guide.txt       # Subscription plans and pricing
│   ├── technical_manual.txt    # Error codes, troubleshooting steps
│   └── faq_document.txt        # Common customer FAQs
├── memory.db                   # SQLite database (auto-created on run)
├── README.md                   # This file
```

---

## Setup Instructions

### 1. Install Python dependencies
```bash
pip install langgraph langchain-core langchain-ollama rich langgraph-checkpoint-sqlite
```

### 2. Install and start Ollama
```bash
# Install Ollama from https://ollama.com
ollama pull qwen2.5:3b
ollama serve
```
> You can also use `llama3` — change `LLM_MODEL` in the script.

### 3. Run the system
```bash
cd abc_support
python abc_support_system.py
```

---

## Human-in-the-Loop 

High-risk requests (refunds, cancellations, account closures, compensation, escalations) pause the workflow and prompt a supervisor:

```
[A] Approve — send the draft response as-is
[R] Reject  — reject with a custom reason
[M] Modify  — approve with a custom response message
```

---

## SQLite Memory 

- Conversation history is persisted to `memory.db` automatically.
- Each customer session is keyed by `customer_id` (thread_id).
- Memory survives process restarts — customers can ask "What was my previous issue?" across sessions.
- Type `history` in interactive mode to view stored conversation turns.

---

## RAG Pipeline 

The system retrieves relevant knowledge base chunks based on:
- **Intent** → maps to preferred document (e.g., `billing` → Company Policy + FAQ)
- **Keyword overlap** → scores each paragraph against the customer query
- Top 4 chunks are injected into the agent's prompt

---

## High-Risk Keywords 

The following keywords automatically trigger human approval:
- refund
- cancel subscription / subscription cancellation
- close account / account closure
- compensation
- escalate / escalation to management
- speak to manager

---

## Configuration

Edit the top of `abc_support.py`:
```python
LLM_MODEL = "qwen2.5:3b"   # Change to "llama3", "mistral", etc.
DB_PATH   = "memory.db"    # SQLite database file path
KB_DIR    = "./knowledge_base"  # Knowledge base directory
```

---

## SQLite Schema

The `memory.db` file is managed by LangGraph's `SqliteSaver`. It stores full graph checkpoints (state snapshots) per `thread_id`, enabling complete conversation replay and memory recall.

To inspect manually:
```bash
sqlite3 memory.db
.tables
SELECT thread_id, checkpoint_ns FROM checkpoints LIMIT 10;
```


---

## React + TypeScript Web App

The repository also includes a responsive web chat with intent, risk, retrieved knowledge sources, and supervisor approval status.

### Live site

[Open ABC Customer Support](https://ai-powered-customer-support-automation-for-companies-1tw5uzjq1.vercel.app/)

The public web app is deployed. The web API uses Gemini `gemini-3.5-flash-lite`, which has a free tier with request limits. Add a Gemini API key as a server-side Vercel environment variable to enable chat.

### Local development

The local web app uses Ollama and the `qwen2.5:3b` model:

```sh
ollama serve
npm install
npm run dev
```

Open the local URL printed by Vite. You can set `OLLAMA_MODEL` and `OLLAMA_BASE_URL` in `.env.local` to use another installed model or Ollama server.

### Vercel

Import this repository into Vercel with the repository root as the project root. Create a Gemini API key in [Google AI Studio](https://aistudio.google.com/app/apikey). In Vercel, open this project’s **Settings → Environment Variables**, add `GEMINI_API_KEY` as a Secret for Production, then redeploy. The optional server-side `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`. Never use a `VITE_` prefix for a secret or commit the key. Google’s free tier has rate limits and states that submitted content may be used to improve its products; do not send real sensitive customer information through this demo on the free tier.

The web app stores conversation history in the browser, separately for each customer ID.
