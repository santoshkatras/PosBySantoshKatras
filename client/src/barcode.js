// Barcode encoders for label printing: Code 128 (auto B/C) and EAN-13 / EAN-8 / UPC-A.
// Each returns a string of '1' (bar) and '0' (space) modules.

const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

function widths(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) out += (i % 2 === 0 ? '1' : '0').repeat(Number(pattern[i]));
  return out;
}

// Code 128: digit runs of 4+ use set C (denser), everything else set B (printable ASCII).
export function code128(text) {
  const value = String(text ?? '').replace(/[^\x20-\x7e]/g, '');
  if (!value) return '';
  const codes = [];
  let set = '';
  let i = 0;
  const digitRun = (at) => { let j = at; while (j < value.length && value[j] >= '0' && value[j] <= '9') j += 1; return j - at; };
  while (i < value.length) {
    const run = digitRun(i);
    const useC = run >= 4 || (run >= 2 && run === value.length - i && run % 2 === 0 && set === 'C');
    if (useC) {
      const take = run - (run % 2);
      if (set !== 'C') { codes.push(set ? CODE_C : START_C); set = 'C'; }
      for (let k = 0; k < take; k += 2) codes.push(Number(value.slice(i + k, i + k + 2)));
      i += take;
    } else {
      if (set !== 'B') { codes.push(set ? CODE_B : START_B); set = 'B'; }
      codes.push(value.charCodeAt(i) - 32);
      i += 1;
    }
  }
  let sum = codes[0];
  for (let k = 1; k < codes.length; k += 1) sum += codes[k] * k;
  codes.push(sum % 103, STOP);
  return codes.map((code) => widths(C128[code])).join('');
}

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function eanCheck(digits) {
  let sum = 0;
  const body = digits.slice(0, -1);
  for (let i = 0; i < body.length; i += 1) {
    const weight = (body.length - i) % 2 === 1 ? 3 : 1;
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

export function ean13(text) {
  let digits = String(text || '');
  if (/^\d{12}$/.test(digits)) digits = `0${digits}`; // UPC-A → EAN-13
  if (!/^\d{13}$/.test(digits) || !eanCheck(digits)) return '';
  const parity = EAN_PARITY[Number(digits[0])];
  let out = '101';
  for (let i = 1; i <= 6; i += 1) out += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[Number(digits[i])];
  out += '01010';
  for (let i = 7; i <= 12; i += 1) out += EAN_R[Number(digits[i])];
  return `${out}101`;
}

export function ean8(text) {
  const digits = String(text || '');
  if (!/^\d{8}$/.test(digits) || !eanCheck(digits)) return '';
  let out = '101';
  for (let i = 0; i < 4; i += 1) out += EAN_L[Number(digits[i])];
  out += '01010';
  for (let i = 4; i < 8; i += 1) out += EAN_R[Number(digits[i])];
  return `${out}101`;
}

// Picks EAN when the value is a valid EAN/UPC, else Code 128.
export function encode(value, symbology = 'auto') {
  const text = String(value || '').trim();
  if (symbology !== 'code128') {
    const e13 = ean13(text);
    if (e13) return { type: 'EAN-13', modules: e13, text: text.length === 12 ? `0${text}` : text };
    const e8 = ean8(text);
    if (e8) return { type: 'EAN-8', modules: e8, text };
  }
  return { type: 'Code 128', modules: code128(text), text };
}

// SVG markup (string) — used inside the print window and the on-screen preview.
export function barcodeSvg(value, { height = 40, symbology = 'auto' } = {}) {
  const { modules } = encode(value, symbology);
  if (!modules) return '';
  const quiet = 10;
  const total = modules.length + quiet * 2;
  let bars = '';
  let i = 0;
  while (i < modules.length) {
    if (modules[i] === '1') {
      let j = i;
      while (j < modules.length && modules[j] === '1') j += 1;
      bars += `<rect x="${i + quiet}" y="0" width="${j - i}" height="${height}"/>`;
      i = j;
    } else i += 1;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges">${bars}</svg>`;
}
