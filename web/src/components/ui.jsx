import { useEffect, useState, createContext, useContext, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, Inbox as InboxIcon, Copy, Check } from 'lucide-react';
import { avatarColor, initials } from '../lib/format.js';

const cx = (...c) => c.filter(Boolean).join(' ');
export { cx };

// ---------- Button ----------
const VARIANTS = {
  primary:
    'bg-brand-600 text-white shadow-sm shadow-brand-600/25 hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-400 dark:disabled:bg-brand-800',
  secondary:
    'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 dark:border-ink-600 dark:bg-ink-850 dark:text-slate-200 dark:hover:bg-ink-800',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-ink-800 dark:hover:text-white',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-400',
  soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-300 dark:hover:bg-brand-500/25',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
};
const SIZES = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded-lg',
  sm: 'h-8.5 px-3 text-[13px] gap-1.5 rounded-xl',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-11.5 px-5 text-[15px] gap-2 rounded-xl',
  icon: 'size-9 rounded-xl justify-center',
  iconSm: 'size-8 rounded-lg justify-center',
};

export function Button({ variant = 'primary', size = 'md', loading, icon: Icon, children, className, ...rest }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/25 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" /> : null}
      {children}
    </button>
  );
}

// ---------- Form fields ----------
export function Field({ label, hint, error, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {error ? <p className="mt-1.5 text-xs text-rose-600">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </label>
  );
}
export const Input = ({ className, ...p }) => <input {...p} className={cx('input', className)} />;
export const Textarea = ({ className, ...p }) => <textarea {...p} className={cx('input min-h-24 resize-y leading-relaxed', className)} />;
export function Select({ className, children, ...p }) {
  return (
    <select {...p} className={cx('input appearance-none bg-[length:16px] bg-[right_0.8rem_center] bg-no-repeat pr-9', className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }) {
  return (
    <label className={cx('flex items-start gap-3', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 inline-flex h-5.5 w-10 shrink-0 rounded-full transition',
          checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-ink-600',
        )}
      >
        <span className={cx('absolute top-0.5 size-4.5 rounded-full bg-white shadow transition-all', checked ? 'left-5' : 'left-0.5')} />
      </button>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</span>}
          {description && <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{description}</span>}
        </span>
      )}
    </label>
  );
}

// ---------- Display ----------
const TONES = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/15 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/15 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20',
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/15 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400/20',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/15 dark:bg-ink-700 dark:text-slate-300 dark:ring-slate-400/10',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/15 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/20',
};
const DOTS = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-rose-500', blue: 'bg-sky-500', brand: 'bg-brand-500', slate: 'bg-slate-400', violet: 'bg-violet-500' };

export function Badge({ tone = 'slate', dot, children, className }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', TONES[tone], className)}>
      {dot && <span className={cx('size-1.5 rounded-full', DOTS[tone], dot === 'pulse' && 'animate-pulse')} />}
      {children}
    </span>
  );
}

export function Avatar({ name, seed, size = 'md', className }) {
  const s = { xs: 'size-6 text-[10px]', sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg' }[size];
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-bold text-white shadow-sm',
        avatarColor(seed || name),
        s,
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function Card({ className, children, ...p }) {
  return (
    <div {...p} className={cx('card', className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, icon: Icon }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-ink-700">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-400">{eyebrow}</p>}
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-[28px] dark:text-white">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon = InboxIcon, title, description, action, className }) {
  return (
    <div className={cx('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <span className="mb-4 inline-flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-cyan-50 text-brand-600 ring-1 ring-brand-100 dark:from-brand-500/10 dark:to-cyan-500/10 dark:text-brand-300 dark:ring-brand-500/20">
        <Icon className="size-6" />
      </span>
      <h3 className="text-base font-bold text-slate-900 dark:text-white">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export const Spinner = ({ className }) => <Loader2 className={cx('size-5 animate-spin text-brand-500', className)} />;
export const Skeleton = ({ className }) => <div className={cx('skeleton', className)} />;

export function Stat({ label, value, sub, icon: Icon, tone = 'brand', trend }) {
  const ring = {
    brand: 'from-brand-500/15 to-brand-500/5 text-brand-600 dark:text-brand-300',
    green: 'from-emerald-500/15 to-emerald-500/5 text-emerald-600 dark:text-emerald-300',
    amber: 'from-amber-500/15 to-amber-500/5 text-amber-600 dark:text-amber-300',
    sky: 'from-sky-500/15 to-sky-500/5 text-sky-600 dark:text-sky-300',
    rose: 'from-rose-500/15 to-rose-500/5 text-rose-600 dark:text-rose-300',
    violet: 'from-violet-500/15 to-violet-500/5 text-violet-600 dark:text-violet-300',
  }[tone];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <p className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">{label}</p>
        {Icon && (
          <span className={cx('inline-flex size-9 items-center justify-center rounded-xl bg-gradient-to-br', ring)}>
            <Icon className="size-4.5" />
          </span>
        )}
      </div>
      <p className="mt-2 text-[28px] font-extrabold leading-none tracking-tight text-slate-900 tabular-nums dark:text-white">{value}</p>
      {(sub || trend) && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
    </Card>
  );
}

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cx('inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-ink-850', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cx(
            'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition',
            value === t.value
              ? 'bg-white text-slate-900 shadow-sm dark:bg-ink-700 dark:text-white'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
          )}
        >
          {t.icon && <t.icon className="size-4" />}
          {t.label}
          {t.count != null && (
            <span className={cx('rounded-full px-1.5 text-[11px] tabular-nums', value === t.value ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200' : 'bg-slate-200 text-slate-600 dark:bg-ink-700 dark:text-slate-300')}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------- Modal ----------
export function Modal({ open, onClose, title, description, children, footer, size = 'md', icon: Icon }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cx('animate-rise relative flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-white shadow-[var(--shadow-pop)] sm:rounded-3xl dark:bg-ink-900 dark:ring-1 dark:ring-ink-700', w)}>
        <div className="flex items-start gap-3 px-6 pt-5 pb-3">
          {Icon && (
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
              <Icon className="size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-ink-800" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 pb-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-6 py-4 dark:border-ink-700">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Confirm dialog (promise based) ----------
const ConfirmContext = createContext(async () => false);
export const useConfirm = () => useContext(ConfirmContext);
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const confirm = useCallback(
    (opts) => new Promise((resolve) => setState({ ...opts, resolve })),
    [],
  );
  const close = (v) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={Boolean(state)}
        onClose={() => close(false)}
        title={state?.title || 'Are you sure?'}
        description={state?.description}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {state?.confirmLabel || 'Confirm'}
            </Button>
          </>
        }
      />
    </ConfirmContext.Provider>
  );
}

export function CopyButton({ value, label = 'Copy', size = 'xs' }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="secondary"
      size={size}
      icon={done ? Check : Copy}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          /* clipboard blocked */
        }
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? 'Copied' : label}
    </Button>
  );
}

export function Code({ children, className }) {
  return (
    <pre className={cx('overflow-x-auto rounded-xl bg-ink-900 p-4 font-mono text-[12.5px] leading-relaxed text-slate-200 dark:bg-ink-950 dark:ring-1 dark:ring-ink-700', className)}>
      {children}
    </pre>
  );
}

export function Callout({ tone = 'brand', icon: Icon, title, children, className }) {
  const t = {
    brand: 'border-brand-200 bg-brand-50/70 text-brand-900 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-100',
    amber: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100',
    red: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-100',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-100',
  }[tone];
  return (
    <div className={cx('flex gap-3 rounded-2xl border p-4 text-sm', t, className)}>
      {Icon && <Icon className="mt-0.5 size-4.5 shrink-0" />}
      <div className="min-w-0 leading-relaxed">
        {title && <p className="mb-0.5 font-bold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function Logo({ className = 'size-8' }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`t${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8ef0cc" />
          <stop offset="1" stopColor="#2fc792" />
        </linearGradient>
        <linearGradient id={`h${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".7" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="17" fill={`url(#t${id})`} />
      <rect x="5" y="4" width="54" height="26" rx="14" fill={`url(#h${id})`} />
      <g fill="#fff">
        <rect x="27" y="10" width="11" height="8" rx="4" />
        <path d="M29 17l-1 4 4-3z" />
        <path d="M15 49H7l8-9z" />
        <path d="M49 49h8l-8-9z" />
        <rect x="14" y="29" width="6" height="21" rx="2" />
        <rect x="44" y="29" width="6" height="21" rx="2" />
      </g>
      <g fill="none" stroke="#fff" strokeLinecap="round">
        <path d="M19 38c6-9 20-9 26 0" strokeWidth="3.6" />
        <path d="M19 46c6-7 20-7 26 0" strokeWidth="3.2" />
        <path d="M26 35v8M32 33.5v8.5M38 35v8" strokeWidth="2.6" />
      </g>
    </svg>
  );
}
