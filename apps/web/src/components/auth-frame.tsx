'use client';

import { useI18n } from '@/lib/i18n';

export function AuthFrame({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const points = [t('app.pointCatalogue'), t('app.pointStock'), t('app.pointModules')];
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      <aside className="relative hidden flex-col justify-between bg-sidebar px-12 py-12 text-sidebar-foreground lg:flex">
        <div>
          <p className="font-serif text-4xl text-white">{t('app.name')}</p>
          <p className="mt-4 max-w-md text-lg leading-relaxed text-sidebar-foreground/80">{t('app.tagline')}</p>
          <ul className="mt-10 space-y-4">
            {points.map((point) => (
              <li key={point} className="flex gap-3 text-sm text-sidebar-foreground/80">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs uppercase tracking-[0.18em] text-sidebar-foreground/50">{t('app.languageNote')}</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <p className="mb-6 font-serif text-3xl lg:hidden">{t('app.name')}</p>
          {children}
          <p className="mt-8 text-xs text-muted-foreground">{t('app.footer')}</p>
        </div>
      </main>
    </div>
  );
}
