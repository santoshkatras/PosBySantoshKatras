'use client';

import { FEATURE_GROUPS, INDIAN_STATES, updateSettingsSchema } from '@stockkeep/types';
import { useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

export default function SettingsPage() {
  const { t } = useI18n();
  const { session, request, can, refreshSession } = useAuth();
  const [name, setName] = useState(session?.tenant.name ?? '');
  const [legalName, setLegalName] = useState(session?.tenant.legalName ?? '');
  const [stateCode, setStateCode] = useState(session?.tenant.stateCode ?? '27');
  const [gstin, setGstin] = useState(session?.tenant.gstin ?? '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [pending, setPending] = useState(false);

  if (!session) return null;

  async function saveProfile() {
    const parsed = updateSettingsSchema.safeParse({
      name,
      legalName: legalName || null,
      stateCode,
      gstin: gstin || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('common.retry'));
      return;
    }
    setPending(true);
    setError('');
    setSaved('');
    try {
      await request('/settings', { method: 'PATCH', body: parsed.data });
      await refreshSession();
      setSaved(t('settings.saved'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.retry'));
    } finally {
      setPending(false);
    }
  }

  async function toggle(featureKey: string, enabled: boolean) {
    setError('');
    try {
      await request('/settings/modules', { method: 'PATCH', body: { featureKey, enabled } });
      await refreshSession();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.retry'));
    }
  }

  return (
    <div>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <ErrorText>{error}</ErrorText>
      {saved ? <p className="mb-4 text-sm text-emerald-800">{saved}</p> : null}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">{t('settings.profile')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('settings.plan')}: {session.tenant.plan.name}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium">
            {t('auth.businessName')}
            <Input value={name} onChange={(event) => setName(event.target.value)} disabled={!can('settings.manage')} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {t('settings.legalName')}
            <Input
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
              disabled={!can('settings.manage')}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {t('auth.state')}
            <Select
              value={stateCode}
              onChange={(event) => setStateCode(event.target.value)}
              disabled={!can('settings.manage')}
            >
              {INDIAN_STATES.map((state) => (
                <option key={state.code} value={state.code}>
                  {state.code} — {state.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {t('auth.gstin')}
            <Input
              value={gstin}
              onChange={(event) => setGstin(event.target.value.toUpperCase())}
              disabled={!can('settings.manage')}
            />
          </label>
        </div>
        {can('settings.manage') ? (
          <Button className="mt-4" onClick={() => void saveProfile()} disabled={pending}>
            {pending ? t('common.saving') : t('common.save')}
          </Button>
        ) : null}
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">{t('settings.modules')}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('settings.modulesHint')}</p>
        <div className="mt-4 space-y-6">
          {FEATURE_GROUPS.map((group) => (
            <div key={group.id}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`groups.${group.id}`)}
              </h3>
              <ul className="mt-2 divide-y rounded-xl border bg-card">
                {group.keys.map((key) => {
                  const module = session.modules.find((item) => item.key === key);
                  const entitled = module?.entitled ?? false;
                  const enabled = module?.enabled ?? false;
                  const locked = module?.locked ?? false;
                  return (
                    <li key={key} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">{t(`features.${key}`)}</p>
                        <p className="text-xs text-muted-foreground">
                          {!entitled ? t('settings.notInPlan') : locked ? t('settings.locked') : null}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        disabled={!can('settings.manage') || !entitled || locked}
                        onClick={() => void toggle(key, !enabled)}
                        className={`relative h-7 w-12 rounded-full transition-colors disabled:opacity-50 ${
                          enabled ? 'bg-primary' : 'bg-muted'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${
                            enabled ? 'left-5' : 'left-0.5'
                          }`}
                        />
                        <span className="sr-only">
                          {t(`features.${key}`)} {enabled ? t('common.on') : t('common.off')}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
