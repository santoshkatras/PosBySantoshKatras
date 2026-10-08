'use client';

import { ADJUSTMENT_REASONS, stockAdjustmentSchema, type AdjustmentReason } from '@stockkeep/types';
import { EmptyState, formatDateTime, formatInr, formatQty } from '@stockkeep/ui';
import { useEffect, useMemo, useState } from 'react';
import { ErrorText } from '@/components/error-text';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

type StockRow = {
  variantId: string;
  sku: string;
  productName: string;
  unitCode: string;
  locationId: string;
  locationName: string;
  qtyOnHand: string;
  minStock: string;
  stockValue: string | null;
  low: boolean;
};

type Movement = {
  id: string;
  qty: string;
  movementType: string;
  reason: string | null;
  note: string | null;
  createdAt: string;
  location: { name: string };
  sku: string;
  productName: string;
};

export default function StockPage() {
  const { t } = useI18n();
  const { request, can } = useAuth();
  const [rows, setRows] = useState<StockRow[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [query, setQuery] = useState('');
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const [variantId, setVariantId] = useState('');
  const [adjustLocation, setAdjustLocation] = useState('');
  const [qtyDelta, setQtyDelta] = useState('');
  const [reason, setReason] = useState<AdjustmentReason>('correction');
  const [note, setNote] = useState('');

  async function load(search = query) {
    const path = `/stock${search ? `?q=${encodeURIComponent(search)}` : ''}`;
    const [stock, ledger] = await Promise.all([
      request<{ items: StockRow[] }>(path),
      request<{ items: Movement[] }>('/stock/movements'),
    ]);
    setRows(stock.items);
    setMovements(ledger.items);
  }

  useEffect(() => {
    load('')
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : t('common.retry')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locations = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) map.set(row.locationId, row.locationName);
    return [...map.entries()];
  }, [rows]);

  const variants = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) map.set(row.variantId, `${row.productName} · ${row.sku}`);
    return [...map.entries()];
  }, [rows]);

  const visible = rows.filter((row) => !locationId || row.locationId === locationId);

  async function adjust() {
    const parsed = stockAdjustmentSchema.safeParse({
      locationId: adjustLocation,
      variantId,
      qtyDelta,
      reason,
      note,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? t('common.retry'));
      return;
    }
    setPending(true);
    setFormError('');
    try {
      await request('/stock/adjustments', { method: 'POST', body: parsed.data });
      setOpen(false);
      setQtyDelta('');
      setNote('');
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('common.retry'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t('stock.title')}
        subtitle={t('stock.subtitle')}
        action={
          can('stock.adjust') ? (
            <Button
              onClick={() => {
                setAdjustLocation(locations[0]?.[0] ?? '');
                setVariantId(variants[0]?.[0] ?? '');
                setFormError('');
                setOpen(true);
              }}
            >
              {t('stock.adjust')}
            </Button>
          ) : null
        }
      />
      <ErrorText>{error}</ErrorText>
      {loading ? <p className="text-sm text-muted-foreground">{t('common.loading')}</p> : null}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input
          value={query}
          placeholder={t('stock.search')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select className="sm:max-w-xs" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
          <option value="">{t('common.all')}</option>
          {locations.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
        <Button variant="outline" onClick={() => void load(query)}>
          {t('common.search')}
        </Button>
      </div>
      {visible.length === 0 && !loading ? (
        <EmptyState title={t('stock.emptyTitle')} body={t('stock.emptyBody')} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t('stock.item')}</th>
                <th className="px-4 py-3 font-medium">{t('stock.location')}</th>
                <th className="px-4 py-3 font-medium">{t('stock.onHand')}</th>
                <th className="px-4 py-3 font-medium">{t('stock.minimum')}</th>
                <th className="px-4 py-3 font-medium">{t('stock.value')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={`${row.variantId}-${row.locationId}`} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{row.productName}</p>
                    <p className="text-xs text-muted-foreground">{row.sku}</p>
                  </td>
                  <td className="px-4 py-3">{row.locationName}</td>
                  <td className="px-4 py-3">
                    {formatQty(row.qtyOnHand)} {row.unitCode}
                    {row.low ? <Badge className="ml-2 border-primary/30 text-primary">{t('stock.low')}</Badge> : null}
                  </td>
                  <td className="px-4 py-3">{formatQty(row.minStock)}</td>
                  <td className="px-4 py-3">{row.stockValue ? formatInr(row.stockValue) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold">{t('stock.ledger')}</h2>
        {movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('stock.emptyLedger')}</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {movements.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {row.productName} <span className="text-muted-foreground">{row.sku}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.location.name} · {t(`movement.${row.movementType}`)}
                    {row.reason ? ` · ${t(`reasons.${row.reason}`)}` : ''}
                    {row.note ? ` · ${row.note}` : ''}
                  </p>
                </div>
                <div className="text-sm">
                  <span className="font-medium">{formatQty(row.qty)}</span>
                  <span className="ml-3 text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('stock.adjustTitle')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm font-medium">
              {t('stock.variant')}
              <Select value={variantId} onChange={(event) => setVariantId(event.target.value)}>
                {variants.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t('stock.location')}
              <Select value={adjustLocation} onChange={(event) => setAdjustLocation(event.target.value)}>
                {locations.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t('stock.qtyDelta')}
              <Input
                value={qtyDelta}
                onChange={(event) => setQtyDelta(event.target.value)}
                placeholder={t('stock.qtyPlaceholder')}
              />
              <span className="text-xs font-normal text-muted-foreground">{t('stock.qtyHint')}</span>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t('stock.reason')}
              <Select value={reason} onChange={(event) => setReason(event.target.value as AdjustmentReason)}>
                {ADJUSTMENT_REASONS.map((item) => (
                  <option key={item} value={item}>
                    {t(`reasons.${item}`)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              {t('stock.note')}
              <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <ErrorText>{formError}</ErrorText>
            <Button onClick={() => void adjust()} disabled={pending}>
              {pending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
