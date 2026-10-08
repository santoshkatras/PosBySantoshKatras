import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { provisionTenant } from '../src/modules/tenancy/provision';
import { seedPlans } from '../src/modules/tenancy/seed-plans';

const admin = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } },
});

const DEMO_PASSWORD = 'Demo@12345';

async function main() {
  await seedPlans(admin);
  await seedComputerShop();
  await seedBikeCentre();
  console.log('Seed complete.');
  console.log('Computer shop: owner@bytebazaar.demo / Demo@12345');
  console.log('Bike service:  owner@spoke.demo / Demo@12345');
}

async function seedComputerShop() {
  if (await admin.user.findUnique({ where: { email: 'owner@bytebazaar.demo' } })) {
    console.log('ByteBazaar already seeded');
    return;
  }
  const { tenant, user } = await provisionTenant(admin, {
    businessName: 'ByteBazaar Computers',
    businessType: 'computer_shop',
    stateCode: '27',
    gstin: '27AAPFU0939F1ZV',
    locationName: 'Andheri Showroom',
    ownerName: 'Asha Menon',
    email: 'owner@bytebazaar.demo',
    password: DEMO_PASSWORD,
  });

  await admin.location.update({
    where: { id: (await mustLocation(tenant.id, 'Andheri Showroom')).id },
    data: {
      addressLine: '14, SV Road',
      city: 'Mumbai',
      pincode: '400069',
      gstin: '27AAPFU0939F1ZV',
    },
  });

  const warehouse = await admin.location.create({
    data: {
      tenantId: tenant.id,
      name: 'Bhiwandi Warehouse',
      type: 'warehouse',
      addressLine: 'Godown 4, Kalher',
      city: 'Bhiwandi',
      stateCode: '27',
      pincode: '421302',
    },
  });
  const showroom = await mustLocation(tenant.id, 'Andheri Showroom');

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const managerRole = await mustRole(tenant.id, 'manager');
  const salesRole = await mustRole(tenant.id, 'sales');
  await admin.user.create({
    data: {
      tenantId: tenant.id,
      roleId: managerRole.id,
      name: 'Rahul Deshmukh',
      email: 'manager@bytebazaar.demo',
      passwordHash,
      status: 'active',
    },
  });
  await admin.user.create({
    data: {
      tenantId: tenant.id,
      roleId: salesRole.id,
      name: 'Neha Kulkarni',
      email: 'sales@bytebazaar.demo',
      passwordHash,
      status: 'active',
      locations: { create: [{ tenantId: tenant.id, locationId: showroom.id }] },
    },
  });

  const pcs = await mustUnit(tenant.id, 'pcs');
  const gaming = await mustCategory(tenant.id, 'Gaming');
  const accessories = await mustCategory(tenant.id, 'Accessories');
  const lenovo = await admin.brand.create({ data: { tenantId: tenant.id, name: 'Lenovo' } });
  const logitech = await admin.brand.create({ data: { tenantId: tenant.id, name: 'Logitech' } });

  const legion = await admin.product.create({
    data: {
      tenantId: tenant.id,
      name: 'Lenovo Legion 5',
      categoryId: gaming.id,
      brandId: lenovo.id,
      unitId: pcs.id,
      hsnSac: '84713010',
      gstRate: '18',
      trackingType: 'serial',
      variants: {
        create: [
          variant(tenant.id, {
            sku: 'LEGION5-16-512',
            attributes: { RAM: '16 GB', Storage: '512 GB SSD' },
            mrp: '145000',
            salePrice: '139999',
            costPrice: '120000',
            minStock: '1',
          }),
          variant(tenant.id, {
            sku: 'LEGION5-32-1TB',
            attributes: { RAM: '32 GB', Storage: '1 TB SSD' },
            mrp: '175000',
            salePrice: '168999',
            costPrice: '145000',
            minStock: '1',
          }),
        ],
      },
    },
    include: { variants: true },
  });

  const mouse = await admin.product.create({
    data: {
      tenantId: tenant.id,
      name: 'Logitech M185 mouse',
      categoryId: accessories.id,
      brandId: logitech.id,
      unitId: pcs.id,
      hsnSac: '84716060',
      gstRate: '18',
      trackingType: 'none',
      variants: {
        create: variant(tenant.id, {
          sku: 'M185-BLK',
          barcode: '5099206042078',
          attributes: { Colour: 'Black' },
          mrp: '995',
          salePrice: '799',
          costPrice: '450',
          minStock: '10',
        }),
      },
    },
    include: { variants: true },
  });

  const cable = await admin.product.create({
    data: {
      tenantId: tenant.id,
      name: 'USB-C cable 1m',
      categoryId: accessories.id,
      unitId: pcs.id,
      hsnSac: '85444299',
      gstRate: '18',
      trackingType: 'none',
      variants: {
        create: variant(tenant.id, {
          sku: 'USBC-1M',
          barcode: '8901234000018',
          mrp: '499',
          salePrice: '349',
          costPrice: '120',
          minStock: '20',
        }),
      },
    },
    include: { variants: true },
  });

  const bySku = new Map(
    [...legion.variants, ...mouse.variants, ...cable.variants].map((item) => [item.sku, item]),
  );
  await openStock(tenant.id, showroom.id, user.id, bySku.get('LEGION5-16-512')!.id, '2', '120000');
  await openStock(tenant.id, showroom.id, user.id, bySku.get('LEGION5-32-1TB')!.id, '1', '145000');
  await openStock(tenant.id, showroom.id, user.id, bySku.get('M185-BLK')!.id, '15', '450');
  await openStock(tenant.id, showroom.id, user.id, bySku.get('USBC-1M')!.id, '8', '120');
  await openStock(tenant.id, warehouse.id, user.id, bySku.get('M185-BLK')!.id, '50', '450');
  await openStock(tenant.id, warehouse.id, user.id, bySku.get('USBC-1M')!.id, '100', '120');
}

async function seedBikeCentre() {
  if (await admin.user.findUnique({ where: { email: 'owner@spoke.demo' } })) {
    console.log('Spoke & Sprocket already seeded');
    return;
  }
  const { tenant, user } = await provisionTenant(admin, {
    businessName: 'Spoke & Sprocket',
    businessType: 'bike_service',
    stateCode: '29',
    gstin: '29AAGCR4375J1Z5',
    locationName: 'Indiranagar Workshop',
    ownerName: 'Ravi Shetty',
    email: 'owner@spoke.demo',
    password: DEMO_PASSWORD,
  });

  const workshop = await mustLocation(tenant.id, 'Indiranagar Workshop');
  await admin.location.update({
    where: { id: workshop.id },
    data: { addressLine: '88, 12th Main', city: 'Bengaluru', pincode: '560038' },
  });
  const parts = await admin.location.create({
    data: {
      tenantId: tenant.id,
      name: 'Parts Store',
      type: 'warehouse',
      city: 'Bengaluru',
      stateCode: '29',
    },
  });

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const advisorRole = await mustRole(tenant.id, 'service_advisor');
  const mechanicRole = await mustRole(tenant.id, 'mechanic');
  await admin.user.create({
    data: {
      tenantId: tenant.id,
      roleId: advisorRole.id,
      name: 'Kavya Reddy',
      email: 'advisor@spoke.demo',
      passwordHash,
      status: 'active',
    },
  });
  await admin.user.create({
    data: {
      tenantId: tenant.id,
      roleId: mechanicRole.id,
      name: 'Imran Pasha',
      email: 'mechanic@spoke.demo',
      passwordHash,
      status: 'active',
      locations: { create: [{ tenantId: tenant.id, locationId: workshop.id }] },
    },
  });

  const ltr = await mustUnit(tenant.id, 'ltr');
  const pcs = await mustUnit(tenant.id, 'pcs');
  const lubricants = await mustCategory(tenant.id, 'Lubricants');
  const spares = await mustCategory(tenant.id, 'Spare parts');
  const motul = await admin.brand.create({ data: { tenantId: tenant.id, name: 'Motul' } });
  const bosch = await admin.brand.create({ data: { tenantId: tenant.id, name: 'Bosch' } });

  const oil = await admin.product.create({
    data: {
      tenantId: tenant.id,
      name: '10W-30 engine oil',
      categoryId: lubricants.id,
      brandId: motul.id,
      unitId: ltr.id,
      hsnSac: '27101980',
      gstRate: '18',
      trackingType: 'none',
      variants: {
        create: variant(tenant.id, {
          sku: 'MOTUL-7100-1L',
          attributes: { Grade: '10W-30', Pack: '1 litre' },
          mrp: '850',
          salePrice: '799',
          costPrice: '620',
          minStock: '8',
        }),
      },
    },
    include: { variants: true },
  });
  const pads = await admin.product.create({
    data: {
      tenantId: tenant.id,
      name: 'Front brake pads',
      categoryId: spares.id,
      brandId: bosch.id,
      unitId: pcs.id,
      hsnSac: '87141090',
      gstRate: '28',
      trackingType: 'none',
      variants: {
        create: variant(tenant.id, {
          sku: 'BOSCH-BP-ACTIVA',
          attributes: { Model: 'Activa' },
          mrp: '450',
          salePrice: '399',
          costPrice: '240',
          minStock: '4',
        }),
      },
    },
    include: { variants: true },
  });
  const filter = await admin.product.create({
    data: {
      tenantId: tenant.id,
      name: 'Air filter',
      categoryId: spares.id,
      unitId: pcs.id,
      hsnSac: '84213100',
      gstRate: '18',
      trackingType: 'none',
      variants: {
        create: variant(tenant.id, {
          sku: 'FILTER-AIR',
          mrp: '250',
          salePrice: '199',
          costPrice: '90',
          minStock: '6',
        }),
      },
    },
    include: { variants: true },
  });

  await openStock(tenant.id, parts.id, user.id, oil.variants[0]!.id, '24.000', '620');
  await openStock(tenant.id, parts.id, user.id, pads.variants[0]!.id, '12', '240');
  await openStock(tenant.id, parts.id, user.id, filter.variants[0]!.id, '3', '90');
}

function variant(
  tenantId: string,
  input: {
    sku: string;
    barcode?: string;
    attributes?: Record<string, string>;
    mrp: string;
    salePrice: string;
    costPrice: string;
    minStock: string;
  },
) {
  return {
    tenantId,
    sku: input.sku,
    barcode: input.barcode,
    attributes: input.attributes ?? {},
    mrp: input.mrp,
    salePrice: input.salePrice,
    costPrice: input.costPrice,
    minStock: input.minStock,
  };
}

async function openStock(
  tenantId: string,
  locationId: string,
  userId: string,
  variantId: string,
  quantity: string,
  unitCost: string,
) {
  await admin.stockLevel.create({
    data: {
      tenantId,
      locationId,
      variantId,
      qtyOnHand: quantity,
      qtyReserved: 0,
    },
  });
  await admin.stockMovement.create({
    data: {
      tenantId,
      locationId,
      variantId,
      qty: quantity,
      unitCost,
      movementType: 'opening',
      reason: 'opening',
      note: 'Opening stock',
      createdById: userId,
    },
  });
}

async function mustLocation(tenantId: string, name: string) {
  const location = await admin.location.findFirst({ where: { tenantId, name } });
  if (!location) throw new Error(`Missing location ${name}`);
  return location;
}

async function mustRole(tenantId: string, code: string) {
  const role = await admin.role.findUnique({ where: { tenantId_code: { tenantId, code } } });
  if (!role) throw new Error(`Missing role ${code}`);
  return role;
}

async function mustUnit(tenantId: string, code: string) {
  const unit = await admin.unit.findUnique({ where: { tenantId_code: { tenantId, code } } });
  if (!unit) throw new Error(`Missing unit ${code}`);
  return unit;
}

async function mustCategory(tenantId: string, name: string) {
  const category = await admin.category.findUnique({ where: { tenantId_name: { tenantId, name } } });
  if (!category) throw new Error(`Missing category ${name}`);
  return category;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.$disconnect();
  });
