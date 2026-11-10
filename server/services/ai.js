import Anthropic from '@anthropic-ai/sdk';
import { all, getSettings } from '../db.js';
import { config } from '../config.js';

// AI auto-replies with Claude. The API key comes from Settings → AI (or ANTHROPIC_API_KEY).
// Server-side refusal fallbacks are enabled ("default" routing), so a declined request is
// retried on a suitable model inside the same call instead of leaving the customer unanswered.

let cached = { key: null, client: null };
function client(apiKey) {
  if (cached.key !== apiKey) cached = { key: apiKey, client: new Anthropic({ apiKey, maxRetries: 2, timeout: 60000 }) };
  return cached.client;
}

export function aiConfig() {
  const s = getSettings('ai');
  return { ...s, apiKey: s.apiKey || config.anthropicKey };
}

function buildSystem(s, businessName) {
  const parts = [
    s.persona,
    `Business name: ${businessName}.`,
    'You are replying inside WhatsApp. Use plain text (WhatsApp supports *bold* and _italic_), no markdown headings or tables.',
    'Never invent prices, order numbers, dates or policies that are not in the knowledge base. If the customer asks for something you cannot answer or wants a human, reply that a team member will get back to them shortly.',
  ];
  if (s.knowledge?.trim()) parts.push(`Knowledge base:\n${s.knowledge.trim()}`);
  return parts.join('\n\n');
}

// Turn the stored conversation into alternating user/assistant turns (the API needs the first to be user).
function historyFor(conversationId, limit = 16) {
  const rows = all(
    `SELECT direction, type, body FROM messages
      WHERE conversation_id = ? AND status != 'failed'
      ORDER BY id DESC LIMIT ?`,
    conversationId,
    limit,
  ).reverse();
  const turns = [];
  for (const r of rows) {
    const role = r.direction === 'in' ? 'user' : 'assistant';
    const text = (r.body && r.body.trim()) || `[${r.type}]`;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n${text}`;
    else turns.push({ role, content: text });
  }
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

export async function generateReply({ conversationId, messages: directMessages, overrides = {} }) {
  const s = { ...aiConfig(), ...overrides };
  if (!s.apiKey) throw Object.assign(new Error('Add your Anthropic API key in Settings → AI assistant.'), { status: 400 });
  const general = getSettings('general');
  const messages = directMessages || historyFor(conversationId);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return null;

  try {
    const response = await client(s.apiKey).beta.messages.create({
      model: s.model || 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: s.effort || 'low' },
      system: buildSystem(s, general.businessName),
      messages,
    });
    if (response.stop_reason === 'refusal') return null;
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return text || null;
  } catch (e) {
    let reason = e?.message || 'AI request failed';
    if (e instanceof Anthropic.AuthenticationError) reason = 'Anthropic API key is invalid.';
    else if (e instanceof Anthropic.RateLimitError) reason = 'Anthropic rate limit reached — try again shortly.';
    else if (e instanceof Anthropic.BadRequestError) reason = `AI request rejected: ${e.message}`;
    else if (e instanceof Anthropic.APIConnectionError) reason = 'Could not reach the Anthropic API.';
    throw Object.assign(new Error(reason), { status: e?.status || 502 });
  }
}
