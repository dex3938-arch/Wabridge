import { useEffect, useState } from 'react';
import { Building2, ShieldCheck, Server, UserCircle2, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useLoad, useToast, useAuth } from '../lib/app.jsx';
import { Badge, Button, Card, CardHeader, CopyButton, Field, Input, PageHeader, Tabs, Textarea, Spinner, Callout } from '../components/ui.jsx';
import { dateTime } from '../lib/format.js';

function Section({ title, description, icon, children, onSave, busy }) {
  return (
    <Card className="max-w-3xl">
      <CardHeader title={title} description={description} icon={icon} />
      <div className="space-y-5 p-5">
        {children}
        {onSave && <div className="flex justify-end"><Button onClick={onSave} loading={busy}>Save</Button></div>}
      </div>
    </Card>
  );
}

function EngineTab() {
  const { data, loading, reload } = useLoad(() => api.get('/api/engine'), []);
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <div className="flex justify-center py-12"><Spinner /></div>;
  return (
    <Section title="WhatsApp engine (OpenWA)" description="WaBridge talks to the OpenWA engine for everything WhatsApp. Change these in the .env file." icon={Server}>
      <div className="flex items-center gap-3">
        {data.online ? <CheckCircle2 className="size-6 text-emerald-500" /> : <XCircle className="size-6 text-rose-500" />}
        <div>
          <p className="font-bold">{data.online ? 'Engine is online' : 'Engine is offline'}</p>
          <p className="text-xs text-slate-500">Checked {dateTime(data.checkedAt)}{data.health?.version ? ` · OpenWA ${data.health.version}` : ''}</p>
        </div>
        <Button size="sm" variant="secondary" icon={RefreshCw} className="ml-auto" loading={busy} onClick={async () => { setBusy(true); await api.post('/api/engine/refresh').catch(() => {}); await reload(); setBusy(false); }}>Re-check</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Engine URL (OPENWA_URL)"><Input readOnly value={data.url} className="font-mono text-xs" /></Field>
        <Field label="Engine API key (OPENWA_API_KEY)"><Input readOnly value={data.keySet ? 'Set ✓' : 'Missing ✗'} /></Field>
      </div>
      <Field label="Engine → WaBridge event URL (WABRIDGE_PUBLIC_URL + /hooks/openwa)" hint="Registered automatically on every number. Must be reachable from the engine.">
        <div className="flex gap-2"><Input readOnly value={data.webhookUrl} className="font-mono text-xs" /><CopyButton value={data.webhookUrl} /></div>
      </Field>
      {data.engineType && <p className="text-sm">Active engine: <Badge tone="brand">{typeof data.engineType === 'string' ? data.engineType : JSON.stringify(data.engineType)}</Badge></p>}
      {!data.online && <Callout tone="red" title="Engine not reachable">{data.health?.error}</Callout>}
    </Section>
  );
}

function AccountTab() {
  const { user } = useAuth();
  const [form, setForm] = useState({ current: '', next: '' });
  const toast = useToast();
  return (
    <Section title="Your account" description={`${user.name} · ${user.email}`} icon={UserCircle2} onSave={async () => {
      try {
        await api.post('/api/auth/password', form);
        toast('Password changed');
        setForm({ current: '', next: '' });
      } catch (e) {
        toast(e.message, 'error');
      }
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Current password"><Input type="password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} /></Field>
        <Field label="New password" hint="At least 8 characters"><Input type="password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} /></Field>
      </div>
    </Section>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState(isAdmin ? 'general' : 'account');
  const { data, reload } = useLoad(() => api.get('/api/settings'), []);
  const [general, setGeneral] = useState(null);
  const [safety, setSafety] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (data) {
      setGeneral(data.general);
      setSafety(data.safety);
    }
  }, [data]);

  const save = async (section, body) => {
    setBusy(true);
    try {
      await api.put(`/api/settings/${section}`, body);
      toast('Settings saved');
      reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const tabs = isAdmin
    ? [{ value: 'general', label: 'General', icon: Building2 }, { value: 'safety', label: 'Safety & consent', icon: ShieldCheck }, { value: 'engine', label: 'Engine', icon: Server }, { value: 'account', label: 'Account', icon: UserCircle2 }]
    : [{ value: 'account', label: 'Account', icon: UserCircle2 }];

  return (
    <div>
      <PageHeader eyebrow="Admin" title="Settings" />
      <Tabs className="mb-6" value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'general' && general && (
        <Section title="Business" icon={Building2} onSave={() => save('general', general)} busy={busy}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Business name" hint="Available as {{business}}"><Input value={general.businessName} onChange={(e) => setGeneral({ ...general, businessName: e.target.value })} /></Field>
            <Field label="Time zone" hint="IANA name"><Input value={general.timezone} onChange={(e) => setGeneral({ ...general, timezone: e.target.value })} /></Field>
            <Field label="Default country code" hint="Added to 10-digit numbers"><Input value={general.defaultCountryCode} onChange={(e) => setGeneral({ ...general, defaultCountryCode: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
        </Section>
      )}
      {tab === 'safety' && safety && (
        <Section title="Safety & consent" description="Protects your numbers from bans and respects customers who opt out." icon={ShieldCheck} onSave={() => save('safety', safety)} busy={busy}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Opt-out words" hint="Exact message, comma separated"><Input value={safety.optOutKeywords} onChange={(e) => setSafety({ ...safety, optOutKeywords: e.target.value })} /></Field>
            <Field label="Opt-in words"><Input value={safety.optInKeywords} onChange={(e) => setSafety({ ...safety, optInKeywords: e.target.value })} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reply after opt-out"><Textarea value={safety.optOutReply} onChange={(e) => setSafety({ ...safety, optOutReply: e.target.value })} className="min-h-20" /></Field>
            <Field label="Reply after opt-in"><Textarea value={safety.optInReply} onChange={(e) => setSafety({ ...safety, optInReply: e.target.value })} className="min-h-20" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Human takeover (minutes)" hint="Bots stay quiet after a person replies"><Input type="number" value={safety.humanTakeoverMinutes} onChange={(e) => setSafety({ ...safety, humanTakeoverMinutes: Number(e.target.value) })} /></Field>
            <Field label="Bot reply delay min (s)" hint="Feels human, avoids instant-bot patterns"><Input type="number" value={safety.replyDelayMin} onChange={(e) => setSafety({ ...safety, replyDelayMin: Number(e.target.value) })} /></Field>
            <Field label="Bot reply delay max (s)"><Input type="number" value={safety.replyDelayMax} onChange={(e) => setSafety({ ...safety, replyDelayMax: Number(e.target.value) })} /></Field>
          </div>
          <p className="pt-2 text-sm font-bold">Campaign defaults</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Min gap (s)"><Input type="number" value={safety.defaultMinDelay} onChange={(e) => setSafety({ ...safety, defaultMinDelay: Number(e.target.value) })} /></Field>
            <Field label="Max gap (s)"><Input type="number" value={safety.defaultMaxDelay} onChange={(e) => setSafety({ ...safety, defaultMaxDelay: Number(e.target.value) })} /></Field>
            <Field label="Daily cap"><Input type="number" value={safety.defaultDailyCap} onChange={(e) => setSafety({ ...safety, defaultDailyCap: Number(e.target.value) })} /></Field>
          </div>
        </Section>
      )}
      {tab === 'engine' && <EngineTab />}
      {tab === 'account' && <AccountTab />}
    </div>
  );
}
