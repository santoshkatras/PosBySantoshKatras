import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DbService } from '../../common/db.service';
import { scopedLocationIds } from '../../common/location-access';
import type { RequestUser } from '../../common/request-user';

@Injectable()
export class DashboardService {
  constructor(private readonly db: DbService) {}

  async summary(user: RequestUser) {
    const allowed = scopedLocationIds(user);
    const locationWhere = allowed ? { id: { in: allowed } } : {};
    const [locations, products, variants, movements] = await Promise.all([
      this.db.client.location.count({ where: { ...locationWhere, isActive: true } }),
      this.db.client.product.count({ where: { isActive: true } }),
      this.db.client.productVariant.findMany({
        where: { isActive: true, product: { isActive: true } },
        include: { stockLevels: true },
      }),
      this.db.client.stockMovement.findMany({
        where: allowed ? { locationId: { in: allowed } } : undefined,
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          location: { select: { name: true } },
          variant: { include: { product: { select: { name: true } } } },
        },
      }),
    ]);

    const locationIds =
      allowed ??
      (
        await this.db.client.location.findMany({
          where: { isActive: true },
          select: { id: true },
        })
      ).map((location) => location.id);

    let lowStock = 0;
    let stockValue = new Prisma.Decimal(0);
    for (const variant of variants) {
      for (const locationId of locationIds) {
        const level = variant.stockLevels.find((row) => row.locationId === locationId);
        const onHand = level?.qtyOnHand ?? new Prisma.Decimal(0);
        if (variant.minStock.greaterThan(0) && onHand.lessThanOrEqualTo(variant.minStock)) {
          lowStock += 1;
        }
        stockValue = stockValue.plus(onHand.mul(variant.costPrice));
      }
    }

    return {
      locations,
      products,
      skus: variants.length,
      lowStock,
      stockValue: stockValue.toFixed(2),
      recentMovements: movements.map((row) => ({
        id: row.id,
        qty: row.qty.toFixed(3),
        movementType: row.movementType,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
        locationName: row.location.name,
        productName: row.variant.product.name,
        sku: row.variant.sku,
      })),
    };
  }
}
