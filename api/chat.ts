import type { VercelRequest, VercelResponse } from '@vercel/node';

const knowledge = [
  { type: 'billing', text: 'Refunds are reviewed within 5–7 business days. Subscription cancellation stops the next renewal; access remains through the current paid period. Billing disputes require supervisor approval.' },
  { type: 'sales', text: 'ABC offers Starter, Professional, and Enterprise plans. Enterprise includes priority support and custom onboarding. Contact sales for a tailored quote.' },
  { type: 'technical', text: 'For login or loading issues, refresh the page, clear the browser cache, and confirm the latest browser version. Include the error code and steps to reproduce when contacting technical support.' },
  { type: 'account', text: 'Account email changes require identity verification. Account closure requests are reviewed by a supervisor before they are completed.' },
  { type: 'general', text: 'Support is available Monday–Friday. We aim to respond to standard requests within one business day.' }
];
const highRisk = /refund|cancel(?:lation)?|close my account|account closure|compensation|escalat|manager/i;
const sourcesByIntent: Record<string, string[]> = {
  billing: ['company_policy.txt', 'faq_document.txt'],
  sales: ['pricing_guide.txt', 'faq_document.txt'],
  technical: ['technical_manual.txt', 'faq_document.txt'],
  account: ['company_policy.txt', 'faq_document.txt'],
  general: ['faq_document.txt']
};
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : [];
  if (!message || message.length > 2000) return res.status(400).json({ error: 'Enter a message under 2,000 characters.' });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI is not configured yet. Add OPENAI_API_KEY in the Vercel project environment variables.' });

  const intent = message.match(/refund|invoice|payment|bill|charge|subscription|price|plan|cost|purchase/i) ? 'billing'
    : message.match(/error|bug|broken|crash|technical|login|load|slow/i) ? 'technical'
    : message.match(/account|password|email|profile|sign in/i) ? 'account'
    : message.match(/price|plan|buy|purchase|sales|quote/i) ? 'sales' : 'general';
  const risk = highRisk.test(message);
  const context = knowledge.filter((entry) => entry.type === intent || entry.type === 'general').map((entry) => entry.text).join('\n');
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0.4, max_tokens: 450, messages: [
        { role: 'system', content: `You are a kind, concise customer support agent for ABC Technologies. Answer using this policy context; do not invent policy details. If a high-risk request is pending supervisor approval, acknowledge it and do not claim it is completed.\n\nPolicy context:\n${context}` },
        ...history.filter((item: any) => ['user', 'assistant'].includes(item?.role) && typeof item?.content === 'string').map((item: any) => ({ role: item.role, content: item.content.slice(0, 2000) })),
        { role: 'user', content: message }
      ] })
    });
    const data = await upstream.json();
    if (!upstream.ok) return res.status(502).json({ error: data?.error?.message || 'The AI provider could not complete the request.' });
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string') return res.status(502).json({ error: 'The AI provider returned an empty response.' });
    return res.status(200).json({ reply, intent, needsApproval: risk, approvalStatus: risk ? 'pending' : null, ragCharacters: context.length, sources: sourcesByIntent[intent] || sourcesByIntent.general, provider: model });
  } catch {
    return res.status(502).json({ error: 'Could not reach the AI provider. Try again in a moment.' });
  }
}
