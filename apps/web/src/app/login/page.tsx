'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { ErrorText } from '@/components/error-text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import Link from 'next/link';

const DEMOS = [
  { email: 'owner@bytebazaar.demo', label: 'auth.demoComputer' },
  { email: 'owner@spoke.demo', label: 'auth.demoBike' },
] as const;

export default function LoginPage() {
  const { t } = useI18n();
  const { session, ready, signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (ready && session) router.replace('/dashboard');
  }, [ready, session, router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await signIn(email, password);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.retry'));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFrame>
      <h1 className="font-serif text-3xl">{t('auth.loginTitle')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('auth.loginSubtitle')}</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <label className="grid gap-1.5 text-sm font-medium">
          {t('common.email')}
          <Input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          {t('common.password')}
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
      </form>
      <p className="mt-4 text-sm">
        <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
          {t('auth.createBusiness')}
        </Link>
      </p>
      <section className="mt-8 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">{t('auth.demoTitle')}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('auth.demoHint', { password: 'Demo@12345' })}</p>
        <ul className="mt-3 space-y-2">
          {DEMOS.map((demo) => (
            <li key={demo.email}>
              <button
                type="button"
                className="w-full rounded-lg border px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  setEmail(demo.email);
                  setPassword('Demo@12345');
                }}
              >
                <span className="block font-medium">{t(demo.label)}</span>
                <span className="text-muted-foreground">{demo.email}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </AuthFrame>
  );
}
