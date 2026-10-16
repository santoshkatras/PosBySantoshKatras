import { hashPassword } from './auth.mjs';
import { openStore } from './store.mjs';
import { provisionTenant } from './provision.mjs';

const PASSWORD = 'Demo@12345';

async function addUser(store, companyId, roleCode, name, email, locationId) {
  const [role] = await store.find('roles', { company_id: companyId, code: roleCode });
  const user = await store.insert('users', {
    company_id: companyId,
    role_id: role.id,
    name,
    email,
    password_hash: hashPassword(PASSWORD),
    status: 'active',
    created_at: new Date().toISOString(),
  });
  if (locationId) await store.insert('user_locations', { company_id: companyId, user_id: user.id, location_id: locationId });
  return user.id;
}

async function addProduct(store, companyId, input) {
  const product = await store.insert('products', {
    company_id: companyId,
    name: input.name,
    brand_id: input.brandId || '',
    category_id: input.categoryId || '',
    unit_id: input.unitId,
    hsn_sac: input.hsn || '',
    gst_rate: input.gst || '18',
    tracking_type: input.tracking || 'none',
    is_service: 0,
    is_active: 1,
  });
  const variants = [];
  for (const variant of input.variants) {
    const saved = await store.insert('variants', {
      company_id: companyId,
      product_id: product.id,
      sku: variant.sku,
      barcode: variant.barcode || '',
      mrp: variant.mrp || '',
      sale_price: variant.sale || '',
      cost_price: variant.cost || '',
      min_stock: variant.min || '0',
      is_active: 1,
    });
    variants.push({ id: saved.id, ...variant });
  }
  return variants;
}

async function openStock(store, companyId, locationId, variantId, amount) {
  const qty = Number(amount).toFixed(3);
  await store.insert('stock_levels', {
    company_id: companyId,
    location_id: locationId,
    variant_id: variantId,
    qty_on_hand: qty,
  });
  await store.insert('stock_movements', {
    company_id: companyId,
    location_id: locationId,
    variant_id: variantId,
    qty,
    movement_type: 'opening',
    reason: 'opening',
    note: 'Opening stock',
    created_at: new Date().toISOString(),
  });
}

async function categoryId(store, companyId, name) {
  const rows = await store.find('categories', { company_id: companyId, name });
  return rows[0].id;
}

export async function seedDemos(store) {
  const users = await store.find('users', {});
  if (!users.some((row) => row.email === 'owner@bytebazaar.demo')) {
    const shop = await provisionTenant(store, {
      ownerName: 'Asha Menon',
      email: 'owner@bytebazaar.demo',
      password: PASSWORD,
      businessName: 'SK Company Multi Business',
      legalName: 'SK Company Multi Business',
      businessType: 'computer_shop',
      gstin: '27AAPFU0939F1ZV',
      stateCode: '27',
      locationName: 'Andheri Showroom',
    });
    const warehouse = await store.insert('locations', {
      company_id: shop.companyId,
      name: 'Bhiwandi Warehouse',
      kind: 'warehouse',
      is_active: 1,
    });
    await addUser(store, shop.companyId, 'manager', 'Rahul Deshmukh', 'manager@bytebazaar.demo');
    await addUser(store, shop.companyId, 'sales', 'Neha Kulkarni', 'sales@bytebazaar.demo', shop.locationId);
    const brand = async (name) => (await store.insert('brands', { company_id: shop.companyId, name })).id;
    const lenovo = await brand('Lenovo');
    const logitech = await brand('Logitech');
    const laptops = await categoryId(store, shop.companyId, 'Laptops');
    const accessories = await categoryId(store, shop.companyId, 'Accessories');
    const legion = await addProduct(store, shop.companyId, {
      name: 'Lenovo Legion 5', brandId: lenovo, categoryId: laptops, unitId: shop.unitIds.pcs, hsn: '84713010', gst: '18', tracking: 'serial',
      variants: [
        { sku: 'LEGION5-16-512', mrp: '98000.00', sale: '92000.00', cost: '80000.00', min: '1' },
        { sku: 'LEGION5-32-1TB', mrp: '124000.00', sale: '118000.00', cost: '101000.00', min: '1' },
      ],
    });
    const mouse = await addProduct(store, shop.companyId, {
      name: 'Logitech M185 mouse', brandId: logitech, categoryId: accessories, unitId: shop.unitIds.pcs, hsn: '84716060', gst: '18',
      variants: [{ sku: 'M185-BLK', mrp: '995.00', sale: '799.00', cost: '450.00', min: '5' }],
    });
    const cable = await addProduct(store, shop.companyId, {
      name: 'USB-C cable 1m', brandId: '', categoryId: accessories, unitId: shop.unitIds.pcs, hsn: '85444299', gst: '18',
      variants: [{ sku: 'USBC-1M', mrp: '499.00', sale: '299.00', cost: '80.00', min: '20' }],
    });
    await openStock(store, shop.companyId, shop.locationId, legion[0].id, 2);
    await openStock(store, shop.companyId, warehouse.id, legion[0].id, 4);
    await openStock(store, shop.companyId, shop.locationId, mouse[0].id, 18);
    await openStock(store, shop.companyId, warehouse.id, mouse[0].id, 50);
    await openStock(store, shop.companyId, shop.locationId, cable[0].id, 8);
    await openStock(store, shop.companyId, warehouse.id, cable[0].id, 100);
  }

  const again = await store.find('users', {});
  if (!again.some((row) => row.email === 'owner@spoke.demo')) {
    const shop = await provisionTenant(store, {
      ownerName: 'Ravi Shetty',
      email: 'owner@spoke.demo',
      password: PASSWORD,
      businessName: 'Spoke & Sprocket',
      legalName: 'Spoke & Sprocket',
      businessType: 'bike_service',
      gstin: '29AAGCR4375J1Z5',
      stateCode: '29',
      locationName: 'Indiranagar Workshop',
    });
    const parts = await store.insert('locations', {
      company_id: shop.companyId,
      name: 'Parts Store',
      kind: 'store',
      is_active: 1,
    });
    await addUser(store, shop.companyId, 'service_advisor', 'Kavya Reddy', 'advisor@spoke.demo');
    await addUser(store, shop.companyId, 'mechanic', 'Imran Pasha', 'mechanic@spoke.demo', shop.locationId);
    const brand = async (name) => (await store.insert('brands', { company_id: shop.companyId, name })).id;
    const motul = await brand('Motul');
    const bosch = await brand('Bosch');
    const lubricants = await categoryId(store, shop.companyId, 'Lubricants');
    const spares = await categoryId(store, shop.companyId, 'Spare parts');
    const oil = await addProduct(store, shop.companyId, {
      name: '10W-30 engine oil', brandId: motul, categoryId: lubricants, unitId: shop.unitIds.ltr, hsn: '27101980', gst: '18',
      variants: [{ sku: 'MOTUL-7100-1L', mrp: '820.00', sale: '750.00', cost: '610.00', min: '6' }],
    });
    const pads = await addProduct(store, shop.companyId, {
      name: 'Front brake pads', brandId: bosch, categoryId: spares, unitId: shop.unitIds.pcs, hsn: '87141090', gst: '28',
      variants: [{ sku: 'BOSCH-BP-ACTIVA', mrp: '540.00', sale: '480.00', cost: '290.00', min: '4' }],
    });
    const filter = await addProduct(store, shop.companyId, {
      name: 'Air filter', brandId: '', categoryId: spares, unitId: shop.unitIds.pcs, hsn: '84213100', gst: '18',
      variants: [{ sku: 'FILTER-AIR', mrp: '320.00', sale: '280.00', cost: '140.00', min: '6' }],
    });
    await openStock(store, shop.companyId, parts.id, oil[0].id, 24);
    await openStock(store, shop.companyId, parts.id, pads[0].id, 12);
    await openStock(store, shop.companyId, parts.id, filter[0].id, 3);
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.mjs')) {
  const store = await openStore();
  await seedDemos(store);
  console.log('Seed complete. Computer shop: owner@bytebazaar.demo / Demo@12345. Bike service: owner@spoke.demo / Demo@12345.');
}
