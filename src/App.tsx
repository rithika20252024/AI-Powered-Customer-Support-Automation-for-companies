import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Activity, ArrowUpRight, Check, ChevronDown, CircleHelp, Clock3, Copy, FileText, Headphones, LifeBuoy, Plus, Search, Send, ShieldCheck, Sparkles, ThumbsUp, X } from 'lucide-react';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  intent?: string;
  needsApproval?: boolean;
  ragCharacters?: number;
  sources?: string[];
  provider?: string;
};

const storageKey = 'abc-support-conversation-v1';
const documents = ['company_policy.txt', 'faq_document.txt', 'pricing_guide.txt', 'technical_manual.txt'];
const suggestions = ['What pricing plans do you offer?', 'I can’t log in to my account', 'I need help with a billing question'];

function savedMessages(sessionId: string): Message[] {
  try {
    const raw = localStorage.getItem(`${storageKey}:${sessionId}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export default function App() {
  const [customerId, setCustomerId] = useState('CUST_001');
  const [customerName, setCustomerName] = useState('');
  const [draftId, setDraftId] = useState('CUST_001');
  const [draftName, setDraftName] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadedCustomerId, setLoadedCustomerId] = useState('');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMessages(savedMessages(customerId)); setLoadedCustomerId(customerId); }, [customerId]);
  useEffect(() => {
    if (loadedCustomerId !== customerId) return;
    localStorage.setItem(`${storageKey}:${customerId}`, JSON.stringify(messages));
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, customerId, loadedCustomerId]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 2600); return () => clearTimeout(timer); }, [toast]);

  function applyCustomer(event: FormEvent) {
    event.preventDefault();
    const id = draftId.trim() || 'CUST_001';
    setDraftId(id);
    setCustomerName(draftName.trim());
    setCustomerId(id);
    setToast(`Session set to ${id}`);
  }

  function newConversation() {
    setMessages([]);
    setInput('');
    setToast('New conversation started');
  }

  async function sendMessage(event?: FormEvent, preset?: string) {
    event?.preventDefault();
    const text = (preset ?? input).trim();
    if (!text || sending) return;
    const previous = messages;
    setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'user', content: text }]);
    setInput('');
    setSending(true);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: previous.slice(-8).map(({ role, content }) => ({ role, content })) })
      });
      const raw = await response.text();
      let result: { error?: string; reply?: string; intent?: string; needsApproval?: boolean; ragCharacters?: number; sources?: string[]; provider?: string };
      try { result = JSON.parse(raw); }
      catch { throw new Error(raw || `The server returned an invalid response (HTTP ${response.status}).`); }
      if (!response.ok) throw new Error(result.error || 'The reply could not be sent.');
      if (typeof result.reply !== 'string') throw new Error('The server response did not include a reply.');
      setMessages((items) => [...items, {
        id: crypto.randomUUID(), role: 'assistant', content: result.reply!, intent: result.intent,
        needsApproval: result.needsApproval, ragCharacters: result.ragCharacters, sources: result.sources, provider: result.provider
      }]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
      setMessages((items) => [...items, { id: crypto.randomUUID(), role: 'assistant', content: `Unable to generate a response: ${detail}`, intent: 'system' }]);
    } finally { setSending(false); }
  }

  function copyResponse(content: string) { navigator.clipboard?.writeText(content); setToast('Response copied'); }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Headphones size={19}/></span><span>abc<span className="brand-muted">support</span></span></div>
      <button className="new-chat" onClick={newConversation}><Plus size={16}/> New conversation <span>⌘ K</span></button>
      <div className="side-label">WORKSPACE</div>
      <div className="side-active"><LifeBuoy size={16}/> Support assistant <span className="online-dot"/></div>
      <div className="side-label knowledge-label">KNOWLEDGE BASE <span className="loaded-count">4</span></div>
      <div className="knowledge-list">{documents.map((file) => <div key={file}><FileText size={14}/><span>{file}</span></div>)}</div>
      <div className="sidebar-fill"/>
      <div className="support-card"><span className="support-icon"><CircleHelp size={17}/></span><div><strong>Need more help?</strong><p>Our team is ready to assist.</p><button onClick={() => setToast('Contact your support team for assistance.')}>Contact support <ArrowUpRight size={12}/></button></div></div>
      <form className="customer-card" onSubmit={applyCustomer}><div className="customer-avatar">{(customerName || customerId).slice(0, 2).toUpperCase()}</div><div className="customer-fields"><label htmlFor="customer-id">CUSTOMER SESSION</label><input id="customer-id" value={draftId} onChange={(event) => setDraftId(event.target.value)} aria-label="Customer ID"/><input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="Name (optional)" aria-label="Customer name"/><button type="submit">Apply session</button></div></form>
    </aside>

    <main className="main-panel">
      <header className="topbar"><div className="breadcrumb"><span>Support</span><span>/</span><strong>{customerName || customerId}</strong></div><div className="top-actions"><span className={`environment-pill ${import.meta.env.DEV ? 'preview' : ''}`}><i/>{import.meta.env.DEV ? 'Ollama · qwen2.5:3b' : 'All systems operational'}</span><button className="icon-button" onClick={() => setToast('Search is available across your active conversation')} aria-label="Search"><Search size={17}/></button><button className="icon-button" onClick={() => setToast('Conversation activity')} aria-label="Activity"><Activity size={17}/></button><div className="user-avatar">{(customerName || customerId).slice(0, 2).toUpperCase()}</div></div></header>
      <div className="content-column">
        <section className="page-heading"><div><div className="eyebrow"><span/> ABC TECHNOLOGIES · CUSTOMER CARE</div><h1>How can we help?</h1><p>Ask us anything about your account, billing, or product.</p></div><div className="response-time"><Clock3 size={14}/><span>Usually replies in a few minutes</span></div></section>
        <section className="chat-area" aria-live="polite">
          {messages.length === 0 ? <div className="welcome-state"><div className="welcome-avatar"><Sparkles size={20}/></div><h2>Welcome to ABC Support</h2><p>I’m your AI support assistant. I can help with billing, account access, product questions, and technical issues.</p><div className="suggestions-label">SUGGESTED QUESTIONS</div><div className="suggestions">{suggestions.map((question) => <button key={question} onClick={() => sendMessage(undefined, question)}><Sparkles size={14}/>{question}<span>↗</span></button>)}</div></div>
          : <div className="message-list">{messages.map((message) => message.role === 'user'
            ? <article className="user-message" key={message.id}><div className="user-bubble">{message.content}</div><div className="user-avatar small">{(customerName || customerId).slice(0, 2).toUpperCase()}</div></article>
            : <article className="assistant-message" key={message.id}><div className="assistant-avatar"><Headphones size={16}/></div><div className="assistant-body"><div className="assistant-byline"><strong>ABC Support</strong><span>{message.intent && message.intent !== 'system' ? `${message.intent} team` : 'Support assistant'}</span>{message.provider && <span className="model-badge">{message.provider}</span>}</div>
              <div className="answer-card"><div className="answer-metadata"><span className="meta-label">INTENT</span><span className="intent-chip">{message.intent || 'General'}</span><span className="meta-divider"/><span className="meta-label">RISK</span><span className={`risk-chip ${message.needsApproval ? 'high' : 'normal'}`}><i/>{message.needsApproval ? 'High' : 'Normal'}</span><span className="review-chip"><ShieldCheck size={13}/>{message.needsApproval ? 'Supervisor approval required' : 'No supervisor review needed'}</span></div>
                {typeof message.ragCharacters === 'number' && <details className="rag-details"><summary><span><Search size={13}/> Knowledge base context</span><small>{message.ragCharacters} characters retrieved</small><ChevronDown size={14}/></summary><div className="rag-content"><span>Retrieved from</span>{(message.sources?.length ? message.sources : ['Knowledge base']).map((source) => <span className="source-chip" key={source}><FileText size={12}/>{source}</span>)}</div></details>}
                {message.needsApproval && <div className="approval-note"><ShieldCheck size={14}/> This request needs human approval before any action is taken.</div>}
                <div className="answer-text">{message.content.split('\n').map((line, i) => <p key={i}>{line}</p>)}</div>
                {message.role === 'assistant' && message.intent !== 'system' && <div className="answer-actions"><button onClick={() => copyResponse(message.content)}><Copy size={13}/> Copy</button><button onClick={() => setToast('Thanks for your feedback')}><ThumbsUp size={13}/> Helpful</button><span><Check size={13}/> Answer generated</span></div>}
              </div></div></article>)}
            {sending && <div className="thinking-row"><div className="assistant-avatar"><Headphones size={16}/></div><div className="thinking-card"><span className="typing-dots"><i/><i/><i/></span><span>Reviewing your question and searching the knowledge base…</span></div></div>}
          </div>}
          <div ref={bottomRef}/>
        </section>
        <form className="composer" onSubmit={(event) => sendMessage(event)}><div className="composer-box"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder="Write your message…" rows={1} maxLength={2000} aria-label="Write your message" disabled={sending}/><div className="composer-bottom"><span><ShieldCheck size={13}/> Your conversation is private</span><div><kbd>↵</kbd> to send <button type="submit" disabled={!input.trim() || sending} aria-label="Send message"><Send size={15}/></button></div></div></div><div className="composer-brand">AI responses are based on the ABC Technologies knowledge base.</div></form>
      </div>
    </main>
    {toast && <div className="toast"><Check size={15}/>{toast}<button aria-label="Dismiss" onClick={() => setToast('')}><X size={14}/></button></div>}
  </div>;
}
