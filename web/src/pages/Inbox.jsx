import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  Search,
  Plus,
  Send,
  Paperclip,
  Sparkles,
  FileText,
  Check,
  CheckCheck,
  Clock3,
  AlertCircle,
  Users2,
  BotOff,
  Bot,
  PanelRightOpen,
  PanelRightClose,
  ArrowLeft,
  CheckCircle2,
  RotateCcw,
  X,
  MessageSquareDashed,
  StickyNote,
  Tag,
  BadgeCheck,
  Download,
  Smartphone,
} from 'lucide-react';
import { api, fileToBase64, mediaKindFor } from '../lib/api.js';
import { useLive, useToast, useAuth } from '../lib/app.jsx';
import { Avatar, Badge, Button, EmptyState, Field, Input, Modal, Select, Spinner, Textarea, Toggle, cx } from '../components/ui.jsx';
import { chatTime, clock, dayLabel, phonePretty, timeAgo } from '../lib/format.js';

const FILTERS = [
  { value: 'open', label: 'Open', status: 'open' },
  { value: 'mine', label: 'Mine', status: 'all', assigned: 'me' },
  { value: 'unassigned', label: 'Unassigned', status: 'all', assigned: 'unassigned' },
  { value: 'pending', label: 'Pending', status: 'pending' },
  { value: 'closed', label: 'Closed', status: 'closed' },
];
const AUTHOR_LABEL = { bot: 'Auto-reply', ai: 'AI', campaign: 'Campaign', api: 'API', phone: 'From phone' };

function Tick({ status }) {
  if (status === 'pending') return <Clock3 className="size-3.5 opacity-70" />;
  if (status === 'failed') return <AlertCircle className="size-3.5 text-rose-300" />;
  if (status === 'read') return <CheckCheck className="size-3.5 text-cyan-200" />;
  if (status === 'delivered') return <CheckCheck className="size-3.5 opacity-80" />;
  return <Check className="size-3.5 opacity-80" />;
}

function MessageBubble({ m, isGroup }) {
  const out = m.direction === 'out';
  const isImage = m.media_path && (m.type === 'image' || m.type === 'sticker' || String(m.media_mime).startsWith('image/'));
  const isVideo = m.media_path && (m.type === 'video' || String(m.media_mime).startsWith('video/'));
  const isAudio = m.media_path && (['audio', 'voice', 'ptt'].includes(m.type) || String(m.media_mime).startsWith('audio/'));
  const isDoc = !isImage && !isVideo && !isAudio && (m.type === 'document' || m.media_name);
  return (
    <div className={cx('flex', out ? 'justify-end' : 'justify-start')}>
      <div
        className={cx(
          'group relative max-w-[min(78%,560px)] rounded-2xl px-3.5 py-2 text-[14.5px] leading-relaxed shadow-sm',
          out
            ? 'rounded-br-md bg-gradient-to-br from-brand-600 to-brand-700 text-white'
            : 'rounded-bl-md bg-white text-slate-800 ring-1 ring-slate-200/70 dark:bg-ink-800 dark:text-slate-100 dark:ring-ink-700',
          m.status === 'failed' && 'from-rose-600 to-rose-700',
        )}
      >
        {!out && isGroup && m.author && <p className="mb-0.5 text-xs font-bold text-brand-600 dark:text-brand-300">{m.author}</p>}
        {out && AUTHOR_LABEL[m.author] && (
          <p className="mb-0.5 flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider text-white/70">
            {m.author === 'ai' ? <Sparkles className="size-3" /> : m.author === 'bot' ? <Bot className="size-3" /> : null}
            {AUTHOR_LABEL[m.author]}
          </p>
        )}
        {isImage && (
          <a href={m.media_path} target="_blank" rel="noreferrer">
            <img src={m.media_path} alt="" className="mb-1.5 max-h-80 rounded-xl object-cover" loading="lazy" />
          </a>
        )}
        {isVideo && <video src={m.media_path} controls className="mb-1.5 max-h-80 rounded-xl" />}
        {isAudio && <audio src={m.media_path} controls className="mb-1.5 w-64 max-w-full" />}
        {isDoc && (
          <a
            href={m.media_path || undefined}
            target="_blank"
            rel="noreferrer"
            className={cx('mb-1.5 flex items-center gap-3 rounded-xl p-2.5', out ? 'bg-white/10' : 'bg-slate-50 dark:bg-ink-700')}
          >
            <FileText className="size-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.media_name || 'Document'}</span>
            {m.media_path && <Download className="size-4 opacity-70" />}
          </a>
        )}
        {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
        {!m.body && !m.media_path && !isDoc && <p className="italic opacity-70">[{m.type}]</p>}
        <div className={cx('mt-0.5 flex items-center justify-end gap-1 text-[10.5px]', out ? 'text-white/70' : 'text-slate-400')}>
          {clock(m.created_at)}
          {out && <Tick status={m.status} />}
        </div>
        {m.status === 'failed' && m.error && <p className="mt-1 border-t border-white/20 pt-1 text-xs text-white/90">{m.error}</p>}
      </div>
    </div>
  );
}

function ConversationItem({ c, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition',
        active ? 'bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-500/10 dark:ring-brand-500/25' : 'hover:bg-slate-50 dark:hover:bg-ink-850',
      )}
    >
      <div className="relative">
        <Avatar name={c.name || c.phone || '#'} seed={c.chat_id} />
        {c.is_group ? (
          <span className="absolute -right-1 -bottom-1 rounded-full bg-white p-0.5 dark:bg-ink-900"><Users2 className="size-3.5 text-slate-500" /></span>
        ) : c.channel === 'meta' ? (
          <span className="absolute -right-1 -bottom-1 rounded-full bg-white p-0.5 dark:bg-ink-900"><BadgeCheck className="size-3.5 text-sky-500" /></span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className={cx('min-w-0 flex-1 truncate text-sm', c.unread ? 'font-extrabold' : 'font-semibold')}>{c.name || phonePretty(c.phone) || c.chat_id}</p>
          <span className={cx('shrink-0 text-[11px]', c.unread ? 'font-bold text-brand-600 dark:text-brand-400' : 'text-slate-400')}>{chatTime(c.last_at)}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p className={cx('min-w-0 flex-1 truncate text-[13px]', c.unread ? 'text-slate-800 dark:text-slate-200' : 'text-slate-500')}>
            {c.last_direction === 'out' && <span className="text-slate-400">You: </span>}
            {c.last_message || 'No messages yet'}
          </p>
          {c.bot_paused ? <BotOff className="size-3.5 shrink-0 text-amber-500" title="Bot paused" /> : null}
          {c.unread > 0 && <span className="min-w-5 shrink-0 rounded-full bg-brand-600 px-1.5 text-center text-[11px] font-bold text-white tabular-nums">{c.unread}</span>}
        </div>
        {c.assignee_name && <p className="mt-1 truncate text-[11px] font-medium text-slate-400">→ {c.assignee_name}</p>}
      </div>
    </button>
  );
}

function NewChatModal({ open, onClose, numbers, onStarted }) {
  const [form, setForm] = useState({ sessionId: '', phone: '', name: '', text: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (open && !form.sessionId) setForm((f) => ({ ...f, sessionId: numbers.find((n) => n.status === 'ready')?.id || '' }));
  }, [open, numbers]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    setBusy(true);
    try {
      const out = await api.post('/api/conversations/start', form);
      onStarted(out.conversation);
      setForm({ sessionId: form.sessionId, phone: '', name: '', text: '' });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="New conversation" icon={Plus}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={Send} loading={busy} onClick={submit} disabled={!form.sessionId || !form.phone || !form.text}>Send</Button></>}>
      <div className="space-y-4">
        <Field label="Send from">
          <Select value={form.sessionId} onChange={(e) => setForm({ ...form, sessionId: e.target.value })}>
            <option value="">Choose a number…</option>
            {numbers.map((n) => <option key={n.id} value={n.id} disabled={n.status !== 'ready'}>{n.label}{n.status !== 'ready' ? ' (not connected)' : ''}</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone number" hint="With country code, or 10 digits for India."><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="919876543210" /></Field>
          <Field label="Name (optional)"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Customer name" /></Field>
        </div>
        <Field label="Message"><Textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="Hi! 👋" /></Field>
      </div>
    </Modal>
  );
}

function DetailsPanel({ conv, users, onChange, onClose }) {
  const [data, setData] = useState(null);
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const toast = useToast();
  const load = useCallback(() => api.get(`/api/conversations/${conv.id}`).then((d) => { setData(d); setTags((d.contact?.tags ? JSON.parse(d.contact.tags) : []).join(', ')); }), [conv.id]);
  useEffect(() => { load(); }, [load]);

  const addNote = async () => {
    if (!note.trim()) return;
    await api.post(`/api/conversations/${conv.id}/notes`, { body: note });
    setNote('');
    load();
  };
  const saveTags = async () => {
    if (!data?.contact) return;
    await api.patch(`/api/contacts/${data.contact.id}`, { tags });
    toast('Tags saved');
  };
  const consent = async (field, value) => {
    await api.patch(`/api/contacts/${data.contact.id}`, { [field]: value });
    load();
  };

  return (
    <aside className="flex h-full w-full flex-col border-l border-slate-200 bg-white xl:w-80 dark:border-ink-800 dark:bg-ink-900">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-ink-800">
        <p className="font-bold">Details</p>
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-ink-800"><X className="size-4" /></button>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto p-5">
        <div className="text-center">
          <Avatar name={conv.name || conv.phone} seed={conv.chat_id} size="lg" className="mx-auto" />
          <p className="mt-3 font-bold">{conv.name || 'Unknown'}</p>
          <p className="text-sm text-slate-500">{conv.is_group ? 'Group chat' : phonePretty(conv.phone)}</p>
        </div>
        <Field label="Assigned to">
          <Select value={conv.assigned_to || ''} onChange={(e) => onChange({ assignedTo: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </Field>
        <Toggle checked={!conv.bot_paused} onChange={(v) => onChange({ botPaused: !v })} label="Automations & AI" description="Auto-replies for this chat. Pause it while a person handles the customer." />
        {data?.contact && (
          <>
            <div>
              <p className="label flex items-center gap-1.5"><Tag className="size-3.5" /> Tags</p>
              <div className="flex gap-2">
                <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="lead, delhi, vip" />
                <Button size="sm" variant="secondary" onClick={saveTags}>Save</Button>
              </div>
            </div>
            <div className="space-y-3 rounded-2xl bg-slate-50 p-4 dark:bg-ink-850">
              <Toggle checked={Boolean(data.contact.opted_in) && !data.contact.opted_out} onChange={(v) => consent('optedIn', v)} label="Opted in" description="Agreed to receive campaigns." />
              <Toggle checked={Boolean(data.contact.opted_out)} onChange={(v) => consent('optedOut', v)} label="Opted out" description="Never include in campaigns." />
            </div>
          </>
        )}
        <div>
          <p className="label flex items-center gap-1.5"><StickyNote className="size-3.5" /> Internal notes</p>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only your team sees notes…" className="min-h-20" />
          <Button size="sm" variant="soft" className="mt-2" onClick={addNote} disabled={!note.trim()}>Add note</Button>
          <ul className="mt-3 space-y-2">
            {data?.notes.map((n) => (
              <li key={n.id} className="rounded-xl bg-amber-50 p-3 text-sm dark:bg-amber-500/10">
                <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{n.body}</p>
                <p className="mt-1 text-[11px] text-slate-500">{n.author} · {timeAgo(n.created_at)}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}

export default function Inbox() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const [filter, setFilter] = useState('open');
  const [q, setQ] = useState('');
  const [numberFilter, setNumberFilter] = useState('');
  const [list, setList] = useState([]);
  const [counts, setCounts] = useState({});
  const [loadingList, setLoadingList] = useState(true);
  const [numbers, setNumbers] = useState([]);
  const [users, setUsers] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [conv, setConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [showDetails, setShowDetails] = useState(() => window.innerWidth >= 1280);
  const [showNew, setShowNew] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const activeId = id ? Number(id) : null;

  const f = FILTERS.find((x) => x.value === filter);
  const loadList = useCallback(async () => {
    const params = new URLSearchParams({ status: f.status });
    if (f.assigned) params.set('assigned', f.assigned);
    if (q) params.set('q', q);
    if (numberFilter) params.set('sessionId', numberFilter);
    try {
      const out = await api.get(`/api/conversations?${params}`);
      setList(out.conversations);
      setCounts(out.counts || {});
    } finally {
      setLoadingList(false);
    }
  }, [f, q, numberFilter]);

  useEffect(() => {
    const t = setTimeout(loadList, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadList, q]);

  useEffect(() => {
    api.get('/api/numbers').then((d) => setNumbers(d.numbers)).catch(() => {});
    api.get('/api/team').then((d) => setUsers(d.users.filter((u) => u.active))).catch(() => {});
    api.get('/api/templates').then((d) => setTemplates(d.templates)).catch(() => {});
  }, []);

  // Open a conversation
  useEffect(() => {
    if (!activeId) {
      setConv(null);
      return;
    }
    let cancelled = false;
    setLoadingMsgs(true);
    setMessages([]);
    Promise.all([api.get(`/api/conversations/${activeId}`), api.get(`/api/conversations/${activeId}/messages`)])
      .then(([c, m]) => {
        if (cancelled) return;
        setConv(c.conversation);
        setMessages(m.messages);
        if (c.conversation.unread) {
          api.post(`/api/conversations/${activeId}/read`).catch(() => {});
          setList((l) => l.map((x) => (x.id === activeId ? { ...x, unread: 0 } : x)));
        }
      })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => !cancelled && setLoadingMsgs(false));
    return () => {
      cancelled = true;
    };
  }, [activeId, toast]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, activeId]);

  // Live updates
  useLive('message', ({ message, conversation }) => {
    if (!conversation) return;
    setList((l) => {
      const rest = l.filter((x) => x.id !== conversation.id);
      const matches =
        (f.status === 'all' || conversation.status === f.status) &&
        (!f.assigned || (f.assigned === 'me' ? conversation.assigned_to === user.id : !conversation.assigned_to)) &&
        (!numberFilter || conversation.session_id === numberFilter);
      const updated = conversation.id === activeId ? { ...conversation, unread: 0 } : conversation;
      return matches ? [updated, ...rest] : rest;
    });
    if (conversation.id === activeId) {
      setMessages((ms) => (ms.some((m) => m.id === message.id) ? ms : [...ms, message]));
      setConv(conversation);
      if (message.direction === 'in') api.post(`/api/conversations/${activeId}/read`).catch(() => {});
    }
  });
  useLive('message.status', (d) => {
    if (d.conversationId === activeId) setMessages((ms) => ms.map((m) => (m.id === d.id ? { ...m, status: d.status, error: d.error ?? m.error } : m)));
  });
  useLive('conversation', (c) => {
    setList((l) => l.map((x) => (x.id === c.id ? { ...x, ...c } : x)));
    if (c.id === activeId) setConv((old) => ({ ...old, ...c }));
  });

  const update = async (patch) => {
    try {
      const out = await api.patch(`/api/conversations/${activeId}`, patch);
      setConv(out.conversation);
      if (patch.status) {
        toast(patch.status === 'closed' ? 'Conversation closed' : 'Conversation reopened');
        loadList();
      }
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const send = async () => {
    if ((!text.trim() && !attachment) || sending) return;
    setSending(true);
    try {
      let media;
      if (attachment) {
        media = {
          kind: mediaKindFor(attachment.type),
          base64: await fileToBase64(attachment),
          mimetype: attachment.type || 'application/octet-stream',
          filename: attachment.name,
          caption: text.trim() || undefined,
        };
      }
      await api.post(`/api/conversations/${activeId}/messages`, { text: text.trim(), media });
      setText('');
      setAttachment(null);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const aiDraft = async () => {
    setDrafting(true);
    try {
      const out = await api.post(`/api/conversations/${activeId}/ai-draft`);
      if (out.text) setText(out.text);
      else toast('AI had nothing to suggest for this chat.', 'info');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setDrafting(false);
    }
  };

  const slash = text.startsWith('/') ? text.slice(1).toLowerCase() : null;
  const slashMatches = useMemo(
    () => (slash == null ? [] : templates.filter((t) => (t.shortcut || '').toLowerCase().startsWith(slash) || t.name.toLowerCase().includes(slash)).slice(0, 6)),
    [slash, templates],
  );
  const applyTemplate = (t) => {
    const name = conv?.name || 'there';
    setText(t.body.replace(/\{\{\s*(name|first_name)\s*\}\}/g, (m, k) => (k === 'first_name' ? name.split(' ')[0] : name)));
    setShowTemplates(false);
  };

  const grouped = useMemo(() => {
    const out = [];
    let last = '';
    for (const m of messages) {
      const d = new Date(m.created_at).toDateString();
      if (d !== last) {
        out.push({ divider: dayLabel(m.created_at), key: `d-${m.id}` });
        last = d;
      }
      out.push(m);
    }
    return out;
  }, [messages]);

  const number = numbers.find((n) => n.id === conv?.session_id);
  const canSend = conv && (conv.channel === 'meta' || number?.status === 'ready');

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <section className={cx('flex w-full flex-col border-r border-slate-200 bg-white md:w-[340px] md:shrink-0 dark:border-ink-800 dark:bg-ink-900', activeId && 'hidden md:flex')}>
        <div className="space-y-3 border-b border-slate-100 p-4 dark:border-ink-800">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-extrabold tracking-tight">Inbox</h1>
            <Button size="sm" icon={Plus} onClick={() => setShowNew(true)}>New</Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number, message" className="pl-9" />
          </div>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
            {FILTERS.map((x) => {
              const count = { open: counts.open, mine: counts.mine, unassigned: counts.unassigned, pending: counts.pending, closed: null }[x.value];
              return (
                <button key={x.value} onClick={() => setFilter(x.value)}
                  className={cx('shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition', filter === x.value ? 'bg-ink-900 text-white dark:bg-white dark:text-ink-900' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-ink-800 dark:text-slate-300')}>
                  {x.label}{count ? ` ${count}` : ''}
                </button>
              );
            })}
          </div>
          {numbers.length > 1 && (
            <Select value={numberFilter} onChange={(e) => setNumberFilter(e.target.value)} className="py-2 text-xs">
              <option value="">All numbers</option>
              {numbers.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </Select>
          )}
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {loadingList ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : list.length === 0 ? (
            <EmptyState icon={MessageSquareDashed} title="No conversations" description={filter === 'open' ? 'New WhatsApp messages land here instantly. Tip: use “Sync chats” on a connected number to import recent chats.' : 'Nothing in this view.'} />
          ) : (
            list.map((c) => <ConversationItem key={c.id} c={c} active={c.id === activeId} onClick={() => navigate(`/inbox/${c.id}`)} />)
          )}
        </div>
      </section>

      {/* Thread */}
      <section className={cx('min-w-0 flex-1 flex-col', activeId ? 'flex' : 'hidden md:flex')}>
        {!activeId ? (
          <div className="chat-wallpaper flex h-full items-center justify-center">
            <EmptyState icon={MessageSquareDashed} title="Pick a conversation" description="Choose a chat on the left, or start a new one. Replies go out from the number the customer wrote to." action={<Button icon={Plus} onClick={() => setShowNew(true)}>New conversation</Button>} />
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-ink-800 dark:bg-ink-900">
              <button onClick={() => navigate('/inbox')} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden dark:hover:bg-ink-800"><ArrowLeft className="size-5" /></button>
              {conv && <Avatar name={conv.name || conv.phone} seed={conv.chat_id} size="sm" />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{conv?.name || phonePretty(conv?.phone) || '…'}</p>
                <p className="flex items-center gap-1.5 truncate text-xs text-slate-500">
                  {conv?.channel === 'meta' ? <BadgeCheck className="size-3.5 text-sky-500" /> : <Smartphone className="size-3.5" />}
                  {number?.label || (conv?.channel === 'meta' ? 'Official API' : 'Number')}
                  {conv?.phone && !conv?.is_group && <span>· {phonePretty(conv.phone)}</span>}
                </p>
              </div>
              {conv?.bot_paused ? <Badge tone="amber" className="hidden sm:inline-flex"><BotOff className="size-3" /> Bot paused</Badge> : null}
              {conv?.status === 'closed' ? (
                <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => update({ status: 'open' })}>Reopen</Button>
              ) : (
                <Button size="sm" variant="secondary" icon={CheckCircle2} onClick={() => update({ status: 'closed' })}>Close</Button>
              )}
              <button onClick={() => setShowDetails((v) => !v)} className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 sm:block dark:hover:bg-ink-800" title="Details">
                {showDetails ? <PanelRightClose className="size-4.5" /> : <PanelRightOpen className="size-4.5" />}
              </button>
            </header>

            <div ref={scrollRef} className="chat-wallpaper flex-1 space-y-1.5 overflow-y-auto px-3 py-5 sm:px-8">
              {loadingMsgs ? (
                <div className="flex justify-center py-16"><Spinner /></div>
              ) : messages.length === 0 ? (
                <p className="py-16 text-center text-sm text-slate-500">No messages stored yet for this chat.</p>
              ) : (
                grouped.map((m) =>
                  m.divider ? (
                    <div key={m.key} className="flex justify-center py-3">
                      <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-slate-500 shadow-sm ring-1 ring-slate-200/60 dark:bg-ink-800 dark:text-slate-300 dark:ring-ink-700">{m.divider}</span>
                    </div>
                  ) : (
                    <MessageBubble key={m.id} m={m} isGroup={Boolean(conv?.is_group)} />
                  ),
                )
              )}
            </div>

            <footer className="relative border-t border-slate-200 bg-white p-3 sm:px-5 dark:border-ink-800 dark:bg-ink-900">
              {!canSend && conv && (
                <p className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                  This number is not connected right now. <Link to="/numbers" className="underline">Reconnect it</Link> to reply.
                </p>
              )}
              {(slashMatches.length > 0 || showTemplates) && (
                <div className="absolute right-3 bottom-full left-3 mb-2 max-h-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[var(--shadow-pop)] sm:left-5 sm:max-w-md dark:border-ink-600 dark:bg-ink-800">
                  <p className="px-3 pt-1.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">Templates</p>
                  {(showTemplates ? templates : slashMatches).map((t) => (
                    <button key={t.id} onClick={() => applyTemplate(t)} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-ink-700">
                      <p className="text-sm font-semibold">{t.name} {t.shortcut && <span className="kbd ml-1">/{t.shortcut}</span>}</p>
                      <p className="truncate text-xs text-slate-500">{t.body}</p>
                    </button>
                  ))}
                  {showTemplates && templates.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">No templates yet. <Link to="/templates" className="text-brand-600 underline">Create one</Link>.</p>}
                </div>
              )}
              {attachment && (
                <div className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-ink-800">
                  <Paperclip className="size-4 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                  <span className="text-xs text-slate-400">{(attachment.size / 1024 / 1024).toFixed(1)} MB</span>
                  <button onClick={() => setAttachment(null)} className="text-slate-400 hover:text-slate-700"><X className="size-4" /></button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <input ref={fileRef} type="file" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && file.size > 16 * 1024 * 1024) toast('Files up to 16 MB only.', 'error');
                  else if (file) setAttachment(file);
                  e.target.value = '';
                }} />
                <div className="flex gap-0.5 pb-1">
                  <Button variant="ghost" size="iconSm" onClick={() => fileRef.current?.click()} title="Attach file"><Paperclip className="size-4.5" /></Button>
                  <Button variant="ghost" size="iconSm" onClick={() => setShowTemplates((v) => !v)} title="Templates"><FileText className="size-4.5" /></Button>
                  <Button variant="ghost" size="iconSm" onClick={aiDraft} loading={drafting} title="Draft reply with AI"><Sparkles className="size-4.5 text-violet-500" /></Button>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !slashMatches.length) {
                      e.preventDefault();
                      send();
                    }
                    if (e.key === 'Escape') setShowTemplates(false);
                  }}
                  rows={Math.min(6, Math.max(1, text.split('\n').length))}
                  placeholder={canSend ? 'Type a message…  ( / for templates, Shift+Enter for new line )' : 'Number not connected'}
                  disabled={!canSend}
                  className="input max-h-40 min-h-11 flex-1 resize-none py-2.5"
                />
                <Button size="icon" onClick={send} loading={sending} disabled={!canSend || (!text.trim() && !attachment)} className="mb-0.5 size-11" title="Send (Enter)">
                  {!sending && <Send className="size-4.5" />}
                </Button>
              </div>
            </footer>
          </>
        )}
      </section>

      {activeId && conv && showDetails && (
        <div className="fixed inset-0 z-30 flex justify-end bg-slate-950/40 xl:static xl:z-auto xl:bg-transparent" onClick={(e) => e.target === e.currentTarget && setShowDetails(false)}>
          <div className="h-full w-[min(360px,90vw)] xl:w-80">
            <DetailsPanel conv={conv} users={users} onChange={update} onClose={() => setShowDetails(false)} />
          </div>
        </div>
      )}

      <NewChatModal open={showNew} onClose={() => setShowNew(false)} numbers={numbers.filter((n) => n.channel !== 'meta' || n.status === 'ready')} onStarted={(c) => { setShowNew(false); loadList(); navigate(`/inbox/${c.id}`); }} />
    </div>
  );
}

