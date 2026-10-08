import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { getSetupStatus } from './lib/setup-api';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Integrations from './pages/Integrations';
import IntegrationForm from './pages/IntegrationForm';
import Contacts from './pages/Contacts';
import Conversations from './pages/Conversations';
import Support from './pages/Support';
import Manual from './pages/Manual';
import MediaLibrary from './pages/MediaLibrary';
import License from './pages/License';
import System from './pages/System';
import SetupWizard from './pages/SetupWizard';
import Logs from './pages/Logs';

function Spinner() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-white/10 border-t-blue-500 animate-spin" />
    </div>
  );
}

/** Auth + first-run setup gate. `bare` skips Layout and the setup redirect (for /setup itself). */
function Protected({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  const { user, loading } = useAuth();
  const [setup, setSetup] = useState<{ loaded: boolean; completed: boolean }>({
    loaded: false,
    completed: false,
  });

  useEffect(() => {
    if (!user) return;
    getSetupStatus()
      .then((s) => setSetup({ loaded: true, completed: s.setupCompleted }))
      .catch(() => setSetup({ loaded: true, completed: true }));
  }, [user]);

  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!setup.loaded) return <Spinner />;
  if (!bare && !setup.completed) return <Navigate to="/setup" replace />;
  if (bare && setup.completed) return <Navigate to="/" replace />;

  return bare ? <>{children}</> : <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/setup" element={<Protected bare><SetupWizard /></Protected>} />
          <Route path="/" element={<Protected><Dashboard /></Protected>} />
          <Route path="/integrations" element={<Protected><Integrations /></Protected>} />
          <Route path="/integrations/new" element={<Protected><IntegrationForm /></Protected>} />
          <Route path="/integrations/:id" element={<Protected><IntegrationForm /></Protected>} />
          <Route path="/contacts" element={<Protected><Contacts /></Protected>} />
          <Route path="/conversations" element={<Protected><Conversations /></Protected>} />
          <Route path="/support" element={<Protected><Support /></Protected>} />
          <Route path="/manual" element={<Protected><Manual /></Protected>} />
          <Route path="/media" element={<Protected><MediaLibrary /></Protected>} />
          <Route path="/license" element={<Protected><License /></Protected>} />
          <Route path="/system" element={<Protected><System /></Protected>} />
          <Route path="/logs" element={<Protected><Logs /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
