import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { StockAdjustmentInput } from '@stockkeep/types';
import { asAttributes, money, qty } from '../../common/decimal';
import { DbService } from '../../common/db.service';
import { assertLocationAccess, scopedLocationIds } from '../../common/location-access';
import type { RequestMeta, RequestUser } from '../../common/request-user';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class StockService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(user: RequestUser, locationId?: string, search?: string) {
    const allowed = scopedLocationIds(user);
    if (locationId) assertLocationAccess(user, locationId);

    const locations = await this.db.client.location.findMany({
      where: {
        isActive: true,
        ...(locationId ? { id: locationId } : {}),
        ...(allowed ? { id: locationId ? locationId : { in: allowed } } : {}),
      },
      orderBy: { name: 'asc' },
    });
    const query = search?.trim();
    const variants = await this.db.client.productVariant.findMany({
      where: {
        isActive: true,
        product: { isActive: true },
        ...(query
          ? {
              OR: [
                { sku: { contains: query, mode: 'insensitive' } },
                { barcode: { contains: query, mode: 'insensitive' } },
                { product: { name: { contains: query, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        product: { include: { unit: true } },
        stockLevels: true,
      },
      orderBy: { sku: 'asc' },
      take: 200,
    });

    const items = variants.flatMap((variant) =>
      locations.map((location) => {
        const level = variant.stockLevels.find((row) => row.locationId === location.id);
        const onHand = level?.qtyOnHand ?? new Prisma.Decimal(0);
        const value = onHand.mul(variant.costPrice);
        return {
          variantId: variant.id,
          sku: variant.sku,
          barcode: variant.barcode,
          attributes: asAttributes(variant.attributes),
          productId: variant.productId,
          productName: variant.product.name,
          unitCode: variant.product.unit.code,
          trackingType: variant.product.trackingType,
          locationId: location.id,
          locationName: location.name,
          qtyOnHand: qty(onHand),
          minStock: qty(variant.minStock),
          costPrice: money(variant.costPrice),
          stockValue: money(value),
          low: variant.minStock.greaterThan(0) && onHand.lessThanOrEqualTo(variant.minStock),
        };
      }),
    );
    return { items };
  }

  async movements(user: RequestUser) {
    const allowed = scopedLocationIds(user);
    const rows = await this.db.client.stockMovement.findMany({
      where: allowed ? { locationId: { in: allowed } } : undefined,
      include: {
        location: { select: { id: true, name: true } },
        variant: { include: { product: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        qty: qty(row.qty),
        unitCost: money(row.unitCost),
        movementType: row.movementType,
        reason: row.reason,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
        location: row.location,
        sku: row.variant.sku,
        productName: row.variant.product.name,
      })),
    };
  }

  async adjust(user: RequestUser, input: StockAdjustmentInput, meta: RequestMeta) {
    assertLocationAccess(user, input.locationId);
    const location = await this.db.client.location.findUnique({ where: { id: input.locationId } });
    if (!location || !location.isActive) throw new NotFoundException('Location not found');
    const variant = await this.db.client.productVariant.findUnique({ where: { id: input.variantId } });
    if (!variant || !variant.isActive) throw new NotFoundException('Variant not found');

    let rows: Array<{ qty_on_hand: Prisma.Decimal | string }>;
    try {
      rows = await this.db.client.$queryRaw<Array<{ qty_on_hand: Prisma.Decimal | string }>>`
        INSERT INTO stock_levels (
          tenant_id, location_id, variant_id, qty_on_hand, qty_reserved, updated_at
        )
        VALUES (
          CAST(${user.tenantId} AS uuid),
          CAST(${input.locationId} AS uuid),
          CAST(${input.variantId} AS uuid),
          CAST(${input.qtyDelta} AS numeric),
          0,
          NOW()
        )
        ON CONFLICT (tenant_id, location_id, variant_id)
        DO UPDATE SET
          qty_on_hand = stock_levels.qty_on_hand + CAST(${input.qtyDelta} AS numeric),
          updated_at = NOW()
        WHERE stock_levels.qty_on_hand + CAST(${input.qtyDelta} AS numeric) >= 0
        RETURNING qty_on_hand
      `;
    } catch (error) {
      if (error instanceof Error && error.message.includes('stock_levels_qty_nonnegative')) {
        throw new BadRequestException('Stock cannot go below zero');
      }
      throw error;
    }
    const updated = rows[0];
    if (!updated) throw new BadRequestException('Stock cannot go below zero');

    const after = new Prisma.Decimal(updated.qty_on_hand);
    const before = after.minus(input.qtyDelta);
    const movement = await this.db.client.stockMovement.create({
      data: {
        tenantId: user.tenantId,
        locationId: input.locationId,
        variantId: input.variantId,
        qty: input.qtyDelta,
        unitCost: variant.costPrice,
        movementType: input.reason === 'opening' ? 'opening' : 'adjustment',
        reason: input.reason,
        note: input.note,
        createdById: user.user.id,
      },
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.user.id,
      action: 'stock.adjust',
      entity: 'stock_movement',
      entityId: movement.id,
      before: { qtyOnHand: qty(before) },
      after: { qtyOnHand: qty(after), qtyDelta: input.qtyDelta, reason: input.reason },
      meta,
    });
    return {
      movementId: movement.id,
      qtyOnHand: qty(after),
    };
  }
}
