import { useState } from 'react';
import { UserCog, Plus, ShieldCheck, Trash2, KeyRound } from 'lucide-react';
import { api } from '../lib/api.js';
import { useLoad, useToast, useAuth } from '../lib/app.jsx';
import { Avatar, Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Toggle, useConfirm, Spinner } from '../components/ui.jsx';
import { timeAgo } from '../lib/format.js';

export default function Team() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data, loading, reload } = useLoad(() => api.get('/api/team'), []);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'agent' });
  const [resetFor, setResetFor] = useState(null);
  const [newPass, setNewPass] = useState('');
  const toast = useToast();
  const confirm = useConfirm();

  const add = async () => {
    try {
      await api.post('/api/team', form);
      toast(`${form.name} added — share their email and password with them.`);
      setAdding(false);
      setForm({ name: '', email: '', password: '', role: 'agent' });
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const update = async (u, patch) => {
    try {
      await api.put(`/api/team/${u.id}`, patch);
      reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Admin" title="Team" description="Agents answer chats in the inbox. Admins also manage numbers, integrations and settings."
        actions={isAdmin && <Button icon={Plus} onClick={() => setAdding(true)}>Add teammate</Button>} />
      <Card>
        {loading && !data ? <div className="flex justify-center py-16"><Spinner /></div> : (
          <ul className="divide-y divide-slate-100 dark:divide-ink-700">
            {data.users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <Avatar name={u.name} />
                <div className="min-w-48 flex-1">
                  <p className="font-semibold">{u.name} {u.id === user.id && <span className="text-xs font-normal text-slate-400">(you)</span>}</p>
                  <p className="text-sm text-slate-500">{u.email} · {u.last_login ? `active ${timeAgo(u.last_login)}` : 'never signed in'}</p>
                </div>
                {isAdmin ? (
                  <>
                    <Select value={u.role} onChange={(e) => update(u, { role: e.target.value })} className="w-32 py-2">
                      <option value="agent">Agent</option>
                      <option value="admin">Admin</option>
                    </Select>
                    <Toggle checked={Boolean(u.active)} onChange={(v) => update(u, { active: v })} />
                    <Button size="iconSm" variant="ghost" title="Reset password" onClick={() => setResetFor(u)}><KeyRound className="size-4" /></Button>
                    {u.id !== user.id && <Button size="iconSm" variant="ghost" onClick={async () => { if (await confirm({ title: `Remove ${u.name}?`, danger: true, confirmLabel: 'Remove' })) { try { await api.del(`/api/team/${u.id}`); reload(); } catch (e) { toast(e.message, 'error'); } } }}><Trash2 className="size-4 text-rose-500" /></Button>}
                  </>
                ) : (
                  <Badge tone={u.role === 'admin' ? 'brand' : 'slate'}>{u.role === 'admin' ? <ShieldCheck className="size-3" /> : null}{u.role}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add teammate" icon={UserCog}
        footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button onClick={add}>Add</Button></>}>
        <div className="space-y-4">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Temporary password" hint="At least 8 characters. They can change it in Settings → Account."><Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="agent">Agent — inbox, contacts, campaigns</option>
              <option value="admin">Admin — everything</option>
            </Select>
          </Field>
        </div>
      </Modal>
      <Modal open={Boolean(resetFor)} onClose={() => setResetFor(null)} title={`Reset password for ${resetFor?.name}`} icon={KeyRound} size="sm"
        footer={<><Button variant="secondary" onClick={() => setResetFor(null)}>Cancel</Button><Button onClick={async () => { await update(resetFor, { password: newPass }); toast('Password updated'); setResetFor(null); setNewPass(''); }} disabled={newPass.length < 8}>Save</Button></>}>
        <Field label="New password"><Input value={newPass} onChange={(e) => setNewPass(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}
