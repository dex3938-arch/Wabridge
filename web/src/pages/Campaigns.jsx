import { Link, useNavigate } from 'react-router-dom';
import { Megaphone, Plus, BadgeCheck, Smartphone, ChevronRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { useLoad, useLive } from '../lib/app.jsx';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, cx } from '../components/ui.jsx';
import { CAMPAIGN_STATUS, dateTime, num } from '../lib/format.js';

export function Progress({ c, className }) {
  const done = c.sent + c.failed + c.skipped;
  const pct = c.total ? Math.round((done / c.total) * 100) : 0;
  const w = (n) => `${c.total ? (n / c.total) * 100 : 0}%`;
  return (
    <div className={className}>
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-ink-700">
        <div className="bg-gradient-to-r from-brand-500 to-cyan-500" style={{ width: w(c.sent) }} />
        <div className="bg-rose-400" style={{ width: w(c.failed) }} />
        <div className="bg-slate-300 dark:bg-ink-600" style={{ width: w(c.skipped) }} />
      </div>
      <p className="mt-1.5 text-xs text-slate-500 tabular-nums">{pct}% · {num(c.sent)} sent{c.failed ? ` · ${num(c.failed)} failed` : ''}{c.skipped ? ` · ${num(c.skipped)} skipped` : ''} of {num(c.total)}</p>
    </div>
  );
}

export default function Campaigns() {
  const { data, loading, setData } = useLoad(() => api.get('/api/campaigns'), []);
  const navigate = useNavigate();
  useLive('campaign', (c) => c && setData((d) => d && { campaigns: d.campaigns.map((x) => (x.id === c.id ? c : x)) }));
  const list = data?.campaigns || [];
  return (
    <div>
      <PageHeader eyebrow="Workspace" title="Campaigns" description="Send personalised messages to a tagged audience — slowly and safely, one at a time."
        actions={<Link to="/campaigns/new"><Button icon={Plus}>New campaign</Button></Link>} />
      {loading && !data ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={Megaphone} title="No campaigns yet" description="Announce an offer, remind about payments or share updates with opted-in customers. WaBridge paces every send to protect your number."
            action={<Link to="/campaigns/new"><Button icon={Plus}>Create campaign</Button></Link>} />
        </Card>
      ) : (
        <Card className="divide-y divide-slate-100 dark:divide-ink-700">
          {list.map((c) => {
            const st = CAMPAIGN_STATUS[c.status] || { label: c.status, tone: 'slate' };
            return (
              <button key={c.id} onClick={() => navigate(c.status === 'draft' ? `/campaigns/${c.id}/edit` : `/campaigns/${c.id}`)}
                className="flex w-full flex-wrap items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-50/70 dark:hover:bg-ink-850">
                <span className={cx('inline-flex size-10 items-center justify-center rounded-xl', c.channel === 'meta' ? 'bg-sky-50 text-sky-600 dark:bg-sky-500/10' : 'bg-brand-50 text-brand-600 dark:bg-brand-500/10')}>
                  {c.channel === 'meta' ? <BadgeCheck className="size-5" /> : <Smartphone className="size-5" />}
                </span>
                <div className="min-w-48 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-bold">{c.name}</p>
                    <Badge tone={st.tone} dot={c.status === 'running' ? 'pulse' : true}>{st.label}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {c.status === 'scheduled' ? `Starts ${dateTime(c.schedule_at)}` : c.started_at ? `Started ${dateTime(c.started_at)}` : `Created ${dateTime(c.created_at)}`}
                    {c.last_error && c.status !== 'completed' ? ` · ${c.last_error}` : ''}
                  </p>
                </div>
                {c.total > 0 ? <Progress c={c} className="w-full sm:w-72" /> : <span className="text-xs text-slate-400">Audience not built yet</span>}
                <ChevronRight className="size-4 text-slate-400" />
              </button>
            );
          })}
        </Card>
      )}
    </div>
  );
}
