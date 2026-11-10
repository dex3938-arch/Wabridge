import { StrictMode, useEffect, useState, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import './index.css';
import { api } from './lib/api.js';
import { AuthContext, ToastProvider, connectLive, disconnectLive } from './lib/app.jsx';
import { ConfirmProvider, Spinner } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import AuthPage from './pages/Auth.jsx';

const Overview = lazy(() => import('./pages/Overview.jsx'));
const Inbox = lazy(() => import('./pages/Inbox.jsx'));
const Contacts = lazy(() => import('./pages/Contacts.jsx'));
const Campaigns = lazy(() => import('./pages/Campaigns.jsx'));
const CampaignEditor = lazy(() => import('./pages/CampaignEditor.jsx'));
const CampaignDetail = lazy(() => import('./pages/CampaignDetail.jsx'));
const Automations = lazy(() => import('./pages/Automations.jsx'));
const Templates = lazy(() => import('./pages/Templates.jsx'));
const Numbers = lazy(() => import('./pages/Numbers.jsx'));
const Integrations = lazy(() => import('./pages/Integrations.jsx'));
const Explorer = lazy(() => import('./pages/Explorer.jsx'));
const Team = lazy(() => import('./pages/Team.jsx'));
const Activity = lazy(() => import('./pages/Activity.jsx'));
const SettingsPage = lazy(() => import('./pages/Settings.jsx'));

const Loading = () => (
  <div className="flex h-full min-h-[60vh] items-center justify-center">
    <Spinner className="size-7" />
  </div>
);

function App() {
  const [state, setState] = useState({ loading: true, user: null, setupRequired: false });
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get('/api/auth/state')
      .then((s) => setState({ loading: false, user: s.user, setupRequired: s.setupRequired }))
      .catch(() => setState({ loading: false, user: null, setupRequired: false }));
    const out = () => {
      disconnectLive();
      setState((s) => ({ ...s, user: null }));
      navigate('/login');
    };
    window.addEventListener('wb:signed-out', out);
    return () => window.removeEventListener('wb:signed-out', out);
  }, [navigate]);

  useEffect(() => {
    if (state.user) connectLive();
  }, [state.user]);

  if (state.loading) return <Loading />;
  const setUser = (user) => setState((s) => ({ ...s, user, setupRequired: false }));

  return (
    <AuthContext.Provider value={{ user: state.user, setUser }}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route
            path="/login"
            element={state.user ? <Navigate to="/" replace /> : <AuthPage mode={state.setupRequired ? 'setup' : 'login'} onDone={setUser} />}
          />
          <Route
            path="/signup"
            element={state.user ? <Navigate to="/" replace /> : <AuthPage mode="setup" onDone={setUser} />}
          />
          <Route
            path="/setup"
            element={state.user ? <Navigate to="/" replace /> : <AuthPage mode="setup" onDone={setUser} />}
          />
          <Route element={state.user ? <Layout /> : <Navigate to="/login" replace />}>
            <Route index element={<Overview />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="inbox/:id" element={<Inbox />} />
            <Route path="contacts" element={<Contacts />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="campaigns/new" element={<CampaignEditor />} />
            <Route path="campaigns/:id/edit" element={<CampaignEditor />} />
            <Route path="campaigns/:id" element={<CampaignDetail />} />
            <Route path="automations" element={<Automations />} />
            <Route path="templates" element={<Templates />} />
            <Route path="numbers" element={<Numbers />} />
            <Route path="integrations" element={<Integrations />} />
            <Route path="explorer" element={<Explorer />} />
            <Route path="team" element={<Team />} />
            <Route path="activity" element={<Activity />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </AuthContext.Provider>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
