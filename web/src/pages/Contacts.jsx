import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Upload, Plus, Search, Download, Tag, Trash2, CheckCircle2, Ban, MessageCircle, Pencil, ShieldCheck, FileSpreadsheet } from 'lucide-react';
import { api } from '../lib/api.js';
import { useLoad, useToast } from '../lib/app.jsx';
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea, Toggle, useConfirm, Spinner, Callout, cx } from '../components/ui.jsx';
import { parseCsv, phonePretty, timeAgo, num } from '../lib/format.js';

const GUESS = {
  phone: /phone|mobile|number|whatsapp|contact no|cell/i,
  name: /^name$|full ?name|customer|first ?name/i,
  email: /e-?mail/i,
  tags: /tag|group|label|segment/i,
};

function ImportModal({ open, onClose, onDone }) {
  const [rows, setRows] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [map, setMap] = useState({});
  const [tags, setTags] = useState('');
  const [optedIn, setOptedIn] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const reset = () => {
    setRows(null);
    setHeaders([]);
    setMap({});
    setTags('');
  };
  const onFile = async (file) => {
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) return toast('The file needs a header row and at least one contact.', 'error');
    const [head, ...body] = parsed;
    setHeaders(head);
    setRows(body);
    const m = {};
    head.forEach((h, i) => {
      for (const [field, re] of Object.entries(GUESS)) if (m[field] === undefined && re.test(h)) m[field] = i;
    });
    if (m.phone === undefined) m.phone = 0;
    setMap(m);
  };
  const submit = async () => {
    setBusy(true);
    try {
      const payload = rows.map((r) => {
        const o = {};
        headers.forEach((h, i) => {
          const key = Object.entries(map).find(([, idx]) => idx === i)?.[0];
          if (key) o[key] = r[i];
          else if (h.trim()) o[h.trim().toLowerCase().replace(/\s+/g, '_')] = r[i];
        });
        return o;
      });
      const out = await api.post('/api/contacts/import', { rows: payload, tags, optedIn });
      toast(`${out.created} added, ${out.updated} updated${out.invalid ? `, ${out.invalid} skipped (bad number)` : ''}`);
      reset();
      onDone();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Import contacts" description="Upload a CSV exported from Excel, Google Sheets or your CRM." icon={FileSpreadsheet} size="lg"
      footer={rows && <><Button variant="secondary" onClick={reset}>Choose another file</Button><Button onClick={submit} loading={busy} icon={Upload}>Import {num(rows.length)} contacts</Button></>}>
      {!rows ? (
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 px-6 py-14 text-center transition hover:border-brand-300 hover:bg-brand-50/40 dark:border-ink-600 dark:hover:bg-brand-500/5">
          <Upload className="size-8 text-brand-500" />
          <p className="mt-3 font-bold">Choose a CSV file</p>
          <p className="mt-1 text-sm text-slate-500">Columns like phone, name, email, tags. Any extra columns become custom fields you can use as {'{{column}}'} in messages.</p>
          <input type="file" accept=".csv,text/csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {['phone', 'name', 'email', 'tags'].map((field) => (
              <Field key={field} label={`${field[0].toUpperCase()}${field.slice(1)} column${field === 'phone' ? ' *' : ''}`}>
                <Select value={map[field] ?? ''} onChange={(e) => setMap({ ...map, [field]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                  <option value="">— not in file —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </Select>
              </Field>
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-ink-700">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-ink-850">
                <tr>{headers.map((h, i) => <th key={i} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.slice(0, 4).map((r, ri) => (
                  <tr key={ri} className="border-t border-slate-100 dark:border-ink-700">{headers.map((_, i) => <td key={i} className="truncate px-3 py-2">{r[i]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <Field label="Add tags to everyone in this file" hint="Comma separated, e.g. diwali-2026, delhi">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="imported" />
          </Field>
          <Toggle checked={optedIn} onChange={setOptedIn} label="These people agreed to receive WhatsApp messages from us"
            description="Marks them as opted in. Campaigns only send to opted-in contacts by default — this protects your number." />
        </div>
      )}
    </Modal>
  );
}

function ContactModal({ contact, onClose, onSaved }) {
  const isNew = contact === 'new';
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!contact) return;
    setForm(isNew ? { phone: '', name: '', email: '', tags: '', notes: '', optedIn: true } : { ...contact, tags: (contact.tags || []).join(', '), optedIn: Boolean(contact.opted_in) });
  }, [contact, isNew]);
  const save = async () => {
    setBusy(true);
    try {
      const body = { name: form.name, email: form.email, tags: form.tags, notes: form.notes, optedIn: form.optedIn };
      if (isNew) await api.post('/api/contacts', { ...body, phone: form.phone });
      else await api.patch(`/api/contacts/${contact.id}`, body);
      toast(isNew ? 'Contact added' : 'Contact saved');
      onSaved();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={Boolean(contact)} onClose={onClose} title={isNew ? 'Add contact' : 'Edit contact'} icon={isNew ? Plus : Pencil}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone number"><Input value={form.phone || ''} disabled={!isNew} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="919876543210" /></Field>
          <Field label="Name"><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        </div>
        <Field label="Email"><Input value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Tags" hint="Comma separated"><Input value={form.tags || ''} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="lead, vip" /></Field>
        <Field label="Notes"><Textarea value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        <Toggle checked={Boolean(form.optedIn)} onChange={(v) => setForm({ ...form, optedIn: v })} label="Opted in to WhatsApp messages" />
      </div>
    </Modal>
  );
}

export default function Contacts() {
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState(null);
  const [bulkTag, setBulkTag] = useState('');
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const query = useMemo(() => new URLSearchParams({ q, tag, status, page }).toString(), [q, tag, status, page]);
  const { data, loading, reload } = useLoad(() => api.get(`/api/contacts?${query}`), [query]);
  const tags = useLoad(() => api.get('/api/contacts/tags'), []);
  const stats = useLoad(() => api.get('/api/contacts/stats'), []);
  const refresh = () => {
    reload();
    tags.reload();
    stats.reload();
    setSelected(new Set());
  };
  const contacts = data?.contacts || [];
  const allSelected = contacts.length > 0 && contacts.every((c) => selected.has(c.id));

  const bulk = async (body, msg) => {
    try {
      await api.post('/api/contacts/bulk', { ids: [...selected], ...body });
      toast(msg);
      refresh();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const openChat = async (c) => {
    try {
      const numbers = await api.get('/api/numbers');
      const ready = numbers.numbers.find((n) => n.status === 'ready');
      if (!ready) return toast('Connect a WhatsApp number first.', 'error');
      const out = await api.post('/api/conversations/new', { sessionId: ready.id, phone: c.phone, name: c.name });
      navigate(`/inbox/${out.conversation.id}`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const s = stats.data || {};
  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Contacts"
        description="Your customer list with tags and consent. Campaigns use these tags as audiences."
        actions={
          <>
            <a href="/api/contacts/export.csv"><Button variant="secondary" icon={Download}>Export</Button></a>
            <Button variant="secondary" icon={Upload} onClick={() => setImporting(true)}>Import CSV</Button>
            <Button icon={Plus} onClick={() => setEditing('new')}>Add contact</Button>
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['All contacts', s.total, 'text-slate-900 dark:text-white'],
          ['Opted in', s.optedIn, 'text-emerald-600'],
          ['Opted out', s.optedOut, 'text-rose-600'],
          ['On WhatsApp (checked)', s.onWhatsapp, 'text-brand-600'],
        ].map(([l, v, c]) => (
          <Card key={l} className="px-4 py-3.5">
            <p className="text-xs font-semibold text-slate-500">{l}</p>
            <p className={cx('mt-1 text-2xl font-extrabold tabular-nums', c)}>{num(v || 0)}</p>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4 dark:border-ink-700">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name, phone or email" className="pl-9" />
          </div>
          <Select value={tag} onChange={(e) => { setTag(e.target.value); setPage(1); }} className="w-44">
            <option value="">All tags</option>
            {(tags.data?.tags || []).map((t) => <option key={t.name} value={t.name}>{t.name} ({t.count})</option>)}
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-44">
            <option value="">Any consent</option>
            <option value="opted_in">Opted in</option>
            <option value="no_consent">No consent yet</option>
            <option value="opted_out">Opted out</option>
          </Select>
        </div>
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50/60 px-4 py-2.5 dark:border-brand-500/20 dark:bg-brand-500/10">
            <span className="text-sm font-semibold">{selected.size} selected</span>
            <Input value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} placeholder="tag" className="h-8 w-32 py-1" />
            <Button size="xs" variant="secondary" icon={Tag} disabled={!bulkTag} onClick={() => bulk({ addTags: bulkTag }, 'Tag added')}>Add tag</Button>
            <Button size="xs" variant="secondary" disabled={!bulkTag} onClick={() => bulk({ removeTags: bulkTag }, 'Tag removed')}>Remove tag</Button>
            <Button size="xs" variant="secondary" icon={CheckCircle2} onClick={() => bulk({ optedIn: true }, 'Marked as opted in')}>Mark opted in</Button>
            <Button size="xs" variant="ghost" icon={Trash2} className="text-rose-600" onClick={async () => (await confirm({ title: `Delete ${selected.size} contacts?`, danger: true, confirmLabel: 'Delete' })) && bulk({ remove: true }, 'Deleted')}>Delete</Button>
          </div>
        )}
        {loading && !data ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : contacts.length === 0 ? (
          <EmptyState icon={Users} title="No contacts found" description="Import a CSV, add contacts manually, or just wait — everyone who messages you is added automatically." action={<Button icon={Upload} onClick={() => setImporting(true)}>Import CSV</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="border-b border-slate-100 dark:border-ink-700">
                <tr>
                  <th className="table-head w-10"><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(contacts.map((c) => c.id)))} className="size-4 accent-brand-600" /></th>
                  <th className="table-head">Contact</th>
                  <th className="table-head">Tags</th>
                  <th className="table-head">Consent</th>
                  <th className="table-head">Last message</th>
                  <th className="table-head text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-ink-700">
                {contacts.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/60 dark:hover:bg-ink-850">
                    <td className="table-cell"><input type="checkbox" checked={selected.has(c.id)} onChange={() => setSelected((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} className="size-4 accent-brand-600" /></td>
                    <td className="table-cell">
                      <div className="flex items-center gap-3">
                        <Avatar name={c.name || c.phone} seed={c.phone} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{c.name || '—'}</p>
                          <p className="text-xs text-slate-500">{phonePretty(c.phone)}{c.email ? ` · ${c.email}` : ''}</p>
                        </div>
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="flex max-w-64 flex-wrap gap-1">
                        {c.tags.length ? c.tags.slice(0, 4).map((t) => <span key={t} className="chip">{t}</span>) : <span className="text-xs text-slate-400">—</span>}
                        {c.tags.length > 4 && <span className="chip">+{c.tags.length - 4}</span>}
                      </div>
                    </td>
                    <td className="table-cell">
                      {c.opted_out ? <Badge tone="red"><Ban className="size-3" /> Opted out</Badge> : c.opted_in ? <Badge tone="green"><ShieldCheck className="size-3" /> Opted in</Badge> : <Badge>No consent</Badge>}
                    </td>
                    <td className="table-cell text-slate-500">{c.last_message_at ? timeAgo(c.last_message_at) : '—'}</td>
                    <td className="table-cell text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="iconSm" variant="ghost" title="Open chat" onClick={() => openChat(c)}><MessageCircle className="size-4" /></Button>
                        <Button size="iconSm" variant="ghost" title="Edit" onClick={() => setEditing(c)}><Pencil className="size-4" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm dark:border-ink-700">
            <span className="text-slate-500">Page {data.page} of {Math.ceil(data.total / data.pageSize)} · {num(data.total)} contacts</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="secondary" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
      <Callout tone="brand" icon={ShieldCheck} className="mt-5">
        People who reply <b>STOP</b> (or your custom opt-out words) are unsubscribed automatically and skipped by every campaign.
      </Callout>
      <ImportModal open={importing} onClose={() => setImporting(false)} onDone={() => { setImporting(false); refresh(); }} />
      <ContactModal contact={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
    </div>
  );
}
