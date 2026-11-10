import { all, get, run, nowIso, getSettings, logActivity, parseJson } from '../db.js';
import { engine } from './openwa.js';
import { META_SESSION } from './meta.js';
import { broadcast } from './events.js';
import { emitOutbound } from './outbound.js';
import { sendMessage, conversationView, upsertContact } from './messaging.js';
import { generateReply, aiConfig } from './ai.js';
import { personalise, splitList, isBusinessOpen, randomBetween, sleep } from './text.js';

// Runs on every inbound message: opt-out/opt-in keywords → human takeover → rules → AI fallback.
// One queue per conversation so a burst of messages never produces overlapping bot replies.
const queues = new Map();

export function handleInbound(conv, message) {
  const prev = queues.get(conv.id) || Promise.resolve();
  const next = prev
    .then(() => runAutomation(conv.id, message))
    .catch((e) => logActivity('automation.error', `Automation failed: ${e.message}`, { level: 'error' }));
  queues.set(conv.id, next);
  next.finally(() => {
    if (queues.get(conv.id) === next) queues.delete(conv.id);
  });
  return next;
}

const norm = (s) => String(s || '').trim().toLowerCase();

export function matches(rule, text) {
  const body = norm(text);
  if (!body) return false;
  const words = splitList(rule.keywords).map(norm);
  if (rule.match_type === 'regex') {
    try {
      return new RegExp(rule.keywords, 'i').test(text);
    } catch {
      return false;
    }
  }
  return words.some((w) => {
    if (!w) return false;
    if (rule.match_type === 'exact') return body === w;
    if (rule.match_type === 'starts') return body.startsWith(w);
    return new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(body);
  });
}

function inCooldown(rule, convId) {
  if (!rule.cooldown_minutes) return false;
  const hit = get('SELECT hit_at FROM automation_hits WHERE automation_id = ? AND conversation_id = ?', rule.id, convId);
  if (!hit) return false;
  return Date.now() - Date.parse(hit.hit_at) < rule.cooldown_minutes * 60000;
}

function markHit(rule, convId) {
  const now = nowIso();
  run(
    'INSERT INTO automation_hits(automation_id, conversation_id, hit_at) VALUES(?, ?, ?) ON CONFLICT DO UPDATE SET hit_at = excluded.hit_at',
    rule.id,
    convId,
    now,
  );
  run('UPDATE automations SET hits = hits + 1, last_hit_at = ? WHERE id = ?', now, rule.id);
}

function addTag(phone, tag) {
  if (!phone || !tag) return;
  const c = get('SELECT id, tags FROM contacts WHERE phone = ?', phone);
  if (!c) return;
  const tags = new Set(parseJson(c.tags, []));
  tags.add(tag);
  run('UPDATE contacts SET tags = ? WHERE id = ?', JSON.stringify([...tags]), c.id);
}

async function reply(conv, text, author) {
  if (!text) return;
  const safety = getSettings('safety');
  if (conv.session_id !== META_SESSION) {
    engine.typing(conv.session_id, conv.chat_id, 'typing').catch(() => {});
  }
  await sleep(randomBetween(safety.replyDelayMin, safety.replyDelayMax) * 1000);
  await sendMessage({ sessionId: conv.session_id, chatId: conv.chat_id, text, author });
}

async function runAutomation(convId, message) {
  const conv = get('SELECT * FROM conversations WHERE id = ?', convId);
  if (!conv || message.direction !== 'in') return;
  const text = message.body || '';
  const safety = getSettings('safety');
  const contact = conv.phone ? upsertContact(conv.phone, conv.name) : null;
  const vars = contact ? { ...contact, fields: parseJson(contact.fields, {}) } : { name: conv.name };

  // 1) consent keywords
  const body = norm(text);
  if (!conv.is_group && contact) {
    if (splitList(safety.optOutKeywords).map(norm).includes(body)) {
      run('UPDATE contacts SET opted_out = 1, opted_in = 0 WHERE id = ?', contact.id);
      logActivity('contact.opted_out', `${contact.name || contact.phone} unsubscribed`, { meta: { phone: contact.phone } });
      emitOutbound('contact.opted_out', { phone: contact.phone, name: contact.name });
      await reply(conv, safety.optOutReply, 'bot');
      return;
    }
    if (splitList(safety.optInKeywords).map(norm).includes(body)) {
      run('UPDATE contacts SET opted_out = 0, opted_in = 1 WHERE id = ?', contact.id);
      logActivity('contact.opted_in', `${contact.name || contact.phone} subscribed`, { meta: { phone: contact.phone } });
      emitOutbound('contact.opted_in', { phone: contact.phone, name: contact.name });
      await reply(conv, safety.optInReply, 'bot');
      return;
    }
  }

  // 2) a person is handling this chat
  if (conv.bot_paused) return;
  if (
    conv.last_human_reply_at &&
    Date.now() - Date.parse(conv.last_human_reply_at) < (Number(safety.humanTakeoverMinutes) || 0) * 60000
  ) {
    return;
  }

  // 3) rules (highest priority = lowest number)
  const inboundCount = get(
    "SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND direction = 'in'",
    conv.id,
  ).n;
  const rules = all(
    `SELECT * FROM automations WHERE enabled = 1 AND (session_id IS NULL OR session_id = '' OR session_id = ?)
      ORDER BY priority ASC, id ASC`,
    conv.session_id,
  );
  for (const rule of rules) {
    if (conv.is_group && !rule.include_groups) continue;
    let hit = false;
    if (rule.trigger_type === 'welcome') hit = inboundCount <= 1;
    else if (rule.trigger_type === 'keyword') hit = matches(rule, text);
    else if (rule.trigger_type === 'away') hit = !isBusinessOpen();
    else if (rule.trigger_type === 'any') hit = true;
    if (!hit || inCooldown(rule, conv.id)) continue;

    markHit(rule, conv.id);
    if (rule.add_tag) addTag(conv.phone, rule.add_tag);
    if (rule.reply_type === 'ai') {
      const ai = await generateReply({ conversationId: conv.id }).catch((e) => {
        logActivity('ai.error', e.message, { level: 'warn' });
        return null;
      });
      await reply(conv, ai, 'ai');
    } else {
      await reply(conv, personalise(rule.reply_body, vars), 'bot');
    }
    return;
  }

  // 4) AI fallback
  const ai = aiConfig();
  if (!ai.enabled || !ai.apiKey || conv.is_group) return;
  if (splitList(ai.handoffKeywords).map(norm).some((k) => k && body.includes(k))) {
    run("UPDATE conversations SET bot_paused = 1, status = 'pending' WHERE id = ?", conv.id);
    broadcast('conversation', conversationView(conv.id));
    logActivity('handoff', `${conv.name || conv.phone} asked for a human`, { level: 'warn', meta: { conversationId: conv.id } });
    await reply(conv, 'Sure — connecting you with our team. Someone will reply here shortly. 🙏', 'bot');
    return;
  }
  const recentAi = get(
    `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND author = 'ai'
       AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')`,
    conv.id,
  ).n;
  if (recentAi >= (Number(ai.maxPerHour) || 30)) return;
  const answer = await generateReply({ conversationId: conv.id }).catch((e) => {
    logActivity('ai.error', e.message, { level: 'warn' });
    return null;
  });
  await reply(conv, answer, 'ai');
}
