'use client';

import { formatDate, formatInr, formatQty } from '@stockkeep/ui';
import { useEffect, useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

type Summary = {
  locations: number;
  products: number;
  skus: number;
  lowStock: number;
  stockValue: string;
  recentMovements: Array<{
    id: string;
    qty: string;
    movementType: string;
    reason: string | null;
    createdAt: string;
    locationName: string;
    productName: string;
    sku: string;
  }>;
};

export default function DashboardPage() {
  const { t } = useI18n();
  const { session, request } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    request<Summary>('/dashboard/summary')
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : t('common.retry'));
      });
    return () => {
      cancelled = true;
    };
  }, [request, t]);

  if (!session) return null;
  const enabled = session.modules.filter((module) => module.enabled);

  return (
    <div>
      <PageHeader
        title={t('dashboard.greeting', { name: session.user.name })}
        subtitle={session.tenant.trialEndsAt ? t('dashboard.trial', { date: formatDate(session.tenant.trialEndsAt) }) : t(`tenantStatus.${session.tenant.status}`)}
      />
      <ErrorText>{error}</ErrorText>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label={t('dashboard.locations')} value={summary ? String(summary.locations) : '—'} />
        <Stat label={t('dashboard.products')} value={summary ? String(summary.products) : '—'} />
        <Stat label={t('dashboard.skus')} value={summary ? String(summary.skus) : '—'} />
        <Stat label={t('dashboard.lowStock')} value={summary ? String(summary.lowStock) : '—'} hint={t('dashboard.lowHint')} />
        <Stat label={t('dashboard.stockValue')} value={summary ? formatInr(summary.stockValue) : '—'} />
      </div>
      <section className="mt-8">
        <h2 className="text-sm font-semibold">{t('dashboard.modules')}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {enabled.map((module) => (
            <Badge key={module.key} className="bg-card">
              {t(`features.${module.key}`)}
            </Badge>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t('dashboard.plan')}: {session.tenant.plan.name}
        </p>
      </section>
      <section className="mt-8">
        <h2 className="text-sm font-semibold">{t('dashboard.recent')}</h2>
        {!summary ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : summary.recentMovements.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('dashboard.emptyMovements')}</p>
        ) : (
          <ul className="mt-3 divide-y rounded-xl border bg-card">
            {summary.recentMovements.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {row.productName} <span className="text-muted-foreground">{row.sku}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.locationName} · {t(`movement.${row.movementType}`)}
                    {row.reason ? ` · ${t(`reasons.${row.reason}`)}` : ''}
                  </p>
                </div>
                <div className="text-sm">
                  <span className="font-medium">{formatQty(row.qty)}</span>
                  <span className="ml-3 text-xs text-muted-foreground">{formatDate(row.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-2 font-serif text-2xl">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
