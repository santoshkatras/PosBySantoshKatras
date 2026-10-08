'use client';

import { PERMISSIONS, createUserSchema, type Permission } from '@stockkeep/types';
import { useEffect, useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

type UserRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  role: { id: string; code: string; name: string };
  locationIds: string[];
};
type RoleRow = {
  id: string;
  code: string;
  name: string;
  locked: boolean;
  permissions: Permission[];
};
type Location = { id: string; name: string };

export default function UsersPage() {
  const { t } = useI18n();
  const { request, can, session } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Permission[]>>({});

  async function load() {
    const [userData, roleData] = await Promise.all([
      request<{ items: UserRow[] }>('/users'),
      request<{ items: RoleRow[] }>('/roles'),
    ]);
    setUsers(userData.items);
    setRoles(roleData.items);
    setDrafts(Object.fromEntries(roleData.items.map((role) => [role.id, role.permissions])));
    if (can('locations.view')) {
      const locationData = await request<{ items: Location[] }>('/locations');
      setLocations(locationData.items);
    }
  }

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof ApiError ? err.message : t('common.retry')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleLocation(id: string) {
    setLocationIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function togglePermission(role: string, permission: Permission) {
    setDrafts((current) => {
      const list = current[role] ?? [];
      const next = list.includes(permission) ? list.filter((item) => item !== permission) : [...list, permission];
      return { ...current, [role]: next };
    });
  }

  async function createUser() {
    const parsed = createUserSchema.safeParse({ name, email, password, roleId, locationIds });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? t('common.retry'));
      return;
    }
    setPending(true);
    setFormError('');
    try {
      await request('/users', { method: 'POST', body: parsed.data });
      setOpen(false);
      setName('');
      setEmail('');
      setPassword('');
      setLocationIds([]);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('common.retry'));
    } finally {
      setPending(false);
    }
  }

  async function saveRole(role: RoleRow) {
    await request(`/roles/${role.id}/permissions`, {
      method: 'PATCH',
      body: { permissions: drafts[role.id] ?? [] },
    });
    await load();
  }

  async function setStatus(user: UserRow, status: 'active' | 'disabled') {
    await request(`/users/${user.id}`, { method: 'PATCH', body: { status } });
    await load();
  }

  const limit = session?.limits.users;

  return (
    <div>
      <PageHeader
        title={t('users.title')}
        subtitle={t('users.subtitle')}
        action={
          can('users.manage') ? (
            <Button
              onClick={() => {
                setRoleId(roles[0]?.id ?? '');
                setFormError('');
                setOpen(true);
              }}
            >
              {t('users.add')}
            </Button>
          ) : null
        }
      />
      {limit != null ? (
        <p className="mb-4 text-xs text-muted-foreground">{t('users.userLimit', { count: users.length, limit })}</p>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">{t('common.name')}</th>
              <th className="px-4 py-3 font-medium">{t('users.role')}</th>
              <th className="px-4 py-3 font-medium">{t('users.locations')}</th>
              <th className="px-4 py-3 font-medium">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{user.name}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </td>
                <td className="px-4 py-3">{t(`roles.${user.role.code}`)}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {user.locationIds.length === 0
                    ? t('users.allLocations')
                    : user.locationIds
                        .map((id) => locations.find((location) => location.id === id)?.name ?? id)
                        .join(', ')}
                </td>
                <td className="px-4 py-3">
                  <Badge>{user.status === 'active' ? t('common.active') : t('users.disabled')}</Badge>
                  {can('users.manage') && user.id !== session?.user.id ? (
                    <Button
                      className="ml-2"
                      size="sm"
                      variant="ghost"
                      onClick={() => void setStatus(user, user.status === 'active' ? 'disabled' : 'active')}
                    >
                      {user.status === 'active' ? t('users.disabled') : t('common.active')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">{t('users.rolesTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('users.rolesHint')}</p>
        <div className="mt-4 space-y-4">
          {roles.map((role) => (
            <div key={role.id} className="rounded-xl border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{t(`roles.${role.code}`)}</p>
                  {role.locked ? <p className="text-xs text-muted-foreground">{t('users.lockedRole')}</p> : null}
                </div>
                {can('users.manage') && !role.locked ? (
                  <Button size="sm" variant="outline" onClick={() => void saveRole(role)}>
                    {t('users.saveRole')}
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {PERMISSIONS.map((permission) => (
                  <label key={permission} className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={role.locked || !can('users.manage')}
                      checked={(drafts[role.id] ?? []).includes(permission)}
                      onChange={() => togglePermission(role.id, permission)}
                    />
                    {t(`permissions.${permission}`)}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('users.createTitle')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm font-medium">
              {t('common.name')}
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t('common.email')}
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t('common.password')}
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              <span className="text-xs font-normal text-muted-foreground">{t('auth.passwordHint')}</span>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t('users.role')}
              <Select value={roleId} onChange={(event) => setRoleId(event.target.value)}>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {t(`roles.${role.code}`)}
                  </option>
                ))}
              </Select>
            </label>
            <fieldset>
              <legend className="text-sm font-medium">{t('users.locations')}</legend>
              <p className="mb-2 text-xs text-muted-foreground">{t('users.locationsHint')}</p>
              <div className="grid gap-1">
                {locations.map((location) => (
                  <label key={location.id} className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={locationIds.includes(location.id)}
                      onChange={() => toggleLocation(location.id)}
                    />
                    {location.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <ErrorText>{formError}</ErrorText>
            <Button onClick={() => void createUser()} disabled={pending}>
              {pending ? t('common.saving') : t('common.create')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
