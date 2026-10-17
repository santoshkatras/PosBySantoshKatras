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
      licenseMode: 'active', // demo businesses stay on Professional (no trial)
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
      licenseMode: 'active', // demo businesses stay on Professional (no trial)
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

  // Liquor / Wine Shop & Bar demo: FL-II wine shop + FL-III permit room, excise items, licences and dry days
  const third = await store.find('users', {});
  if (!third.some((row) => row.email === 'owner@wines.demo')) {
    const shop = await provisionTenant(store, {
      licenseMode: 'active',
      ownerName: 'Santosh Patil',
      email: 'owner@wines.demo',
      mobile: '9822000000',
      password: PASSWORD,
      businessName: 'Vambori Wines',
      legalName: 'Vambori Wines',
      businessType: 'computer_shop',
      companyType: 'liquor_shop',
      gstin: '',
      stateCode: '27',
      locationName: 'Vambori Wine Shop',
    });
    const bar = await store.insert('locations', { company_id: shop.companyId, name: 'Sagar Permit Room (Bar)', kind: 'store', is_active: 1 });
    await addUser(store, shop.companyId, 'sales', 'Ganesh Shinde', 'counter@wines.demo', shop.locationId);
    const units = await store.find('units', { company_id: shop.companyId });
    const bottle = (units.find((u) => u.code === 'btl') || units[0]).id;
    const brandIds = new Map();
    const brandOf = async (name) => { if (!brandIds.has(name)) brandIds.set(name, (await store.insert('brands', { company_id: shop.companyId, name })).id); return brandIds.get(name); };
    // [name, brand, category (Item Type), liquor category, hsn, size ml, MRP, case pack, strength, shop stock, bar stock, peg 30 ml rate]
    const LIST = [
      ['Royal Stag Whisky', 'Royal Stag', 'Whisky', 'whisky', '22083011', 180, 260, 48, 42.8, 96, 0, 0],
      ['Royal Stag Whisky', 'Royal Stag', 'Whisky', 'whisky', '22083011', 375, 520, 24, 42.8, 48, 0, 0],
      ['Royal Stag Whisky', 'Royal Stag', 'Whisky', 'whisky', '22083011', 750, 1040, 12, 42.8, 36, 6, 70],
      ['Imperial Blue Whisky', 'Imperial Blue', 'Whisky', 'whisky', '22083011', 180, 230, 48, 42.8, 72, 0, 0],
      ['Imperial Blue Whisky', 'Imperial Blue', 'Whisky', 'whisky', '22083011', 750, 920, 12, 42.8, 24, 6, 60],
      ['Blenders Pride Whisky', 'Blenders Pride', 'Whisky', 'whisky', '22083011', 750, 1500, 12, 42.8, 18, 4, 110],
      ['Old Monk Rum', 'Old Monk', 'Rum', 'rum', '22084011', 180, 200, 48, 42.8, 48, 0, 0],
      ['Old Monk Rum', 'Old Monk', 'Rum', 'rum', '22084011', 750, 780, 12, 42.8, 24, 4, 55],
      ['Magic Moments Vodka', 'Magic Moments', 'Vodka', 'vodka', '22086000', 750, 980, 12, 37.5, 12, 3, 70],
      ['Mansion House Brandy', 'Mansion House', 'Brandy', 'brandy', '22082011', 180, 230, 48, 42.8, 48, 0, 0],
      ['Kingfisher Strong Beer', 'Kingfisher', 'Beer', 'beer_strong', '22030000', 650, 190, 12, 8, 120, 24, 0],
      ['Kingfisher Premium Beer', 'Kingfisher', 'Beer', 'beer_mild', '22030000', 650, 180, 12, 4.8, 60, 12, 0],
      ['Budweiser Beer Can', 'Budweiser', 'Beer', 'beer_mild', '22030000', 500, 200, 24, 5, 48, 0, 0],
      ['Sula Shiraz Cabernet Red Wine', 'Sula', 'Wine', 'wine', '22042190', 750, 850, 12, 13, 12, 2, 0],
    ];
    for (const [i, [name, brand, cat, lcat, hsn, size, mrp, pack, strength, shopQty, barQty, peg]] of LIST.entries()) {
      const [variant] = await addProduct(store, shop.companyId, {
        name: `${name} ${size} ML`, brandId: await brandOf(brand), categoryId: await categoryId(store, shop.companyId, cat), unitId: bottle, hsn, gst: '0',
        variants: [{ sku: `LQ${String(i + 1).padStart(3, '0')}`, mrp: `${mrp}.00`, sale: `${mrp}.00`, cost: (Math.round(mrp * 0.82)).toFixed(2), min: String(Math.max(Math.round(pack / 2), 3)) }],
      });
      await store.insert('liquor_items', { company_id: shop.companyId, variant_id: variant.id, category: lcat, size_ml: String(size), case_qty: String(pack), strength: String(strength), excise_code: '', peg_rates: JSON.stringify(peg ? { 30: peg, 60: peg * 2 - 10, 90: peg * 3 - 20 } : {}), active: '1', updated_at: new Date().toISOString() });
      await openStock(store, shop.companyId, shop.locationId, variant.id, shopQty);
      if (barQty) await openStock(store, shop.companyId, bar.id, variant.id, barQty);
    }
    const year = new Date().getFullYear();
    await store.insert('settings', {
      company_id: shop.companyId, setting_key: 'liquor_config',
      setting_value: JSON.stringify({
        licences: [
          { id: 'lic-fl2', type: 'FL-II', number: 'FL-II/AHM/0421', holder: 'Santosh Patil', locationId: shop.locationId, validFrom: `${year}-04-01`, validTo: `${year + 1}-03-31`, office: 'Superintendent of State Excise, Ahilyanagar', fee: '', notes: '' },
          { id: 'lic-fl3', type: 'FL-III', number: 'FL-III/AHM/1187', holder: 'Santosh Patil', locationId: bar.id, validFrom: `${year}-04-01`, validTo: `${year + 1}-03-31`, office: 'Superintendent of State Excise, Ahilyanagar', fee: '', notes: '' },
        ],
        rules: {},
        dryDays: [[`${year}-01-26`, 'Republic Day'], [`${year}-05-01`, 'Maharashtra Day'], [`${year}-08-15`, 'Independence Day'], [`${year}-10-02`, 'Gandhi Jayanti'], [`${year + 1}-01-26`, 'Republic Day'], [`${year + 1}-05-01`, 'Maharashtra Day']].map(([date, reason]) => ({ date, reason, locationIds: [] })),
      }),
    });
  }

  // Goa liquor demo: packed-bottle shop + bar, Goa VAT (22% / 5%), suppliers in Goa and Maharashtra (CST against Form C)
  const fourth = await store.find('users', {});
  if (!fourth.some((row) => row.email === 'owner@goawines.demo')) {
    const shop = await provisionTenant(store, {
      licenseMode: 'active', ownerName: 'Anthony Fernandes', email: 'owner@goawines.demo', mobile: '9822100000', password: PASSWORD,
      businessName: 'Panaji Wine Store', legalName: 'Panaji Wine Store', businessType: 'computer_shop', companyType: 'liquor_shop', gstin: '', stateCode: '30', locationName: 'Panaji Wine Store',
    });
    const bar = await store.insert('locations', { company_id: shop.companyId, name: 'Calangute Bar & Restaurant', kind: 'store', is_active: 1 });
    const units = await store.find('units', { company_id: shop.companyId });
    const bottle = (units.find((u) => u.code === 'btl') || units[0]).id;
    const brandIds = new Map();
    const brandOf = async (name) => { if (!brandIds.has(name)) brandIds.set(name, (await store.insert('brands', { company_id: shop.companyId, name })).id); return brandIds.get(name); };
    const LIST = [
      ['Royal Stag Whisky', 'Royal Stag', 'Whisky', 'whisky', '22083011', 750, 650, 12, 42.8, 36, 6, 60],
      ['Old Monk Rum', 'Old Monk', 'Rum', 'rum', '22084011', 750, 450, 12, 42.8, 24, 4, 45],
      ['Magic Moments Vodka', 'Magic Moments', 'Vodka', 'vodka', '22086000', 750, 600, 12, 37.5, 12, 3, 60],
      ['Kingfisher Strong Beer', 'Kingfisher', 'Beer', 'beer_strong', '22030000', 650, 130, 12, 8, 120, 24, 0],
      ['Cashew Feni', 'Big Boss', 'Country Liquor', 'country', '22089091', 750, 300, 12, 42.8, 24, 4, 40],
      ['Big Banyan Red Wine', 'Big Banyan', 'Wine', 'wine', '22042190', 750, 900, 12, 13, 12, 2, 0],
    ];
    for (const [i, [name, brand, cat, lcat, hsn, size, mrp, pack, strength, shopQty, barQty, peg]] of LIST.entries()) {
      const [variant] = await addProduct(store, shop.companyId, {
        name: `${name} ${size} ML`, brandId: await brandOf(brand), categoryId: await categoryId(store, shop.companyId, cat), unitId: bottle, hsn, gst: '0',
        variants: [{ sku: `GL${String(i + 1).padStart(3, '0')}`, mrp: `${mrp}.00`, sale: `${mrp}.00`, cost: (Math.round(mrp * 0.7)).toFixed(2), min: String(Math.max(Math.round(pack / 2), 3)) }],
      });
      await store.insert('liquor_items', { company_id: shop.companyId, variant_id: variant.id, category: lcat, size_ml: String(size), case_qty: String(pack), strength: String(strength), excise_code: '', peg_rates: JSON.stringify(peg ? { 30: peg, 60: peg * 2 - 10 } : {}), active: '1', updated_at: new Date().toISOString() });
      await openStock(store, shop.companyId, shop.locationId, variant.id, shopQty);
      if (barQty) await openStock(store, shop.companyId, bar.id, variant.id, barQty);
    }
    const now = new Date().toISOString();
    await store.insert('suppliers', { company_id: shop.companyId, code: 'SUPP-0001', name: 'Goa Liquor Distributors (Margao)', mobile: '9890000001', email: '', gstin: '', address: 'Margao, Salcete', city: 'Margao', state_code: '30', notes: 'Goa wholesaler — input VAT', created_at: now });
    await store.insert('suppliers', { company_id: shop.companyId, code: 'SUPP-0002', name: 'Kolhapur Spirits Pvt Ltd', mobile: '9890000002', email: '', gstin: '', address: 'MIDC Shiroli', city: 'Kolhapur', state_code: '27', notes: 'Maharashtra supplier — CST against Form C', created_at: now });
    const year = new Date().getFullYear();
    await store.insert('settings', {
      company_id: shop.companyId, setting_key: 'liquor_config',
      setting_value: JSON.stringify({
        licences: [
          { id: 'lic-rb', type: 'GOA-RB', number: 'EXC/TIS/RB/2231', holder: 'Anthony Fernandes', locationId: shop.locationId, validFrom: `${year}-04-01`, validTo: `${year + 1}-03-31`, office: 'Excise Inspector, Tiswadi', fee: '', notes: '' },
          { id: 'lic-rc', type: 'GOA-RC', number: 'EXC/BAR/RC/0877', holder: 'Anthony Fernandes', locationId: bar.id, validFrom: `${year}-04-01`, validTo: `${year + 1}-03-31`, office: 'Excise Inspector, Bardez', fee: '', notes: '' },
        ],
        rules: {},
        tax: { tin: '30000000000', cstNo: 'GOA/CST/0000' },
        dryDays: [[`${year}-01-26`, 'Republic Day'], [`${year}-08-15`, 'Independence Day'], [`${year}-10-02`, 'Gandhi Jayanti'], [`${year + 1}-01-26`, 'Republic Day']].map(([date, reason]) => ({ date, reason, locationIds: [] })),
      }),
    });
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.mjs')) {
  const store = await openStore();
  await seedDemos(store);
  console.log('Seed complete. Computer shop: owner@bytebazaar.demo / Demo@12345. Bike service: owner@spoke.demo / Demo@12345. Liquor shop: owner@wines.demo / Demo@12345. Goa liquor: owner@goawines.demo / Demo@12345.');
}
