# =============================================================
# ABC Technologies — AI-Powered Customer Support Automation

# =============================================================

import os
import re
import sqlite3
from typing import TypedDict, Optional, List, Annotated

from langgraph.graph import StateGraph, END
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph.message import add_messages

from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.language_models.fake import FakeListLLM   # Fallback when Ollama unavailable

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.rule import Rule

console = Console()

# ─────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────
LLM_MODEL = "qwen2.5:3b"
DB_PATH   = "memory.db"

# KB_DIR: resolved relative to this script so it always finds
# the knowledge_base/ folder sitting next to support_system.py
KB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "knowledge_base")

HIGH_RISK_KEYWORDS = [
    "refund", "cancel subscription", "subscription cancellation",
    "close account", "account closure", "compensation",
    "escalate", "speak to manager",
]

# ─────────────────────────────────────────────────────────────
# STATE
# ─────────────────────────────────────────────────────────────
class SupportState(TypedDict):
    customer_id:     str
    customer_name:   Optional[str]
    query:           str
    intent:          str
    is_high_risk:    bool
    rag_context:     str
    needs_approval:  bool
    approval_status: str
    supervisor_note: str
    draft_response:  str
    final_response:  str
    messages:        Annotated[list, add_messages]

# ─────────────────────────────────────────────────────────────
# LLM  (falls back to mock if Ollama is not running)
# ─────────────────────────────────────────────────────────────
def get_llm():
    try:
        llm = ChatOllama(model=LLM_MODEL, temperature=0.2)
        llm.invoke("hi")
        return llm
    except Exception:
        console.print(f"[yellow]⚠  Ollama '{LLM_MODEL}' unavailable — using mock responses.[/yellow]")
        return FakeListLLM(responses=["Thank you for your query. Our support team will assist you shortly."] * 50)

# ─────────────────────────────────────────────────────────────
# KNOWLEDGE BASE — reads your existing knowledge_base/ files:
#   company_policy.txt  |  faq_document.txt
#   pricing_guide.txt   |  technical_manual.txt
# ─────────────────────────────────────────────────────────────
def load_knowledge_base() -> dict:
    kb = {}
    if not os.path.isdir(KB_DIR):
        console.print(f"[bold red]ERROR: knowledge_base/ not found at {KB_DIR}[/bold red]")
        return kb
    for fname in sorted(os.listdir(KB_DIR)):
        if fname.endswith(".txt"):
            key  = fname.replace(".txt", "").replace("_", " ").title()
            with open(os.path.join(KB_DIR, fname), "r", encoding="utf-8") as f:
                content = f.read()
            kb[key] = content
            console.print(f"[dim]   {fname}  ({len(content):,} chars)[/dim]")
    console.print(f"[green]✓ Knowledge base: {len(kb)} documents loaded[/green]\n")
    return kb

KB = load_knowledge_base()


# ─────────────────────────────────────────────────────────────
# RAG — scored keyword retrieval 
# ─────────────────────────────────────────────────────────────
def retrieve_context(query: str, intent: str) -> str:
    query_lower = query.lower()
    scored: List[tuple] = []

    intent_doc_map = {
        "sales":     ["Pricing Guide"],
        "billing":   ["Company Policy", "Faq Document"],
        "technical": ["Technical Manual", "Faq Document"],
        "account":   ["Faq Document", "Company Policy"],
    }
    preferred_docs = intent_doc_map.get(intent, [])

    for doc_name, content in KB.items():
        paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
        for para in paragraphs:
            score = 0
            for pref in preferred_docs:
                if pref.lower() in doc_name.lower():
                    score += 5
            for word in re.findall(r'\w+', query_lower):
                if len(word) > 3 and word in para.lower():
                    score += 1
            if score > 0:
                scored.append((score, doc_name, para))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:4]

    if not top:
        return "\n\n".join(f"[{n}]\n{c[:300]}" for n, c in KB.items())

    return "\n\n".join(f"[{doc}]\n{chunk}" for _, doc, chunk in top)

# ─────────────────────────────────────────────────────────────
# NODES
# ─────────────────────────────────────────────────────────────
def classify_intent(state: SupportState) -> SupportState:
    query = state["query"].lower()

    # Memory detection — no LLM needed
    if any(p in query for p in ["previous", "last issue", "history", "what was my", "earlier"]):
        state["intent"]          = "memory"
        state["is_high_risk"]    = False
        state["needs_approval"]  = False
        state["approval_status"] = "not_required"
        console.print("[bold cyan]→ Intent: MEMORY RECALL[/bold cyan]")
        return state

    # Keyword-based classification (billing checked first to avoid collision with "subscription")
    if any(w in query for w in ["refund", "bill", "payment", "cancel"]):
        state["intent"] = "billing"
    elif any(w in query for w in ["crash", "error", "upload", "bug"]):
        state["intent"] = "technical"
    elif any(w in query for w in ["password", "login", "account", "profile"]):
        state["intent"] = "account"
    elif any(w in query for w in ["price", "plan", "subscription", "cost"]):
        state["intent"] = "sales"
    else:
        state["intent"] = "account"

    is_high_risk             = any(kw in query for kw in HIGH_RISK_KEYWORDS)
    state["is_high_risk"]    = is_high_risk
    state["needs_approval"]  = is_high_risk
    state["approval_status"] = "pending" if is_high_risk else "not_required"

    risk = "[bold red]⚠ HIGH RISK[/bold red]" if is_high_risk else "[green]Normal[/green]"
    console.print(f"[bold cyan]→ Intent: {state['intent'].upper()}[/bold cyan] | Risk: {risk}")
    return state


def _run_agent(state: SupportState, role: str) -> SupportState:
    llm     = get_llm()
    context = retrieve_context(state["query"], state["intent"])
    state["rag_context"] = context
    console.print(f"[dim]RAG: Retrieved {len(context)} chars from knowledge base[/dim]")

    # Build conversation history snippet
    history_text = ""
    for msg in state["messages"][-8:]:
        if hasattr(msg, "content"):
            who           = "Customer" if isinstance(msg, HumanMessage) else "Agent"
            history_text += f"{who}: {msg.content}\n"

    name_str = f" Address the customer as {state['customer_name']}." if state.get("customer_name") else ""

    prompt = (
        f"You are {role} at ABC Technologies.{name_str}\n\n"
        f"--- KNOWLEDGE BASE CONTEXT ---\n{context}\n\n"
        f"--- CONVERSATION HISTORY ---\n{history_text or 'No previous conversation.'}\n\n"
        f"--- CUSTOMER QUERY ---\n{state['query']}\n\n"
        f"Reply professionally and concisely (3-5 sentences). "
        f"Use only information from the knowledge base. "
        f"If this is a high-risk request acknowledge that it needs supervisor approval.\n\n"
        f"Response:"
    )

    result = llm.invoke(prompt)
    state["draft_response"] = result.content if hasattr(result, "content") else str(result)
    return state


def sales_agent(state):     return _run_agent(state, "Sales & Product Information Specialist")
def technical_agent(state): return _run_agent(state, "Technical Support Engineer")
def billing_agent(state):   return _run_agent(state, "Billing & Accounts Specialist")
def account_agent(state):   return _run_agent(state, "Account Management Specialist")


def memory_agent(state: SupportState) -> SupportState:
    llm = get_llm()

    history_parts = [
        f"{'Customer' if isinstance(m, HumanMessage) else 'Agent'}: {m.content}"
        for m in state["messages"] if hasattr(m, "content") and m.content
    ]

    if len(history_parts) <= 2:
        state["draft_response"] = (
            "I don't have any previous interactions on record for this session. "
            "How can I help you today?"
        )
        state["rag_context"] = "Memory recall — no RAG needed."
        return state

    history_text = "\n".join(history_parts[:-2])
    prompt = (
        f"You are a helpful ABC Technologies support agent.\n\n"
        f"--- CONVERSATION HISTORY ---\n{history_text}\n\n"
        f"--- CUSTOMER QUESTION ---\n{state['query']}\n\n"
        f"Answer in 2-3 sentences using the history above.\n\nResponse:"
    )
    result = llm.invoke(prompt)
    state["draft_response"] = result.content if hasattr(result, "content") else str(result)
    state["rag_context"]    = "Memory recall — conversation history used."
    console.print("[dim]📚 Memory: Conversation history retrieved[/dim]")
    return state


def human_approval_gate(state: SupportState) -> str:
    return "await_approval" if state.get("needs_approval") else "supervisor_review"


def await_human_approval(state: SupportState) -> SupportState:
    console.print(Rule("[bold red]⚠  HUMAN SUPERVISOR APPROVAL REQUIRED  ⚠[/bold red]"))
    console.print(Panel(
        f"[bold]Query:[/bold]          {state['query']}\n"
        f"[bold]Intent:[/bold]         {state['intent'].upper()}\n\n"
        f"[bold]Draft Response:[/bold]\n{state['draft_response']}",
        title="[red]High-Risk Request — Pending Approval[/red]",
        border_style="red",
    ))
    console.print("\n[bold yellow]Supervisor Options:[/bold yellow]")
    console.print("  [green][A][/green] Approve")
    console.print("  [red][R][/red]  Reject")
    console.print("  [blue][M][/blue] Modify\n")

    while True:
        choice = console.input("[bold cyan]Supervisor (A/R/M): [/bold cyan]").strip().upper()
        if choice == "A":
            state["approval_status"] = "approved"
            state["supervisor_note"] = "Approved by supervisor."
            console.print("[bold green]✓ APPROVED[/bold green]")
            break
        elif choice == "R":
            reason                   = console.input("[bold red]Rejection reason: [/bold red]").strip()
            state["approval_status"] = "rejected"
            state["supervisor_note"] = reason
            state["draft_response"]  = (
                f"We are unable to process your request at this time. "
                f"Reason: {reason}. "
                f"Contact billing@abctechnologies.com for further help."
            )
            console.print("[bold red]✗ REJECTED[/bold red]")
            break
        elif choice == "M":
            custom                   = console.input("[bold blue]Custom response: [/bold blue]").strip()
            state["approval_status"] = "approved"
            state["supervisor_note"] = "Approved with modifications."
            state["draft_response"]  = custom
            console.print("[bold blue]✓ APPROVED (modified)[/bold blue]")
            break
        else:
            console.print("[yellow]Enter A, R, or M[/yellow]")

    return state


def supervisor_review(state: SupportState) -> SupportState:
    llm    = get_llm()
    prompt = (
        f"You are the QA Supervisor at ABC Technologies.\n\n"
        f"Review the draft response. Fix grammar or tone only if needed. "
        f"Do NOT add new information or change approval decisions. "
        f"Return ONLY the final response text.\n\n"
        f"Customer Query:  {state['query']}\n"
        f"Department:      {state['intent'].upper()}\n"
        f"Approval Status: {state.get('approval_status', 'not_required')}\n"
        f"Draft Response:  {state['draft_response']}\n\n"
        f"Final Response:"
    )
    result = llm.invoke(prompt)
    state["final_response"] = result.content if hasattr(result, "content") else str(result)
    console.print("[dim]✅ Supervisor review complete[/dim]")
    return state


def send_response(state: SupportState) -> SupportState:
    state["messages"] = [AIMessage(content=state["final_response"])]
    return state

# ─────────────────────────────────────────────────────────────
# GRAPH
# ─────────────────────────────────────────────────────────────
def build_graph():
    builder = StateGraph(SupportState)

    builder.add_node("classify",        classify_intent)
    builder.add_node("sales",           sales_agent)
    builder.add_node("technical",       technical_agent)
    builder.add_node("billing",         billing_agent)
    builder.add_node("account",         account_agent)
    builder.add_node("memory",          memory_agent)
    builder.add_node("await_approval",  await_human_approval)
    builder.add_node("supervisor",      supervisor_review)
    builder.add_node("send",            send_response)

    builder.set_entry_point("classify")

    builder.add_conditional_edges("classify", lambda s: s["intent"], {
        "sales":     "sales",
        "technical": "technical",
        "billing":   "billing",
        "account":   "account",
        "memory":    "memory",
    })

    for node in ["sales", "technical", "billing", "account", "memory"]:
        builder.add_conditional_edges(node, human_approval_gate, {
            "await_approval":  "await_approval",
            "supervisor_review": "supervisor",
        })

    builder.add_edge("await_approval", "supervisor")
    builder.add_edge("supervisor",     "send")
    builder.set_finish_point("send")

    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    return builder.compile(checkpointer=SqliteSaver(conn))

# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────
def make_state(query: str, customer_id: str, customer_name: Optional[str]) -> SupportState:
    return {
        "customer_id":     customer_id,
        "customer_name":   customer_name,
        "query":           query,
        "intent":          "",
        "is_high_risk":    False,
        "rag_context":     "",
        "needs_approval":  False,
        "approval_status": "",
        "supervisor_note": "",
        "draft_response":  "",
        "final_response":  "",
        "messages":        [HumanMessage(content=query)],
    }


def show_history(graph, config: dict):
    console.print(Rule("[bold cyan]Conversation History (SQLite Memory)[/bold cyan]"))
    try:
        checkpoint = graph.get_state(config)
        msgs       = checkpoint.values.get("messages", []) if checkpoint else []
        if not msgs:
            console.print("[yellow]No history found for this session.[/yellow]")
            return
        table = Table(title=f"Session: {config['configurable']['thread_id']}", style="cyan")
        table.add_column("#",       width=4)
        table.add_column("Role",    width=12)
        table.add_column("Message", width=64)
        for i, msg in enumerate(msgs, 1):
            role  = "Customer" if isinstance(msg, HumanMessage) else "Agent"
            color = "white"    if isinstance(msg, HumanMessage) else "green"
            text  = msg.content[:80] + ("…" if len(msg.content) > 80 else "")
            table.add_row(str(i), f"[{color}]{role}[/{color}]", text)
        console.print(table)
    except Exception as e:
        console.print(f"[red]Could not load history: {e}[/red]")

# ─────────────────────────────────────────────────────────────
# MAIN — INTERACTIVE CHAT
# ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    console.print(Panel(
        "[bold]ABC Technologies[/bold]\n"
        "AI-Powered Customer Support\n"
        ,
        title="[bold magenta]Welcome[/bold magenta]",
        border_style="magenta",
        padding=(1, 4),
    ))

    graph = build_graph()

    customer_id   = console.input("[bold]Customer ID (Enter for 'CUST_001'): [/bold]").strip() or "CUST_001"
    customer_name = console.input("[bold]Your name (optional):               [/bold]").strip() or None
    config        = {"configurable": {"thread_id": customer_id}}

    console.print(f"\n[green]Session started — ID: [bold]{customer_id}[/bold][/green]")
    console.print("[dim]Commands: 'history' · 'quit'[/dim]\n")

    while True:
        query = console.input("[bold white]You: [/bold white]").strip()
        if not query:
            continue
        if query.lower() in ["quit", "exit"]:
            console.print("[yellow]Thank you for contacting ABC Technologies. Goodbye![/yellow]")
            break
        if query.lower() == "history":
            show_history(graph, config)
            continue

        result = graph.invoke(make_state(query, customer_id, customer_name), config=config)

        console.print(Panel(
            result.get("final_response", "Thank you for contacting ABC Technologies."),
            title=f"[bold green]ABC Support ({result.get('intent', '').upper()})[/bold green]",
            border_style="green",
        ))