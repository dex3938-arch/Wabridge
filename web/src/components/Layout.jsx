import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  MessagesSquare,
  Users,
  Megaphone,
  Bot,
  FileText,
  Smartphone,
  Plug,
  TerminalSquare,
  UserCog,
  History,
  Settings,
  Menu,
  X,
  Sun,
  Moon,
  LogOut,
  Radio,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth, useLive, useLiveStatus, useTheme, disconnectLive } from '../lib/app.jsx';
import { Avatar, Logo, cx } from './ui.jsx';

const NAV = [
  {
    title: 'Workspace',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/inbox', label: 'Inbox', icon: MessagesSquare, badge: 'unread' },
      { to: '/contacts', label: 'Contacts', icon: Users },
      { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
    ],
  },
  {
    title: 'Automate',
    items: [
      { to: '/automations', label: 'Automations & AI', icon: Bot },
      { to: '/templates', label: 'Templates', icon: FileText },
    ],
  },
  {
    title: 'Connect',
    items: [
      { to: '/numbers', label: 'WhatsApp numbers', icon: Smartphone, badge: 'numbers' },
      { to: '/integrations', label: 'Integrations & API', icon: Plug, admin: true },
      { to: '/explorer', label: 'Engine API explorer', icon: TerminalSquare, admin: true },
    ],
  },
  {
    title: 'Admin',
    items: [
      { to: '/team', label: 'Team', icon: UserCog },
      { to: '/activity', label: 'Activity log', icon: History },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

function useBadges() {
  const [badges, setBadges] = useState({ unread: 0, numbersDown: 0, engineOnline: true });
  const refresh = () =>
    api
      .get('/api/overview')
      .then((o) =>
        setBadges({
          unread: o.conversations.unread,
          numbersDown: o.numbers.total - o.numbers.ready,
          engineOnline: o.engine.online,
        }),
      )
      .catch(() => {});
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, []);
  useLive('message', (d) => d.message?.direction === 'in' && refresh());
  useLive('session', refresh);
  useLive('engine', refresh);
  return [badges, refresh];
}

function Sidebar({ onNavigate, badges }) {
  const { user } = useAuth();
  return (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      {NAV.map((group) => (
        <div key={group.title}>
          <p className="mb-2 px-3 text-[10.5px] font-bold uppercase tracking-[0.16em] text-slate-500">{group.title}</p>
          <div className="space-y-0.5">
            {group.items
              .filter((i) => !i.admin || user?.role === 'admin')
              .map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cx(
                      'group flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-semibold transition',
                      isActive
                        ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]'
                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon className={cx('size-4.5', isActive ? 'text-cyan-300' : 'text-slate-500 group-hover:text-slate-300')} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge === 'unread' && badges.unread > 0 && (
                        <span className="rounded-full bg-brand-500 px-1.5 py-px text-[11px] font-bold text-white tabular-nums">{badges.unread}</span>
                      )}
                      {item.badge === 'numbers' && badges.numbersDown > 0 && (
                        <span className="size-2 rounded-full bg-amber-400 ring-4 ring-amber-400/20" title="A number needs attention" />
                      )}
                    </>
                  )}
                </NavLink>
              ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export default function Layout() {
  const { user, setUser } = useAuth();
  const { dark, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [badges] = useBadges();
  const live = useLiveStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const fullBleed = location.pathname.startsWith('/inbox');

  const logout = async () => {
    await api.post('/api/auth/logout').catch(() => {});
    disconnectLive();
    setUser(null);
    navigate('/login');
  };

  const brand = (
    <div className="flex items-center gap-2.5 px-5 pt-5">
      <Logo className="size-8.5" />
      <div className="leading-tight">
        <p className="text-[17px] font-extrabold tracking-tight text-white">WaBridge</p>
        <p className="text-[11px] font-medium text-slate-400">WhatsApp workspace</p>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col bg-ink-900 lg:flex dark:border-r dark:border-ink-800 dark:bg-ink-950">
        {brand}
        <div className="min-h-0 flex-1">
          <Sidebar badges={badges} />
        </div>
        <div className="border-t border-white/5 p-3">
          <div className="flex items-center gap-3 rounded-xl p-2">
            <Avatar name={user?.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-white">{user?.name}</p>
              <p className="truncate text-[11px] capitalize text-slate-400">{user?.role}</p>
            </div>
            <button onClick={logout} className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white" title="Sign out">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/60" onClick={() => setOpen(false)} />
          <aside className="animate-rise absolute inset-y-0 left-0 flex w-72 flex-col bg-ink-900">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button onClick={() => setOpen(false)} className="mt-5 rounded-lg p-2 text-slate-400 hover:text-white">
                <X className="size-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <Sidebar badges={badges} onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t border-white/5 p-3">
              <button onClick={logout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-300 hover:bg-white/5">
                <LogOut className="size-4" /> Sign out
              </button>
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-15 shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur sm:px-6 dark:border-ink-800 dark:bg-ink-950/80">
          <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden dark:hover:bg-ink-800" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="flex items-center gap-2 lg:hidden">
            <Logo className="size-7" />
            <span className="font-extrabold tracking-tight">WaBridge</span>
          </div>
          <div className="flex-1" />
          <span
            className={cx(
              'hidden items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold sm:inline-flex',
              badges.engineOnline
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
            )}
            title={badges.engineOnline ? 'WhatsApp engine reachable' : 'WhatsApp engine offline'}
          >
            <span className={cx('size-1.5 rounded-full', badges.engineOnline ? 'bg-emerald-500' : 'animate-pulse bg-rose-500')} />
            Engine {badges.engineOnline ? 'online' : 'offline'}
          </span>
          <span className="hidden items-center gap-1.5 text-xs font-medium text-slate-500 md:inline-flex" title="Live updates">
            <Radio className={cx('size-3.5', live === 'live' ? 'text-brand-500' : 'text-slate-400')} />
            {{ live: 'Live', connecting: 'Connecting', paused: 'Paused', idle: 'Offline' }[live] || 'Reconnecting'}
          </span>
          <button onClick={toggle} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-ink-800" aria-label="Toggle theme">
            {dark ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
          </button>
        </header>
        <main className={cx('min-h-0 flex-1', fullBleed ? 'overflow-hidden' : 'overflow-y-auto')}>
          {fullBleed ? (
            <Outlet />
          ) : (
            <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
              <Outlet />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
