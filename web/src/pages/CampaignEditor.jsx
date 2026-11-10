import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Users, MessageSquareText, ShieldCheck, Rocket, Smartphone, BadgeCheck, Paperclip, X, Send, Clock, Save, Braces, AlertTriangle } from 'lucide-react';
import { api, fileToBase64, mediaKindFor } from '../lib/api.js';
import { useToast } from '../lib/app.jsx';
import { Button, Card, Field, Input, Select, Textarea, Toggle, Callout, Spinner, cx } from '../components/ui.jsx';
import { WhatsAppPreview, VARIABLES } from './Templates.jsx';
import { num } from '../lib/format.js';

const STEPS = [
  { key: 'basics', label: 'Sender', icon: Smartphone },
  { key: 'audience', label: 'Audience', icon: Users },
  { key: 'message', label: 'Message', icon: MessageSquareText },
  { key: 'safety', label: 'Safety', icon: ShieldCheck },
  { key: 'review', label: 'Launch', icon: Rocket },
];

const blank = {
  name: '',
  channel: 'openwa',
  sessionId: '',
  body: '',
  media: null,
  metaTemplate: { name: '', language: 'en', params: [] },
  audience: { all: false, tags: [], match: 'any', phones: [] },
  requireOptIn: true,
  minDelay: 25,
  maxDelay: 70,
  dailyCap: 80,
  quietStart: '21:00',
  quietEnd: '09:00',
  stopAfterFailures: 5,
};

export default function CampaignEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(blank);
  const [campaignId, setCampaignId] = useState(id ? Number(id) : null);
  const [numbers, setNumbers] = useState([]);
  const [tags, setTags] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [metaTemplates, setMetaTemplates] = useState(null);
  const [preview, setPreview] = useState(null);
  const [rendered, setRendered] = useState('');
  const [pasted, setPasted] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    api.get('/api/numbers').then((d) => {
      setNumbers(d.numbers);
      setForm((f) => (f.sessionId ? f : { ...f, sessionId: d.numbers.find((n) => n.channel === 'openwa' && n.status === 'ready')?.id || '' }));
    });
    api.get('/api/contacts/tags').then((d) => setTags(d.tags));
    api.get('/api/templates').then((d) => setTemplates(d.templates));
    api.get('/api/settings').then((s) =>
      setForm((f) => (id ? f : { ...f, minDelay: s.safety.defaultMinDelay, maxDelay: s.safety.defaultMaxDelay, dailyCap: s.safety.defaultDailyCap })),
    );
    if (id) {
      api.get(`/api/campaigns/${id}`).then(({ campaign: c }) => {
        setForm({
          name: c.name,
          channel: c.channel,
          sessionId: c.session_id || '',
          body: c.body || '',
          media: c.media,
          metaTemplate: c.meta_template || blank.metaTemplate,
          audience: { ...blank.audience, ...c.audience },
          requireOptIn: Boolean(c.require_opt_in),
          minDelay: c.min_delay,
          maxDelay: c.max_delay,
          dailyCap: c.daily_cap,
          quietStart: c.quiet_start || '',
          quietEnd: c.quiet_end || '',
          stopAfterFailures: c.stop_after_failures,
        });
        setPasted((c.audience?.phones || []).join('\n'));
        setLoading(false);
      });
    }
  }, [id]);

  const metaEnabled = numbers.some((n) => n.channel === 'meta');
  useEffect(() => {
    if (form.channel === 'meta' && metaTemplates === null) {
      api.get('/api/integrations/meta/templates').then((d) => setMetaTemplates(d.templates)).catch((e) => { setMetaTemplates([]); toast(e.message, 'error'); });
    }
  }, [form.channel, metaTemplates, toast]);

  const audience = useMemo(() => ({ ...form.audience, phones: pasted.split(/\n/).map((x) => x.trim()).filter(Boolean) }), [form.audience, pasted]);
  useEffect(() => {
    const t = setTimeout(() => api.post('/api/campaigns/audience-preview', { audience, requireOptIn: form.requireOptIn }).then(setPreview).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [audience, form.requireOptIn]);
  useEffect(() => {
    const t = setTimeout(() => api.post('/api/templates/preview', { body: form.body }).then((d) => setRendered(d.text)).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [form.body]);

  const payload = () => ({ ...form, audience, sessionId: form.channel === 'meta' ? 'meta-cloud' : form.sessionId });
  const save = async (quiet) => {
    const body = payload();
    if (body.media?.path && !body.media.base64) delete body.media; // already stored server-side
    const out = campaignId ? await api.patch(`/api/campaigns/${campaignId}`, body) : await api.post('/api/campaigns', body);
    setCampaignId(out.campaign.id);
    setForm((f) => ({ ...f, media: out.campaign.media }));
    if (!quiet) toast('Draft saved');
    return out.campaign.id;
  };

  const next = async () => {
    if (step === 0 && !form.name.trim()) return toast('Give the campaign a name.', 'error');
    if (step === 0 && form.channel === 'openwa' && !form.sessionId) return toast('Choose the number to send from.', 'error');
    if (step === 1 && !preview?.willSend) return toast('The audience is empty — pick tags, all contacts, or paste numbers.', 'error');
    if (step === 2 && form.channel === 'openwa' && !form.body.trim()) return toast('Write your message.', 'error');
    if (step === 2 && form.channel === 'meta' && !form.metaTemplate.name) return toast('Choose an approved template.', 'error');
    try {
      await save(true);
      setStep((s) => Math.min(STEPS.length - 1, s + 1));
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const attach = async (file) => {
    if (file.size > 16 * 1024 * 1024) return toast('Files up to 16 MB only.', 'error');
    set({ media: { kind: mediaKindFor(file.type), base64: await fileToBase64(file), mimetype: file.type, filename: file.name } });
  };

  const sendTest = async () => {
    setBusy(true);
    try {
      const cid = await save(true);
      await api.post(`/api/campaigns/${cid}/test`, { phone: testPhone });
      toast('Test message sent');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const launch = async () => {
    setBusy(true);
    try {
      const cid = await save(true);
      await api.post(`/api/campaigns/${cid}/launch`, { scheduleAt: scheduleAt ? new Date(scheduleAt).toISOString() : undefined });
      toast(scheduleAt ? 'Campaign scheduled' : 'Campaign started 🚀');
      navigate(`/campaigns/${cid}`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const avg = (Number(form.minDelay) + Number(form.maxDelay)) / 2;
  const sendable = preview?.willSend || 0;
  const perDay = Math.min(Number(form.dailyCap) || 1, sendable);
  const days = sendable ? Math.ceil(sendable / (Number(form.dailyCap) || 1)) : 0;
  const hoursPerDay = (perDay * avg) / 3600;
  const metaSelected = (metaTemplates || []).find((t) => t.name === form.metaTemplate.name && t.language === form.metaTemplate.language);
  const metaBody = metaSelected?.components?.find((c) => c.type === 'BODY')?.text || '';
  const metaParamCount = (metaBody.match(/\{\{\d+\}\}/g) || []).length;

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  return (
    <div className="mx-auto max-w-5xl">
      <button onClick={() => navigate('/campaigns')} className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white"><ArrowLeft className="size-4" /> Campaigns</button>
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">{id ? 'Edit campaign' : 'New campaign'}</h1>

      <ol className="mt-6 mb-6 grid grid-cols-5 gap-2">
        {STEPS.map((s, i) => (
          <li key={s.key}>
            <button onClick={() => i < step && setStep(i)} className={cx('flex w-full flex-col items-start gap-1.5 rounded-xl border-t-[3px] pt-2.5 text-left', i <= step ? 'border-brand-500' : 'border-slate-200 dark:border-ink-700')}>
              <span className={cx('flex items-center gap-1.5 text-xs font-bold', i === step ? 'text-brand-600 dark:text-brand-400' : i < step ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400')}>
                <s.icon className="size-3.5" /> <span className="hidden sm:inline">{s.label}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <Card className="p-6">
        {step === 0 && (
          <div className="space-y-6">
            <Field label="Campaign name"><Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Diwali offer 2026" autoFocus /></Field>
            <div>
              <p className="label">Send through</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { v: 'openwa', icon: Smartphone, t: 'Linked WhatsApp number', d: 'Free-form text & media from a QR-linked number. Best for opted-in customers.' },
                  { v: 'meta', icon: BadgeCheck, t: 'Official Cloud API (Meta)', d: metaEnabled ? 'Approved templates only. Safest for large marketing sends.' : 'Set up in Integrations → Official API first.', disabled: !metaEnabled },
                ].map((o) => (
                  <button key={o.v} disabled={o.disabled} onClick={() => set({ channel: o.v })}
                    className={cx('rounded-2xl border-2 p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50', form.channel === o.v ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10' : 'border-slate-200 hover:border-slate-300 dark:border-ink-700')}>
                    <o.icon className="size-5 text-brand-600" />
                    <p className="mt-2 font-bold">{o.t}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{o.d}</p>
                  </button>
                ))}
              </div>
            </div>
            {form.channel === 'openwa' && (
              <Field label="Number to send from">
                <Select value={form.sessionId} onChange={(e) => set({ sessionId: e.target.value })}>
                  <option value="">Choose…</option>
                  {numbers.filter((n) => n.channel === 'openwa').map((n) => <option key={n.id} value={n.id}>{n.label}{n.status !== 'ready' ? ' (not connected)' : ''}{n.warmupDay ? ` · warm-up day ${n.warmupDay}` : ''}</option>)}
                </Select>
              </Field>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
            <div className="space-y-6">
              <Toggle checked={form.audience.all} onChange={(v) => set({ audience: { ...form.audience, all: v } })} label="Send to all contacts" description="Everyone in Contacts (opt-outs are always excluded)." />
              {!form.audience.all && (
                <div>
                  <p className="label">Contacts with these tags</p>
                  <div className="flex flex-wrap gap-2">
                    {tags.length === 0 && <p className="text-sm text-slate-500">No tags yet — tag contacts or import a CSV with tags.</p>}
                    {tags.map((t) => {
                      const on = form.audience.tags.includes(t.name);
                      return (
                        <button key={t.name} onClick={() => set({ audience: { ...form.audience, tags: on ? form.audience.tags.filter((x) => x !== t.name) : [...form.audience.tags, t.name] } })}
                          className={cx('rounded-full px-3 py-1.5 text-sm font-semibold ring-1 transition', on ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-200 hover:ring-brand-300 dark:bg-ink-850 dark:text-slate-300 dark:ring-ink-600')}>
                          {t.name} <span className="opacity-70">{t.count}</span>
                        </button>
                      );
                    })}
                  </div>
                  {form.audience.tags.length > 1 && (
                    <div className="mt-3 flex items-center gap-2 text-sm">
                      Match
                      <Select value={form.audience.match} onChange={(e) => set({ audience: { ...form.audience, match: e.target.value } })} className="w-40 py-1.5">
                        <option value="any">any tag</option>
                        <option value="all">all tags</option>
                      </Select>
                    </div>
                  )}
                </div>
              )}
              <Field label="…and/or paste numbers" hint="One per line. Optional name after a comma: 919876543210, Priya">
                <Textarea value={pasted} onChange={(e) => setPasted(e.target.value)} className="min-h-28 font-mono text-[13px]" placeholder={'919876543210, Priya\n918888777666'} />
              </Field>
              <Toggle checked={form.requireOptIn} onChange={(v) => set({ requireOptIn: v })} label="Only contacts who opted in (recommended)"
                description="Messaging people who never agreed is the #1 reason numbers get banned. Pasted numbers count as not opted in." />
            </div>
            <div className="h-fit rounded-2xl bg-slate-50 p-5 dark:bg-ink-850">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Audience</p>
              <p className="mt-2 text-4xl font-extrabold tabular-nums">{num(preview?.willSend ?? 0)}</p>
              <p className="text-sm text-slate-500">will receive the message</p>
              <div className="mt-4 space-y-1.5 text-sm">
                <p className="flex justify-between"><span className="text-slate-500">Matched</span><b>{num(preview?.total ?? 0)}</b></p>
                <p className="flex justify-between"><span className="text-slate-500">Opted out</span><b className="text-rose-600">−{num(preview?.optedOut ?? 0)}</b></p>
                {form.requireOptIn && <p className="flex justify-between"><span className="text-slate-500">No opt-in</span><b className="text-amber-600">−{num(preview?.noConsent ?? 0)}</b></p>}
              </div>
            </div>
          </div>
        )}

        {step === 2 && form.channel === 'openwa' && (
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="space-y-4">
              {templates.length > 0 && (
                <Field label="Start from a template">
                  <Select value="" onChange={(e) => { const t = templates.find((x) => String(x.id) === e.target.value); if (t) set({ body: t.body }); }}>
                    <option value="">Choose a template…</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </Field>
              )}
              <Field label="Message" hint="Use {Hi|Hello|Hey} to vary wording per person — it makes bulk sends look natural.">
                <Textarea value={form.body} onChange={(e) => set({ body: e.target.value })} className="min-h-48" placeholder={'{Hi|Hello} {{first_name}} 👋\n\nOur Diwali offer is live: 20% off till Sunday.\n\nReply STOP to unsubscribe.'} />
              </Field>
              <div className="flex flex-wrap items-center gap-1.5">
                <Braces className="size-4 text-slate-400" />
                {VARIABLES.map((v) => <button key={v} onClick={() => set({ body: `${form.body}${v}` })} className="chip hover:bg-brand-100 hover:text-brand-700">{v}</button>)}
              </div>
              {!/stop/i.test(form.body) && (
                <Callout tone="amber" icon={AlertTriangle}>Add an opt-out line such as “Reply STOP to unsubscribe”. It lowers reports and keeps your number healthy.</Callout>
              )}
              <div>
                <p className="label">Attachment (optional)</p>
                {form.media ? (
                  <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm dark:bg-ink-850">
                    <Paperclip className="size-4 text-slate-400" /><span className="flex-1 truncate">{form.media.filename || 'Attached file'}</span>
                    <button onClick={() => set({ media: null })}><X className="size-4 text-slate-400" /></button>
                  </div>
                ) : (
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-brand-400 dark:border-ink-600 dark:text-slate-300">
                    <Paperclip className="size-4" /> Add image, video or PDF
                    <input type="file" className="hidden" accept="image/*,video/*,application/pdf" onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} />
                  </label>
                )}
              </div>
            </div>
            <div>
              <p className="label">Preview</p>
              <WhatsAppPreview text={rendered} />
              <p className="mt-2 text-xs text-slate-400">Shown for a sample contact. Each person gets their own name and a random variation.</p>
            </div>
          </div>
        )}

        {step === 2 && form.channel === 'meta' && (
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="space-y-4">
              {metaTemplates === null ? <Spinner /> : (
                <Field label="Approved template" hint="Templates are created and approved in Meta WhatsApp Manager.">
                  <Select value={form.metaTemplate.name ? `${form.metaTemplate.name}|${form.metaTemplate.language}` : ''}
                    onChange={(e) => { const [name, language] = e.target.value.split('|'); set({ metaTemplate: { name, language, params: [] } }); }}>
                    <option value="">Choose…</option>
                    {metaTemplates.filter((t) => t.status === 'APPROVED').map((t) => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language}) · {t.category}</option>)}
                  </Select>
                </Field>
              )}
              {Array.from({ length: metaParamCount }).map((_, i) => (
                <Field key={i} label={`Value for {{${i + 1}}}`} hint="You can use {{name}}, {{first_name}} or any contact field.">
                  <Input value={form.metaTemplate.params[i] || ''} onChange={(e) => { const params = [...form.metaTemplate.params]; params[i] = e.target.value; set({ metaTemplate: { ...form.metaTemplate, params } }); }} placeholder={i === 0 ? '{{first_name}}' : ''} />
                </Field>
              ))}
            </div>
            <div>
              <p className="label">Template text</p>
              <WhatsAppPreview text={metaBody} />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Minimum gap between messages (seconds)"><Input type="number" min="5" value={form.minDelay} onChange={(e) => set({ minDelay: e.target.value })} /></Field>
                <Field label="Maximum gap (seconds)"><Input type="number" min="5" value={form.maxDelay} onChange={(e) => set({ maxDelay: e.target.value })} /></Field>
              </div>
              <Field label="Daily cap" hint="Stops for the day after this many sends and continues tomorrow."><Input type="number" min="1" value={form.dailyCap} onChange={(e) => set({ dailyCap: e.target.value })} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Quiet hours start" hint="No sends at night"><Input type="time" value={form.quietStart} onChange={(e) => set({ quietStart: e.target.value })} /></Field>
                <Field label="Quiet hours end"><Input type="time" value={form.quietEnd} onChange={(e) => set({ quietEnd: e.target.value })} /></Field>
              </div>
              <Field label="Auto-pause after failures in a row" hint="Repeated failures are often the first sign of a restricted number."><Input type="number" min="1" value={form.stopAfterFailures} onChange={(e) => set({ stopAfterFailures: e.target.value })} /></Field>
            </div>
            <div className="h-fit space-y-3 rounded-2xl bg-slate-50 p-5 text-sm dark:bg-ink-850">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Estimate</p>
              <p className="flex justify-between"><span className="text-slate-500">Recipients</span><b>{num(sendable)}</b></p>
              <p className="flex justify-between"><span className="text-slate-500">Per day</span><b>{num(perDay)}</b></p>
              <p className="flex justify-between"><span className="text-slate-500">Sending time / day</span><b>{hoursPerDay < 1 ? `${Math.round(hoursPerDay * 60)} min` : `${hoursPerDay.toFixed(1)} h`}</b></p>
              <p className="flex justify-between"><span className="text-slate-500">Days to finish</span><b>{days}</b></p>
              {Number(form.minDelay) < 15 && <p className="rounded-lg bg-amber-100 p-2 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">Gaps under 15 s look automated. 25–70 s is safer.</p>}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ['Sender', form.channel === 'meta' ? 'Official Cloud API' : numbers.find((n) => n.id === form.sessionId)?.label || '—'],
                ['Recipients', num(sendable)],
                ['Pace', `${form.minDelay}–${form.maxDelay}s gaps, max ${form.dailyCap}/day`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-slate-50 p-4 dark:bg-ink-850">
                  <p className="text-xs font-semibold text-slate-500">{k}</p>
                  <p className="mt-1 font-bold">{v}</p>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-slate-200 p-5 dark:border-ink-700">
              <p className="font-bold">Send yourself a test first</p>
              <p className="text-sm text-slate-500">Check how the message looks on a real phone.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="Your number, e.g. 919876543210" className="max-w-xs" />
                <Button variant="secondary" icon={Send} onClick={sendTest} loading={busy} disabled={!testPhone}>Send test</Button>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 p-5 dark:border-ink-700">
              <p className="font-bold">When should it start?</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="max-w-xs" />
                <span className="text-sm text-slate-500">{scheduleAt ? 'Scheduled' : 'Leave empty to start now'}</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</Button>
        <div className="flex gap-2">
          <Button variant="secondary" icon={Save} onClick={() => save(false).catch((e) => toast(e.message, 'error'))}>Save draft</Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={next}>Continue <ArrowRight className="size-4" /></Button>
          ) : (
            <Button icon={scheduleAt ? Clock : Rocket} onClick={launch} loading={busy}>{scheduleAt ? 'Schedule campaign' : `Start sending to ${num(sendable)}`}</Button>
          )}
        </div>
      </div>
    </div>
  );
}
