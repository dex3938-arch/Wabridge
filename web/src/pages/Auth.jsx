import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessagesSquare, Megaphone, Bot, ShieldCheck, ArrowRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Field, Input, Logo } from '../components/ui.jsx';

const FEATURES = [
  { icon: MessagesSquare, title: 'Team inbox', text: 'Every WhatsApp number in one shared, real-time inbox.' },
  { icon: Megaphone, title: 'Safe campaigns', text: 'Random gaps, daily caps, quiet hours and opt-out handling built in.' },
  { icon: Bot, title: 'Automations + AI', text: 'Keyword rules, welcome & away messages, and Claude-powered replies.' },
  { icon: ShieldCheck, title: 'Self-hosted', text: 'Runs on your own laptop or server. Your data never leaves it.' },
];

export default function AuthPage({ mode, setupRequired = false, allowRegistration = true, onDone }) {
  const [activeMode, setActiveMode] = useState(mode);
  const [allowReg, setAllowReg] = useState(allowRegistration);
  const [form, setForm] = useState({ name: '', email: '', password: '', businessName: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    setActiveMode(mode);
    setError('');
  }, [mode]);

  useEffect(() => {
    setAllowReg(allowRegistration);
  }, [allowRegistration]);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/auth/state')
      .then((s) => {
        if (cancelled) return;
        setAllowReg(Boolean(s.allowRegistration));
        if (mode === 'setup') {
          setActiveMode(s.setupRequired ? 'setup' : 'register');
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const isSetup = activeMode === 'setup';
  const isRegister = activeMode === 'register';
  const isCreatingAccount = isSetup || isRegister;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const endpoint = isSetup ? '/api/auth/setup' : isRegister ? '/api/auth/register' : '/api/auth/login';
      const payload = isSetup
        ? form
        : isRegister
          ? { name: form.name, email: form.email, password: form.password }
          : { email: form.email, password: form.password };
      const out = await api.post(endpoint, payload);
      onDone(out.user);
      navigate(isSetup ? '/numbers' : '/app');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const title = isSetup ? 'Create your workspace' : isRegister ? 'Create your account' : 'Welcome back';
  const subtitle = isSetup
    ? 'You are the first user, so you become the admin.'
    : isRegister
      ? 'Sign up to access your WaBridge workspace.'
      : 'Sign in to your WaBridge workspace.';

  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-ink-900 p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -top-40 -left-32 size-[520px] rounded-full bg-brand-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 bottom-0 size-[420px] rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <Logo className="size-10" />
          <span className="text-2xl font-extrabold tracking-tight">WaBridge</span>
        </div>
        <div className="relative mt-auto max-w-lg">
          <h1 className="text-4xl leading-[1.1] font-extrabold tracking-tight">
            Run all your WhatsApp conversations from <span className="bg-gradient-to-r from-brand-300 to-cyan-300 bg-clip-text text-transparent">one calm place.</span>
          </h1>
          <div className="mt-10 grid gap-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-4">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/10">
                  <f.icon className="size-5 text-cyan-300" />
                </span>
                <div>
                  <p className="font-bold">{f.title}</p>
                  <p className="text-sm text-slate-300">{f.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="relative mt-12 text-xs text-slate-500">Independent software. Not affiliated with WhatsApp or Meta.</p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Logo className="size-9" />
            <span className="text-xl font-extrabold tracking-tight">WaBridge</span>
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight">{title}</h2>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
          {isRegister && !allowReg ? (
            <div className="mt-8 space-y-4">
              <p className="rounded-xl bg-amber-50 px-3.5 py-3 text-sm font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                Public sign-ups are closed. Ask your workspace admin to enable them in Settings → General, or sign in with an existing account.
              </p>
              <Button type="button" size="lg" className="w-full" onClick={() => navigate('/login')}>
                Go to Sign in <ArrowRight className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="mt-8 space-y-4">
              {isSetup && (
                <Field label="Business name">
                  <Input value={form.businessName} onChange={set('businessName')} placeholder="e.g. SmartWebCare" autoFocus />
                </Field>
              )}
              {isCreatingAccount && (
                <Field label="Your name">
                  <Input value={form.name} onChange={set('name')} placeholder="Full name" required autoFocus={!isSetup} />
                </Field>
              )}
              <Field label="Email">
                <Input
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  placeholder="you@company.com"
                  required
                  autoFocus={!isCreatingAccount}
                  autoComplete="email"
                />
              </Field>
              <Field label="Password" hint={isCreatingAccount ? 'At least 8 characters.' : undefined}>
                <Input
                  type="password"
                  value={form.password}
                  onChange={set('password')}
                  placeholder="••••••••"
                  required
                  autoComplete={isCreatingAccount ? 'new-password' : 'current-password'}
                />
              </Field>
              {error && <p className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
              <Button type="submit" size="lg" loading={busy} className="w-full">
                {isSetup ? 'Create workspace' : isRegister ? 'Create account' : 'Sign in'} <ArrowRight className="size-4" />
              </Button>
              <div className="pt-2 text-center text-sm text-slate-500 dark:text-slate-400">
                {isCreatingAccount ? (
                  <p>
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setActiveMode('login');
                        navigate('/login');
                      }}
                      className="font-semibold text-brand-600 hover:underline dark:text-brand-400 cursor-pointer"
                    >
                      Sign in
                    </button>
                  </p>
                ) : (
                  <p>
                    {setupRequired ? (
                      <>
                        First user on this server?{' '}
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMode('setup');
                            navigate('/setup');
                          }}
                          className="font-semibold text-brand-600 hover:underline dark:text-brand-400 cursor-pointer"
                        >
                          Create workspace
                        </button>
                      </>
                    ) : allowReg ? (
                      <>
                        New to WaBridge?{' '}
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMode('register');
                            navigate('/signup');
                          }}
                          className="font-semibold text-brand-600 hover:underline dark:text-brand-400 cursor-pointer"
                        >
                          Create an account
                        </button>
                      </>
                    ) : (
                      'Sign-ups are closed. Ask an admin to invite you in Team.'
                    )}
                  </p>
                )}
              </div>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
