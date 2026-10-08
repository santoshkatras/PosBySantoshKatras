'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

export default function HomePage() {
  const { ready, session } = useAuth();
  const router = useRouter();
  const { t } = useI18n();

  useEffect(() => {
    if (!ready) return;
    router.replace(session ? '/dashboard' : '/login');
  }, [ready, session, router]);

  return <p className="p-8 text-sm text-muted-foreground">{t('common.loading')}</p>;
}
