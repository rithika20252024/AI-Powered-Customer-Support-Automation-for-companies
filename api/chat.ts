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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI is not configured yet. Add GEMINI_API_KEY in the Vercel project environment variables.' });

  const intent = message.match(/price|plan|buy|purchase|sales|quote|cost/i) ? 'sales'
    : message.match(/refund|invoice|payment|bill|charge|subscription/i) ? 'billing'
    : message.match(/error|bug|broken|crash|technical|login|load|slow|upload/i) ? 'technical'
    : message.match(/account|password|email|profile|sign in/i) ? 'account'
    : 'general';
  const risk = highRisk.test(message);
  const context = knowledge.filter((entry) => entry.type === intent || entry.type === 'general').map((entry) => entry.text).join('\n');
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  try {
    const validHistory = history.filter((item: any) => ['user', 'assistant'].includes(item?.role) && typeof item?.content === 'string');
    const firstUser = validHistory.findIndex((item: any) => item.role === 'user');
    const apiHistory = (firstUser < 0 ? [] : validHistory.slice(firstUser))
      .map((item: any) => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content.slice(0, 2000) }] }));
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `You are a kind, concise customer support agent for ABC Technologies. Answer using this policy context; do not invent policy details. If a high-risk request is pending supervisor approval, acknowledge it and do not claim it is completed.\n\nPolicy context:\n${context}` }] },
        contents: [...apiHistory, { role: 'user', parts: [{ text: message }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 450 }
      })
    });
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) return res.status(502).json({ error: data?.error?.message || 'Gemini could not complete the request.' });
    const reply = data?.candidates?.[0]?.content?.parts?.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('');
    if (typeof reply !== 'string') return res.status(502).json({ error: 'The AI provider returned an empty response.' });
    return res.status(200).json({ reply, intent, needsApproval: risk, approvalStatus: risk ? 'pending' : null, ragCharacters: context.length, sources: sourcesByIntent[intent] || sourcesByIntent.general, provider: `Gemini · ${model}` });
  } catch {
    return res.status(502).json({ error: 'Could not reach the AI provider. Try again in a moment.' });
  }
}
