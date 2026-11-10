import { useState } from 'react';
import { History } from 'lucide-react';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/app.jsx';
import { Badge, Card, EmptyState, PageHeader, Tabs, Spinner } from '../components/ui.jsx';
import { dateTime } from '../lib/format.js';

const TONE = { error: 'red', warn: 'amber', info: 'brand' };

export default function Activity() {
  const [level, setLevel] = useState('');
  const { data, loading } = useLoad(() => api.get(`/api/activity?limit=300${level ? `&level=${level}` : ''}`), [level]);
  return (
    <div>
      <PageHeader eyebrow="Admin" title="Activity log" description="Connections, disconnections, campaigns, opt-outs, settings changes and errors." />
      <Tabs className="mb-5" value={level} onChange={setLevel} tabs={[{ value: '', label: 'All' }, { value: 'error', label: 'Errors' }, { value: 'warn', label: 'Warnings' }, { value: 'info', label: 'Info' }]} />
      <Card>
        {loading && !data ? <div className="flex justify-center py-16"><Spinner /></div> : data.activity.length === 0 ? <EmptyState icon={History} title="Nothing here yet" /> : (
          <ul className="divide-y divide-slate-100 dark:divide-ink-700">
            {data.activity.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <Badge tone={TONE[a.level] || 'slate'} className="mt-0.5 w-16 justify-center">{a.level}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{a.message}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-400">{a.type}{a.user_name ? ` · by ${a.user_name}` : ''}</p>
                </div>
                <span className="text-xs whitespace-nowrap text-slate-400">{dateTime(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
