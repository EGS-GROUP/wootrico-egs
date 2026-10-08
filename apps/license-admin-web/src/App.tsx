import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import UserDetail from './pages/UserDetail';
import Keys from './pages/Keys';
import KeyDetail from './pages/KeyDetail';
import FreeLicenses from './pages/FreeLicenses';
import Payments from './pages/Payments';
import Support from './pages/Support';
import Logs from './pages/Logs';
import WebhookKeys from './pages/WebhookKeys';
import Health from './pages/Health';
import Settings from './pages/Settings';

function Spinner() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="h-6 w-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />
    </div>
  );
}

function Protected({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (bare) {
    if (user) return <Navigate to="/" replace />;
    return <>{children}</>;
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Protected bare><Login /></Protected>} />
          <Route path="/" element={<Protected><Dashboard /></Protected>} />
          <Route path="/users" element={<Protected><Users /></Protected>} />
          <Route path="/users/:email" element={<Protected><UserDetail /></Protected>} />
          <Route path="/keys" element={<Protected><Keys /></Protected>} />
          <Route path="/keys/:id" element={<Protected><KeyDetail /></Protected>} />
          <Route path="/free-licenses" element={<Protected><FreeLicenses /></Protected>} />
          <Route path="/payments" element={<Protected><Payments /></Protected>} />
          <Route path="/support" element={<Protected><Support /></Protected>} />
          <Route path="/logs" element={<Protected><Logs /></Protected>} />
          <Route path="/health" element={<Protected><Health /></Protected>} />
          <Route path="/webhook-keys" element={<Protected><WebhookKeys /></Protected>} />
          <Route path="/settings" element={<Protected><Settings /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
