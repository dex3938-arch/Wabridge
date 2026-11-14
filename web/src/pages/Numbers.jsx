import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Smartphone,
  Plus,
  QrCode,
  Play,
  Square,
  RotateCw,
  Unlink,
  Trash2,
  RefreshCcw,
  Settings2,
  ShieldAlert,
  KeyRound,
  CheckCircle2,
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  Flame,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useLoad, useLive, useToast, useAuth } from '../lib/app.jsx';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Skeleton, Tabs, Callout, useConfirm, Spinner, cx } from '../components/ui.jsx';
import { SESSION_STATUS, phonePretty, timeAgo, num } from '../lib/format.js';

const WARMUP = [20, 40, 80, 160, 320, 640, 1000];

function ConnectModal({ session, onClose }) {
  const [tab, setTab] = useState('qr');
  const [qr, setQr] = useState({ qrCode: session?.qrCode || null, status: session?.status || 'connecting' });
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (session) {
      setQr({ qrCode: session.qrCode || null, status: session.status || 'connecting' });
      setCode(null);
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let stop = false;
    const poll = async () => {
      try {
        const out = await api.get(`/api/numbers/${session.id}/qr`);
        if (!stop && out) {
          setQr((prev) => ({
            status: out.status || prev.status,
            qrCode: out.qrCode !== undefined ? out.qrCode : prev.qrCode,
          }));
        }
      } catch {
        /* keep polling */
      }
    };
    poll();
    const interval = qr.qrCode ? 2500 : 1000;
    const t = setInterval(poll, interval);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [session, qr.qrCode]);

  useLive('session', (d) => {
    if (d.sessionId === session?.id) {
      setQr((q) => ({
        ...q,
        status: d.status || q.status,
        qrCode: d.qrCode !== undefined ? d.qrCode : q.qrCode,
      }));
    }
  });

  const ready = qr.status === 'ready';
  const requestCode = async () => {
    setBusy(true);
    try {
      const out = await api.post(`/api/numbers/${session.id}/pairing-code`, { phone });
      setCode(out.pairingCode || out.code);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={Boolean(session)} onClose={onClose} title={ready ? 'Number connected' : `Link “${session?.label || session?.name}”`} icon={ready ? CheckCircle2 : QrCode} size="lg"
      footer={<Button variant={ready ? 'primary' : 'secondary'} onClick={onClose}>{ready ? 'Done' : 'Close'}</Button>}>
      {ready ? (
        <div className="py-8 text-center">
          <span className="mx-auto inline-flex size-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10">
            <CheckCircle2 className="size-8" />
          </span>
          <p className="mt-4 text-lg font-bold">You are connected 🎉</p>
          <p className="mt-1 text-sm text-slate-500">New messages will now appear in your Inbox in real time.</p>
          <Link to="/inbox" onClick={onClose} className="mt-5 inline-block">
            <Button>Go to inbox</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'qr', label: 'Scan QR code', icon: QrCode }, { value: 'code', label: 'Use phone number', icon: KeyRound }]} />
          {tab === 'qr' ? (
            <div className="grid gap-6 sm:grid-cols-[260px_1fr] sm:items-center">
              <div className="flex aspect-square items-center justify-center rounded-2xl border border-slate-200 bg-white p-3 dark:border-ink-600">
                {qr.qrCode ? (
                  <img src={qr.qrCode} alt="WhatsApp QR code" className="size-full rounded-lg" />
                ) : (
                  <div className="text-center">
                    <Spinner className="mx-auto" />
                    <p className="mt-3 text-xs text-slate-500">{qr.status === 'authenticating' ? 'Linking… keep WhatsApp open' : 'Preparing QR code…'}</p>
                  </div>
                )}
              </div>
              <ol className="space-y-3 text-sm">
                {['Open WhatsApp on the phone with this number.', 'Tap ⋮ Menu (Android) or Settings (iPhone) → Linked devices.', 'Tap “Link a device” and point the camera at this QR code.', 'Keep this window open until it says connected.'].map((s, i) => (
                  <li key={s} className="flex gap-3">
                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">{i + 1}</span>
                    <span className="text-slate-600 dark:text-slate-300">{s}</span>
                  </li>
                ))}
                <li className="pt-1 text-xs text-slate-400">The code refreshes automatically every few seconds. Status: <b>{SESSION_STATUS[qr.status]?.label || qr.status}</b></li>
              </ol>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Use this when you cannot scan (e.g. the phone is the same device). On the phone: Linked devices → Link a device → <b>Link with phone number instead</b>, then type the 8-character code.
              </p>
              <div className="flex gap-2">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone with country code, e.g. 919876543210" />
                <Button onClick={requestCode} loading={busy} disabled={!phone}>Get code</Button>
              </div>
              {code && (
                <div className="rounded-2xl border border-dashed border-brand-300 bg-brand-50/60 p-5 text-center dark:border-brand-500/30 dark:bg-brand-500/10">
                  <p className="text-xs font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">Pairing code</p>
                  <p className="mt-2 font-mono text-3xl font-bold tracking-[0.3em]">{code}</p>
                </div>
              )}
              <p className="text-xs text-slate-400">The QR code must be ready (status “Scan QR”) before a code can be requested.</p>
            </div>
          )}
          <Callout tone="amber" icon={ShieldAlert}>
            If WhatsApp asks you to <b>create a passkey</b> and linking never finishes, this number cannot be linked right now (a WhatsApp-side restriction). Try a different number.
          </Callout>
        </div>
      )}
    </Modal>
  );
}

function AddModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ label: '', dailyLimit: '', proxyUrl: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setBusy(true);
    try {
      const out = await api.post('/api/numbers', { ...form, name: form.label });
      onCreated(out.session, form.label);
      setForm({ label: '', dailyLimit: '', proxyUrl: '' });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add a WhatsApp number" description="You will scan a QR code on the next step." icon={Plus}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={form.label.trim().length < 3}>Continue</Button></>}>
      <div className="space-y-4">
        <Field label="Name for this number" hint="Only you see this, e.g. “Sales”, “Support”, “Delhi store”.">
          <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Sales" autoFocus />
        </Field>
        <Field label="Daily send limit (optional)" hint="Hard stop for outgoing messages per day from this number. Recommended for new numbers.">
          <Input type="number" min="1" value={form.dailyLimit} onChange={(e) => setForm({ ...form, dailyLimit: e.target.value })} placeholder="e.g. 150" />
        </Field>
        <Field label="Proxy URL (optional)" hint="Residential proxy for this number, e.g. http://user:pass@host:port">
          <Input value={form.proxyUrl} onChange={(e) => setForm({ ...form, proxyUrl: e.target.value })} placeholder="http://…" />
        </Field>
        <Callout tone="brand" icon={ShieldAlert}>
          Use a <b>dedicated number</b> you can afford to lose — not your main personal or business number. Unofficial automation always carries some ban risk.
        </Callout>
      </div>
    </Modal>
  );
}

function EditModal({ number, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (number) setForm({ label: number.label || '', dailyLimit: number.dailyLimit || '', proxyUrl: '' });
  }, [number]);
  const save = async () => {
    setBusy(true);
    try {
      const body = { label: form.label, dailyLimit: form.dailyLimit };
      if (form.proxyUrl) body.proxyUrl = form.proxyUrl;
      await api.patch(`/api/numbers/${number.id}`, body);
      toast('Saved');
      onSaved();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={Boolean(number)} onClose={onClose} title="Number settings" icon={Settings2}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name"><Input value={form.label || ''} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
        <Field label="Daily send limit" hint="Leave empty for no limit."><Input type="number" value={form.dailyLimit || ''} onChange={(e) => setForm({ ...form, dailyLimit: e.target.value })} /></Field>
        <Field label="New proxy URL" hint="Applies on the next restart. Leave empty to keep the current proxy."><Input value={form.proxyUrl || ''} onChange={(e) => setForm({ ...form, proxyUrl: e.target.value })} placeholder="http://user:pass@host:port" /></Field>
      </div>
    </Modal>
  );
}

function NumberCard({ n, onAction, onQr, onEdit, isAdmin }) {
  const st = SESSION_STATUS[n.status] || { label: n.status, tone: 'slate' };
  const official = n.channel === 'meta';
  const day = n.warmupDay;
  const suggested = day ? WARMUP[Math.min(day, WARMUP.length) - 1] : null;
  const needsQr = ['qr_ready', 'created', 'initializing', 'authenticating'].includes(n.status);
  return (
    <Card className="flex flex-col">
      <div className="flex items-start gap-4 p-5">
        <span className={cx('inline-flex size-12 shrink-0 items-center justify-center rounded-2xl', official ? 'bg-gradient-to-br from-sky-500 to-blue-600 text-white' : n.status === 'ready' ? 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white' : 'bg-slate-100 text-slate-500 dark:bg-ink-800')}>
          {official ? <BadgeCheck className="size-6" /> : <Smartphone className="size-6" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-bold">{n.label}</h3>
            <Badge tone={st.tone} dot={n.status === 'ready' ? true : 'pulse'}>{st.label}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-slate-500">{n.phone ? (official ? n.phone : phonePretty(n.phone)) : 'Not linked yet'}{n.pushName ? ` · ${n.pushName}` : ''}</p>
          {n.lastError && n.status !== 'ready' && <p className="mt-1.5 line-clamp-2 text-xs text-rose-600">{n.lastError}</p>}
        </div>
      </div>
      <div className="grid grid-cols-3 border-y border-slate-100 text-center dark:border-ink-700">
        <div className="px-3 py-3">
          <p className="flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-500"><ArrowDownLeft className="size-3" /> In today</p>
          <p className="text-lg font-extrabold tabular-nums">{num(n.today?.in)}</p>
        </div>
        <div className="border-x border-slate-100 px-3 py-3 dark:border-ink-700">
          <p className="flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-500"><ArrowUpRight className="size-3" /> Out today</p>
          <p className="text-lg font-extrabold tabular-nums">{num(n.today?.out)}{n.dailyLimit ? <span className="text-xs font-semibold text-slate-400">/{n.dailyLimit}</span> : null}</p>
        </div>
        <div className="px-3 py-3">
          <p className="flex items-center justify-center gap-1 text-[11px] font-semibold text-slate-500"><Flame className="size-3" /> Warm-up</p>
          <p className="text-lg font-extrabold tabular-nums">{official ? '—' : day ? `Day ${day}` : '—'}</p>
        </div>
      </div>
      {!official && day && day <= 7 && (
        <p className="px-5 pt-3 text-xs text-slate-500">
          Warm-up tip: keep today under <b>{suggested}</b> messages, mostly to people who message you first.
        </p>
      )}
      {!official && isAdmin && (
        <div className="mt-auto flex flex-wrap gap-1.5 p-4">
          {needsQr && <Button size="sm" icon={QrCode} onClick={() => onQr(n)}>Show QR</Button>}
          {['created', 'disconnected', 'failed'].includes(n.status) && <Button size="sm" variant="soft" icon={Play} onClick={() => onAction(n, 'start')}>Start</Button>}
          {n.status === 'ready' && <Button size="sm" variant="secondary" icon={RefreshCcw} onClick={() => onAction(n, 'sync-chats')}>Sync chats</Button>}
          {!['created', 'disconnected'].includes(n.status) && <Button size="sm" variant="ghost" icon={Square} onClick={() => onAction(n, 'stop')}>Stop</Button>}
          <Button size="sm" variant="ghost" icon={RotateCw} onClick={() => onAction(n, 'restart')}>Restart</Button>
          <Button size="sm" variant="ghost" icon={Settings2} onClick={() => onEdit(n)}>Settings</Button>
          {n.status === 'ready' && <Button size="sm" variant="ghost" icon={Unlink} onClick={() => onAction(n, 'logout')}>Unlink</Button>}
          <Button size="sm" variant="ghost" icon={Trash2} onClick={() => onAction(n, 'delete')} className="text-rose-600 hover:text-rose-700">Delete</Button>
        </div>
      )}
      {official && (
        <div className="mt-auto p-4">
          <Link to="/integrations?tab=meta"><Button size="sm" variant="secondary" icon={Settings2}>Official API settings</Button></Link>
        </div>
      )}
    </Card>
  );
}

export default function Numbers() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data, loading, reload } = useLoad(() => api.get('/api/numbers'), []);
  const [adding, setAdding] = useState(false);
  const [qrFor, setQrFor] = useState(null);
  const [editing, setEditing] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();
  useLive('session', () => reload());

  useEffect(() => {
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, [reload]);

  const onAction = async (n, action) => {
    const prompts = {
      logout: { title: 'Unlink this number?', description: 'WhatsApp will log this device out. You will need to scan a new QR code to use it again.', confirmLabel: 'Unlink', danger: true },
      delete: { title: `Delete “${n.label}”?`, description: 'The number is unlinked and removed from the engine. Chat history already in WaBridge stays.', confirmLabel: 'Delete number', danger: true },
    };
    if (prompts[action] && !(await confirm(prompts[action]))) return;
    try {
      if (action === 'delete') await api.del(`/api/numbers/${n.id}`);
      else {
        const out = await api.post(`/api/numbers/${n.id}/${action}`);
        if (action === 'sync-chats') toast(`Imported ${out.imported} chats into the inbox`);
        if (action === 'start' || action === 'restart') setQrFor(n);
      }
      if (action !== 'sync-chats') toast('Done');
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const numbers = data?.numbers || [];
  return (
    <div>
      <PageHeader
        eyebrow="Connect"
        title="WhatsApp numbers"
        description="Link numbers by scanning a QR code — exactly like WhatsApp Web. Each number runs in its own session."
        actions={isAdmin && <Button icon={Plus} onClick={() => setAdding(true)} disabled={data && !data.engine.online}>Add number</Button>}
      />
      {data && !data.engine.online && (
        <Callout tone="red" icon={ShieldAlert} title="Engine offline" className="mb-6">{data.engine.error}</Callout>
      )}
      {loading && !data ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : numbers.length === 0 ? (
        <Card>
          <EmptyState icon={Smartphone} title="No numbers yet" description="Add your first WhatsApp number. You only need the phone in your hand — no Meta App ID, no verification." action={isAdmin && <Button icon={Plus} onClick={() => setAdding(true)}>Add number</Button>} />
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {numbers.map((n) => <NumberCard key={n.id} n={n} isAdmin={isAdmin} onAction={onAction} onQr={setQrFor} onEdit={setEditing} />)}
        </div>
      )}
      <p className="mt-6 text-xs text-slate-400">Last checked {timeAgo(new Date().toISOString())}. Status updates live.</p>

      <AddModal open={adding} onClose={() => setAdding(false)} onCreated={(s, label) => { setAdding(false); setQrFor({ ...s, label }); reload(); }} />
      <ConnectModal session={qrFor} onClose={() => { setQrFor(null); reload(); }} />
      <EditModal number={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
    </div>
  );
}
