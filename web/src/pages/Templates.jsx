import { useEffect, useState } from 'react';
import { FileText, Plus, Pencil, Trash2, Braces } from 'lucide-react';
import { api } from '../lib/api.js';
import { useLoad, useToast } from '../lib/app.jsx';
import { Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea, useConfirm, Spinner } from '../components/ui.jsx';

export const VARIABLES = ['{{name}}', '{{first_name}}', '{{phone}}', '{{business}}'];

export function WhatsAppPreview({ text }) {
  const html = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/_([^_\n]+)_/g, '<i>$1</i>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>');
  return (
    <div className="chat-wallpaper rounded-2xl p-4">
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-brand-600 to-brand-700 px-3.5 py-2 text-[14px] leading-relaxed text-white shadow-sm">
        <p className="whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: html || '<span style="opacity:.6">Your message preview</span>' }} />
        <p className="mt-0.5 text-right text-[10px] text-white/70">12:30 ✓✓</p>
      </div>
    </div>
  );
}

function Editor({ template, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (template) setForm(template === 'new' ? { name: '', body: '', category: 'general', shortcut: '' } : { ...template });
  }, [template]);
  useEffect(() => {
    const t = setTimeout(() => api.post('/api/templates/preview', { body: form.body }).then((d) => setPreview(d.text)).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [form.body]);
  const insert = (v) => setForm((f) => ({ ...f, body: `${f.body || ''}${v}` }));
  const save = async () => {
    setBusy(true);
    try {
      if (template === 'new') await api.post('/api/templates', form);
      else await api.put(`/api/templates/${template.id}`, form);
      toast('Template saved');
      onSaved();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={Boolean(template)} onClose={onClose} title={template === 'new' ? 'New template' : 'Edit template'} icon={FileText} size="xl"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save template</Button></>}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Order shipped" /></Field>
            <Field label="Shortcut" hint="Type /shortcut in the inbox"><Input value={form.shortcut || ''} onChange={(e) => setForm({ ...form, shortcut: e.target.value })} placeholder="shipped" /></Field>
          </div>
          <Field label="Category">
            <Select value={form.category || 'general'} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {['general', 'sales', 'support', 'marketing', 'billing'].map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
            </Select>
          </Field>
          <Field label="Message" hint="*bold*  _italic_  ~strike~ · {Hi|Hello|Hey} picks one at random so bulk messages vary.">
            <Textarea value={form.body || ''} onChange={(e) => setForm({ ...form, body: e.target.value })} className="min-h-44" placeholder={'Hi {{first_name}}! 👋\nYour order is on its way.'} />
          </Field>
          <div className="flex flex-wrap items-center gap-1.5">
            <Braces className="size-4 text-slate-400" />
            {VARIABLES.map((v) => <button key={v} onClick={() => insert(v)} className="chip hover:bg-brand-100 hover:text-brand-700">{v}</button>)}
          </div>
        </div>
        <div>
          <p className="label">Preview (sample contact “Priya Sharma”)</p>
          <WhatsAppPreview text={preview} />
        </div>
      </div>
    </Modal>
  );
}

export default function Templates() {
  const { data, loading, reload } = useLoad(() => api.get('/api/templates'), []);
  const [editing, setEditing] = useState(null);
  const confirm = useConfirm();
  const toast = useToast();
  const list = data?.templates || [];
  const remove = async (t) => {
    if (!(await confirm({ title: `Delete “${t.name}”?`, danger: true, confirmLabel: 'Delete' }))) return;
    await api.del(`/api/templates/${t.id}`);
    toast('Deleted');
    reload();
  };
  return (
    <div>
      <PageHeader eyebrow="Automate" title="Templates" description="Saved replies for the inbox, campaigns, automations and the API. Personalise with variables."
        actions={<Button icon={Plus} onClick={() => setEditing('new')}>New template</Button>} />
      {loading && !data ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : list.length === 0 ? (
        <Card><EmptyState icon={FileText} title="No templates yet" description="Create quick replies like greetings, pricing, address or payment details." action={<Button icon={Plus} onClick={() => setEditing('new')}>Create template</Button>} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => (
            <Card key={t.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold">{t.name}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                    <span className="capitalize">{t.category}</span>
                    {t.shortcut && <span className="kbd">/{t.shortcut}</span>}
                  </p>
                </div>
                <div className="flex gap-0.5">
                  <Button size="iconSm" variant="ghost" onClick={() => setEditing(t)}><Pencil className="size-4" /></Button>
                  <Button size="iconSm" variant="ghost" onClick={() => remove(t)}><Trash2 className="size-4 text-rose-500" /></Button>
                </div>
              </div>
              <p className="mt-3 line-clamp-5 flex-1 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-ink-850 dark:text-slate-300">{t.body}</p>
            </Card>
          ))}
        </div>
      )}
      <Editor template={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
    </div>
  );
}
