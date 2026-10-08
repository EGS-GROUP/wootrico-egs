import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api-client';
import { useAuth, type User } from '../lib/auth';
import { Button, Card, Eyebrow, ErrorText, Field, Input } from '../components/ui';

type Mode = 'login' | 'create-admin';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ hasAdmin: boolean }>('/api/setup/status')
      .then((s) => setMode(s.hasAdmin ? 'login' : 'create-admin'))
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/setup/admin';
      const body =
        mode === 'login' ? { email, password } : { name: name.trim(), email, password };
      const res = await api<{ token: string; user: User }>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      login(res.token, res.user);
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'invalid_credentials') setError('E-mail ou senha inválidos.');
        else if (err.code === 'validation') setError('Verifique os campos (senha mínima de 8 caracteres).');
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
          <Eyebrow>{mode === 'login' ? 'Painel · Wootrico' : 'Primeiro acesso'}</Eyebrow>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white">
            {mode === 'login' ? 'Entrar' : 'Criar administrador'}
          </h1>
          <p className="mt-2 text-sm text-neutral-400">
            {mode === 'login'
              ? 'Acesse o painel da sua instância.'
              : 'Defina a conta de administrador desta instância.'}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-5">
          {mode === 'create-admin' && (
            <Field label="Nome">
              <Input
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </Field>
          )}
          <Field label="E-mail">
            <Input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Senha" hint={mode === 'create-admin' ? 'Mínimo de 8 caracteres.' : undefined}>
            <Input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>

          <ErrorText>{error}</ErrorText>

          <Button type="submit" loading={busy} className="w-full">
            {mode === 'login' ? 'Entrar' : 'Criar e entrar'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
