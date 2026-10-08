'use client';

import { INDIAN_STATES, signupSchema, type BusinessType } from '@stockkeep/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { ErrorText } from '@/components/error-text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export default function SignupPage() {
  const { t } = useI18n();
  const { ready, session, signUp } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    ownerName: '',
    email: '',
    password: '',
    businessName: '',
    businessType: 'computer_shop' as BusinessType,
    stateCode: '27',
    gstin: '',
    locationName: '',
  });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (ready && session) router.replace('/dashboard');
  }, [ready, session, router]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = signupSchema.safeParse(form);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue ? `${issue.path.join('.')}: ${issue.message}` : t('common.retry'));
      return;
    }
    setPending(true);
    setError('');
    try {
      await signUp(parsed.data);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.retry'));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFrame>
      <h1 className="font-serif text-3xl">{t('auth.signupTitle')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('auth.signupSubtitle')}</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-5">
        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('auth.accountSection')}
          </legend>
          <Field label={t('auth.ownerName')}>
            <Input required value={form.ownerName} onChange={(event) => set('ownerName', event.target.value)} />
          </Field>
          <Field label={t('common.email')}>
            <Input
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={(event) => set('email', event.target.value)}
            />
          </Field>
          <Field label={t('common.password')} hint={t('auth.passwordHint')}>
            <Input
              type="password"
              autoComplete="new-password"
              required
              value={form.password}
              onChange={(event) => set('password', event.target.value)}
            />
          </Field>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('auth.businessSection')}
          </legend>
          <p className="text-sm font-medium">{t('auth.businessType')}</p>
          <div className="grid gap-2">
            {(['computer_shop', 'bike_service'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => set('businessType', type)}
                className={cn(
                  'rounded-xl border px-3 py-3 text-left',
                  form.businessType === type ? 'border-primary bg-primary/5' : 'bg-card',
                )}
              >
                <span className="block text-sm font-semibold">{t(`business.${type}`)}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t(`business.${type}_blurb`)}
                </span>
              </button>
            ))}
          </div>
          <Field label={t('auth.businessName')}>
            <Input required value={form.businessName} onChange={(event) => set('businessName', event.target.value)} />
          </Field>
          <Field label={t('auth.state')}>
            <Select value={form.stateCode} onChange={(event) => set('stateCode', event.target.value)}>
              {INDIAN_STATES.map((state) => (
                <option key={state.code} value={state.code}>
                  {state.code} — {state.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('auth.gstin')} hint={t('auth.gstinHint')}>
            <Input value={form.gstin} onChange={(event) => set('gstin', event.target.value.toUpperCase())} />
          </Field>
          <Field label={t('auth.locationName')} hint={t('auth.locationHint')}>
            <Input
              required
              value={form.locationName}
              onChange={(event) => set('locationName', event.target.value)}
            />
          </Field>
        </fieldset>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t('auth.creating') : t('auth.createWorkspace')}
        </Button>
      </form>
      <p className="mt-4 text-sm">
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          {t('auth.haveAccount')}
        </Link>
      </p>
    </AuthFrame>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      {children}
      {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}
