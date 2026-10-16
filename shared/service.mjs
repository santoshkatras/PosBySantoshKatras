// Vehicle service (car and bike) workshop domain.
// Shared by the server (rules) and the client (labels, checklists, packages).

export const VEHICLE_TYPES = [
  ['car', 'Car'],
  ['bike', 'Bike / scooter'],
];

export const FUEL_TYPES = ['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid'];
export const FUEL_LEVELS = ['Empty', '1/4', '1/2', '3/4', 'Full'];

export const SERVICE_TYPES = {
  car: [
    ['periodic', 'Periodic maintenance service'],
    ['free', 'Free service (warranty coupon)'],
    ['running_repair', 'General / running repair'],
    ['accident', 'Accident repair (body & paint)'],
    ['ac', 'AC service'],
    ['alignment', 'Wheel alignment & balancing'],
    ['detailing', 'Wash & detailing'],
  ],
  bike: [
    ['periodic', 'General service'],
    ['free', 'Free service (warranty coupon)'],
    ['running_repair', 'Running repair'],
    ['accident', 'Accident repair'],
    ['detailing', 'Wash & polish'],
  ],
};

export function serviceTypeLabel(vehicleType, code) {
  const list = SERVICE_TYPES[vehicleType] || SERVICE_TYPES.bike;
  return list.find((item) => item[0] === code)?.[1] || code || '—';
}

// The real workshop flow, in order.
export const JOB_STATUSES = [
  ['checked_in', 'Checked in'],
  ['awaiting_approval', 'Awaiting approval'],
  ['approved', 'Approved'],
  ['in_progress', 'In progress'],
  ['waiting_parts', 'Waiting for parts'],
  ['qc', 'Quality check'],
  ['ready', 'Ready for delivery'],
  ['delivered', 'Delivered'],
  ['cancelled', 'Cancelled'],
];
export const OPEN_STATUSES = ['checked_in', 'awaiting_approval', 'approved', 'in_progress', 'waiting_parts', 'qc', 'ready'];
export const BOARD_COLUMNS = [
  { id: 'reception', label: 'Reception', statuses: ['checked_in', 'awaiting_approval'] },
  { id: 'approved', label: 'Approved · queued', statuses: ['approved'] },
  { id: 'floor', label: 'On the floor', statuses: ['in_progress', 'waiting_parts'] },
  { id: 'qc', label: 'Quality check', statuses: ['qc'] },
  { id: 'ready', label: 'Ready for delivery', statuses: ['ready'] },
];

export function statusLabel(code) {
  return JOB_STATUSES.find((item) => item[0] === code)?.[1] || code;
}

// action -> statuses it can start from, and where it leads
export const TRANSITIONS = {
  send_estimate: { from: ['checked_in'], to: 'awaiting_approval' },
  approve: { from: ['checked_in', 'awaiting_approval'], to: 'approved' },
  start: { from: ['approved'], to: 'in_progress' },
  wait_parts: { from: ['in_progress'], to: 'waiting_parts' },
  resume: { from: ['waiting_parts'], to: 'in_progress' },
  send_qc: { from: ['in_progress'], to: 'qc' },
  qc_fail: { from: ['qc'], to: 'in_progress' },
  mark_ready: { from: ['qc'], to: 'ready' },
  deliver: { from: ['ready'], to: 'delivered' },
  cancel: { from: ['checked_in', 'awaiting_approval', 'approved', 'in_progress', 'waiting_parts', 'qc'], to: 'cancelled' },
};

export const PAYMENT_MODES = [
  ['cash', 'Cash'],
  ['upi', 'UPI'],
  ['card', 'Card'],
  ['bank', 'Bank transfer'],
  ['insurance', 'Insurance settlement'],
];

export const APPROVAL_CHANNELS = [
  ['in_person', 'In person'],
  ['phone', 'Phone call'],
  ['whatsapp', 'WhatsApp'],
];

// SAC for maintenance and repair of motor vehicles
export const LABOUR_SAC = '998714';
export const LABOUR_GST = '18';

// Walk-around inspection at check-in.
export const INSPECTION = {
  car: ['Front bumper', 'Rear bumper', 'Bonnet', 'Roof', 'Left doors', 'Right doors', 'Windshield', 'Headlamps', 'Tail lamps', 'ORVMs', 'Alloys / wheel caps', 'Interior / seats'],
  bike: ['Front mudguard', 'Rear mudguard', 'Fuel tank', 'Side panels', 'Headlamp', 'Tail lamp', 'Indicators', 'Mirrors', 'Seat', 'Silencer'],
};
export const INSPECTION_STATES = [['ok', 'OK'], ['scratch', 'Scratch'], ['dent', 'Dent'], ['broken', 'Broken']];

// Belongings recorded at check-in so nothing goes missing.
export const ACCESSORIES = {
  car: ['Spare wheel', 'Jack & tool kit', 'Music system', 'Floor mats', 'Mud flaps', 'Wheel caps', 'First aid kit', 'Charger / cables', 'Documents (RC, insurance)'],
  bike: ['Tool kit', 'Helmet', 'Mirrors', 'Side stand', 'Documents (RC, insurance)', 'Key chain'],
};

// QC / road-test checklist before delivery.
export const QC_CHECKS = {
  car: ['Road test done', 'Brakes OK', 'No warning lights', 'AC cooling OK', 'Fluid levels topped up', 'Tyre pressure set', 'Old parts kept in boot', 'Car washed & interior vacuumed', 'Service reminder reset'],
  bike: ['Road test done', 'Brakes OK', 'Chain tension & lube OK', 'Lights & horn OK', 'Tyre pressure set', 'Old parts handed over', 'Bike washed'],
};

// Ready-made labour menus per vehicle type. Rates in INR, before GST.
export const SERVICE_PACKAGES = {
  car: [
    { code: 'car_pms', name: 'Periodic maintenance (labour)', rate: 1800, hours: 2.5 },
    { code: 'car_oil', name: 'Engine oil & filter change', rate: 450, hours: 0.5 },
    { code: 'car_brake', name: 'Brake pad replacement (per axle)', rate: 650, hours: 1 },
    { code: 'car_ac', name: 'AC gas top-up & cleaning', rate: 1500, hours: 1.5 },
    { code: 'car_align', name: 'Wheel alignment', rate: 600, hours: 0.5 },
    { code: 'car_balance', name: 'Wheel balancing (4 wheels)', rate: 400, hours: 0.5 },
    { code: 'car_battery', name: 'Battery check & replacement', rate: 250, hours: 0.3 },
    { code: 'car_clutch', name: 'Clutch overhaul', rate: 3500, hours: 5 },
    { code: 'car_dent', name: 'Denting (per panel)', rate: 1200, hours: 2 },
    { code: 'car_paint', name: 'Painting (per panel)', rate: 2800, hours: 3 },
    { code: 'car_wash', name: 'Foam wash & vacuum', rate: 500, hours: 0.75 },
    { code: 'car_scan', name: 'OBD scan & diagnosis', rate: 700, hours: 0.5 },
  ],
  bike: [
    { code: 'bike_gs', name: 'General service (labour)', rate: 450, hours: 1.5 },
    { code: 'bike_oil', name: 'Engine oil change', rate: 100, hours: 0.25 },
    { code: 'bike_brake', name: 'Brake pad / shoe replacement', rate: 150, hours: 0.5 },
    { code: 'bike_chain', name: 'Chain clean, lube & adjust', rate: 120, hours: 0.3 },
    { code: 'bike_chain_kit', name: 'Chain sprocket kit replacement', rate: 350, hours: 1 },
    { code: 'bike_carb', name: 'Carburettor / throttle body cleaning', rate: 300, hours: 0.75 },
    { code: 'bike_clutch', name: 'Clutch plate replacement', rate: 500, hours: 1.5 },
    { code: 'bike_puncture', name: 'Puncture repair (tubeless)', rate: 100, hours: 0.25 },
    { code: 'bike_electric', name: 'Electrical check & wiring', rate: 250, hours: 0.75 },
    { code: 'bike_wash', name: 'Water wash & polish', rate: 150, hours: 0.5 },
  ],
};

// Default next-service interval by vehicle type.
export const NEXT_SERVICE = {
  car: { days: 180, km: 10000 },
  bike: { days: 90, km: 3000 },
};

export function addDays(dateText, days) {
  const base = dateText ? new Date(dateText) : new Date();
  return new Date(base.getTime() + days * 86400000).toISOString().slice(0, 10);
}

// Money for one job line. Discount is an amount in INR on the line.
export function lineMath(line) {
  const qty = Number(line.qty) || 0;
  const rate = Number(line.rate) || 0;
  const discount = Math.min(Number(line.discount) || 0, qty * rate);
  const taxable = Math.max(0, qty * rate - discount);
  const gst = Number(line.gst_rate ?? line.gstRate) || 0;
  const tax = taxable * gst / 100;
  return { gross: qty * rate, discount, taxable, gst, tax, total: taxable + tax };
}

// Totals for the billable (approved) lines on a job. intraState decides CGST+SGST vs IGST.
export function jobTotals(lines, intraState = true) {
  const out = { labour: 0, parts: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, total: 0, round: 0, grand: 0, slabs: {} };
  for (const line of lines) {
    if (line.approval !== 'approved') continue;
    const math = lineMath(line);
    if (line.line_type === 'labour') out.labour += math.taxable;
    else out.parts += math.taxable;
    out.discount += math.discount;
    out.taxable += math.taxable;
    out.tax += math.tax;
    const slab = String(math.gst);
    out.slabs[slab] = out.slabs[slab] || { taxable: 0, tax: 0 };
    out.slabs[slab].taxable += math.taxable;
    out.slabs[slab].tax += math.tax;
  }
  if (intraState) {
    out.cgst = out.tax / 2;
    out.sgst = out.tax / 2;
  } else {
    out.igst = out.tax;
  }
  out.total = out.taxable + out.tax;
  out.grand = Math.round(out.total);
  out.round = out.grand - out.total;
  for (const key of ['labour', 'parts', 'discount', 'taxable', 'cgst', 'sgst', 'igst', 'tax', 'total', 'round']) {
    out[key] = Math.round(out[key] * 100) / 100;
  }
  return out;
}

export function normalizeRegNo(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// "KA03MX4521" -> "KA 03 MX 4521" for display.
export function formatRegNo(value) {
  const raw = normalizeRegNo(value);
  const match = raw.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  if (!match) return raw;
  return [match[1], match[2], match[3], match[4]].filter(Boolean).join(' ');
}

export function normalizeMobile(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// Service-role capabilities. Kept on role codes so existing tenants need no new permission rows.
export function serviceCaps(session) {
  const role = session?.user?.role?.code;
  const can = (permission) => Boolean(session?.user?.permissions?.includes(permission));
  const view = can('bike_service.view');
  const desk = view && ['owner', 'manager', 'service_advisor'].includes(role);
  return {
    view,
    desk, // check-in, estimates, approvals, pricing, invoicing, delivery
    floor: view && (desk || role === 'mechanic'), // start work, finish tasks, request parts, send to QC
    qc: desk,
    payments: desk || (can('sales.view') && role === 'accountant'),
    issueParts: desk && can('stock.view'),
    customers: can('customers.view'),
    customerEdit: can('customers.view') && ['owner', 'manager', 'service_advisor', 'sales'].includes(role),
  };
}
