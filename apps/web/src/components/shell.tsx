'use client';

import { NAV_ITEMS, stateName, type FeatureKey } from '@stockkeep/types';
import {
  Bell,
  Box,
  ChartColumn,
  Cpu,
  LayoutDashboard,
  MapPin,
  Menu,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  UserRound,
  Users,
  Warehouse,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  '/dashboard': LayoutDashboard,
  '/catalogue': Box,
  '/stock': Warehouse,
  '/locations': MapPin,
  '/m/purchase': ShoppingCart,
  '/m/sales': Receipt,
  '/m/customers': Users,
  '/m/reports': ChartColumn,
  '/m/serial': Cpu,
  '/m/warranty': ShieldCheck,
  '/m/bike-service': Wrench,
  '/m/notifications': Bell,
  '/users': UserRound,
  '/settings': Settings,
};

export function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const { session, signOut } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (!session) return null;

  const items = NAV_ITEMS.filter((item) => {
    if (item.feature && !session.modules.some((module) => module.key === item.feature && module.enabled)) {
      return false;
    }
    return session.user.permissions.includes(item.permission);
  });

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
      {items.map((item) => {
        const Icon = ICONS[item.href] ?? Box;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm',
              active ? 'bg-white/10 text-white' : 'text-sidebar-foreground/75 hover:bg-white/5 hover:text-white',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1">{t(item.labelKey)}</span>
            {item.implemented ? null : (
              <span className="text-[10px] uppercase tracking-wide text-sidebar-foreground/50">
                {t('common.comingSoon')}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="px-5 pt-5">
      <Link href="/dashboard" className="font-serif text-2xl text-white" onClick={() => setOpen(false)}>
        {t('app.name')}
      </Link>
      <p className="mt-1 text-sm text-sidebar-foreground/70">{session.tenant.name}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge className="border-white/15 bg-white/10 text-sidebar-foreground">
          {t(`business.${session.tenant.businessType}`)}
        </Badge>
        <Badge className="border-white/15 bg-transparent text-sidebar-foreground/80">
          {t(`tenantStatus.${session.tenant.status}`)}
        </Badge>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col bg-sidebar text-sidebar-foreground lg:flex">
        {brand}
        {nav}
        <UserFooter onSignOut={() => void signOut()} />
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
          <div>
            <p className="font-serif text-xl leading-none">{t('app.name')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{session.tenant.name}</p>
          </div>
          <Button variant="outline" size="icon" onClick={() => setOpen(true)} aria-label={t('common.menu')}>
            <Menu className="h-5 w-5" />
          </Button>
        </header>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="left-0 top-0 h-full max-h-none w-[min(100%,20rem)] translate-x-0 translate-y-0 rounded-none border-0 bg-sidebar p-0 text-sidebar-foreground">
            <DialogTitle className="sr-only">{t('common.menu')}</DialogTitle>
            {brand}
            {nav}
            <UserFooter onSignOut={() => void signOut()} />
          </DialogContent>
        </Dialog>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

function UserFooter({ onSignOut }: { onSignOut: () => void }) {
  const { session } = useAuth();
  const { t } = useI18n();
  if (!session) return null;
  return (
    <div className="border-t border-white/10 p-4">
      <p className="truncate text-sm font-medium text-white">{session.user.name}</p>
      <p className="truncate text-xs text-sidebar-foreground/60">
        {t(`roles.${session.user.role.code}`)} · {stateName(session.tenant.stateCode)}
      </p>
      <button
        type="button"
        onClick={onSignOut}
        className="mt-3 min-h-11 text-sm text-sidebar-foreground/80 underline-offset-4 hover:underline"
      >
        {t('common.signOut')}
      </button>
    </div>
  );
}

export function moduleEnabled(feature: FeatureKey, modules: { key: string; enabled: boolean }[]) {
  return modules.some((module) => module.key === feature && module.enabled);
}
