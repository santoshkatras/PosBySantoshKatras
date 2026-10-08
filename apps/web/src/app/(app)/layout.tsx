'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Shell } from '@/components/shell';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { ready, session } = useAuth();
  const router = useRouter();
  const { t } = useI18n();

  useEffect(() => {
    if (ready && !session) router.replace('/login');
  }, [ready, session, router]);

  if (!ready || !session) {
    return <p className="p-8 text-sm text-muted-foreground">{t('common.loading')}</p>;
  }

  return <Shell>{children}</Shell>;
}
