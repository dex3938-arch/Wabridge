import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

// ---------------- auth ----------------
export const AuthContext = createContext({ user: null, setUser: () => {} });
export const useAuth = () => useContext(AuthContext);

// ---------------- toasts ----------------
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, tone = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setItems((x) => [...x, { id, message: String(message), tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'error' ? 6500 : 3800);
  }, []);
  const icon = { success: CheckCircle2, error: AlertTriangle, info: Info };
  const color = { success: 'text-emerald-500', error: 'text-rose-500', info: 'text-brand-500' };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => {
          const Icon = icon[t.tone] || Info;
          return (
            <div
              key={t.id}
              className="animate-rise pointer-events-auto flex items-start gap-3 rounded-2xl border border-slate-200 bg-white/95 p-3.5 text-sm shadow-[var(--shadow-pop)] backdrop-blur dark:border-ink-600 dark:bg-ink-800/95"
            >
              <Icon className={`mt-0.5 size-4.5 shrink-0 ${color[t.tone]}`} />
              <p className="flex-1 leading-snug text-slate-700 dark:text-slate-200">{t.message}</p>
              <button
                onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Dismiss"
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------- live events (one shared EventSource) ----------------
const listeners = new Map();
let source = null;
let status = 'idle';
const statusListeners = new Set();

function setStatus(s) {
  status = s;
  for (const fn of statusListeners) fn(s);
}

let wanted = false;
let hideTimer = null;

function openSource() {
  if (source) return;
  source = new EventSource('/api/events');
  setStatus('connecting');
  source.onopen = () => setStatus('live');
  source.addEventListener('hello', () => setStatus('live'));
  source.onerror = () => setStatus('reconnecting');
  for (const name of ['message', 'message.status', 'conversation', 'session', 'campaign', 'engine']) {
    source.addEventListener(name, (e) => {
      let data = null;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      for (const fn of listeners.get(name) || []) fn(data);
    });
  }
}

function closeSource() {
  source?.close();
  source = null;
}

// Browsers allow only ~6 connections per server across ALL tabs, so a hidden tab gives its live
// connection back after a short while and reconnects (and refreshes) when it becomes visible again.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!wanted) return;
    clearTimeout(hideTimer);
    if (document.hidden) {
      hideTimer = setTimeout(() => {
        closeSource();
        setStatus('paused');
      }, 15000);
    } else if (!source) {
      openSource();
      for (const fn of listeners.get('engine') || []) fn({ resumed: true });
      for (const fn of listeners.get('session') || []) fn({ resumed: true });
    }
  });
}

export function connectLive() {
  wanted = true;
  if (!document.hidden) openSource();
}

export function disconnectLive() {
  wanted = false;
  closeSource();
  setStatus('idle');
}

export function useLive(event, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (d) => ref.current(d);
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  }, [event]);
}

export function useLiveStatus() {
  const [s, setS] = useState(status);
  useEffect(() => {
    statusListeners.add(setS);
    return () => statusListeners.delete(setS);
  }, []);
  return s;
}

// ---------------- data loading ----------------
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const mounted = useRef(true);
  const run = useCallback(async () => {
    try {
      const data = await loader();
      if (mounted.current) setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      if (mounted.current) setState((s) => ({ ...s, error, loading: false }));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    mounted.current = true;
    setState((s) => ({ ...s, loading: true }));
    run();
    return () => {
      mounted.current = false;
    };
  }, [run]);
  return { ...state, reload: run, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })) };
}

// ---------------- theme ----------------
export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('wb-theme', next ? 'dark' : 'light');
    } catch {
      /* private mode */
    }
  };
  return { dark, toggle };
}
