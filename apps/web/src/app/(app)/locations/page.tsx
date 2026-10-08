'use client';

import { INDIAN_STATES, LOCATION_TYPES, locationSchema, stateName, type LocationType } from '@stockkeep/types';
import { EmptyState } from '@stockkeep/ui';
import { useEffect, useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

type Location = {
  id: string;
  name: string;
  type: LocationType;
  addressLine: string | null;
  city: string | null;
  stateCode: string;
  pincode: string | null;
  gstin: string | null;
  isActive: boolean;
};

const emptyForm = {
  name: '',
  type: 'store' as LocationType,
  addressLine: '',
  city: '',
  stateCode: '27',
  pincode: '',
  gstin: '',
  isActive: true,
};

export default function LocationsPage() {
  const { t } = useI18n();
  const { request, can, session } = useAuth();
  const [items, setItems] = useState<Location[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);

  async function load() {
    const data = await request<{ items: Location[] }>('/locations');
    setItems(data.items);
  }

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof ApiError ? err.message : t('common.retry')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startCreate() {
    setEditing(null);
    setForm({ ...emptyForm, stateCode: session?.tenant.stateCode ?? '27' });
    setFormError('');
    setOpen(true);
  }

  function startEdit(location: Location) {
    setEditing(location);
    setForm({
      name: location.name,
      type: location.type,
      addressLine: location.addressLine ?? '',
      city: location.city ?? '',
      stateCode: location.stateCode,
      pincode: location.pincode ?? '',
      gstin: location.gstin ?? '',
      isActive: location.isActive,
    });
    setFormError('');
    setOpen(true);
  }

  async function save() {
    const parsed = locationSchema.safeParse(form);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? t('common.retry'));
      return;
    }
    setPending(true);
    setFormError('');
    try {
      if (editing) {
        await request(`/locations/${editing.id}`, { method: 'PATCH', body: parsed.data });
      } else {
        await request('/locations', { method: 'POST', body: parsed.data });
      }
      setOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('common.retry'));
    } finally {
      setPending(false);
    }
  }

  const limit = session?.limits.locations;

  return (
    <div>
      <PageHeader
        title={t('locations.title')}
        subtitle={t('locations.subtitle')}
        action={
          can('locations.manage') ? (
            <Button onClick={startCreate}>{t('locations.add')}</Button>
          ) : null
        }
      />
      {limit != null ? (
        <p className="mb-4 text-xs text-muted-foreground">
          {t('locations.limit', { count: items.length, limit })}
        </p>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {items.length === 0 ? (
        <EmptyState title={t('locations.emptyTitle')} body={t('locations.emptyBody')} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((location) => (
            <Card key={location.id}>
              <CardContent className="space-y-2 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{location.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {t(`locationTypes.${location.type}`)} · {stateName(location.stateCode)}
                    </p>
                  </div>
                  <Badge>{location.isActive ? t('common.active') : t('common.archived')}</Badge>
                </div>
                <p className="text-sm">
                  {[location.addressLine, location.city, location.pincode].filter(Boolean).join(', ') || '—'}
                </p>
                {location.gstin ? <p className="text-xs text-muted-foreground">{location.gstin}</p> : null}
                {can('locations.manage') ? (
                  <Button variant="outline" size="sm" onClick={() => startEdit(location)}>
                    {t('common.edit')}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('locations.editTitle') : t('locations.createTitle')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm font-medium">
              {t('common.name')}
              <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t('locations.type')}
              <Select
                value={form.type}
                onChange={(event) => setForm({ ...form, type: event.target.value as LocationType })}
              >
                {LOCATION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`locationTypes.${type}`)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t('locations.address')}
              <Input
                value={form.addressLine}
                onChange={(event) => setForm({ ...form, addressLine: event.target.value })}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                {t('locations.city')}
                <Input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                {t('locations.pincode')}
                <Input value={form.pincode} onChange={(event) => setForm({ ...form, pincode: event.target.value })} />
              </label>
            </div>
            <label className="grid gap-1.5 text-sm font-medium">
              {t('locations.state')}
              <Select value={form.stateCode} onChange={(event) => setForm({ ...form, stateCode: event.target.value })}>
                {INDIAN_STATES.map((state) => (
                  <option key={state.code} value={state.code}>
                    {state.code} — {state.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t('locations.gstin')}
              <Input
                value={form.gstin}
                onChange={(event) => setForm({ ...form, gstin: event.target.value.toUpperCase() })}
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
              />
              {t('locations.active')}
            </label>
            <ErrorText>{formError}</ErrorText>
            <Button onClick={() => void save()} disabled={pending}>
              {pending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
