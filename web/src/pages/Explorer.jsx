import { useMemo, useState } from 'react';
import { TerminalSquare, Play, Search, Info } from 'lucide-react';
import { api } from '../lib/api.js';
import { useLoad, useToast } from '../lib/app.jsx';
import { Badge, Button, Card, CardHeader, Code, Input, PageHeader, Select, Textarea, Spinner, Callout, cx } from '../components/ui.jsx';

const METHOD_TONE = { GET: 'blue', POST: 'green', PUT: 'amber', PATCH: 'violet', DELETE: 'red' };

export default function Explorer() {
  const { data, loading } = useLoad(() => api.get('/api/explorer/spec'), []);
  const numbers = useLoad(() => api.get('/api/numbers'), []);
  const [filter, setFilter] = useState('');
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/api/sessions');
  const [body, setBody] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const toast = useToast();

  const endpoints = data?.endpoints || [];
  const groups = useMemo(() => {
    const f = filter.toLowerCase();
    const out = {};
    for (const e of endpoints) {
      if (f && !`${e.method} ${e.path} ${e.summary} ${e.tag}`.toLowerCase().includes(f)) continue;
      (out[e.tag] ||= []).push(e);
    }
    return out;
  }, [endpoints, filter]);

  const pick = (e) => {
    setMethod(e.method);
    setPath(sessionId ? e.path.replace('{sessionId}', sessionId) : e.path);
    setBody(e.example ? JSON.stringify(e.example, null, 2) : '');
    setResult(null);
  };

  const run = async () => {
    let parsed;
    if (body.trim() && !['GET', 'DELETE'].includes(method)) {
      try {
        parsed = JSON.parse(body);
      } catch {
        return toast('Body is not valid JSON.', 'error');
      }
    }
    const [p, qs] = path.split('?');
    setBusy(true);
    try {
      setResult(await api.post('/api/explorer', { method, path: p, query: qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined, body: parsed }));
    } catch (e) {
      setResult({ status: e.status || 0, data: { error: e.message }, ms: 0 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Connect" title="Engine API explorer" description="Every OpenWA engine endpoint (groups, channels, labels, status, catalog, polls, profile…) — callable from here with your server-side key." />
      <Callout tone="amber" icon={Info} className="mb-6">Admin tool. Requests run directly against the engine — be careful with DELETE and logout endpoints.</Callout>
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="flex max-h-[75vh] flex-col">
          <div className="space-y-2 border-b border-slate-100 p-3 dark:border-ink-700">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${endpoints.length} endpoints`} className="pl-9" />
            </div>
            <Select value={sessionId} onChange={(e) => setSessionId(e.target.value)} className="py-2 text-xs">
              <option value="">Fill {'{sessionId}'} with…</option>
              {(numbers.data?.numbers || []).filter((n) => n.channel === 'openwa').map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </Select>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {loading ? <div className="flex justify-center py-10"><Spinner /></div> : data?.note ? <p className="p-3 text-sm text-slate-500">{data.note}</p> : (
              Object.entries(groups).map(([tag, list]) => (
                <div key={tag} className="mb-3">
                  <p className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{tag}</p>
                  {list.map((e) => (
                    <button key={`${e.method}${e.path}`} onClick={() => pick(e)} className={cx('flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-ink-850', path === e.path && method === e.method && 'bg-brand-50 dark:bg-brand-500/10')}>
                      <Badge tone={METHOD_TONE[e.method]} className="w-14 justify-center px-0 text-[10px]">{e.method}</Badge>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[11.5px]">{e.path.replace('/api', '')}</span>
                        {e.summary && <span className="block truncate text-[11px] text-slate-500">{e.summary}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Request" icon={TerminalSquare} />
            <div className="space-y-3 p-5">
              <div className="flex gap-2">
                <Select value={method} onChange={(e) => setMethod(e.target.value)} className="w-28">
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
                </Select>
                <Input value={path} onChange={(e) => setPath(e.target.value)} className="font-mono text-[13px]" />
                <Button icon={Play} onClick={run} loading={busy}>Send</Button>
              </div>
              {!['GET', 'DELETE'].includes(method) && <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="{ JSON body }" className="min-h-36 font-mono text-[12.5px]" />}
            </div>
          </Card>
          <Card>
            <CardHeader title="Response" action={result && <div className="flex items-center gap-2 text-xs"><Badge tone={result.status < 300 ? 'green' : result.status < 500 ? 'amber' : 'red'}>HTTP {result.status}</Badge><span className="text-slate-500">{result.ms} ms</span></div>} />
            <div className="p-5">
              {result ? <Code className="max-h-[50vh]">{typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)}</Code> : <p className="text-sm text-slate-500">Pick an endpoint on the left and press Send.</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
