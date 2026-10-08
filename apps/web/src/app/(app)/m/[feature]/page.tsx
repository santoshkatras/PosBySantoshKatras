'use client';

import { FEATURE_KEYS, type FeatureKey } from '@stockkeep/types';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

const SLUG_TO_FEATURE: Record<string, FeatureKey> = {
  purchase: 'purchase',
  sales: 'sales',
  customers: 'customers',
  reports: 'reports',
  serial: 'serial',
  warranty: 'warranty',
  'bike-service': 'bike_service',
  notifications: 'notifications',
};

export default function PlaceholderPage() {
  const params = useParams<{ feature: string }>();
  const feature = SLUG_TO_FEATURE[params.feature] ?? null;
  const { t } = useI18n();
  const { session } = useAuth();
  const known = feature && (FEATURE_KEYS as readonly string[]).includes(feature);
  const enabled = known && session?.modules.some((module) => module.key === feature && module.enabled);

  if (!known || !feature) {
    return <PageHeader title={t('common.back')} />;
  }

  return (
    <div>
      <PageHeader title={t(`placeholders.${feature}.title`)} subtitle={t(`placeholders.${feature}.body`)} />
      <Badge>{enabled ? t('common.comingSoon') : t('settings.notInPlan')}</Badge>
    </div>
  );
}
