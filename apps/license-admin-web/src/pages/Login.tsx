import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Eyebrow, ErrorText, Field, Input } from '../components/ui';
import { useAuth } from '../lib/auth';
import { login } from '../lib/admin-api';
import { ApiError } from '../lib/api-client';

export default function Login() {
  const navigate = useNavigate();
  const { login: setSession } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await login(email.trim(), password);
      setSession(res.token, res.user);
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'invalid_credentials') setError('E-mail ou senha inválidos.');
        else if (err.code === 'login_not_configured')
          setError('Login do painel não configurado (defina LICENSE_ADMIN_EMAIL/PASSWORD).');
        else setError(`Erro: ${err.code}`);
      } else setError('Falha de conexão.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-black relative flex items-center justify-center px-6 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/50 to-black" />
        <div className="absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2">
          <div className="w-[40rem] h-[40rem] rounded-full bg-blue-600/20 blur-[120px] mix-blend-screen" />
        </div>
      </div>

      <Card className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-8">
          <Eyebrow>Licenças · Wootrico</Eyebrow>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">Administração</h1>
          <p className="mt-2 text-sm text-neutral-400">Gerencie chaves de licença e seus acessos.</p>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <Field label="E-mail">
            <Input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Senha">
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>

          <ErrorText>{error}</ErrorText>

          <Button type="submit" loading={busy} className="w-full">
            Entrar
          </Button>
        </form>
      </Card>
    </div>
  );
}
