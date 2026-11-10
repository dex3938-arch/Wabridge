import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Pause, Play, XCircle, RotateCcw, Copy, Trash2, Send, AlertTriangle, CheckCircle2, Clock, Ban, MessageCircleReply, Pencil } from 'lucide-react';
import { api } from '../lib/api.js';
import { useLoad, useLive, useToast } from '../lib/app.jsx';
import { Badge, Button, Card, CardHeader, Spinner, Callout, useConfirm, Stat } from '../components/ui.jsx';
import { CAMPAIGN_STATUS, dateTime, num, phonePretty, timeAgo } from '../lib/format.js';
import { Progress } from './Campaigns.jsx';
import { WhatsAppPreview } from './Templates.jsx';

const R_STATUS = {
  sent: { tone: 'green', label: 'Sent', icon: CheckCircle2 },
  failed: { tone: 'red', label: 'Failed', icon: AlertTriangle },
  pending: { tone: 'slate', label: 'Waiting', icon: Clock },
  skipped: { tone: 'amber', label: 'Skipped', icon: Ban },
};

export default function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, reload, setData } = useLoad(() => api.get(`/api/campaigns/${id}`), [id]);
  useLive('campaign', (c) => {
    if (c && String(c.id) === String(id)) {
      setData((d) => d && { ...d, campaign: c });
      if (['completed', 'paused'].includes(c.status)) reload();
    }
  });

  if (loading && !data) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!data) return null;
  const c = data.campaign;
  const st = CAMPAIGN_STATUS[c.status] || { label: c.status, tone: 'slate' };

  const act = async (path, msg, opts) => {
    if (opts && !(await confirm(opts))) return;
    try {
      const out = await api.post(`/api/campaigns/${c.id}/${path}`);
      toast(msg);
      if (path === 'duplicate') navigate(`/campaigns/${out.campaign.id}/edit`);
      else reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this campaign?', description: 'Its stats and recipient list are removed. Messages already sent stay in the inbox.', danger: true, confirmLabel: 'Delete' }))) return;
    try {
      await api.del(`/api/campaigns/${c.id}`);
      navigate('/campaigns');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const replyRate = c.sent ? Math.round((data.replies / c.sent) * 100) : 0;

  return (
    <div>
      <Link to="/campaigns" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white"><ArrowLeft className="size-4" /> Campaigns</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">{c.name}</h1>
            <Badge tone={st.tone} dot={c.status === 'running' ? 'pulse' : true}>{st.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {c.channel === 'meta' ? 'Official Cloud API' : 'Linked number'} · {c.status === 'scheduled' ? `starts ${dateTime(c.schedule_at)}` : `started ${dateTime(c.started_at)}`}
            {c.finished_at ? ` · finished ${dateTime(c.finished_at)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {['running', 'scheduled'].includes(c.status) && <Button variant="secondary" icon={Pause} onClick={() => act('pause', 'Paused')}>Pause</Button>}
          {c.status === 'paused' && <Button icon={Play} onClick={() => act('launch', 'Resumed')}>Resume</Button>}
          {c.status === 'paused' && <Link to={`/campaigns/${c.id}/edit`}><Button variant="secondary" icon={Pencil}>Edit</Button></Link>}
          {c.failed > 0 && <Button variant="secondary" icon={RotateCcw} onClick={() => act('retry-failed', 'Failed recipients queued again')}>Retry failed</Button>}
          {!['completed', 'cancelled'].includes(c.status) && <Button variant="ghost" icon={XCircle} onClick={() => act('cancel', 'Cancelled', { title: 'Cancel this campaign?', description: 'Recipients still waiting will be skipped.', danger: true, confirmLabel: 'Cancel campaign' })}>Cancel</Button>}
          <Button variant="ghost" icon={Copy} onClick={() => act('duplicate', 'Copied as a new draft')}>Duplicate</Button>
          <Button variant="ghost" icon={Trash2} className="text-rose-600" onClick={remove}>Delete</Button>
        </div>
      </div>

      {c.last_error && !['completed', 'cancelled'].includes(c.status) && (
        <Callout tone={c.status === 'paused' ? 'red' : 'amber'} icon={AlertTriangle} className="mb-5">{c.last_error}</Callout>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Sent" value={num(c.sent)} icon={Send} tone="brand" />
        <Stat label="Waiting" value={num(c.pending)} icon={Clock} tone="sky" sub={c.status === 'running' && c.next_send_at ? `next in ~${Math.max(0, Math.round((Date.parse(c.next_send_at) - Date.now()) / 1000))}s` : undefined} />
        <Stat label="Failed" value={num(c.failed)} icon={AlertTriangle} tone="rose" />
        <Stat label="Skipped" value={num(c.skipped)} icon={Ban} tone="amber" sub="opted out / no consent" />
        <Stat label="Replied" value={`${replyRate}%`} icon={MessageCircleReply} tone="green" sub={`${num(data.replies)} people replied`} />
      </div>

      <Card className="mt-6 p-5">
        <Progress c={c} />
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Recipients" description="Failed first, then waiting, then done (first 300)." />
          <div className="max-h-[520px] overflow-y-auto">
            <table className="w-full">
              <tbody className="divide-y divide-slate-100 dark:divide-ink-700">
                {data.recipients.map((r) => {
                  const s = R_STATUS[r.status] || R_STATUS.pending;
                  return (
                    <tr key={r.id}>
                      <td className="table-cell">
                        <p className="font-semibold">{r.name || phonePretty(r.phone)}</p>
                        {r.name && <p className="text-xs text-slate-500">{phonePretty(r.phone)}</p>}
                      </td>
                      <td className="table-cell"><Badge tone={s.tone}><s.icon className="size-3" /> {s.label}</Badge></td>
                      <td className="table-cell max-w-64 text-xs text-slate-500">{r.error || (r.sent_at ? timeAgo(r.sent_at) : '')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="h-fit">
          <CardHeader title="Message" description={`${c.min_delay}–${c.max_delay}s gaps · max ${c.daily_cap}/day${c.quiet_start ? ` · quiet ${c.quiet_start}–${c.quiet_end}` : ''}`} />
          <div className="p-4">
            <WhatsAppPreview text={c.channel === 'meta' ? `Template: ${c.meta_template?.name}` : c.body} />
            {c.media?.filename && <p className="mt-2 text-xs text-slate-500">📎 {c.media.filename}</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
