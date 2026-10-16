// Shortcut keys and tender types (payment modes), shared by Settings screens, the shortcut
// handler and the server.

// ---------- shortcut keys ----------
// scope: where the key works. target: 'nav' → href, otherwise the element marked data-sc="<action>".
export const SHORTCUT_GROUPS = [
  ['global', 'Anywhere in the application'],
  ['document', 'Purchase & Sales documents (PO, Receipt Note, Purchase Invoice, Quotation, Sales Order, Sales Bill)'],
  ['entry', 'Opening Stock Entry & Price Update windows'],
  ['item', 'Item Master (create / edit item)'],
  ['party', 'Customer / Supplier master'],
  ['list', 'List screens (items, documents, parties, price lists)'],
  ['barcode', 'Print Barcodes'],
  ['payment', 'Sales Bill payment collection'],
];

export const SHORTCUT_ACTIONS = [
  { id: 'menu-search', group: 'global', label: 'Search menu', keys: 'Ctrl+K', event: 'skpos:menu-search' },
  { id: 'shortcut-help', group: 'global', label: 'Show shortcut keys', keys: 'Ctrl+/', event: 'skpos:shortcut-help' },
  { id: 'go-dashboard', group: 'global', label: 'Open Dashboard', keys: 'Alt+D', href: '/dashboard' },
  { id: 'go-items', group: 'global', label: 'Open Item Master (Product)', keys: 'Alt+I', href: '/catalogue' },
  { id: 'go-new-item', group: 'global', label: 'Create new item', keys: 'Alt+Shift+I', href: '/catalogue?compose=1' },
  { id: 'go-stock', group: 'global', label: 'Open Stock Update', keys: 'Alt+S', href: '/stock' },
  { id: 'go-opening', group: 'global', label: 'Open Opening Stock Entry', keys: 'Alt+O', href: '/stock?mode=opening' },
  { id: 'go-ledger', group: 'global', label: 'Open Item Ledger', keys: 'Alt+L', href: '/ledger' },
  { id: 'go-wastage', group: 'global', label: 'Open Wastage Entry', keys: 'Alt+W', href: '/menu/wastage' },
  { id: 'go-transfer-out', group: 'global', label: 'Open Transfer Out', keys: 'Alt+T', href: '/menu/transfer-out' },
  { id: 'go-transfer-in', group: 'global', label: 'Open Transfer In', keys: 'Alt+R', href: '/menu/transfer-in' },
  { id: 'go-po', group: 'global', label: 'Open Purchase Orders', keys: 'Alt+1', href: '/m/purchase?doc=order' },
  { id: 'go-grn', group: 'global', label: 'Open Receipt Notes', keys: 'Alt+2', href: '/m/purchase?doc=receipt' },
  { id: 'go-pi', group: 'global', label: 'Open Purchase Invoices', keys: 'Alt+3', href: '/m/purchase?doc=invoice' },
  { id: 'go-sq', group: 'global', label: 'Open Sales Quotations', keys: 'Alt+4', href: '/m/sales?doc=quotation' },
  { id: 'go-so', group: 'global', label: 'Open Sales Orders', keys: 'Alt+5', href: '/m/sales?doc=order' },
  { id: 'go-sb', group: 'global', label: 'Open Sales Bills', keys: 'Alt+B', href: '/m/sales?doc=bill' },
  { id: 'go-customers', group: 'global', label: 'Open Customers', keys: 'Alt+C', href: '/customers' },
  { id: 'go-suppliers', group: 'global', label: 'Open Suppliers', keys: 'Alt+U', href: '/suppliers' },
  { id: 'go-barcodes', group: 'global', label: 'Open Print Barcodes', keys: 'Alt+P', href: '/menu/print-barcodes' },
  { id: 'go-offers', group: 'global', label: 'Open Offer Management', keys: 'Alt+F', href: '/menu/offers' },

  { id: 'doc-save', group: 'document', label: 'Save the document', keys: 'F10', target: 'doc-save' },
  { id: 'doc-save-alt', group: 'document', label: 'Save the document (alternate)', keys: 'Ctrl+S', target: 'doc-save' },
  { id: 'doc-item-code', group: 'document', label: 'Go to Item Code (scan / type)', keys: 'F2', target: 'item-code' },
  { id: 'doc-item-name', group: 'document', label: 'Search item by name', keys: 'F3', target: 'item-name' },
  { id: 'doc-party', group: 'document', label: 'Go to Supplier / Customer', keys: 'F4', target: 'party' },
  { id: 'doc-gst', group: 'document', label: 'Toggle "Rates include GST"', keys: 'Ctrl+G', target: 'toggle-gst' },
  { id: 'doc-payment', group: 'document', label: 'Open payment collection (Sales Bill)', keys: 'F8', target: 'payment' },
  { id: 'doc-scan-add', group: 'document', label: 'On scan: add item (scan mode)', keys: 'Alt+A', target: 'scan-add' },
  { id: 'doc-scan-remove', group: 'document', label: 'On scan: remove item one qty at a time (scan mode)', keys: 'Alt+X', target: 'scan-remove' },
  { id: 'bill-cash-save', group: 'document', label: 'Sales Bill: Cash Save (full cash, no payment window)', keys: 'Shift+F10', target: 'cash-save' },
  { id: 'bill-hold', group: 'document', label: 'Sales Bill: Hold bill', keys: 'F9', target: 'hold-bill' },
  { id: 'bill-recall', group: 'document', label: 'Sales Bill: Held bills (recall)', keys: 'Shift+F9', target: 'recall-bill' },
  { id: 'bill-return', group: 'document', label: 'Sales Bill: Return / Exchange', keys: 'Alt+Shift+E', target: 'return-exchange' },
  { id: 'bill-load-order', group: 'document', label: 'Sales Bill: Load Sales Order', keys: 'Alt+Shift+O', target: 'load-order' },
  { id: 'doc-party-history', group: 'document', label: 'Previous history of the customer / supplier', keys: 'Alt+Shift+H', target: 'party-history' },
  { id: 'doc-close', group: 'document', label: 'Close the window', keys: 'Esc', target: 'close', fixed: true },

  { id: 'entry-save', group: 'entry', label: 'Save the entry', keys: 'F10', target: 'entry-save' },
  { id: 'entry-save-alt', group: 'entry', label: 'Save the entry (alternate)', keys: 'Ctrl+S', target: 'entry-save' },
  { id: 'entry-item', group: 'entry', label: 'Go to Item Code', keys: 'F2', target: 'item-code' },
  { id: 'entry-name', group: 'entry', label: 'Search item by name', keys: 'F3', target: 'item-name' },
  { id: 'entry-scan-add', group: 'entry', label: 'On scan: add item (scan mode)', keys: 'Alt+A', target: 'scan-add' },
  { id: 'entry-scan-remove', group: 'entry', label: 'On scan: remove item one qty at a time (scan mode)', keys: 'Alt+X', target: 'scan-remove' },

  { id: 'item-save', group: 'item', label: 'Save item', keys: 'Ctrl+S', target: 'save' },
  { id: 'item-save-new', group: 'item', label: 'Save & add new', keys: 'Ctrl+Shift+S', target: 'save-new' },
  { id: 'item-reset', group: 'item', label: 'Reset / undo changes', keys: 'Ctrl+Shift+R', target: 'reset' },

  { id: 'party-save', group: 'party', label: 'Save customer / supplier', keys: 'Ctrl+S', target: 'party-save' },

  { id: 'list-new', group: 'list', label: 'Create new (item, document, party, price list)', keys: 'Alt+N', target: 'new' },
  { id: 'list-search', group: 'list', label: 'Search in the list', keys: 'Ctrl+F', target: 'search' },
  { id: 'list-edit', group: 'list', label: 'Edit the selected item', keys: 'Alt+E', target: 'edit' },
  { id: 'list-print-barcodes', group: 'list', label: 'Print barcodes of the selected items', keys: 'Alt+Shift+P', target: 'print-selected' },
  { id: 'list-active', group: 'list', label: 'Mark the selected items active / inactive', keys: 'Alt+Shift+A', target: 'toggle-active' },
  { id: 'list-delete', group: 'list', label: 'Delete the selected items', keys: 'Alt+Delete', target: 'delete' },
  { id: 'list-refresh', group: 'list', label: 'Refresh the list', keys: 'Alt+Shift+R', target: 'refresh' },
  { id: 'list-view', group: 'list', label: 'Switch list / image view', keys: 'Alt+V', target: 'switch-view' },

  { id: 'bc-print', group: 'barcode', label: 'Print labels', keys: 'Ctrl+P', target: 'print' },
  { id: 'bc-load', group: 'barcode', label: 'Load items from the chosen document', keys: 'Ctrl+L', target: 'load-doc' },

  { id: 'pay-cash', group: 'payment', label: 'Add Cash payment', keys: 'F5', target: 'tender-cash' },
  { id: 'pay-card', group: 'payment', label: 'Add Card payment', keys: 'F6', target: 'tender-card' },
  { id: 'pay-upi', group: 'payment', label: 'Add UPI payment', keys: 'F7', target: 'tender-upi' },
  { id: 'pay-full', group: 'payment', label: 'Fill the balance in the last payment row', keys: 'Ctrl+Enter', target: 'pay-balance' },
];

export function normaliseKeys(text) {
  const parts = String(text || '').split('+').map((part) => part.trim()).filter(Boolean);
  const mods = ['Ctrl', 'Alt', 'Shift'].filter((mod) => parts.some((part) => part.toLowerCase() === mod.toLowerCase()));
  const key = parts.find((part) => !['ctrl', 'alt', 'shift', 'meta', 'cmd'].includes(part.toLowerCase())) || '';
  const pretty = key.length === 1 ? key.toUpperCase() : key.replace(/^esc(ape)?$/i, 'Esc').replace(/^del(ete)?$/i, 'Delete');
  return [...mods, pretty].filter(Boolean).join('+');
}

export function keysFromEvent(event) {
  const ignore = ['Control', 'Alt', 'Shift', 'Meta'];
  if (ignore.includes(event.key)) return '';
  let key = event.key;
  if (key === ' ') key = 'Space';
  if (key === 'Escape') key = 'Esc';
  if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
  if (event.code?.startsWith('Digit')) key = event.code.slice(5);
  if (event.code?.startsWith('Key')) key = event.code.slice(3);
  if (key === '?') key = '/';
  const mods = [event.ctrlKey || event.metaKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean);
  return [...mods, key].join('+');
}

// Saved config: { [actionId]: { keys, enabled } } over the defaults.
export function shortcutList(saved = {}) {
  return SHORTCUT_ACTIONS.map((action) => {
    const own = saved[action.id] || {};
    return { ...action, defaultKeys: action.keys, keys: action.fixed ? action.keys : normaliseKeys(own.keys ?? action.keys), enabled: own.enabled !== false };
  });
}

// ---------- tender types ----------
export const TENDER_CATEGORIES = [
  ['cash', 'Cash'],
  ['card', 'Card (Debit / Credit)'],
  ['upi', 'UPI / QR'],
  ['wallet', 'Wallet'],
  ['netbanking', 'Bank Transfer (NEFT / RTGS / IMPS)'],
  ['cheque', 'Cheque'],
  ['credit', 'Credit / On Account'],
  ['voucher', 'Gift Voucher'],
  ['loyalty', 'Loyalty Points'],
  ['coupon', 'Coupon / Discount'],
  ['creditnote', 'Credit Note'],
  ['emi', 'EMI / Finance'],
  ['other', 'Other'],
];

// Third-party payment integrations and the credentials each needs.
export const TENDER_PROVIDERS = [
  { id: 'none', name: 'No integration (manual entry)', kinds: [], fields: [] },
  { id: 'phonepe', name: 'PhonePe (EDC / Dynamic QR)', kinds: ['upi', 'card', 'wallet'], fields: [['merchantId', 'Merchant ID'], ['storeId', 'Store ID'], ['terminalId', 'Terminal ID'], ['saltKey', 'Salt Key', true], ['saltIndex', 'Salt Index']] },
  { id: 'paytm', name: 'Paytm (EDC / All-in-One QR)', kinds: ['upi', 'card', 'wallet'], fields: [['merchantId', 'MID'], ['merchantKey', 'Merchant Key', true], ['terminalId', 'EDC Terminal ID (TID)'], ['channelId', 'Channel ID']] },
  { id: 'pinelabs', name: 'Pine Labs (Plutus Smart / Cloud)', kinds: ['card', 'upi', 'wallet', 'emi'], fields: [['merchantId', 'Merchant ID'], ['securityToken', 'Security Token', true], ['storeId', 'Store ID'], ['clientId', 'Client ID (IMEI / POS ID)'], ['paymentMode', 'Allowed Payment Mode']] },
  { id: 'razorpay', name: 'Razorpay POS (Ezetap)', kinds: ['card', 'upi', 'wallet'], fields: [['keyId', 'Key ID'], ['keySecret', 'Key Secret', true], ['deviceId', 'Device ID'], ['username', 'POS Username']] },
  { id: 'mswipe', name: 'Mswipe', kinds: ['card', 'upi'], fields: [['clientCode', 'Client Code'], ['username', 'Username'], ['password', 'Password', true], ['terminalId', 'Terminal ID']] },
  { id: 'bharatpe', name: 'BharatPe (Swipe / QR)', kinds: ['upi', 'card'], fields: [['merchantId', 'Merchant ID'], ['apiKey', 'API Key', true], ['terminalId', 'Terminal ID']] },
  { id: 'gpay', name: 'Google Pay for Business (UPI)', kinds: ['upi'], fields: [['upiId', 'Business UPI ID (VPA)'], ['merchantName', 'Merchant Name'], ['mcc', 'Merchant Category Code']] },
  { id: 'icici', name: 'ICICI Bank EDC', kinds: ['card', 'upi'], fields: [['merchantId', 'Merchant ID'], ['terminalId', 'Terminal ID'], ['apiKey', 'API Key', true]] },
  { id: 'hdfc', name: 'HDFC Bank SmartHub / EDC', kinds: ['card', 'upi'], fields: [['merchantId', 'Merchant ID'], ['terminalId', 'Terminal ID'], ['apiKey', 'API Key', true]] },
  { id: 'cashfree', name: 'Cashfree (Payment links / QR)', kinds: ['upi', 'card', 'netbanking'], fields: [['appId', 'App ID'], ['secretKey', 'Secret Key', true]] },
  { id: 'bajaj', name: 'Bajaj Finserv (EMI)', kinds: ['emi'], fields: [['dealerCode', 'Dealer Code'], ['supplierId', 'Supplier ID'], ['apiKey', 'API Key', true]] },
];

export function defaultTenders() {
  const base = { active: true, locations: [], roles: [], refRequired: false, refLabel: '', allowChange: false, allowRefund: true, openDrawer: false, surchargePct: '', minAmount: '', maxAmount: '', integration: 'none', config: {}, environment: 'sandbox' };
  return [
    { ...base, id: 'cash', code: 'CASH', name: 'Cash', category: 'cash', allowChange: true, openDrawer: true, color: '#12b76a', sort: 1 },
    { ...base, id: 'card', code: 'CARD', name: 'Card (Debit / Credit)', category: 'card', refRequired: true, refLabel: 'Approval code / last 4 digits', color: '#2f6bff', sort: 2 },
    { ...base, id: 'upi', code: 'UPI', name: 'UPI', category: 'upi', refRequired: true, refLabel: 'UPI Ref. No. (UTR)', color: '#7a5af8', sort: 3 },
    { ...base, id: 'credit', code: 'CREDIT', name: 'Credit (On Account)', category: 'credit', allowRefund: false, color: '#f79009', sort: 4, roles: ['owner', 'manager'] },
    { ...base, id: 'neft', code: 'BANK', name: 'Bank Transfer', category: 'netbanking', refRequired: true, refLabel: 'UTR / Transaction ID', color: '#0ba5ec', sort: 5 },
    { ...base, id: 'cheque', code: 'CHQ', name: 'Cheque', category: 'cheque', refRequired: true, refLabel: 'Cheque No. & Bank', color: '#667085', sort: 6 },
    { ...base, id: 'voucher', code: 'GV', name: 'Gift Voucher', category: 'voucher', refRequired: true, refLabel: 'Voucher code', color: '#ee46bc', sort: 7 },
    { ...base, id: 'loyalty', code: 'LOYALTY', name: 'Loyalty Points', category: 'loyalty', color: '#dc6803', sort: 8 },
  ];
}
