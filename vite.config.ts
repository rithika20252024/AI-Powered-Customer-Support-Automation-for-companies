import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function localOllamaChat(model: string, baseUrl: string) {
  const highRisk = /refund|cancel(?:lation)?|close my account|account closure|compensation|escalat|manager/i;
  const policy = [
    { type: 'billing', text: 'Refunds are reviewed within 5–7 business days. Subscription cancellation stops the next renewal; access remains through the current paid period. Billing disputes require supervisor approval.' },
    { type: 'sales', text: 'ABC offers Starter, Professional, and Enterprise plans. Enterprise includes priority support and custom onboarding. Contact sales for a tailored quote.' },
    { type: 'technical', text: 'For login or loading issues, refresh the page, clear the browser cache, and confirm the latest browser version. Include the error code and steps to reproduce when contacting technical support.' },
    { type: 'account', text: 'Account email changes require identity verification. Account closure requests are reviewed by a supervisor before they are completed.' },
    { type: 'general', text: 'Support is available Monday–Friday. We aim to respond to standard requests within one business day.' }
  ];
  return {
    name: 'local-chat-preview',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use('/api/chat', (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Use POST.' }));
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          void (async () => {
          try {
            const payload = JSON.parse(body);
            const message = typeof payload.message === 'string' ? payload.message.trim() : '';
            if (!message || message.length > 2000) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Enter a message under 2,000 characters.' }));
              return;
            }
            const intent = /refund|invoice|payment|bill|charge|subscription/i.test(message) ? 'billing'
              : /error|bug|broken|crash|technical|login|load|slow/i.test(message) ? 'technical'
              : /account|password|email|profile|sign in/i.test(message) ? 'account'
              : /price|plan|buy|purchase|sales|quote/i.test(message) ? 'sales' : 'general';
            const context = policy.filter((entry) => entry.type === intent || entry.type === 'general').map((entry) => entry.text).join('\n');
            const ragCharacters = context.length;
            const needsApproval = highRisk.test(message);
            const history = Array.isArray(payload.history) ? payload.history.slice(-8)
              .filter((item: any) => ['user', 'assistant'].includes(item?.role) && typeof item?.content === 'string')
              .map((item: any) => ({ role: item.role, content: item.content.slice(0, 2000) })) : [];
            const upstream = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model, stream: false, messages: [
                { role: 'system', content: `You are a helpful, thoughtful customer support agent for ABC Technologies. Answer the customer's specific question in your own words; do not reuse a generic template. Use the policy context below and do not invent policy details. If the request is high risk, explain that it requires supervisor approval and do not claim it has been completed. Keep the response clear and concise.\n\nPolicy context:\n${context}` },
                ...history,
                { role: 'user', content: message }
              ] })
            });
            const modelResult = await upstream.json();
            if (!upstream.ok) {
              res.statusCode = 502;
              res.end(JSON.stringify({ error: modelResult?.error || 'Ollama could not generate a response. Confirm the model is available.' }));
              return;
            }
            const reply = modelResult?.message?.content;
            if (typeof reply !== 'string' || !reply.trim()) {
              res.statusCode = 502;
              res.end(JSON.stringify({ error: 'The Ollama model returned an empty response.' }));
              return;
            }
            res.statusCode = 200;
            const sources: Record<string, string[]> = {
              billing: ['company_policy.txt', 'faq_document.txt'], sales: ['pricing_guide.txt', 'faq_document.txt'],
              technical: ['technical_manual.txt', 'faq_document.txt'], account: ['company_policy.txt', 'faq_document.txt'], general: ['faq_document.txt']
            };
            res.end(JSON.stringify({ reply: reply.trim(), intent, needsApproval, approvalStatus: needsApproval ? 'pending' : null, ragCharacters, sources: sources[intent] || sources.general, provider: `Ollama · ${model}` }));
          } catch {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: `Could not reach Ollama at ${baseUrl}. Start Ollama and make sure the ${model} model is installed.` }));
          }
          })();
        });
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const model = env.OLLAMA_MODEL || process.env.OLLAMA_MODEL || 'qwen2.5:3b';
  const baseUrl = env.OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  return { plugins: [react(), localOllamaChat(model, baseUrl)] };
});
