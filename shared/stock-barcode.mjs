// Stock barcodes: every inward entry gets its own 13-digit barcode (EAN-13 format).
// Layout: 2-digit prefix (20–29 = GS1 "in-store use", never a real manufacturer code)
//       + 10-digit running number + 1 check digit  = 13 digits.
// One barcode = one inward lot (plain items and matrix variants), one batch lot, or one serial unit.

export const STOCK_BARCODE_PREFIXES = ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29'];

export const DEFAULT_STOCK_BARCODE = {
  enabled: true,
  prefix: '21',
  serialBarcodes: true, // serialised items: one stock barcode per unit
  outwardPick: 'ask', // 'ask' = item chosen by name asks which batch / barcode / serial; 'auto' = oldest first
  scanQty: 1, // quantity added per scan
};

export function mergeStockBarcode(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const out = { ...DEFAULT_STOCK_BARCODE, ...s };
  if (!STOCK_BARCODE_PREFIXES.includes(String(out.prefix))) out.prefix = DEFAULT_STOCK_BARCODE.prefix;
  out.enabled = out.enabled !== false;
  out.serialBarcodes = out.serialBarcodes !== false;
  out.outwardPick = out.outwardPick === 'auto' ? 'auto' : 'ask';
  out.scanQty = Math.max(Number(out.scanQty) || 1, 0.001);
  return out;
}

// EAN-13 check digit for the first 12 digits.
export function ean13Check(twelve) {
  const digits = String(twelve).split('').map(Number);
  const sum = digits.reduce((total, digit, index) => total + digit * (index % 2 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}

export function makeStockBarcode(prefix, seq) {
  const body = `${prefix}${String(seq).padStart(10, '0')}`.slice(0, 12);
  return body + ean13Check(body);
}

export function isStockBarcode(code) {
  const text = String(code || '').trim();
  return /^2\d{12}$/.test(text) && ean13Check(text.slice(0, 12)) === text[12];
}
