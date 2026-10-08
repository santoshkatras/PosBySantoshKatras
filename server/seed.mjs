import { randomUUID } from 'node:crypto';
import { hashPassword } from './auth.mjs';
import { openDb } from './db.mjs';
import { provisionTenant } from './provision.mjs';

const PASSWORD = 'Demo@12345';

function addUser(db, tenantId, roleCode, name, email, locationId) {
  const role = db.prepare('SELECT id FROM roles WHERE tenant_id = ? AND code = ?').get(tenantId, roleCode);
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, tenant_id, role_id, name, email, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, tenantId, role.id, name, email, hashPassword(PASSWORD),
  );
  if (locationId) db.prepare('INSERT INTO user_locations (user_id, location_id) VALUES (?, ?)').run(id, locationId);
  return id;
}

function addProduct(db, tenantId, input) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO products (id, tenant_id, name, brand_id, category_id, unit_id, hsn_sac, gst_rate, tracking_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, input.name, input.brandId, input.categoryId, input.unitId, input.hsn, input.gst, input.tracking || 'none');
  const variants = [];
  for (const variant of input.variants) {
    const variantId = randomUUID();
    db.prepare(`
      INSERT INTO variants (id, tenant_id, product_id, sku, barcode, mrp, sale_price, cost_price, min_stock)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(variantId, tenantId, id, variant.sku, variant.barcode || null, variant.mrp, variant.sale, variant.cost, variant.min);
    variants.push({ id: variantId, ...variant });
  }
  return variants;
}

function openStock(db, tenantId, locationId, variantId, amount) {
  db.prepare('INSERT INTO stock_levels (id, tenant_id, location_id, variant_id, qty_on_hand) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(), tenantId, locationId, variantId, Number(amount).toFixed(3),
  );
  db.prepare(`
    INSERT INTO stock_movements (id, tenant_id, location_id, variant_id, qty, movement_type, reason, note, created_at)
    VALUES (?, ?, ?, ?, ?, 'opening', 'opening', 'Opening stock', ?)
  `).run(randomUUID(), tenantId, locationId, variantId, Number(amount).toFixed(3), new Date().toISOString());
}

export function seedDemos(db) {
  if (!db.prepare('SELECT id FROM users WHERE email = ?').get('owner@bytebazaar.demo')) {
    const shop = provisionTenant(db, {
      ownerName: 'Asha Menon',
      email: 'owner@bytebazaar.demo',
      password: PASSWORD,
      businessName: 'ByteBazaar Computers',
      legalName: 'ByteBazaar Computers',
      businessType: 'computer_shop',
      gstin: '27AAPFU0939F1ZV',
      stateCode: '27',
      locationName: 'Andheri Showroom',
    });
    const warehouse = randomUUID();
    db.prepare('INSERT INTO locations (id, tenant_id, name, kind) VALUES (?, ?, ?, ?)').run(warehouse, shop.tenantId, 'Bhiwandi Warehouse', 'warehouse');
    addUser(db, shop.tenantId, 'manager', 'Rahul Deshmukh', 'manager@bytebazaar.demo');
    addUser(db, shop.tenantId, 'sales', 'Neha Kulkarni', 'sales@bytebazaar.demo', shop.locationId);
    const brand = (name) => {
      const id = randomUUID();
      db.prepare('INSERT INTO brands (id, tenant_id, name) VALUES (?, ?, ?)').run(id, shop.tenantId, name);
      return id;
    };
    const lenovo = brand('Lenovo');
    const logitech = brand('Logitech');
    const laptops = db.prepare('SELECT id FROM categories WHERE tenant_id = ? AND name = ?').get(shop.tenantId, 'Laptops').id;
    const accessories = db.prepare('SELECT id FROM categories WHERE tenant_id = ? AND name = ?').get(shop.tenantId, 'Accessories').id;
    const pcs = shop.unitIds.pcs;
    const legion = addProduct(db, shop.tenantId, {
      name: 'Lenovo Legion 5', brandId: lenovo, categoryId: laptops, unitId: pcs, hsn: '84713010', gst: '18', tracking: 'serial',
      variants: [
        { sku: 'LEGION5-16-512', mrp: '98000.00', sale: '92000.00', cost: '80000.00', min: '1' },
        { sku: 'LEGION5-32-1TB', mrp: '124000.00', sale: '118000.00', cost: '101000.00', min: '1' },
      ],
    });
    const mouse = addProduct(db, shop.tenantId, {
      name: 'Logitech M185 mouse', brandId: logitech, categoryId: accessories, unitId: pcs, hsn: '84716060', gst: '18',
      variants: [{ sku: 'M185-BLK', mrp: '995.00', sale: '799.00', cost: '450.00', min: '5' }],
    });
    const cable = addProduct(db, shop.tenantId, {
      name: 'USB-C cable 1m', brandId: null, categoryId: accessories, unitId: pcs, hsn: '85444299', gst: '18',
      variants: [{ sku: 'USBC-1M', mrp: '499.00', sale: '299.00', cost: '80.00', min: '20' }],
    });
    openStock(db, shop.tenantId, shop.locationId, legion[0].id, 2);
    openStock(db, shop.tenantId, warehouse, legion[0].id, 4);
    openStock(db, shop.tenantId, shop.locationId, mouse[0].id, 18);
    openStock(db, shop.tenantId, warehouse, mouse[0].id, 50);
    openStock(db, shop.tenantId, shop.locationId, cable[0].id, 8);
    openStock(db, shop.tenantId, warehouse, cable[0].id, 100);
  }

  if (!db.prepare('SELECT id FROM users WHERE email = ?').get('owner@spoke.demo')) {
    const shop = provisionTenant(db, {
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
    const parts = randomUUID();
    db.prepare('INSERT INTO locations (id, tenant_id, name, kind) VALUES (?, ?, ?, ?)').run(parts, shop.tenantId, 'Parts Store', 'store');
    addUser(db, shop.tenantId, 'service_advisor', 'Kavya Reddy', 'advisor@spoke.demo');
    addUser(db, shop.tenantId, 'mechanic', 'Imran Pasha', 'mechanic@spoke.demo', shop.locationId);
    const brand = (name) => {
      const id = randomUUID();
      db.prepare('INSERT INTO brands (id, tenant_id, name) VALUES (?, ?, ?)').run(id, shop.tenantId, name);
      return id;
    };
    const motul = brand('Motul');
    const bosch = brand('Bosch');
    const lubricants = db.prepare('SELECT id FROM categories WHERE tenant_id = ? AND name = ?').get(shop.tenantId, 'Lubricants').id;
    const spares = db.prepare('SELECT id FROM categories WHERE tenant_id = ? AND name = ?').get(shop.tenantId, 'Spare parts').id;
    const oil = addProduct(db, shop.tenantId, {
      name: '10W-30 engine oil', brandId: motul, categoryId: lubricants, unitId: shop.unitIds.ltr, hsn: '27101980', gst: '18',
      variants: [{ sku: 'MOTUL-7100-1L', mrp: '820.00', sale: '750.00', cost: '610.00', min: '6' }],
    });
    const pads = addProduct(db, shop.tenantId, {
      name: 'Front brake pads', brandId: bosch, categoryId: spares, unitId: shop.unitIds.pcs, hsn: '87141090', gst: '28',
      variants: [{ sku: 'BOSCH-BP-ACTIVA', mrp: '540.00', sale: '480.00', cost: '290.00', min: '4' }],
    });
    const filter = addProduct(db, shop.tenantId, {
      name: 'Air filter', brandId: null, categoryId: spares, unitId: shop.unitIds.pcs, hsn: '84213100', gst: '18',
      variants: [{ sku: 'FILTER-AIR', mrp: '320.00', sale: '280.00', cost: '140.00', min: '6' }],
    });
    openStock(db, shop.tenantId, parts, oil[0].id, 24);
    openStock(db, shop.tenantId, parts, pads[0].id, 12);
    openStock(db, shop.tenantId, parts, filter[0].id, 3);
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.mjs')) {
  const db = openDb();
  seedDemos(db);
  console.log('Seed complete. Computer shop: owner@bytebazaar.demo / Demo@12345. Bike service: owner@spoke.demo / Demo@12345.');
}
