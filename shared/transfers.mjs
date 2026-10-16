// Transfer Orders: Transfer Request (indent) → Transfer Out (dispatch, in transit) → Transfer In (receipt),
// with configurable multi-level approvals. Shared by the server and the screens.

export const TRANSFER_KINDS = {
  request: { label: 'Transfer Request', short: 'Request', prefix: 'TRQ', verb: 'request' },
  out: { label: 'Transfer Out', short: 'Out', prefix: 'TO', verb: 'dispatch' },
  in: { label: 'Transfer In', short: 'In', prefix: 'TI', verb: 'receive' },
};

export const APPROVAL_STAGES = [
  ['request', 'Transfer Request', 'Before the supplying location can dispatch against a request'],
  ['out', 'Transfer Out', 'Before stock leaves the source location (dispatch)'],
  ['discrepancy', 'Receipt discrepancy', 'Before shortage / damage found at Transfer In is written off or returned'],
];

const n = (value) => { const v = Number(value); return Number.isFinite(v) ? v : 0; };
const r2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const r3 = (value) => Math.round((value + Number.EPSILON) * 1000) / 1000;

export function blankLevel(index = 0) {
  return { id: `lv${Date.now()}${index}`, name: index ? `Level ${index + 1}` : 'Location manager', roles: index ? ['owner'] : ['manager', 'owner'], minValue: '' };
}

export const DEFAULT_TRANSFER_CONFIG = {
  prefixes: { request: 'TRQ', out: 'TO', in: 'TI' },
  flow: 'two-step',
  valuation: 'cost',
  approvals: {
    request: { enabled: false, levels: [{ id: 'lv-r1', name: 'Branch manager', roles: ['manager', 'owner'], minValue: '' }] },
    out: { enabled: true, levels: [{ id: 'lv-o1', name: 'Store manager', roles: ['manager', 'owner'], minValue: '' }, { id: 'lv-o2', name: 'Owner (high value)', roles: ['owner'], minValue: '100000' }] },
    discrepancy: { enabled: true, levels: [{ id: 'lv-d1', name: 'Manager', roles: ['manager', 'owner'], minValue: '' }] },
  },
  selfApprove: false,
  ownerOverride: true,
  allowDirectOut: true,
  requestPartialDispatch: true,
  allowPartialReceipt: true,
  allowExcess: false,
  excessTolerancePct: '0',
  shortageAction: 'writeoff',
  damageAction: 'writeoff',
  reasonRequired: true,
  requireTransport: false,
  ewayThreshold: '50000',
  transitAlertDays: '3',
  routes: { mode: 'all', pairs: [] },
  createRoles: { request: [], out: [], in: [] },
  cancelRoles: ['owner', 'manager'],
  printTitle: 'Delivery Challan (Stock Transfer)',
  remarksOnReject: true,
};

export const SHORTAGE_REASONS = ['Short received', 'Lost in transit', 'Wrong item sent', 'Not loaded', 'Other'];
export const DAMAGE_REASONS = ['Damaged in transit', 'Packaging damaged', 'Expired / near expiry', 'Manufacturing defect', 'Other'];

export function mergeTransferConfig(saved) {
  const c = { ...DEFAULT_TRANSFER_CONFIG, ...(saved || {}) };
  c.prefixes = { ...DEFAULT_TRANSFER_CONFIG.prefixes, ...(saved?.prefixes || {}) };
  c.approvals = { ...DEFAULT_TRANSFER_CONFIG.approvals, ...(saved?.approvals || {}) };
  c.routes = { ...DEFAULT_TRANSFER_CONFIG.routes, ...(saved?.routes || {}) };
  c.createRoles = { ...DEFAULT_TRANSFER_CONFIG.createRoles, ...(saved?.createRoles || {}) };
  return c;
}

// Quantity per variant of a request / out line.
export function lineQty(line) {
  const map = {};
  if (line.kind === 'serial' && line.picked?.ids?.length) {
    map[line.picked.variantId] = line.picked.ids.length;
    return map;
  }
  for (const row of line.variants || []) if (n(row.qty) > 0) map[row.variantId] = r3((map[row.variantId] || 0) + n(row.qty));
  return map;
}

export function lineValue(line) {
  let value = 0;
  const qty = lineQty(line);
  for (const [variantId, amount] of Object.entries(qty)) {
    const row = (line.variants || []).find((item) => item.variantId === variantId);
    value += amount * n(row?.rate);
  }
  return r2(value);
}

export function transferTotals(lines) {
  let qty = 0; let value = 0;
  for (const line of lines || []) { qty += Object.values(lineQty(line)).reduce((a, b) => a + b, 0); value += lineValue(line); }
  return { qty: r3(qty), value: r2(value), lines: (lines || []).length };
}

// Levels that apply to a document of this value.
export function levelsFor(config, stage, value) {
  const flow = config?.approvals?.[stage];
  if (!flow?.enabled) return [];
  return (flow.levels || []).filter((level) => n(level.minValue) <= n(value)).map((level) => ({ id: level.id, name: level.name, roles: level.roles || [] }));
}

// Can this user act on the current level? Returns '' or the reason.
export function approvalProblem(config, approval, user) {
  if (!approval || approval.step >= approval.levels.length) return 'Nothing is waiting for approval.';
  const level = approval.levels[approval.step];
  const role = user.role?.code || user.role;
  const owner = role === 'owner' && config.ownerOverride;
  if (!owner && !level.roles.includes(role)) return `Level “${level.name}” is approved by ${level.roles.join(' / ') || 'nobody'}.`;
  if (!config.selfApprove && approval.createdBy === user.id && !owner) return 'You created this document; another approver must approve it.';
  if (!config.selfApprove && approval.log?.some((row) => row.userId === user.id && row.action === 'approved') && !owner) return 'You already approved an earlier level.';
  return '';
}

export function routeAllowed(config, fromId, toId) {
  if (!fromId || !toId || fromId === toId) return false;
  if (config?.routes?.mode !== 'selected') return true;
  return (config.routes.pairs || []).includes(`${fromId}>${toId}`);
}

export const STATUS_TONE = {
  'Pending Approval': 'pending', Approved: 'open', 'Partially Dispatched': 'partial', 'Fully Dispatched': 'done',
  'Pending Dispatch': 'pending', 'In Transit': 'transit', 'Partially Received': 'partial', Received: 'done', 'Received (Short)': 'done', 'Settlement Pending': 'pending',
  Rejected: 'closed', Cancelled: 'closed', Recalled: 'closed', 'Short Closed': 'closed',
  'Discrepancy Pending': 'pending', 'Discrepancy Approved': 'done', 'Discrepancy Rejected': 'closed',
};
