import { Link } from 'react-router-dom';
import {
  MessageCircle,
  Send,
  Bot,
  Timer,
  Smartphone,
  Megaphone,
  Users,
  Inbox,
  ArrowUpRight,
  Plus,
  AlertTriangle,
  CheckCheck,
  Activity as ActivityIcon,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useLoad, useLive, useAuth } from '../lib/app.jsx';
import { Badge, Button, Card, CardHeader, Skeleton, Stat, Callout, cx } from '../components/ui.jsx';
import AreaChart from '../components/Chart.jsx';
import { duration, num, timeAgo, SESSION_STATUS, phonePretty } from '../lib/format.js';

const LEVEL = { error: 'bg-rose-500', warn: 'bg-amber-500', info: 'bg-brand-500' };

export default function Overview() {
  const { user } = useAuth();
  const { data, loading, reload } = useLoad(() => api.get('/api/overview'), []);
  useLive('message', () => reload());
  useLive('session', () => reload());
  useLive('campaign', () => reload());

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }
  if (!data) return null;
  const noNumbers = data.numbers.total === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-brand-600 dark:text-brand-400">{data.businessName}</p>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">
            {greet}, {user?.name?.split(' ')[0]} 👋
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Here is what is happening on WhatsApp today.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/campaigns/new">
            <Button variant="secondary" icon={Megaphone}>New campaign</Button>
          </Link>
          <Link to="/inbox">
            <Button icon={Inbox}>Open inbox</Button>
          </Link>
        </div>
      </div>

      {!data.engine.online && (
        <Callout tone="red" icon={AlertTriangle} title="The WhatsApp engine is offline">
          WaBridge cannot reach the OpenWA engine. Start it (see README → “Run”), then check Settings → Engine. {data.engine.error}
        </Callout>
      )}
      {data.engine.online && noNumbers && (
        <Card className="overflow-hidden">
          <div className="flex flex-col items-start gap-5 bg-gradient-to-r from-brand-600 to-cyan-600 p-6 text-white sm:flex-row sm:items-center">
            <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
              <Smartphone className="size-6" />
            </span>
            <div className="flex-1">
              <p className="text-lg font-bold">Connect your first WhatsApp number</p>
              <p className="text-sm text-white/80">Scan a QR code from WhatsApp → Linked devices. No Meta App ID or business verification needed.</p>
            </div>
            <Link to="/numbers">
              <Button variant="secondary" icon={Plus} className="border-transparent">Connect number</Button>
            </Link>
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Received today" value={num(data.messages.received)} icon={MessageCircle} tone="sky" sub={`${num(data.conversations.unread)} chats unread`} />
        <Stat label="Sent today" value={num(data.messages.sent)} icon={Send} tone="brand" sub={data.messages.failed ? `${data.messages.failed} failed` : 'No failures'} />
        <Stat label="Automated replies" value={num(data.messages.automated)} icon={Bot} tone="violet" sub="Rules + AI, today" />
        <Stat label="Median first reply" value={duration(data.medianResponseSeconds)} icon={Timer} tone="green" sub="Last 7 days" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Message volume"
            description="Last 14 days"
            action={
              <div className="flex items-center gap-4 text-xs font-semibold text-slate-500">
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-sky-500" /> Received</span>
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-brand-500" /> Sent</span>
              </div>
            }
          />
          <div className="px-3 pt-3 pb-1">
            <AreaChart data={data.series} />
          </div>
          <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 dark:divide-ink-700 dark:border-ink-700">
            {[
              ['Delivered', data.messages.deliveryRate != null ? `${data.messages.deliveryRate}%` : '—', 'of sent, 7 days'],
              ['Read', data.messages.readRate != null ? `${data.messages.readRate}%` : '—', 'of sent, 7 days'],
              ['Open chats', num(data.conversations.open), `${num(data.conversations.unassigned)} unassigned`],
            ].map(([k, v, s]) => (
              <div key={k} className="px-5 py-4">
                <p className="text-xs font-semibold text-slate-500">{k}</p>
                <p className="mt-1 text-xl font-extrabold tabular-nums">{v}</p>
                <p className="text-[11px] text-slate-400">{s}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="WhatsApp numbers"
            description={`${data.numbers.ready} of ${data.numbers.total} connected`}
            action={
              <Link to="/numbers" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">
                Manage
              </Link>
            }
          />
          <div className="divide-y divide-slate-100 dark:divide-ink-700">
            {data.numbers.list.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-500">No numbers yet.</p>}
            {data.numbers.list.map((n) => {
              const st = SESSION_STATUS[n.status] || { label: n.status, tone: 'slate' };
              return (
                <div key={n.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className={cx('inline-flex size-9 items-center justify-center rounded-xl', n.status === 'ready' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10' : 'bg-slate-100 text-slate-500 dark:bg-ink-800')}>
                    <Smartphone className="size-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{n.name}</p>
                    <p className="text-xs text-slate-500">{n.phone ? phonePretty(n.phone) : 'Not linked yet'}</p>
                  </div>
                  <Badge tone={st.tone} dot>{st.label}</Badge>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-3 gap-px border-t border-slate-100 bg-slate-100 dark:border-ink-700 dark:bg-ink-700">
            {[
              [Users, num(data.contacts.total), 'Contacts'],
              [Megaphone, num(data.campaigns.running), 'Sending now'],
              [CheckCheck, num(data.contacts.optedIn), 'Opted in'],
            ].map(([Icon, v, l]) => (
              <div key={l} className="bg-white px-4 py-3.5 text-center dark:bg-ink-900">
                <Icon className="mx-auto size-4 text-slate-400" />
                <p className="mt-1 text-lg font-extrabold tabular-nums">{v}</p>
                <p className="text-[11px] text-slate-500">{l}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent activity" icon={ActivityIcon} action={<Link to="/activity" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">View all</Link>} />
          <ul className="divide-y divide-slate-100 dark:divide-ink-700">
            {data.activity.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-500">Nothing yet.</li>}
            {data.activity.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', LEVEL[a.level] || LEVEL.info)} />
                <p className="flex-1 text-sm text-slate-700 dark:text-slate-300">{a.message}</p>
                <span className="shrink-0 text-xs text-slate-400">{timeAgo(a.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Top automations" icon={Bot} description="Rules that answered the most messages" action={<Link to="/automations" className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400">Manage</Link>} />
          {data.topRules.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-slate-500">No automation has fired yet.</p>
              <Link to="/automations" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 dark:text-brand-400">
                Create a welcome message <ArrowUpRight className="size-4" />
              </Link>
            </div>
          ) : (
            <ul className="space-y-3 p-5">
              {data.topRules.map((r) => {
                const pct = Math.round((r.hits / data.topRules[0].hits) * 100);
                return (
                  <li key={r.id}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-semibold">{r.name}</span>
                      <span className="tabular-nums text-slate-500">{num(r.hits)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-ink-700">
                      <div className="h-2 rounded-full bg-gradient-to-r from-brand-500 to-cyan-500" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
