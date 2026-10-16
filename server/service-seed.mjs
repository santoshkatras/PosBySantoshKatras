// Demo workshop data for Spoke & Sprocket: car and bike customers with
// past visits (history) and live jobs at every stage of the workshop flow.
import { LABOUR_GST, LABOUR_SAC, SERVICE_PACKAGES } from '../shared/service.mjs';
import { hashPassword } from './auth.mjs';
import { recalc } from './service.mjs';

const DAY = 86400000;
const ago = (days, hours = 0) => new Date(Date.now() - days * DAY - hours * 3600000).toISOString();
const ahead = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
const dateOnly = (iso) => iso.slice(0, 10);

async function ensureMechanic(store, companyId, name, email) {
  const [existing] = await store.find('users', { email });
  if (existing) return existing.id;
  const [role] = await store.find('roles', { company_id: companyId, code: 'mechanic' });
  if (!role) return '';
  const user = await store.insert('users', {
    company_id: companyId, role_id: role.id, name, email, password_hash: hashPassword('Demo@12345'), status: 'active', created_at: new Date().toISOString(),
  });
  return user.id;
}

async function ensurePart(store, companyId, unitId, categoryId, input) {
  const variants = await store.find('variants', { company_id: companyId });
  const hit = variants.find((row) => row.sku === input.sku);
  if (hit) return hit;
  const product = await store.insert('products', {
    company_id: companyId, name: input.name, brand_id: '', category_id: categoryId || '', unit_id: unitId,
    hsn_sac: input.hsn, gst_rate: input.gst, tracking_type: 'none', is_service: 0, is_active: 1,
  });
  return store.insert('variants', {
    company_id: companyId, product_id: product.id, sku: input.sku, barcode: '', mrp: input.mrp, sale_price: input.sale, cost_price: input.cost, min_stock: input.min || '2', is_active: 1,
  });
}

async function addStock(store, companyId, locationId, variantId, qty) {
  const [level] = await store.find('stock_levels', { company_id: companyId, location_id: locationId, variant_id: variantId });
  if (level) return;
  await store.insert('stock_levels', { company_id: companyId, location_id: locationId, variant_id: variantId, qty_on_hand: Number(qty).toFixed(3) });
  await store.insert('stock_movements', {
    company_id: companyId, location_id: locationId, variant_id: variantId, qty: Number(qty).toFixed(3), movement_type: 'opening', reason: 'opening', note: 'Opening stock', created_at: new Date().toISOString(),
  });
}

export async function seedService(store) {
  const [owner] = await store.find('users', { email: 'owner@spoke.demo' });
  if (!owner) return;
  const companyId = owner.company_id;
  if ((await store.find('customers', { company_id: companyId })).length) return;

  const users = await store.find('users', { company_id: companyId });
  const byEmail = (email) => users.find((row) => row.email === email)?.id || '';
  const advisor = byEmail('advisor@spoke.demo') || owner.id;
  const imran = byEmail('mechanic@spoke.demo');
  const suresh = await ensureMechanic(store, companyId, 'Suresh Kumar', 'mechanic2@spoke.demo');
  const locations = await store.find('locations', { company_id: companyId });
  const workshop = locations.find((row) => row.kind === 'service_bay') || locations[0];
  const partsStore = locations.find((row) => row.name === 'Parts Store') || workshop;
  const units = await store.find('units', { company_id: companyId });
  const unit = (code) => units.find((row) => row.code === code)?.id || units[0]?.id;
  const categories = await store.find('categories', { company_id: companyId });
  const category = (name) => categories.find((row) => row.name === name)?.id || '';

  const catalogue = {
    bikeOil: await ensurePart(store, companyId, unit('ltr'), category('Lubricants'), { sku: 'MOTUL-7100-1L', name: '10W-30 engine oil', hsn: '27101980', gst: '18', mrp: '820.00', sale: '750.00', cost: '610.00' }),
    bikePads: await ensurePart(store, companyId, unit('pcs'), category('Spare parts'), { sku: 'BOSCH-BP-ACTIVA', name: 'Front brake pads', hsn: '87141090', gst: '28', mrp: '540.00', sale: '480.00', cost: '290.00' }),
    airFilter: await ensurePart(store, companyId, unit('pcs'), category('Spare parts'), { sku: 'FILTER-AIR', name: 'Air filter', hsn: '84213100', gst: '18', mrp: '320.00', sale: '280.00', cost: '140.00' }),
    chainKit: await ensurePart(store, companyId, unit('pcs'), category('Spare parts'), { sku: 'RK-CHAIN-KIT-150', name: 'Chain sprocket kit (150cc)', hsn: '87149990', gst: '28', mrp: '1850.00', sale: '1650.00', cost: '1100.00' }),
    sparkPlug: await ensurePart(store, companyId, unit('pcs'), category('Spare parts'), { sku: 'NGK-CPR8E', name: 'Spark plug NGK', hsn: '85111000', gst: '28', mrp: '210.00', sale: '190.00', cost: '110.00', min: '10' }),
    carOil: await ensurePart(store, companyId, unit('ltr'), category('Lubricants'), { sku: 'CASTROL-5W30-1L', name: '5W-30 synthetic car engine oil', hsn: '27101980', gst: '18', mrp: '980.00', sale: '890.00', cost: '690.00', min: '12' }),
    carOilFilter: await ensurePart(store, companyId, unit('pcs'), category('Spare parts'), { sku: 'BOSCH-OF-SWIFT', name: 'Oil filter (Swift / Dzire)', hsn: '84212300', gst: '18', mrp: '360.00', sale: '320.00', cost: '190.00' }),
    carPads: await ensurePart(store, companyId, unit('pcs'), category('Spare parts'), { sku: 'BREMBO-FP-CRETA', name: 'Front brake pad set (Creta)', hsn: '87083000', gst: '28', mrp: '3200.00', sale: '2950.00', cost: '2100.00' }),
    cabinFilter: await ensurePart(store, companyId, unit('pcs'), category('Spare parts'), { sku: 'CABIN-AC-FILTER', name: 'AC cabin filter', hsn: '84213990', gst: '18', mrp: '650.00', sale: '560.00', cost: '300.00' }),
    coolant: await ensurePart(store, companyId, unit('ltr'), category('Lubricants'), { sku: 'COOLANT-1L', name: 'Long-life coolant', hsn: '38200000', gst: '18', mrp: '420.00', sale: '380.00', cost: '230.00' }),
    wiper: await ensurePart(store, companyId, unit('pcs'), category('Consumables'), { sku: 'BOSCH-WIPER-22', name: 'Wiper blade 22"', hsn: '85129000', gst: '28', mrp: '520.00', sale: '460.00', cost: '280.00' }),
    battery: await ensurePart(store, companyId, unit('pcs'), category('Spare parts'), { sku: 'AMARON-35AH', name: 'Car battery 35Ah', hsn: '85071000', gst: '28', mrp: '5400.00', sale: '4950.00', cost: '3900.00', min: '1' }),
  };
  const stock = [['carOil', 40], ['carOilFilter', 10], ['carPads', 1], ['cabinFilter', 6], ['coolant', 12], ['wiper', 8], ['battery', 2], ['chainKit', 3], ['sparkPlug', 20]];
  for (const [key, qty] of stock) await addStock(store, companyId, partsStore.id, catalogue[key].id, qty);

  let jobSeq = 0;
  let invoiceSeq = 0;
  const customer = (input) => store.insert('customers', { company_id: companyId, state_code: '29', city: 'Bengaluru', ...input });
  const vehicle = (input) => store.insert('vehicles', { company_id: companyId, ...input });
  const pack = (type, code) => SERVICE_PACKAGES[type].find((item) => item.code === code);

  async function job(spec) {
    jobSeq += 1;
    const delivered = spec.status === 'delivered';
    const invoiced = delivered || spec.status === 'ready';
    if (invoiced) invoiceSeq += 1;
    const row = await store.insert('job_cards', {
      company_id: companyId,
      job_no: `JC-${String(jobSeq).padStart(5, '0')}`,
      customer_id: spec.customer.id,
      vehicle_id: spec.vehicle.id,
      location_id: workshop.id,
      service_type: spec.serviceType,
      status: spec.status,
      odometer_in: String(spec.odometer),
      odometer_out: delivered ? String(spec.odometer + 2) : '',
      fuel_level: spec.fuel || '1/2',
      complaints: JSON.stringify(spec.complaints),
      inspection: JSON.stringify(spec.inspection || {}),
      accessories: JSON.stringify(spec.accessories || []),
      advisor_id: advisor,
      mechanic_id: spec.mechanic || '',
      bay: spec.bay || '',
      promised_at: spec.promised || '',
      checked_in_at: spec.at,
      approved_at: spec.status !== 'checked_in' && spec.status !== 'awaiting_approval' ? spec.at : '',
      approval_channel: 'in_person',
      started_at: ['in_progress', 'waiting_parts', 'qc', 'ready', 'delivered'].includes(spec.status) ? spec.at : '',
      ready_at: invoiced ? spec.readyAt || spec.at : '',
      qc_at: invoiced ? spec.readyAt || spec.at : '',
      invoice_no: invoiced ? `SI-${String(invoiceSeq).padStart(5, '0')}` : '',
      invoiced_at: invoiced ? spec.readyAt || spec.at : '',
      delivered_at: delivered ? spec.deliveredAt || spec.at : '',
      next_service_date: spec.nextDate || '',
      next_service_km: spec.nextKm ? String(spec.nextKm) : '',
      rating: spec.rating ? String(spec.rating) : '',
      feedback: spec.feedback || '',
      insurer: spec.insurer || '',
      claim_no: spec.claimNo || '',
      updated_at: spec.at,
    });
    for (const line of spec.lines) {
      const part = line.part ? catalogue[line.part] : null;
      const product = part ? (await store.find('products', { id: part.product_id }))[0] : null;
      await store.insert('job_lines', {
        company_id: companyId,
        job_id: row.id,
        line_type: part ? 'part' : 'labour',
        description: part ? product.name : line.labour || pack(spec.type, line.pack).name,
        variant_id: part?.id || '',
        sku: part?.sku || '',
        hsn_sac: part ? product.hsn_sac : LABOUR_SAC,
        qty: String(line.qty || 1),
        rate: part ? part.sale_price : Number(line.rate ?? pack(spec.type, line.pack).rate).toFixed(2),
        discount: Number(line.discount || 0).toFixed(2),
        gst_rate: part ? product.gst_rate : LABOUR_GST,
        approval: line.approval || (['checked_in', 'awaiting_approval'].includes(spec.status) ? 'pending' : 'approved'),
        issued_qty: String(line.issued ?? (part && ['qc', 'ready', 'delivered'].includes(spec.status) ? (line.qty || 1) : 0)),
        issue_location_id: partsStore.id,
        done: line.done ?? ['qc', 'ready', 'delivered'].includes(spec.status) ? 1 : 0,
        requested_by: line.requestedBy || 'Kavya Reddy',
        created_at: spec.at,
      });
    }
    const events = [['checked_in', `Checked in at ${spec.odometer} km by Kavya Reddy.`, spec.at]];
    if (!['checked_in'].includes(spec.status)) events.push(['send_estimate', 'Estimate shared with customer on whatsapp. Waiting for approval.', spec.at]);
    if (!['checked_in', 'awaiting_approval'].includes(spec.status)) events.push(['approve', 'Customer approved the estimate (in person).', spec.at]);
    if (['in_progress', 'waiting_parts', 'qc', 'ready', 'delivered'].includes(spec.status)) events.push(['start', 'Work started on the floor.', spec.at]);
    for (const extra of spec.events || []) events.push(extra);
    if (['qc', 'ready', 'delivered'].includes(spec.status)) events.push(['send_qc', 'Work finished. Sent to quality check.', spec.readyAt || spec.at]);
    if (invoiced) events.push(['mark_ready', `Passed quality check. Invoice SI-${String(invoiceSeq).padStart(5, '0')} raised. Ready for delivery.`, spec.readyAt || spec.at]);
    if (delivered) events.push(['deliver', `Delivered to customer at ${spec.odometer + 2} km.`, spec.deliveredAt || spec.at]);
    for (const [kind, text, at] of events) {
      await store.insert('job_events', { company_id: companyId, job_id: row.id, kind, text, user_id: advisor, user_name: kind === 'start' ? 'Imran Pasha' : 'Kavya Reddy', created_at: at });
    }
    let fresh = await recalc(store, row);
    for (const pay of spec.payments || []) {
      const amount = pay === 'full' ? Number(fresh.grand_total) - Number(fresh.paid_total) : pay.amount;
      if (!(amount > 0)) continue;
      await store.insert('job_payments', {
        company_id: companyId, job_id: row.id, customer_id: spec.customer.id, amount: Number(amount).toFixed(2), mode: pay.mode || 'upi', reference: pay.mode === 'cash' ? '' : `UPI${Math.floor(100000 + Math.random() * 899999)}`,
        kind: pay.kind || 'payment', user_id: advisor, user_name: 'Kavya Reddy', created_at: pay.at || spec.deliveredAt || spec.at,
      });
      fresh = await recalc(store, row);
    }
    await store.update('job_cards', row.id, { updated_at: spec.updatedAt || spec.at });
    return row;
  }

  // ---- Customers and vehicles ----
  const arjun = await customer({ name: 'Arjun Nair', mobile: '9845012345', email: 'arjun.nair@example.in', address: '14, 3rd Cross, HAL 2nd Stage', created_at: ago(400), notes: 'Prefers WhatsApp updates. Keeps old parts.' });
  const arjunCar = await vehicle({ customer_id: arjun.id, vehicle_type: 'car', reg_no: 'KA03MX4521', make: 'Hyundai', model: 'Creta', variant: 'SX 1.5 Diesel', fuel_type: 'Diesel', year: '2021', color: 'Polar White', vin: 'MALC381CLMM123456', engine_no: 'D4FCMM654321', odometer: '41250', insurer: 'ICICI Lombard', insurance_expiry: dateOnly(ahead(24 * 18)), puc_expiry: dateOnly(ago(5)), next_service_date: '', created_at: ago(400) });
  const arjunBike = await vehicle({ customer_id: arjun.id, vehicle_type: 'bike', reg_no: 'KA03JK7788', make: 'Royal Enfield', model: 'Classic 350', fuel_type: 'Petrol', year: '2019', color: 'Gunmetal Grey', odometer: '28900', insurer: 'Bajaj Allianz', insurance_expiry: dateOnly(ahead(24 * 140)), next_service_date: dateOnly(ahead(24 * 6)), next_service_km: '31900', last_service_at: ago(84), created_at: ago(380) });

  const meera = await customer({ name: 'Meera Iyer', mobile: '9900123456', email: 'meera.iyer@example.in', address: 'Flat 302, Prestige Shantiniketan, Whitefield', created_at: ago(300) });
  const meeraCar = await vehicle({ customer_id: meera.id, vehicle_type: 'car', reg_no: 'KA53MC1029', make: 'Maruti Suzuki', model: 'Swift', variant: 'ZXi', fuel_type: 'Petrol', year: '2020', color: 'Fire Red', odometer: '35600', insurer: 'HDFC Ergo', insurance_expiry: dateOnly(ahead(24 * 200)), puc_expiry: dateOnly(ahead(24 * 12)), created_at: ago(300) });

  const rohit = await customer({ name: 'Rohit Sharma', mobile: '9741098765', address: '88, 12th Main, Indiranagar', created_at: ago(200) });
  const rohitBike = await vehicle({ customer_id: rohit.id, vehicle_type: 'bike', reg_no: 'KA01HQ2233', make: 'Honda', model: 'Activa 6G', fuel_type: 'Petrol', year: '2022', color: 'Matte Axis Grey', odometer: '11800', insurance_expiry: dateOnly(ago(3)), created_at: ago(200) });

  const fleet = await customer({ name: 'Sai Logistics Pvt Ltd', mobile: '8050011122', email: 'fleet@sailogistics.example.in', address: 'Plot 22, Peenya Industrial Area', gstin: '29AACCS1234K1Z9', created_at: ago(500), notes: 'Fleet account. Credit allowed up to 30 days. Send invoice to fleet email.' });
  const fleetVan = await vehicle({ customer_id: fleet.id, vehicle_type: 'car', reg_no: 'KA02AB9081', make: 'Mahindra', model: 'Bolero Pik-Up', fuel_type: 'Diesel', year: '2018', color: 'White', odometer: '128400', insurer: 'New India Assurance', insurance_expiry: dateOnly(ahead(24 * 25)), puc_expiry: dateOnly(ahead(24 * 40)), next_service_date: dateOnly(ago(4)), next_service_km: '130000', last_service_at: ago(176), created_at: ago(500) });
  const fleetBike = await vehicle({ customer_id: fleet.id, vehicle_type: 'bike', reg_no: 'KA02EF5544', make: 'Bajaj', model: 'Pulsar 150', fuel_type: 'Petrol', year: '2021', color: 'Black', odometer: '42100', created_at: ago(450) });

  const priya = await customer({ name: 'Priya Menon', mobile: '9632587410', address: 'Koramangala 5th Block', state_code: '32', city: 'Kochi', created_at: ago(30), notes: 'Registered in Kerala — IGST applies.' });
  const priyaBike = await vehicle({ customer_id: priya.id, vehicle_type: 'bike', reg_no: 'KL07CD3344', make: 'TVS', model: 'Apache RTR 160 4V', fuel_type: 'Petrol', year: '2023', color: 'Racing Red', odometer: '6400', insurance_expiry: dateOnly(ahead(24 * 300)), created_at: ago(30) });

  const vikram = await customer({ name: 'Vikram Rao', mobile: '9886655443', address: 'Jayanagar 4th Block', created_at: ago(2) });
  const vikramCar = await vehicle({ customer_id: vikram.id, vehicle_type: 'car', reg_no: 'KA05NB7001', make: 'Tata', model: 'Nexon', variant: 'XZ+ Petrol', fuel_type: 'Petrol', year: '2022', color: 'Flame Red', odometer: '22010', created_at: ago(2) });

  // ---- History: delivered visits ----
  await job({ customer: arjun, vehicle: arjunCar, type: 'car', serviceType: 'periodic', status: 'delivered', odometer: 20150, at: ago(360), readyAt: ago(360, -6), deliveredAt: ago(360, -7), mechanic: imran, rating: 5, feedback: 'Quick and clean work.', complaints: ['20,000 km periodic service', 'AC not cooling enough'],
    lines: [{ pack: 'car_pms' }, { pack: 'car_ac' }, { part: 'carOil', qty: 4 }, { part: 'carOilFilter' }, { part: 'cabinFilter' }], payments: ['full'], nextDate: dateOnly(ago(180)), nextKm: 30150 });
  await job({ customer: arjun, vehicle: arjunCar, type: 'car', serviceType: 'periodic', status: 'delivered', odometer: 30480, at: ago(185), readyAt: ago(185, -5), deliveredAt: ago(184), mechanic: suresh, rating: 4, feedback: 'Delivered a day late.', complaints: ['30,000 km service', 'Brake noise at low speed', 'Wiper streaking'],
    lines: [{ pack: 'car_pms' }, { pack: 'car_brake' }, { part: 'carOil', qty: 4 }, { part: 'carOilFilter' }, { part: 'carPads' }, { part: 'wiper', qty: 2 }, { pack: 'car_align' }, { pack: 'car_balance', discount: 100 }],
    payments: [{ amount: 5000, mode: 'upi', kind: 'advance', at: ago(185) }, 'full'], nextDate: dateOnly(ago(5)), nextKm: 40480 });
  await job({ customer: arjun, vehicle: arjunBike, type: 'bike', serviceType: 'periodic', status: 'delivered', odometer: 25850, at: ago(84), readyAt: ago(84, -4), deliveredAt: ago(84, -5), mechanic: imran, rating: 5, complaints: ['General service', 'Chain noise'],
    lines: [{ pack: 'bike_gs' }, { pack: 'bike_chain' }, { part: 'bikeOil', qty: 2.5 }, { part: 'sparkPlug' }], payments: ['full'] });
  await job({ customer: meera, vehicle: meeraCar, type: 'car', serviceType: 'running_repair', status: 'delivered', odometer: 29800, at: ago(150), readyAt: ago(150, -3), deliveredAt: ago(150, -4), mechanic: suresh, rating: 4, complaints: ['Battery draining overnight'],
    lines: [{ pack: 'car_battery' }, { part: 'battery' }, { pack: 'car_scan' }], payments: ['full'] });
  await job({ customer: rohit, vehicle: rohitBike, type: 'bike', serviceType: 'free', status: 'delivered', odometer: 7900, at: ago(120), readyAt: ago(120, -3), deliveredAt: ago(120, -3), mechanic: imran, rating: 5, complaints: ['3rd free service'],
    lines: [{ pack: 'bike_gs', rate: 0 }, { part: 'bikeOil', qty: 0.8 }], payments: ['full'] });
  await job({ customer: fleet, vehicle: fleetVan, type: 'car', serviceType: 'periodic', status: 'delivered', odometer: 120020, at: ago(176), readyAt: ago(176, -8), deliveredAt: ago(175), mechanic: suresh, complaints: ['Scheduled maintenance', 'Clutch slipping on gradient'],
    lines: [{ pack: 'car_pms' }, { pack: 'car_clutch' }, { part: 'carOil', qty: 6 }, { part: 'carOilFilter' }, { part: 'coolant', qty: 2 }],
    payments: [{ amount: 6000, mode: 'bank', at: ago(160) }], nextDate: dateOnly(ago(4)), nextKm: 130000 });
  await job({ customer: fleet, vehicle: fleetBike, type: 'bike', serviceType: 'running_repair', status: 'delivered', odometer: 39950, at: ago(60), readyAt: ago(60, -2), deliveredAt: ago(60, -2), mechanic: imran, complaints: ['Chain slack and noise', 'Rear brake weak'],
    lines: [{ pack: 'bike_chain_kit' }, { part: 'chainKit' }, { pack: 'bike_brake' }], payments: [{ amount: 1000, mode: 'cash', at: ago(60) }] });
  await job({ customer: priya, vehicle: priyaBike, type: 'bike', serviceType: 'free', status: 'cancelled', odometer: 6100, at: ago(20), complaints: ['1st free service'], lines: [{ pack: 'bike_gs', rate: 0 }], events: [['cancel', 'Job cancelled — Customer took the bike to the dealer for warranty claim.', ago(20, -1)]] });

  // ---- Live jobs on the board ----
  await job({ customer: arjun, vehicle: arjunCar, type: 'car', serviceType: 'periodic', status: 'in_progress', odometer: 41250, at: ago(0, 5), promised: ahead(3), mechanic: suresh, bay: 'Bay 2', fuel: '3/4',
    complaints: ['40,000 km periodic service', 'Steering pulls to left', 'Check AC smell'],
    inspection: { 'Front bumper': 'scratch', 'Left doors': 'dent' }, accessories: ['Spare wheel', 'Jack & tool kit', 'Floor mats', 'Documents (RC, insurance)'],
    lines: [{ pack: 'car_pms', done: 1 }, { pack: 'car_align' }, { part: 'carOil', qty: 4, issued: 4 }, { part: 'carOilFilter', issued: 1 }, { part: 'cabinFilter', issued: 0 }, { labour: 'AC duct sanitisation', rate: 650, approval: 'pending', requestedBy: 'Suresh Kumar' }],
    events: [['additional', 'Additional work found — Labour: AC duct sanitisation × 1. Needs customer approval.', ago(0, 1)]], payments: [{ amount: 3000, mode: 'upi', kind: 'advance', at: ago(0, 5) }] });
  await job({ customer: rohit, vehicle: rohitBike, type: 'bike', serviceType: 'periodic', status: 'awaiting_approval', odometer: 11800, at: ago(0, 2), promised: ahead(4), fuel: '1/4',
    complaints: ['General service', 'Front brake squeal', 'Self-start weak in mornings'], accessories: ['Helmet', 'Mirrors'],
    lines: [{ pack: 'bike_gs' }, { pack: 'bike_brake' }, { part: 'bikeOil', qty: 0.8 }, { part: 'bikePads' }, { pack: 'bike_electric' }] });
  await job({ customer: meera, vehicle: meeraCar, type: 'car', serviceType: 'accident', status: 'waiting_parts', odometer: 35600, at: ago(2, 3), promised: ago(0, 4), mechanic: imran, bay: 'Body shop', insurer: 'HDFC Ergo', claimNo: 'HE-CLM-2026-88213',
    complaints: ['Rear bumper damaged in parking', 'Right tail lamp cracked'], inspection: { 'Rear bumper': 'broken', 'Tail lamps': 'broken' },
    lines: [{ pack: 'car_dent', qty: 1 }, { pack: 'car_paint', qty: 2 }, { labour: 'Tail lamp replacement', rate: 300 }],
    events: [['wait_parts', 'On hold — waiting for parts: Rear bumper and RH tail lamp ordered from Maruti dealer, ETA tomorrow.', ago(1)]] });
  await job({ customer: fleet, vehicle: fleetVan, type: 'car', serviceType: 'periodic', status: 'ready', odometer: 128400, at: ago(1, 6), readyAt: ago(0, 3), promised: ago(0, 1), mechanic: suresh, bay: 'Bay 1',
    complaints: ['130,000 km service', 'Headlamp beam low'],
    lines: [{ pack: 'car_pms' }, { part: 'carOil', qty: 6 }, { part: 'carOilFilter' }, { part: 'coolant', qty: 2 }, { labour: 'Headlamp focus adjustment', rate: 200 }] });
  await job({ customer: priya, vehicle: priyaBike, type: 'bike', serviceType: 'running_repair', status: 'qc', odometer: 6400, at: ago(0, 6), readyAt: ago(0, 1), promised: ahead(1), mechanic: imran, bay: 'Bay 4',
    complaints: ['Clutch hard', 'Air filter check'], lines: [{ pack: 'bike_clutch', labour: 'Clutch cable lube & adjust', rate: 150 }, { part: 'airFilter' }, { pack: 'bike_wash' }] });
  await job({ customer: vikram, vehicle: vikramCar, type: 'car', serviceType: 'periodic', status: 'checked_in', odometer: 22010, at: ago(0, 0.5), promised: ahead(7), fuel: '1/2',
    complaints: ['20,000 km service', 'Infotainment freezes'], accessories: ['Spare wheel', 'Jack & tool kit', 'Charger / cables'], lines: [{ pack: 'car_pms' }, { pack: 'car_scan' }] });
  await job({ customer: fleet, vehicle: fleetBike, type: 'bike', serviceType: 'periodic', status: 'approved', odometer: 42100, at: ago(0, 1.5), promised: ahead(5), mechanic: imran,
    complaints: ['Routine service'], lines: [{ pack: 'bike_gs' }, { part: 'bikeOil', qty: 1 }, { part: 'sparkPlug' }] });

  for (const [key, value] of [['seq_job_card', jobSeq], ['seq_service_invoice', invoiceSeq]]) {
    await store.insert('settings', { company_id: companyId, setting_key: key, setting_value: String(value) });
  }
}
