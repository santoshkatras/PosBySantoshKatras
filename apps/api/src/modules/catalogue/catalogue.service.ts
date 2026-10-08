import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  BrandInput,
  CategoryInput,
  CreateProductInput,
  UpdateProductInput,
  UpdateVariantInput,
  VariantInput,
} from '@stockkeep/types';
import { asAttributes, money, qty } from '../../common/decimal';
import { DbService } from '../../common/db.service';
import type { RequestMeta, RequestUser } from '../../common/request-user';
import { AuditService } from '../audit/audit.service';

const productInclude = {
  category: { select: { id: true, name: true, parentId: true } },
  brand: { select: { id: true, name: true } },
  unit: { select: { id: true, code: true, name: true } },
  variants: { orderBy: { sku: 'asc' as const } },
} satisfies Prisma.ProductInclude;

type ProductRecord = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

@Injectable()
export class CatalogueService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async listCategories() {
    const items = await this.db.client.category.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, parentId: true },
    });
    return { items };
  }

  async createCategory(user: RequestUser, input: CategoryInput, meta: RequestMeta) {
    if (input.parentId) {
      const parent = await this.db.client.category.findUnique({ where: { id: input.parentId } });
      if (!parent) throw new NotFoundException('Parent category not found');
    }
    const category = await this.db.client.category.create({
      data: { tenantId: user.tenantId, name: input.name, parentId: input.parentId ?? null },
      select: { id: true, name: true, parentId: true },
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.user.id,
      action: 'category.create',
      entity: 'category',
      entityId: category.id,
      after: { name: category.name },
      meta,
    });
    return category;
  }

  async updateCategory(user: RequestUser, id: string, input: CategoryInput, meta: RequestMeta) {
    if (input.parentId === id) throw new ConflictException('A category cannot be its own parent');
    const category = await this.db.client.category.update({
      where: { id },
      data: { name: input.name, parentId: input.parentId ?? null },
      select: { id: true, name: true, parentId: true },
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.user.id,
      action: 'category.update',
      entity: 'category',
      entityId: id,
      after: { name: category.name },
      meta,
    });
    return category;
  }

  async deleteCategory(user: RequestUser, id: string, meta: RequestMeta) {
    const [products, children] = await Promise.all([
      this.db.client.product.count({ where: { categoryId: id } }),
      this.db.client.category.count({ where: { parentId: id } }),
    ]);
    if (products > 0 || children > 0) {
      throw new ConflictException('Move products and sub-categories out before deleting this category');
    }
    await this.db.client.category.delete({ where: { id } });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.user.id,
      action: 'category.delete',
      entity: 'category',
      entityId: id,
      meta,
    });
    return { id };
  }

  async listBrands() {
    const items = await this.db.client.brand.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return { items };
  }

  async createBrand(user: RequestUser, input: BrandInput, meta: RequestMeta) {
    const brand = await this.db.client.brand.create({
      data: { tenantId: user.tenantId, name: input.name },
      select: { id: true, name: true },
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.user.id,
      action: 'brand.create',
      entity: 'brand',
      entityId: brand.id,
      after: { name: brand.name },
      meta,
    });
    return brand;
  }

  async updateBrand(user: RequestUser, id: string, input: BrandInput, meta: RequestMeta) {
    const brand = await this.db.client.brand.update({
      where: { id },
      data: { name: input.name },
      select: { id: true, name: true },
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.user.id,
      action: 'brand.update',
      entity: 'brand',
      entityId: id,
      after: { name: brand.name },
      meta,
    });
    return brand;
  }

  async deleteBrand(user: RequestUser, id: string, meta: RequestMeta) {
    const products = await this.db.client.product.count({ where: { brandId: id } });
    if (products > 0) throw new ConflictException('This brand is used by products');
    await this.db.client.brand.delete({ where: { id } });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.user.id,
      action: 'brand.delete',
      entity: 'brand',
      entityId: id,
      meta,
    });
    return { id };
  }

  async listUnits() {
    const items = await this.db.client.unit.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true },
    });
    return { items };
  }

  async listProducts(search?: string, includeInactive = false) {
    const query = search?.trim();
    const items = await this.db.client.product.findMany({
      where: {
        ...(includeInactive ? {} : { isActive: true }),
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { variants: { some: { sku: { contains: query, mode: 'insensitive' } } } },
                { variants: { some: { barcode: { contains: query, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      include: productInclude,
      orderBy: { name: 'asc' },
      take: 200,
    });
    return { items: items.map(toProduct) };
  }

  async getProduct(id: string) {
    const product = await this.db.client.product.findUnique({ where: { id }, include: productInclude });
    if (!product) throw new NotFoundException('Product not found');
    return toProduct(product);
  }

  async createProduct(user: RequestUser, input: CreateProductInput, meta: RequestMeta) {
    await this.assertRefs(input.unitId, input.categoryId, input.brandId);
    const product = await this.db.client.product.create({
      data: {
        tenantId: user.tenantId,
        name: input.name,
        categoryId: input.categoryId ?? null,
        brandId: input.brandId ?? null,
        unitId: input.unitId,
        hsnSac: input.hsnSac,
        gstRate: input.gstRate,
        trackingType: input.trackingType,
        isService: input.isService ?? false,
        variants: { create: variantData(user.tenantId, input.variant) },
      },
      include: productInclude,
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.user.id,
      action: 'product.create',
      entity: 'product',
      entityId: product.id,
      after: { name: product.name, sku: input.variant.sku },
      meta,
    });
    return toProduct(product);
  }

  async updateProduct(user: RequestUser, id: string, input: UpdateProductInput, meta: RequestMeta) {
    const existing = await this.db.client.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Product not found');
    if (input.unitId || input.categoryId || input.brandId) {
      await this.assertRefs(input.unitId ?? existing.unitId, input.categoryId, input.brandId);
    }
    const product = await this.db.client.product.update({
      where: { id },
      data: {
        name: input.name,
        categoryId: input.categoryId,
        brandId: input.brandId,
        unitId: input.unitId,
        hsnSac: input.hsnSac,
        gstRate: input.gstRate,
        trackingType: input.trackingType,
        isService: input.isService,
        isActive: input.isActive,
      },
      include: productInclude,
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.user.id,
      action: 'product.update',
      entity: 'product',
      entityId: id,
      before: { name: existing.name, isActive: existing.isActive },
      after: { name: product.name, isActive: product.isActive },
      meta,
    });
    return toProduct(product);
  }

  async addVariant(user: RequestUser, productId: string, input: VariantInput, meta: RequestMeta) {
    const product = await this.db.client.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    const variant = await this.db.client.productVariant.create({
      data: { ...variantData(user.tenantId, input), productId },
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.user.id,
      action: 'variant.create',
      entity: 'product_variant',
      entityId: variant.id,
      after: { sku: variant.sku, productId },
      meta,
    });
    return toVariant(variant);
  }

  async updateVariant(user: RequestUser, id: string, input: UpdateVariantInput, meta: RequestMeta) {
    const variant = await this.db.client.productVariant.update({
      where: { id },
      data: {
        sku: input.sku,
        barcode: input.barcode,
        attributes: input.attributes,
        mrp: input.mrp,
        salePrice: input.salePrice,
        costPrice: input.costPrice,
        minStock: input.minStock,
        isActive: input.isActive,
      },
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.user.id,
      action: 'variant.update',
      entity: 'product_variant',
      entityId: id,
      after: { sku: variant.sku, isActive: variant.isActive },
      meta,
    });
    return toVariant(variant);
  }

  private async assertRefs(
    unitId: string,
    categoryId?: string | null,
    brandId?: string | null,
  ) {
    const unit = await this.db.client.unit.findUnique({ where: { id: unitId } });
    if (!unit) throw new NotFoundException('Unit not found');
    if (categoryId) {
      const category = await this.db.client.category.findUnique({ where: { id: categoryId } });
      if (!category) throw new NotFoundException('Category not found');
    }
    if (brandId) {
      const brand = await this.db.client.brand.findUnique({ where: { id: brandId } });
      if (!brand) throw new NotFoundException('Brand not found');
    }
  }
}

function variantData(tenantId: string, input: VariantInput) {
  return {
    tenantId,
    sku: input.sku,
    barcode: input.barcode ?? null,
    attributes: input.attributes ?? {},
    mrp: input.mrp,
    salePrice: input.salePrice,
    costPrice: input.costPrice,
    minStock: input.minStock,
  };
}

function toVariant(variant: {
  id: string;
  sku: string;
  barcode: string | null;
  attributes: Prisma.JsonValue;
  mrp: Prisma.Decimal;
  salePrice: Prisma.Decimal;
  costPrice: Prisma.Decimal;
  minStock: Prisma.Decimal;
  isActive: boolean;
}) {
  return {
    id: variant.id,
    sku: variant.sku,
    barcode: variant.barcode,
    attributes: asAttributes(variant.attributes),
    mrp: money(variant.mrp),
    salePrice: money(variant.salePrice),
    costPrice: money(variant.costPrice),
    minStock: qty(variant.minStock),
    isActive: variant.isActive,
  };
}

function toProduct(product: ProductRecord) {
  return {
    id: product.id,
    name: product.name,
    hsnSac: product.hsnSac,
    gstRate: money(product.gstRate),
    trackingType: product.trackingType,
    isService: product.isService,
    isActive: product.isActive,
    category: product.category,
    brand: product.brand,
    unit: product.unit,
    variants: product.variants.map(toVariant),
  };
}
