'use client';

import {
  GST_RATES,
  TRACKING_TYPES,
  createProductSchema,
  type TrackingType,
} from '@stockkeep/types';
import { EmptyState, formatInr } from '@stockkeep/ui';
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

type Category = { id: string; name: string; parentId: string | null };
type Brand = { id: string; name: string };
type Unit = { id: string; code: string; name: string };
type Variant = {
  id: string;
  sku: string;
  barcode: string | null;
  attributes: Record<string, string>;
  mrp: string | null;
  salePrice: string | null;
  costPrice: string | null;
  minStock: string;
  isActive: boolean;
};
type Product = {
  id: string;
  name: string;
  hsnSac: string | null;
  gstRate: string | null;
  trackingType: TrackingType;
  isService: boolean;
  isActive: boolean;
  category: Category | null;
  brand: Brand | null;
  unit: Unit;
  variants: Variant[];
};

type Attr = { key: string; value: string };
type VariantDraft = {
  id?: string;
  sku: string;
  barcode: string;
  mrp: string;
  salePrice: string;
  costPrice: string;
  minStock: string;
  attributes: Attr[];
};

const blankVariant = (): VariantDraft => ({
  sku: '',
  barcode: '',
  mrp: '',
  salePrice: '',
  costPrice: '',
  minStock: '0',
  attributes: [],
});

export default function CataloguePage() {
  const { t } = useI18n();
  const { request, can } = useAuth();
  const [tab, setTab] = useState<'products' | 'categories' | 'brands'>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [hsnSac, setHsnSac] = useState('');
  const [gstRate, setGstRate] = useState('18');
  const [trackingType, setTrackingType] = useState<TrackingType>('none');
  const [isService, setIsService] = useState(false);
  const [variants, setVariants] = useState<VariantDraft[]>([blankVariant()]);
  const [categoryName, setCategoryName] = useState('');
  const [parentId, setParentId] = useState('');
  const [brandName, setBrandName] = useState('');

  async function load(search = query) {
    const [productData, categoryData, brandData, unitData] = await Promise.all([
      request<{ items: Product[] }>(`/products?includeInactive=true${search ? `&q=${encodeURIComponent(search)}` : ''}`),
      request<{ items: Category[] }>('/categories'),
      request<{ items: Brand[] }>('/brands'),
      request<{ items: Unit[] }>('/units'),
    ]);
    setProducts(productData.items);
    setCategories(categoryData.items);
    setBrands(brandData.items);
    setUnits(unitData.items);
    if (!unitId && unitData.items[0]) setUnitId(unitData.items[0].id);
  }

  useEffect(() => {
    load('')
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : t('common.retry')))
      .finally(() => setLoading(false));
    // Initial load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCreate() {
    setEditing(null);
    setName('');
    setCategoryId('');
    setBrandId('');
    setUnitId(units[0]?.id ?? '');
    setHsnSac('');
    setGstRate('18');
    setTrackingType('none');
    setIsService(false);
    setVariants([blankVariant()]);
    setFormError('');
    setOpen(true);
  }

  function openEdit(product: Product) {
    setEditing(product);
    setName(product.name);
    setCategoryId(product.category?.id ?? '');
    setBrandId(product.brand?.id ?? '');
    setUnitId(product.unit.id);
    setHsnSac(product.hsnSac ?? '');
    setGstRate(trimRate(product.gstRate));
    setTrackingType(product.trackingType);
    setIsService(product.isService);
    setVariants(
      product.variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        barcode: variant.barcode ?? '',
        mrp: variant.mrp ?? '',
        salePrice: variant.salePrice ?? '',
        costPrice: variant.costPrice ?? '',
        minStock: trimQty(variant.minStock),
        attributes: Object.entries(variant.attributes).map(([key, value]) => ({ key, value })),
      })),
    );
    setFormError('');
    setOpen(true);
  }

  async function saveProduct() {
    const draft = variants[0];
    if (!draft) return;
    const attributes = Object.fromEntries(
      draft.attributes.filter((row) => row.key && row.value).map((row) => [row.key, row.value]),
    );
    setPending(true);
    setFormError('');
    try {
      if (!editing) {
        const parsed = createProductSchema.safeParse({
          name,
          categoryId: categoryId || null,
          brandId: brandId || null,
          unitId,
          hsnSac,
          gstRate,
          trackingType,
          isService,
          variant: {
            sku: draft.sku,
            barcode: draft.barcode,
            attributes,
            mrp: draft.mrp,
            salePrice: draft.salePrice,
            costPrice: draft.costPrice,
            minStock: draft.minStock || '0',
          },
        });
        if (!parsed.success) {
          setFormError(parsed.error.issues[0]?.message ?? t('common.retry'));
          return;
        }
        await request('/products', { method: 'POST', body: parsed.data });
      } else {
        await request(`/products/${editing.id}`, {
          method: 'PATCH',
          body: {
            name,
            categoryId: categoryId || null,
            brandId: brandId || null,
            unitId,
            hsnSac: hsnSac || null,
            gstRate,
            trackingType,
            isService,
            isActive: editing.isActive,
          },
        });
        for (const variant of variants) {
          const variantAttributes = Object.fromEntries(
            variant.attributes.filter((row) => row.key && row.value).map((row) => [row.key, row.value]),
          );
          const body = {
            sku: variant.sku,
            barcode: variant.barcode || null,
            attributes: variantAttributes,
            mrp: variant.mrp,
            salePrice: variant.salePrice,
            costPrice: variant.costPrice,
            minStock: variant.minStock || '0',
          };
          if (variant.id) {
            await request(`/variants/${variant.id}`, { method: 'PATCH', body });
          } else {
            await request(`/products/${editing.id}/variants`, { method: 'POST', body });
          }
        }
      }
      setOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t('common.retry'));
    } finally {
      setPending(false);
    }
  }

  async function archive(product: Product) {
    await request(`/products/${product.id}`, {
      method: 'PATCH',
      body: { isActive: !product.isActive },
    });
    await load();
  }

  async function addCategory() {
    if (!categoryName.trim()) return;
    await request('/categories', {
      method: 'POST',
      body: { name: categoryName.trim(), parentId: parentId || null },
    });
    setCategoryName('');
    setParentId('');
    await load();
  }

  async function addBrand() {
    if (!brandName.trim()) return;
    await request('/brands', { method: 'POST', body: { name: brandName.trim() } });
    setBrandName('');
    await load();
  }

  return (
    <div>
      <PageHeader
        title={t('catalogue.title')}
        subtitle={t('catalogue.subtitle')}
        action={
          can('catalogue.manage') && tab === 'products' ? (
            <Button onClick={openCreate}>{t('catalogue.add')}</Button>
          ) : null
        }
      />
      <div className="mb-4 flex gap-2">
        {(['products', 'categories', 'brands'] as const).map((item) => (
          <Button key={item} variant={tab === item ? 'default' : 'outline'} size="sm" onClick={() => setTab(item)}>
            {t(`catalogue.tabs${item[0]?.toUpperCase()}${item.slice(1)}`)}
          </Button>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
      {loading ? <p className="text-sm text-muted-foreground">{t('common.loading')}</p> : null}

      {tab === 'products' ? (
        <div className="space-y-4">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void load(query);
            }}
          >
            <Input
              value={query}
              placeholder={t('catalogue.search')}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button type="submit" variant="outline">
              {t('common.search')}
            </Button>
          </form>
          {products.length === 0 ? (
            <EmptyState title={t('catalogue.emptyTitle')} body={t('catalogue.emptyBody')} />
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t('common.name')}</th>
                    <th className="px-4 py-3 font-medium">{t('catalogue.sku')}</th>
                    <th className="px-4 py-3 font-medium">{t('catalogue.hsn')}</th>
                    <th className="px-4 py-3 font-medium">{t('catalogue.gst')}</th>
                    <th className="px-4 py-3 font-medium">{t('catalogue.price')}</th>
                    <th className="px-4 py-3 font-medium">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => {
                    const variant = product.variants[0];
                    return (
                      <tr key={product.id} className="border-b last:border-0">
                        <td className="px-4 py-3">
                          <p className="font-medium">{product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {[product.brand?.name, product.category?.name, t(`tracking.${product.trackingType}`)]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                          {!product.isActive ? <Badge className="mt-1">{t('common.archived')}</Badge> : null}
                        </td>
                        <td className="px-4 py-3">
                          {product.variants.map((item) => item.sku).join(', ')}
                        </td>
                        <td className="px-4 py-3">{product.hsnSac ?? '—'}</td>
                        <td className="px-4 py-3">{product.gstRate ? `${trimRate(product.gstRate)}%` : '—'}</td>
                        <td className="px-4 py-3">{variant?.salePrice ? formatInr(variant.salePrice) : '—'}</td>
                        <td className="px-4 py-3">
                          {can('catalogue.manage') ? (
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" onClick={() => openEdit(product)}>
                                {t('common.edit')}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => void archive(product)}>
                                {product.isActive ? t('common.archive') : t('common.restore')}
                              </Button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'categories' ? (
        <div className="space-y-4">
          {can('catalogue.manage') ? (
            <div className="grid gap-2 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                placeholder={t('common.name')}
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
              />
              <Select value={parentId} onChange={(event) => setParentId(event.target.value)}>
                <option value="">{t('catalogue.parent')}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {labelCategory(category, categories)}
                  </option>
                ))}
              </Select>
              <Button onClick={() => void addBrandSafe(addCategory)}>{t('catalogue.addCategory')}</Button>
            </div>
          ) : null}
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('catalogue.emptyCategories')}</p>
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {categories.map((category) => (
                <li key={category.id} className="px-4 py-3 text-sm">
                  {labelCategory(category, categories)}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === 'brands' ? (
        <div className="space-y-4">
          {can('catalogue.manage') ? (
            <div className="flex gap-2">
              <Input
                placeholder={t('common.name')}
                value={brandName}
                onChange={(event) => setBrandName(event.target.value)}
              />
              <Button onClick={() => void addBrandSafe(addBrand)}>{t('catalogue.addBrand')}</Button>
            </div>
          ) : null}
          {brands.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('catalogue.emptyBrands')}</p>
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {brands.map((brand) => (
                <li key={brand.id} className="px-4 py-3 text-sm">
                  {brand.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(calc(100%-1.5rem),42rem)]">
          <DialogHeader>
            <DialogTitle>{editing ? t('catalogue.editTitle') : t('catalogue.createTitle')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm font-medium">
              {t('common.name')}
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                {t('catalogue.category')}
                <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                  <option value="">{t('common.none')}</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {labelCategory(category, categories)}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                {t('catalogue.brand')}
                <Select value={brandId} onChange={(event) => setBrandId(event.target.value)}>
                  <option value="">{t('common.none')}</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1.5 text-sm font-medium">
                {t('catalogue.unit')}
                <Select value={unitId} onChange={(event) => setUnitId(event.target.value)}>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                {t('catalogue.hsn')}
                <Input value={hsnSac} onChange={(event) => setHsnSac(event.target.value)} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                {t('catalogue.gst')}
                <Select value={gstRate} onChange={(event) => setGstRate(event.target.value)}>
                  {GST_RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}%
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <label className="grid gap-1.5 text-sm font-medium">
              {t('catalogue.tracking')}
              <Select
                value={trackingType}
                onChange={(event) => setTrackingType(event.target.value as TrackingType)}
              >
                {TRACKING_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`tracking.${type}`)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={isService} onChange={(event) => setIsService(event.target.checked)} />
              {t('catalogue.service')}
            </label>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{t('catalogue.variants')}</p>
                {editing ? (
                  <Button size="sm" variant="outline" onClick={() => setVariants([...variants, blankVariant()])}>
                    {t('catalogue.variant')}
                  </Button>
                ) : null}
              </div>
              {variants.map((variant, index) => (
                <div key={variant.id ?? index} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                  <Input
                    placeholder={t('catalogue.sku')}
                    value={variant.sku}
                    onChange={(event) => updateVariant(index, { sku: event.target.value })}
                  />
                  <Input
                    placeholder={t('catalogue.barcode')}
                    value={variant.barcode}
                    onChange={(event) => updateVariant(index, { barcode: event.target.value })}
                  />
                  <Input
                    placeholder={t('catalogue.mrp')}
                    value={variant.mrp}
                    onChange={(event) => updateVariant(index, { mrp: event.target.value })}
                  />
                  <Input
                    placeholder={t('catalogue.price')}
                    value={variant.salePrice}
                    onChange={(event) => updateVariant(index, { salePrice: event.target.value })}
                  />
                  <Input
                    placeholder={t('catalogue.cost')}
                    value={variant.costPrice}
                    onChange={(event) => updateVariant(index, { costPrice: event.target.value })}
                  />
                  <Input
                    placeholder={t('catalogue.minStock')}
                    value={variant.minStock}
                    onChange={(event) => updateVariant(index, { minStock: event.target.value })}
                  />
                </div>
              ))}
            </div>
            <ErrorText>{formError}</ErrorText>
            {can('catalogue.manage') ? (
              <Button onClick={() => void saveProduct()} disabled={pending}>
                {pending ? t('common.saving') : t('common.save')}
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

  function updateVariant(index: number, patch: Partial<VariantDraft>) {
    setVariants((current) => current.map((variant, item) => (item === index ? { ...variant, ...patch } : variant)));
  }
}

function labelCategory(category: Category, categories: Category[]) {
  if (!category.parentId) return category.name;
  const parent = categories.find((item) => item.id === category.parentId);
  return parent ? `${parent.name} / ${category.name}` : category.name;
}

function trimRate(value: string | null) {
  if (!value) return '18';
  return value.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function trimQty(value: string) {
  return value.replace(/\.?0+$/, '') || '0';
}

async function addBrandSafe(action: () => Promise<void>) {
  try {
    await action();
  } catch {
    // The page-level error is refreshed on the next load failure. Surface nothing extra here.
  }
}
