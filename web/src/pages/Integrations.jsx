import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Webhook, KeyRound, BadgeCheck, Plus, Trash2, Send, Check, ShieldCheck, ExternalLink, RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useLoad, useToast } from '../lib/app.jsx';
import { Badge, Button, Card, CardHeader, Code, CopyButton, EmptyState, Field, Input, Modal, PageHeader, Tabs, Toggle, useConfirm, Spinner, Callout, cx } from '../components/ui.jsx';
import { timeAgo } from '../lib/format.js';

function WebhooksTab() {
  const { data, loading, reload } = useLoad(() => api.get('/api/integrations/webhooks'), []);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', events: ['*'] });
  const [secret, setSecret] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();
  const events = data?.events || [];
  const create = async () => {
    try {
      const out = await api.post('/api/integrations/webhooks', form);
      setSecret(out.secret);
      setAdding(false);
      setForm({ name: '', url: '', events: ['*'] });
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const test = async (h) => {
    const out = await api.post(`/api/integrations/webhooks/${h.id}/test`);
    toast(out.ok ? `Delivered (HTTP ${out.status})` : `Failed: ${out.error || `HTTP ${out.status}`}`, out.ok ? 'success' : 'error');
    reload();
  };
  const toggleEvent = (ev) => {
    const set = new Set(form.events.filter((x) => x !== '*'));
    set.has(ev) ? set.delete(ev) : set.add(ev);
    setForm({ ...form, events: set.size ? [...set] : ['*'] });
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <Card>
        <CardHeader title="Outgoing webhooks" description="WaBridge POSTs events to your systems (CRM, n8n, Zapier, your backend)." icon={Webhook} action={<Button size="sm" icon={Plus} onClick={() => setAdding(true)}>Add</Button>} />
        {loading && !data ? <div className="flex justify-center py-10"><Spinner /></div> : data.webhooks.length === 0 ? (
          <EmptyState icon={Webhook} title="No webhooks" description="Get every new message, status change or opt-out pushed to your own URL." />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-ink-700">
            {data.webhooks.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <Toggle checked={Boolean(h.active)} onChange={async (v) => { await api.put(`/api/integrations/webhooks/${h.id}`, { active: v }); reload(); }} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{h.name}</p>
                  <p className="truncate font-mono text-xs text-slate-500">{h.url}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {h.events.includes('*') ? 'All events' : h.events.join(', ')} · {h.deliveries} delivered · {h.failures} failed
                    {h.last_at ? ` · last ${timeAgo(h.last_at)} (${h.last_status || 'error'})` : ''}
                  </p>
                </div>
                <Button size="sm" variant="secondary" icon={Send} onClick={() => test(h)}>Test</Button>
                <Button size="iconSm" variant="ghost" onClick={async () => { if (await confirm({ title: 'Delete webhook?', danger: true, confirmLabel: 'Delete' })) { await api.del(`/api/integrations/webhooks/${h.id}`); reload(); } }}><Trash2 className="size-4 text-rose-500" /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="h-fit">
        <CardHeader title="Verify signatures" icon={ShieldCheck} />
        <div className="space-y-3 p-5 text-sm">
          <p className="text-slate-600 dark:text-slate-300">Each request has <span className="kbd">X-WaBridge-Signature: sha256=…</span> — an HMAC-SHA256 of the raw body with your webhook secret.</p>
          <Code>{`const crypto = require('crypto');
const expected = 'sha256=' + crypto
  .createHmac('sha256', SECRET)
  .update(rawBody).digest('hex');
if (expected !== req.headers['x-wabridge-signature'])
  return res.status(401).end();`}</Code>
        </div>
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add webhook" icon={Webhook} footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button onClick={create} disabled={!form.url}>Create</Button></>}>
        <div className="space-y-4">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My CRM" /></Field>
          <Field label="URL"><Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/whatsapp-events" /></Field>
          <div>
            <p className="label">Events</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setForm({ ...form, events: ['*'] })} className={cx('chip', form.events.includes('*') && 'bg-brand-600 text-white dark:bg-brand-600')}>All events</button>
              {events.map((ev) => <button key={ev} onClick={() => toggleEvent(ev)} className={cx('chip', form.events.includes(ev) && 'bg-brand-600 text-white dark:bg-brand-600')}>{ev}</button>)}
            </div>
          </div>
        </div>
      </Modal>
      <Modal open={Boolean(secret)} onClose={() => setSecret(null)} title="Webhook created" icon={Check} footer={<Button onClick={() => setSecret(null)}>I saved it</Button>}>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">Copy the signing secret now — it will not be shown again.</p>
        <div className="flex items-center gap-2"><Input readOnly value={secret || ''} className="font-mono text-xs" /><CopyButton value={secret || ''} /></div>
      </Modal>
    </div>
  );
}

function ApiTab() {
  const { data, reload } = useLoad(() => api.get('/api/integrations/api-keys'), []);
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();
  const base = window.location.origin;
  const create = async () => {
    const out = await api.post('/api/integrations/api-keys', { name });
    setNewKey(out.key);
    setName('');
    reload();
  };
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="API keys" description="Let your website, CRM or scripts send WhatsApp messages through WaBridge." icon={KeyRound} />
        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-5 dark:border-ink-700">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name, e.g. Website" className="max-w-xs" />
          <Button icon={Plus} onClick={create}>Create key</Button>
        </div>
        {newKey && (
          <div className="border-b border-slate-100 bg-emerald-50 p-5 dark:border-ink-700 dark:bg-emerald-500/10">
            <p className="mb-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200">Copy your key now — it is shown only once.</p>
            <div className="flex items-center gap-2"><Input readOnly value={newKey} className="font-mono text-xs" /><CopyButton value={newKey} /></div>
          </div>
        )}
        <ul className="divide-y divide-slate-100 dark:divide-ink-700">
          {(data?.keys || []).map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-5 py-3.5">
              <KeyRound className="size-4 text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{k.name} {k.revoked ? <Badge tone="red">Revoked</Badge> : null}</p>
                <p className="font-mono text-xs text-slate-500">{k.prefix}… · {k.last_used_at ? `used ${timeAgo(k.last_used_at)}` : 'never used'}</p>
              </div>
              {!k.revoked && <Button size="sm" variant="ghost" className="text-rose-600" onClick={async () => { if (await confirm({ title: 'Revoke key?', description: 'Apps using it stop working immediately.', danger: true, confirmLabel: 'Revoke' })) { await api.post(`/api/integrations/api-keys/${k.id}/revoke`); toast('Revoked'); reload(); } }}>Revoke</Button>}
            </li>
          ))}
          {data?.keys?.length === 0 && <li className="px-5 py-6 text-sm text-slate-500">No keys yet.</li>}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Quick API reference" description={`Base URL: ${base}/api/v1 · Header: X-WaBridge-Key`} />
        <div className="grid gap-5 p-5 lg:grid-cols-2">
          {[
            ['Send a text message', `curl -X POST ${base}/api/v1/messages \\
  -H "X-WaBridge-Key: wb_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{"to":"919876543210","text":"Your order #123 is confirmed ✅"}'`],
            ['Send an image by URL', `curl -X POST ${base}/api/v1/messages \\
  -H "X-WaBridge-Key: wb_live_…" -H "Content-Type: application/json" \\
  -d '{"to":"919876543210","text":"Invoice","media":{"type":"document","url":"https://…/invoice.pdf","filename":"invoice.pdf"}}'`],
            ['Send a saved template', `curl -X POST ${base}/api/v1/messages/template \\
  -H "X-WaBridge-Key: wb_live_…" -H "Content-Type: application/json" \\
  -d '{"to":"919876543210","templateName":"Order shipped","variables":{"order":"123"}}'`],
            ['Add / update a contact', `curl -X POST ${base}/api/v1/contacts \\
  -H "X-WaBridge-Key: wb_live_…" -H "Content-Type: application/json" \\
  -d '{"phone":"919876543210","name":"Priya","tags":["website-lead"],"optedIn":true}'`],
            ['List numbers', `curl ${base}/api/v1/numbers -H "X-WaBridge-Key: wb_live_…"`],
            ['Any engine endpoint (full OpenWA API)', `# /api/v1/engine/<path> → engine /api/<path>
curl ${base}/api/v1/engine/sessions -H "X-WaBridge-Key: wb_live_…"`],
          ].map(([t, c]) => (
            <div key={t}>
              <div className="mb-2 flex items-center justify-between"><p className="text-sm font-bold">{t}</p><CopyButton value={c} /></div>
              <Code className="text-[11.5px]">{c}</Code>
            </div>
          ))}
        </div>
        <p className="px-5 pb-5 text-xs text-slate-500">Options for /messages: <span className="kbd">numberId</span> to pick a sender, <span className="kbd">channel</span> = auto | openwa | meta. With <b>auto</b>, if no linked number is connected the official Meta channel is used (when configured).</p>
      </Card>
    </div>
  );
}

function MetaTab() {
  const { data, reload } = useLoad(() => api.get('/api/settings'), []);
  const [m, setM] = useState(null);
  const [status, setStatus] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (data) setM(data.meta);
  }, [data]);
  if (!m) return <div className="flex justify-center py-12"><Spinner /></div>;
  const save = async () => {
    setBusy(true);
    try {
      await api.put('/api/settings/meta', m);
      toast('Saved');
      await reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const check = async () => {
    setStatus({ loading: true });
    setStatus(await api.get('/api/integrations/meta/status'));
  };
  const loadTemplates = async () => {
    try {
      setTemplates((await api.get('/api/integrations/meta/templates')).templates);
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
      <Card>
        <CardHeader title="Official WhatsApp Cloud API" description="Optional. Use your Meta Business account for approved-template campaigns and as a fallback channel." icon={BadgeCheck}
          action={<Toggle checked={Boolean(m.enabled)} onChange={(v) => setM({ ...m, enabled: v })} />} />
        <div className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone Number ID" hint="WhatsApp Manager → API setup"><Input value={m.phoneNumberId} onChange={(e) => setM({ ...m, phoneNumberId: e.target.value })} placeholder="1234567890…" /></Field>
            <Field label="WhatsApp Business Account ID (WABA)"><Input value={m.wabaId} onChange={(e) => setM({ ...m, wabaId: e.target.value })} placeholder="1029384756…" /></Field>
          </div>
          <Field label="Permanent access token" hint="System user token with whatsapp_business_messaging + whatsapp_business_management.">
            <Input type="password" value={m.accessToken} onChange={(e) => setM({ ...m, accessToken: e.target.value })} placeholder={m.accessTokenSet ? 'Saved — type to replace' : 'EAAG…'} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="App secret" hint="Meta App → Settings → Basic. Used to verify webhooks."><Input type="password" value={m.appSecret} onChange={(e) => setM({ ...m, appSecret: e.target.value })} placeholder={m.appSecretSet ? 'Saved — type to replace' : ''} /></Field>
            <Field label="Graph API version"><Input value={m.graphVersion} onChange={(e) => setM({ ...m, graphVersion: e.target.value })} /></Field>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4 dark:bg-ink-850">
            <p className="text-sm font-bold">Webhook for Meta</p>
            <p className="mt-1 text-xs text-slate-500">Meta App → WhatsApp → Configuration → Webhook. Subscribe to <span className="kbd">messages</span>. The URL must be public HTTPS (e.g. a Cloudflare Tunnel).</p>
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2"><Input readOnly value={m.webhookUrl} className="font-mono text-xs" /><CopyButton value={m.webhookUrl} /></div>
              <div className="flex items-center gap-2"><Input value={m.verifyToken} onChange={(e) => setM({ ...m, verifyToken: e.target.value })} placeholder="Verify token (auto-generated when you enable)" className="font-mono text-xs" />{m.verifyToken && <CopyButton value={m.verifyToken} />}</div>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" icon={RefreshCw} onClick={check}>Test connection</Button>
            <Button onClick={save} loading={busy}>Save</Button>
          </div>
          {status && !status.loading && (
            status.connected ? (
              <Callout tone="green" icon={BadgeCheck} title="Connected">
                {status.phone.verified_name} · {status.phone.display_phone_number} · quality {status.phone.quality_rating}
              </Callout>
            ) : <Callout tone="red" icon={AlertTriangle} title="Not connected">{status.reason}</Callout>
          )}
        </div>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader title="What you need from Meta" />
          <ol className="list-decimal space-y-2 p-5 pl-9 text-sm text-slate-600 dark:text-slate-300">
            <li>Meta Business account (your Business ID) — verified for higher limits.</li>
            <li>A Meta developer App with the <b>WhatsApp</b> product added.</li>
            <li>A phone number added in WhatsApp Manager (not used in the WhatsApp phone app).</li>
            <li>Phone Number ID + WABA ID from API setup.</li>
            <li>A <b>System User</b> permanent token with WhatsApp permissions.</li>
            <li>App secret + webhook URL above for incoming messages.</li>
          </ol>
          <div className="px-5 pb-5"><a href="https://business.facebook.com/wa/manage/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 dark:text-brand-400">Open WhatsApp Manager <ExternalLink className="size-3.5" /></a></div>
        </Card>
        <Card>
          <CardHeader title="Approved templates" action={<Button size="sm" variant="secondary" onClick={loadTemplates}>Load</Button>} />
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto dark:divide-ink-700">
            {templates === null && <li className="px-5 py-4 text-sm text-slate-500">Click Load after saving your credentials.</li>}
            {templates?.map((t) => (
              <li key={`${t.name}-${t.language}`} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="font-semibold">{t.name} <span className="font-normal text-slate-400">{t.language}</span></span>
                <Badge tone={t.status === 'APPROVED' ? 'green' : 'amber'}>{t.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

export default function Integrations() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'webhooks';
  return (
    <div>
      <PageHeader eyebrow="Connect" title="Integrations & API" description="Connect WaBridge to your other tools, or to Meta's official Cloud API." />
      <Tabs className="mb-6" value={tab} onChange={(v) => setParams({ tab: v })} tabs={[{ value: 'webhooks', label: 'Webhooks', icon: Webhook }, { value: 'api', label: 'API keys', icon: KeyRound }, { value: 'meta', label: 'Official API (Meta)', icon: BadgeCheck }]} />
      {tab === 'webhooks' && <WebhooksTab />}
      {tab === 'api' && <ApiTab />}
      {tab === 'meta' && <MetaTab />}
    </div>
  );
}

