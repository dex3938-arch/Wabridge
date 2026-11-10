import { useEffect, useState } from 'react';
import { Bot, Plus, Pencil, Trash2, Sparkles, Zap, Hand, Moon, MessageCircle, FlaskConical, Send, Clock3, KeyRound, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useLoad, useToast, useAuth } from '../lib/app.jsx';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Tabs, Textarea, Toggle, useConfirm, Spinner, Callout, cx } from '../components/ui.jsx';
import { num, timeAgo } from '../lib/format.js';

const TRIGGERS = {
  keyword: { label: 'Keyword', icon: KeyRound, tone: 'brand', help: 'Replies when the message contains one of your keywords.' },
  welcome: { label: 'Welcome', icon: Hand, tone: 'green', help: 'Replies to the very first message from a new contact.' },
  away: { label: 'Away', icon: Moon, tone: 'violet', help: 'Replies outside business hours (set them in the Business hours tab).' },
  any: { label: 'Catch-all', icon: MessageCircle, tone: 'slate', help: 'Replies to any message no other rule handled. Put it last (high priority number).' },
};
const blank = { name: '', trigger: 'keyword', matchType: 'contains', keywords: '', replyType: 'text', replyBody: '', addTag: '', priority: 100, cooldownMinutes: 60, includeGroups: false, sessionId: '', enabled: true };

function RuleModal({ rule, numbers, onClose, onSaved }) {
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!rule) return;
    if (rule === 'new') setF(blank);
    else
      setF({
        name: rule.name, trigger: rule.trigger_type, matchType: rule.match_type, keywords: rule.keywords, replyType: rule.reply_type, replyBody: rule.reply_body || '',
        addTag: rule.add_tag || '', priority: rule.priority, cooldownMinutes: rule.cooldown_minutes, includeGroups: Boolean(rule.include_groups), sessionId: rule.session_id || '', enabled: Boolean(rule.enabled),
      });
  }, [rule]);
  const save = async () => {
    setBusy(true);
    try {
      if (rule === 'new') await api.post('/api/automations', f);
      else await api.put(`/api/automations/${rule.id}`, f);
      toast('Rule saved');
      onSaved();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={Boolean(rule)} onClose={onClose} title={rule === 'new' ? 'New automation rule' : 'Edit rule'} icon={Zap} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save rule</Button></>}>
      <div className="space-y-5">
        <Field label="Rule name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Price enquiry" /></Field>
        <div>
          <p className="label">When</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(TRIGGERS).map(([k, t]) => (
              <button key={k} onClick={() => setF({ ...f, trigger: k })} className={cx('rounded-xl border-2 p-3 text-left transition', f.trigger === k ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-slate-200 dark:border-ink-700')}>
                <t.icon className="size-4 text-brand-600" />
                <p className="mt-1.5 text-sm font-bold">{t.label}</p>
              </button>
            ))}
          </div>
          <p className="hint">{TRIGGERS[f.trigger].help}</p>
        </div>
        {f.trigger === 'keyword' && (
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <Field label="Match">
              <Select value={f.matchType} onChange={(e) => setF({ ...f, matchType: e.target.value })}>
                <option value="contains">Contains word</option>
                <option value="exact">Exact message</option>
                <option value="starts">Starts with</option>
                <option value="regex">Regex</option>
              </Select>
            </Field>
            <Field label="Keywords" hint={f.matchType === 'regex' ? 'A JavaScript regular expression (case-insensitive).' : 'Comma separated. Hindi/Hinglish works too: price, rate, kitna, daam'}>
              <Input value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} placeholder="price, rate, kitna" />
            </Field>
          </div>
        )}
        <div>
          <p className="label">Reply with</p>
          <Tabs value={f.replyType} onChange={(v) => setF({ ...f, replyType: v })} tabs={[{ value: 'text', label: 'Fixed message', icon: MessageCircle }, { value: 'ai', label: 'AI answer', icon: Sparkles }]} />
          {f.replyType === 'text' ? (
            <Textarea value={f.replyBody} onChange={(e) => setF({ ...f, replyBody: e.target.value })} className="mt-3 min-h-28" placeholder={'Hi {{first_name}}! Our price list: …'} />
          ) : (
            <p className="mt-3 rounded-xl bg-violet-50 p-3 text-sm text-violet-800 dark:bg-violet-500/10 dark:text-violet-200">Claude writes the reply using your persona and knowledge base (AI assistant tab).</p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Add tag to contact" hint="Optional"><Input value={f.addTag} onChange={(e) => setF({ ...f, addTag: e.target.value })} placeholder="price-lead" /></Field>
          <Field label="Cooldown (minutes)" hint="Per chat, avoids repeats"><Input type="number" value={f.cooldownMinutes} onChange={(e) => setF({ ...f, cooldownMinutes: e.target.value })} /></Field>
          <Field label="Priority" hint="Lower runs first"><Input type="number" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Only for number">
            <Select value={f.sessionId} onChange={(e) => setF({ ...f, sessionId: e.target.value })}>
              <option value="">All numbers</option>
              {numbers.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </Select>
          </Field>
          <div className="pt-7"><Toggle checked={f.includeGroups} onChange={(v) => setF({ ...f, includeGroups: v })} label="Also reply in groups" /></div>
        </div>
      </div>
    </Modal>
  );
}

function Simulator() {
  const [text, setText] = useState('');
  const [first, setFirst] = useState(false);
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setOut(await api.post('/api/automations/simulate', { text, firstMessage: first }));
    } catch (e) {
      setOut({ matched: null, reply: `⚠️ ${e.message}` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Test your automations" description="Type what a customer might send — nothing is sent." icon={FlaskConical} />
      <div className="space-y-3 p-5">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Hi, what is the price?" className="min-h-20" />
        <div className="flex items-center justify-between gap-3">
          <Toggle checked={first} onChange={setFirst} label="First message from contact" />
          <Button size="sm" icon={Send} onClick={run} loading={busy} disabled={!text.trim()}>Test</Button>
        </div>
        {out && (
          <div className="rounded-2xl bg-slate-50 p-4 text-sm dark:bg-ink-850">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{out.matched ? `Matched: ${out.matched.name}` : 'No rule matched'}</p>
            {out.reply && <p className="mt-2 whitespace-pre-wrap">{out.reply}</p>}
          </div>
        )}
      </div>
    </Card>
  );
}

function AiTab() {
  const { data, reload } = useLoad(() => api.get('/api/settings'), []);
  const [ai, setAi] = useState(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState('');
  const [reply, setReply] = useState('');
  const [testing, setTesting] = useState(false);
  const toast = useToast();
  const { user } = useAuth();
  useEffect(() => {
    if (data) setAi(data.ai);
  }, [data]);
  if (!ai) return <div className="flex justify-center py-12"><Spinner /></div>;
  const save = async () => {
    setBusy(true);
    try {
      await api.put('/api/settings/ai', ai);
      toast('AI settings saved');
      reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const runTest = async () => {
    setTesting(true);
    setReply('');
    try {
      const out = await api.post('/api/ai/test', { text: test, overrides: { persona: ai.persona, knowledge: ai.knowledge, model: ai.model, effort: ai.effort } });
      setReply(out.reply);
    } catch (e) {
      setReply(`⚠️ ${e.message}`);
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <Card>
        <CardHeader title="AI assistant (Claude)" description="Answers customers when no rule matches, using your knowledge base." icon={Sparkles}
          action={<Toggle checked={ai.enabled} onChange={(v) => setAi({ ...ai, enabled: v })} />} />
        <div className="space-y-5 p-5">
          <Field label="Anthropic API key" hint={ai.apiKeyFromEnv ? 'Using ANTHROPIC_API_KEY from the server .env file.' : 'Get one at console.anthropic.com → API keys. Stored only in your local database.'}>
            <Input type="password" value={ai.apiKey} onChange={(e) => setAi({ ...ai, apiKey: e.target.value })} placeholder={ai.apiKeySet ? 'Saved — type to replace' : 'sk-ant-…'} disabled={user?.role !== 'admin'} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Model">
              <Select value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })}>
                <option value="claude-opus-5-5">Claude Opus 5.5 (best quality)</option>
                <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (fast, lower cost)</option>
                <option value="claude-haiku-5-5">Claude Haiku 5.5 (fastest, cheapest)</option>
              </Select>
            </Field>
            <Field label="Thinking effort" hint="Low is right for chat replies.">
              <Select value={ai.effort} onChange={(e) => setAi({ ...ai, effort: e.target.value })}>
                <option value="low">Low (fast)</option>
                <option value="medium">Medium</option>
                <option value="high">High (careful)</option>
              </Select>
            </Field>
          </div>
          <Field label="Persona & instructions"><Textarea value={ai.persona} onChange={(e) => setAi({ ...ai, persona: e.target.value })} className="min-h-28" /></Field>
          <Field label="Knowledge base" hint="Prices, services, timings, address, policies, FAQs — the AI only uses what is written here.">
            <Textarea value={ai.knowledge} onChange={(e) => setAi({ ...ai, knowledge: e.target.value })} className="min-h-48 font-mono text-[13px]" placeholder={'Business hours: Mon–Sat 10am–7pm\nWebsite design: from ₹15,000\nSEO plans: ₹8,000/month\nAddress: …'} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hand-off keywords" hint="Pauses the bot and flags the chat for a person."><Input value={ai.handoffKeywords} onChange={(e) => setAi({ ...ai, handoffKeywords: e.target.value })} /></Field>
            <Field label="Max AI replies per chat per hour"><Input type="number" value={ai.maxPerHour} onChange={(e) => setAi({ ...ai, maxPerHour: Number(e.target.value) })} /></Field>
          </div>
          <div className="flex justify-end"><Button onClick={save} loading={busy}>Save AI settings</Button></div>
        </div>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Try it" description="Uses the settings on the left (unsaved changes too)." icon={FlaskConical} />
          <div className="space-y-3 p-5">
            <Textarea value={test} onChange={(e) => setTest(e.target.value)} placeholder="Bhai website banane ka kitna lagega?" className="min-h-20" />
            <Button size="sm" icon={Sparkles} onClick={runTest} loading={testing} disabled={!test.trim()}>Ask AI</Button>
            {reply && <div className="rounded-2xl bg-violet-50 p-4 text-sm whitespace-pre-wrap text-violet-950 dark:bg-violet-500/10 dark:text-violet-100">{reply}</div>}
          </div>
        </Card>
        <Callout tone="brand" icon={ShieldCheck}>
          The AI never runs in group chats, stops when a team member replies (human takeover), and refusals fall back automatically to another Claude model so customers are not left without an answer.
        </Callout>
      </div>
    </div>
  );
}

function HoursTab() {
  const { data, reload } = useLoad(() => api.get('/api/settings'), []);
  const [bh, setBh] = useState(null);
  const [tz, setTz] = useState('');
  const toast = useToast();
  useEffect(() => {
    if (data) {
      setBh(data.businessHours);
      setTz(data.general.timezone);
    }
  }, [data]);
  if (!bh) return <div className="flex justify-center py-12"><Spinner /></div>;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const save = async () => {
    try {
      await api.put('/api/settings/businessHours', bh);
      await api.put('/api/settings/general', { timezone: tz });
      toast('Business hours saved');
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Business hours" description="Used by “Away” rules and shown to your team." icon={Clock3} action={<Toggle checked={bh.enabled} onChange={(v) => setBh({ ...bh, enabled: v })} />} />
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap gap-2">
          {days.map((d, i) => {
            const on = bh.days.includes(i);
            return (
              <button key={d} onClick={() => setBh({ ...bh, days: on ? bh.days.filter((x) => x !== i) : [...bh.days, i].sort() })}
                className={cx('size-12 rounded-xl text-sm font-bold ring-1 transition', on ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-500 ring-slate-200 dark:bg-ink-850 dark:ring-ink-600')}>{d}</button>
            );
          })}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Opens"><Input type="time" value={bh.start} onChange={(e) => setBh({ ...bh, start: e.target.value })} /></Field>
          <Field label="Closes"><Input type="time" value={bh.end} onChange={(e) => setBh({ ...bh, end: e.target.value })} /></Field>
          <Field label="Time zone"><Input value={tz} onChange={(e) => setTz(e.target.value)} placeholder="Asia/Kolkata" /></Field>
        </div>
        <div className="flex justify-end"><Button onClick={save}>Save hours</Button></div>
      </div>
    </Card>
  );
}

export default function Automations() {
  const [tab, setTab] = useState('rules');
  const { data, loading, reload } = useLoad(() => api.get('/api/automations'), []);
  const numbers = useLoad(() => api.get('/api/numbers'), []);
  const [editing, setEditing] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();
  const rules = data?.automations || [];

  const toggle = async (r) => {
    await api.put(`/api/automations/${r.id}`, { enabled: !r.enabled });
    reload();
  };
  const remove = async (r) => {
    if (!(await confirm({ title: `Delete “${r.name}”?`, danger: true, confirmLabel: 'Delete' }))) return;
    await api.del(`/api/automations/${r.id}`);
    toast('Rule deleted');
    reload();
  };
  const starter = async () => {
    const presets = [
      { name: 'Welcome message', trigger: 'welcome', replyBody: 'Hi {{first_name}} 👋 Thanks for messaging {{business}}! How can we help you today?', priority: 10, cooldownMinutes: 0 },
      { name: 'Price enquiry', trigger: 'keyword', keywords: 'price, rate, cost, kitna, charges', replyBody: 'Thanks for asking! Our team will share the latest prices shortly. Meanwhile, tell us what you need 🙂', priority: 50, cooldownMinutes: 120, addTag: 'price-lead' },
      { name: 'Away message', trigger: 'away', replyBody: 'We are closed right now 🌙 We will reply first thing when we open.', priority: 20, cooldownMinutes: 720, enabled: false },
    ];
    try {
      for (const p of presets) await api.post('/api/automations', { ...blank, ...p });
      toast('Starter rules added');
    } catch (e) {
      toast(e.message, 'error');
    }
    reload();
  };

  return (
    <div>
      <PageHeader eyebrow="Automate" title="Automations & AI" description="Reply instantly, 24×7: keyword rules, welcome and away messages, and an AI assistant trained on your business."
        actions={tab === 'rules' && <Button icon={Plus} onClick={() => setEditing('new')}>New rule</Button>} />
      <Tabs className="mb-6" value={tab} onChange={setTab} tabs={[{ value: 'rules', label: 'Rules', icon: Zap, count: rules.length }, { value: 'ai', label: 'AI assistant', icon: Sparkles }, { value: 'hours', label: 'Business hours', icon: Clock3 }]} />
      {tab === 'rules' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-3">
            {loading && !data ? (
              <div className="flex justify-center py-16"><Spinner /></div>
            ) : rules.length === 0 ? (
              <Card>
                <EmptyState icon={Bot} title="No rules yet" description="Start with a welcome message, a price auto-reply and an away message — you can edit them after."
                  action={<div className="flex gap-2"><Button variant="secondary" onClick={starter}>Add starter rules</Button><Button icon={Plus} onClick={() => setEditing('new')}>New rule</Button></div>} />
              </Card>
            ) : (
              rules.map((r) => {
                const t = TRIGGERS[r.trigger_type] || TRIGGERS.keyword;
                return (
                  <Card key={r.id} className={cx('p-4', !r.enabled && 'opacity-60')}>
                    <div className="flex items-start gap-4">
                      <Toggle checked={Boolean(r.enabled)} onChange={() => toggle(r)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-bold">{r.name}</p>
                          <Badge tone={t.tone}><t.icon className="size-3" /> {t.label}</Badge>
                          {r.reply_type === 'ai' && <Badge tone="violet"><Sparkles className="size-3" /> AI</Badge>}
                          <span className="text-xs text-slate-400">priority {r.priority}</span>
                        </div>
                        {r.trigger_type === 'keyword' && <p className="mt-1 text-xs text-slate-500">{r.match_type === 'regex' ? 'regex' : r.match_type}: <span className="font-mono">{r.keywords}</span></p>}
                        {r.reply_body && r.reply_type !== 'ai' && <p className="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{r.reply_body}</p>}
                        <p className="mt-2 text-xs text-slate-400">{num(r.hits)} replies sent{r.last_hit_at ? ` · last ${timeAgo(r.last_hit_at)}` : ''}{r.add_tag ? ` · tags “${r.add_tag}”` : ''}</p>
                      </div>
                      <div className="flex gap-0.5">
                        <Button size="iconSm" variant="ghost" onClick={() => setEditing(r)}><Pencil className="size-4" /></Button>
                        <Button size="iconSm" variant="ghost" onClick={() => remove(r)}><Trash2 className="size-4 text-rose-500" /></Button>
                      </div>
                    </div>
                  </Card>
                );
              })
            )}
            <Callout tone="brand" icon={ShieldCheck}>
              Order of checks for every incoming message: <b>opt-out / opt-in words</b> → <b>human takeover</b> (a person replied recently) → <b>rules by priority</b> → <b>AI assistant</b>.
            </Callout>
          </div>
          <Simulator />
        </div>
      )}
      {tab === 'ai' && <AiTab />}
      {tab === 'hours' && <HoursTab />}
      <RuleModal rule={editing} numbers={(numbers.data?.numbers || []).filter((n) => n.channel === 'openwa')} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
    </div>
  );
}
