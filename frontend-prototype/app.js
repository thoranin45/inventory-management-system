/* ============================================================
   Warehouse Console — Phase 0.5 clickable prototype
   Vanilla JS. No build. Mock data only. No backend calls.
   ============================================================ */
(function () {
"use strict";

/* ---------------------------------------------------------------
   0. tiny utilities
--------------------------------------------------------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clone = (o) => JSON.parse(JSON.stringify(o));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () =>
  "01" + Date.now().toString(36).toUpperCase() +
  Math.random().toString(36).slice(2, 8).toUpperCase();

const TODAY = new Date(2026, 8, 7); // fixed demo "today" (2026-09-07, UTC+7 business)
function addDays(d) {
  const t = new Date(TODAY);
  t.setDate(t.getDate() + d);
  return t;
}
const isoDate = (dt) => dt.toISOString().slice(0, 10);
const fmtDate = (d) => addDays(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const ago = (d) => (d >= 0 ? "today" : d === -1 ? "1d ago" : `${-d}d ago`);

function fmtQty(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function qtyHTML(n) {
  const s = fmtQty(n);
  const i = s.lastIndexOf(".");
  return `<span class="qty">${s.slice(0, i)}<span class="u">${s.slice(i)}</span></span>`;
}
function fmtMoney(n) {
  return "฿" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const pct = (a, b) => (b <= 0 ? 0 : Math.round((a / b) * 100));

/* ---------------------------------------------------------------
   1. icons (Lucide-style, 1.5–2px stroke)
--------------------------------------------------------------- */
const P = {
  dashboard: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  box: '<path d="m7.5 4.3 9 5.2v9.8l-9 5.2-9-5.2V9.5z" transform="translate(4.5 0)"/><path d="M12 22V12M3 7l9 5 9-5"/>',
  layers: '<path d="M12 2 2 7l10 5 10-5z"/><path d="m2 12 10 5 10-5M2 17l10 5 10-5"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.5 3h2l2.6 12.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  pack: '<path d="M12 3 2 8l10 5 10-5z"/><path d="M2 8v8l10 5 10-5V8"/><path d="M7 5.5 17 10.5"/>',
  poIcon: '<path d="M3 4h13v16H3z"/><path d="M8 4v16M16 8h5v12h-5"/><path d="M6 8h4M6 12h4"/>',
  transfer: '<path d="M8 3 4 7l4 4M4 7h16"/><path d="M16 21l4-4-4-4M20 17H4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21c0-4 3.5-6 7-6s7 2 7 6"/><path d="M16 11a3 3 0 1 0 0-6"/>',
  factory: '<path d="M3 21V10l6 4V10l6 4V6l6 4v11z"/><path d="M3 21h18"/>',
  report: '<path d="M4 4v16h16"/><path d="M8 15l3-4 3 3 4-6"/>',
  truck: '<path d="M3 6h11v11H3z"/><path d="M14 9h4l3 3v5h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevR: '<path d="m9 6 6 6-6 6"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
  panelLeft: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  inbox: '<path d="M4 13h4l2 3h4l2-3h4"/><path d="M4 13 6 5h12l2 8v6H4z"/>',
  slip: '<path d="M6 2h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  tag: '<path d="M20 12 12 20l-8-8V4h8z"/><circle cx="8" cy="8" r="1.5"/>',
  dots: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  ship: '<path d="M2 21c1.5 0 3-1 3-1s1.5 1 3 1 3-1 3-1 1.5 1 3 1 3-1 3-1 1.5 1 3 1"/><path d="M4 16 5 8h14l1 8M12 4v4"/>',
};
function icon(n, size = 16, cls = "") {
  return `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ""}</svg>`;
}

/* ---------------------------------------------------------------
   2. seed data (mock — mirrors Phase 1–9 backend shapes)
--------------------------------------------------------------- */
const WH = { MAIN: "Main DC", "EAST-HUB": "East Hub", "SOUTH-DEPOT": "South Depot", TRANSIT: "System Transit" };

const SEED = {
  products: [
    { id: "P1", sku: "WH-COFFEE-1KG", name: "Arabica Whole Bean 1kg", cat: "Beverage", barcode: "885000000001",
      trackBatch: true, trackExpiry: true, owned: 1600, reserved: 180, transit: 0, min: 400, max: 3000,
      batches: [
        { lot: "LOT-2406-A", expDays: 41, qty: 1240 },
        { lot: "LOT-2501-B", expDays: 300, qty: 360 },
      ],
      locs: [{ wh: "MAIN", loc: "A-01", qty: 1200 }, { wh: "MAIN", loc: "A-02", qty: 400 }] },
    { id: "P2", sku: "WH-MILK-UHT-1L", name: "UHT Milk 1L", cat: "Beverage", barcode: "885000000002",
      trackBatch: true, trackExpiry: true, owned: 980, reserved: 60, transit: 80, min: 300, max: 2000,
      batches: [
        { lot: "LOT-2404-EXP", expDays: -9, qty: 140 },
        { lot: "LOT-2405-X", expDays: 25, qty: 760 },
      ],
      locs: [{ wh: "MAIN", loc: "C-04", qty: 900 }, { wh: "TRANSIT", loc: "IN-TRANSIT", qty: 80 }] },
    { id: "P3", sku: "WH-SUGAR-25KG", name: "Refined Sugar Sack 25kg", cat: "Dry goods", barcode: "885000000009",
      trackBatch: false, trackExpiry: false, owned: 62, reserved: 0, transit: 0, min: 80, max: 400,
      batches: [], locs: [{ wh: "MAIN", loc: "D-11", qty: 62 }] },
    { id: "P4", sku: "WH-FLOUR-1KG", name: "All-Purpose Flour 1kg", cat: "Dry goods", barcode: "885000000004",
      trackBatch: false, trackExpiry: false, owned: 3110, reserved: 300, transit: 120, min: 600, max: 5000,
      batches: [], locs: [{ wh: "MAIN", loc: "D-07", qty: 2990 }, { wh: "TRANSIT", loc: "IN-TRANSIT", qty: 120 }] },
    { id: "P5", sku: "WH-BOX-M", name: "Cardboard Box (Medium)", cat: "Packaging", barcode: "885000000005",
      trackBatch: false, trackExpiry: false, owned: 540, reserved: 0, transit: 220, min: 200, max: 2000,
      batches: [], locs: [{ wh: "MAIN", loc: "P-01", qty: 320 }, { wh: "TRANSIT", loc: "IN-TRANSIT", qty: 220 }] },
    { id: "P6", sku: "WH-SALT-500G", name: "Sea Salt 500g", cat: "Dry goods", barcode: "885000000003",
      trackBatch: false, trackExpiry: false, owned: 900, reserved: 0, transit: 0, min: 150, max: 1500,
      batches: [], locs: [{ wh: "MAIN", loc: "D-14", qty: 900 }] },
    { id: "P7", sku: "WH-OIL-5L", name: "Vegetable Oil 5L", cat: "Dry goods", barcode: "885000000007",
      trackBatch: true, trackExpiry: false, owned: 210, reserved: 0, transit: 0, min: 60, max: 600,
      batches: [{ lot: "LOT-OIL-88", expDays: null, qty: 210 }],
      locs: [{ wh: "MAIN", loc: "D-20", qty: 210 }] },
    { id: "P8", sku: "WH-TEA-200G", name: "Green Tea 200g", cat: "Beverage", barcode: "885000000008",
      trackBatch: true, trackExpiry: true, owned: 480, reserved: 40, transit: 40, min: 120, max: 1200,
      batches: [{ lot: "LOT-TEA-19", expDays: 18, qty: 480 }],
      locs: [{ wh: "MAIN", loc: "B-03", qty: 440 }, { wh: "TRANSIT", loc: "IN-TRANSIT", qty: 40 }] },
  ],

  customers: [
    { id: "C1", name: "Siam Fresh Market", phone: "+66 2 118 4420", city: "Bangkok" },
    { id: "C2", name: "Bangkok Grocers", phone: "+66 2 552 9018", city: "Bangkok" },
    { id: "C3", name: "Chao Phraya F&B", phone: "+66 2 447 3311", city: "Nonthaburi" },
    { id: "C4", name: "Nakorn Retail", phone: "+66 44 220 771", city: "Nakhon Ratchasima" },
    { id: "C5", name: "Green Valley Foods", phone: "+66 53 909 220", city: "Chiang Mai" },
  ],
  suppliers: [
    { id: "S1", name: "Golden Harvest Trading", phone: "+66 2 900 1180", city: "Bangkok" },
    { id: "S2", name: "Andaman Distributors", phone: "+66 76 331 900", city: "Phuket" },
    { id: "S3", name: "Northern Mills", phone: "+66 55 640 220", city: "Phitsanulok" },
    { id: "S4", name: "Siam Packaging Co", phone: "+66 2 771 4500", city: "Samut Prakan" },
  ],

  sales: [
    { id: "104829", num: "SO-104829", cust: "C1", status: "PICKING", created: -2,
      items: [
        { pid: "P1", ordered: 6, price: 210, allocs: [{ lot: "LOT-2406-A", expDays: 41, qty: 6 }] },
        { pid: "P2", ordered: 4, price: 42, allocs: [{ lot: "LOT-2405-X", expDays: 25, qty: 2 }, { lot: "LOT-2405-Y", expDays: 60, qty: 2 }] },
        { pid: "P4", ordered: 10, price: 24.5, allocs: [{ lot: null, expDays: null, qty: 10 }] },
      ] },
    { id: "104830", num: "SO-104830", cust: "C2", status: "DRAFT", created: -1,
      items: [
        { pid: "P4", ordered: 40, price: 24.5, allocs: [] },
        { pid: "P5", ordered: 100, price: 9, allocs: [] },
      ] },
    { id: "104831", num: "SO-104831", cust: "C3", status: "CONFIRMED", created: -1,
      items: [
        { pid: "P1", ordered: 20, price: 210, allocs: [{ lot: "LOT-2406-A", expDays: 41, qty: 20 }] },
        { pid: "P8", ordered: 12, price: 78, allocs: [{ lot: "LOT-TEA-19", expDays: 18, qty: 12 }] },
      ] },
    { id: "104832", num: "SO-104832", cust: "C4", status: "PACKING", created: -3,
      items: [
        { pid: "P3", ordered: 4, price: 640, allocs: [{ lot: null, expDays: null, qty: 4 }] },
        { pid: "P4", ordered: 30, price: 24.5, allocs: [{ lot: null, expDays: null, qty: 30 }] },
      ] },
    { id: "104833", num: "SO-104833", cust: "C5", status: "READY_TO_SHIP", created: -3,
      items: [{ pid: "P1", ordered: 8, price: 210, allocs: [{ lot: "LOT-2501-B", expDays: 300, qty: 8 }] }] },
    { id: "104834", num: "SO-104834", cust: "C1", status: "SHIPPED", created: -5,
      items: [{ pid: "P4", ordered: 60, price: 24.5, allocs: [{ lot: null, expDays: null, qty: 60 }] }] },
    { id: "104835", num: "SO-104835", cust: "C2", status: "COMPLETED", created: -8,
      items: [{ pid: "P6", ordered: 20, price: 30, allocs: [{ lot: null, expDays: null, qty: 20 }] }] },
    { id: "104836", num: "SO-104836", cust: "C3", status: "CONFIRMED", created: -2, blocked: "expired_allocation",
      items: [{ pid: "P2", ordered: 30, price: 42, allocs: [{ lot: "LOT-2404-EXP", expDays: -9, qty: 18 }, { lot: "LOT-2405-X", expDays: 25, qty: 12 }] }] },
    { id: "104837", num: "SO-104837", cust: "C4", status: "CANCELLED", created: -6,
      items: [{ pid: "P8", ordered: 10, price: 78, allocs: [] }] },
  ],

  pos: [
    { id: "2087", num: "PO-2087", sup: "S1", status: "CONFIRMED", created: -1,
      items: [{ pid: "P1", ordered: 10, price: 190 }], receipts: [] },
    { id: "2088", num: "PO-2088", sup: "S2", status: "DRAFT", created: 0,
      items: [{ pid: "P8", ordered: 24, price: 70 }, { pid: "P2", ordered: 40, price: 36 }], receipts: [] },
    { id: "2089", num: "PO-2089", sup: "S3", status: "PARTIALLY_RECEIVED", created: -4,
      items: [{ pid: "P3", ordered: 40, price: 560 }, { pid: "P4", ordered: 20, price: 21 }],
      receipts: [{ n: 1, at: -2, key: "seed", lines: [{ pid: "P3", qty: 25 }, { pid: "P4", qty: 20 }] }] },
    { id: "2090", num: "PO-2090", sup: "S1", status: "RECEIVED", created: -9,
      items: [{ pid: "P7", ordered: 60, price: 480 }],
      receipts: [{ n: 1, at: -6, key: "seed", lines: [{ pid: "P7", qty: 60 }] }] },
    { id: "2086", num: "PO-2086", sup: "S4", status: "CANCELLED", created: -10,
      items: [{ pid: "P5", ordered: 500, price: 7.5 }], receipts: [] },
  ],

  transfers: [
    { id: "3312", num: "TRF-3312", src: "MAIN", dst: "EAST-HUB", status: "IN_TRANSIT", created: -1,
      items: [{ pid: "P1", qty: 200 }] },
    { id: "3313", num: "TRF-3313", src: "MAIN", dst: "SOUTH-DEPOT", status: "PARTIALLY_RECEIVED", created: -3,
      items: [{ pid: "P4", qty: 200 }] },
    { id: "3314", num: "TRF-3314", src: "EAST-HUB", dst: "MAIN", status: "DRAFT", created: 0,
      items: [{ pid: "P5", qty: 220 }, { pid: "P8", qty: 40 }] },
    { id: "3315", num: "TRF-3315", src: "SOUTH-DEPOT", dst: "MAIN", status: "COMPLETED", created: -7,
      items: [{ pid: "P3", qty: 60 }] },
  ],

  // mutable per-workflow state
  state: {
    pick: { // orderId -> { itemIdx -> qty picked }
      "104832": { 0: 4, 1: 30 },
    },
    pack: { // orderId -> { itemIdx -> qty packed }
      "104832": { 0: 4, 1: 18 },
    },
    trReceived: { // transferId -> { itemIdx -> qty received }
      "3313": { 0: 120 },
      "3315": { 0: 60 },
    },
    trDispatched: {
      "3312": { 0: 200 },
      "3313": { 0: 200 },
      "3315": { 0: 60 },
    },
    poReceived: { // poId -> { pid -> qty }
      "2089": { P3: 25, P4: 20 },
      "2090": { P7: 60 },
    },
  },
};

/* ---------------------------------------------------------------
   3. persistent demo state
--------------------------------------------------------------- */
const DB_KEY = "wc-proto-db-v1";
let DB;
function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    DB = raw ? JSON.parse(raw) : clone(SEED);
  } catch (e) { DB = clone(SEED); }
}
function saveDB() { try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch (e) {} }
function resetDB() {
  try { localStorage.removeItem(DB_KEY); } catch (e) {}
  DB = clone(SEED);
  saveDB();
}
loadDB();

const prod = (id) => DB.products.find((p) => p.id === id);
const custName = (id) => (DB.customers.find((c) => c.id === id) || {}).name || "—";
const supName = (id) => (DB.suppliers.find((s) => s.id === id) || {}).name || "—";

/* ---------------------------------------------------------------
   4. derived product metrics + status meta
--------------------------------------------------------------- */
function pm(p) {
  const expired = (p.batches || []).filter((b) => b.expDays != null && b.expDays < 0).reduce((a, b) => a + b.qty, 0);
  const near = (p.batches || []).filter((b) => b.expDays != null && b.expDays >= 0 && b.expDays <= 90).reduce((a, b) => a + b.qty, 0);
  const available = Math.max(0, p.owned - p.reserved - p.transit - expired);
  let health = "HEALTHY";
  if (expired > 0) health = "EXPIRED";
  else if (available <= p.min) health = "LOW";
  const soonest = (p.batches || []).filter((b) => b.expDays != null).sort((a, b) => a.expDays - b.expDays)[0];
  return { available, expired, near, health, soonest, owned: p.owned, reserved: p.reserved, transit: p.transit };
}

const STATUS = {
  DRAFT: { c: "b-neutral", dot: 1, t: "Draft" },
  CONFIRMED: { c: "b-info", dot: 1, t: "Confirmed" },
  PICKING: { c: "b-info", dot: 1, t: "Picking" },
  PACKING: { c: "b-info", dot: 1, t: "Packing" },
  READY_TO_SHIP: { c: "b-accent", dot: 1, t: "Ready to ship" },
  IN_TRANSIT: { c: "b-accent", dot: 1, t: "In transit" },
  SHIPPED: { c: "b-success", dot: 1, t: "Shipped" },
  PARTIALLY_RECEIVED: { c: "b-warning", dot: 1, t: "Partially received" },
  RECEIVED: { c: "b-success", dot: 1, t: "Received" },
  COMPLETED: { c: "b-success", dot: 1, t: "Completed" },
  CANCELLED: { c: "b-danger", dot: 1, t: "Cancelled" },
};
function statusBadge(s) {
  const m = STATUS[s] || { c: "b-neutral", dot: 1, t: s };
  return `<span class="badge ${m.c}${m.dot ? " dot" : ""}">${esc(m.t)}</span>`;
}
const HEALTH = {
  HEALTHY: { c: "b-success", t: "Healthy" },
  LOW: { c: "b-warning", t: "Low", ic: "alert" },
  EXPIRED: { c: "b-danger", t: "Expired", ic: "clock" },
  NEAR_EXPIRY: { c: "b-warning", t: "Near expiry" },
  TRANSIT: { c: "b-accent", t: "Transit" },
  RESERVED: { c: "b-neutral", t: "Reserved" },
};
function healthBadge(h) {
  const m = HEALTH[h] || HEALTH.HEALTHY;
  return `<span class="badge ${m.c} dot">${esc(m.t)}</span>`;
}
function expiryBadge(soonest) {
  if (!soonest || soonest.expDays == null) return `<span class="chip-inline">no expiry</span>`;
  const d = soonest.expDays;
  if (d < 0) return `<span class="badge b-danger dot">exp ${fmtDate(d)} · ${d}d</span>`;
  if (d <= 90) return `<span class="badge b-warning dot">exp ${fmtDate(d)} · ${d}d</span>`;
  return `<span class="chip-inline">exp ${fmtDate(d)}</span>`;
}

/* ---------------------------------------------------------------
   5. toast + sound + confirm/modal
--------------------------------------------------------------- */
function toast(msg, kind) {
  const wrap = $("#toastWrap");
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  const ic = kind === "err" ? "x" : kind === "warn" ? "alert" : kind === "ok" ? "check" : "bell";
  el.innerHTML = `${icon(ic, 15, "t-ic")}<span>${esc(msg)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 220);
  }, 2600);
}

let soundOn = true;
let AC;
function beep(ok) {
  if (!soundOn) return;
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = "sine";
    o.frequency.value = ok ? 880 : 200;
    g.gain.value = 0.04;
    o.connect(g); g.connect(AC.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + 0.12);
    o.stop(AC.currentTime + 0.13);
  } catch (e) {}
}

function modalClose() { $("#modalOverlay").classList.remove("show"); }
function confirmDialog(opt) {
  const m = $("#modal");
  m.innerHTML = `
    <h3>${esc(opt.title)}</h3>
    <p>${opt.body || ""}</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-mc="cancel">Cancel</button>
      <button class="btn ${opt.danger ? "btn-danger" : "btn-primary"}" data-mc="ok">${esc(opt.confirmLabel || "Confirm")}</button>
    </div>`;
  $("#modalOverlay").classList.add("show");
  m.querySelector('[data-mc="cancel"]').focus();
  m.onclick = (e) => {
    const b = e.target.closest("[data-mc]");
    if (!b) return;
    if (b.dataset.mc === "ok") { modalClose(); opt.onConfirm && opt.onConfirm(); }
    else modalClose();
  };
}

/* ---------------------------------------------------------------
   6. drawer
--------------------------------------------------------------- */
function openDrawer(title, bodyHTML) {
  const d = $("#drawer");
  d.hidden = false;
  d.innerHTML = `
    <div class="drawer-head">
      <div><h3>${esc(title)}</h3></div>
      <button class="icon-btn" data-act="close-drawer" aria-label="Close">${icon("x", 16)}</button>
    </div>
    <div class="drawer-body">${bodyHTML}</div>`;
  requestAnimationFrame(() => {
    d.classList.add("open");
    $("#drawerScrim").classList.add("show");
  });
}
function closeDrawer() {
  $("#drawer").classList.remove("open");
  $("#drawerScrim").classList.remove("show");
  setTimeout(() => { const d = $("#drawer"); if (!d.classList.contains("open")) d.hidden = true; }, 240);
}

/* ---------------------------------------------------------------
   7. router
--------------------------------------------------------------- */
function parseHash() {
  let h = location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  const seg = path.split("/").filter(Boolean);
  const query = {};
  new URLSearchParams(qs || "").forEach((v, k) => (query[k] = v));
  return { name: seg[0] || "dashboard", id: seg[1], query };
}
function navigate(to) { location.hash = to.startsWith("#") ? to : "#/" + to; }

/* mobile navigation ("More") as a single coordinated state:
   MORE_OPEN  => .app.nav-open  => CSS slides the scan dock down
   MORE_CLOSED => class removed => scan dock restored
   Never leaves two bottom surfaces open at once. */
function setNav(open) {
  const app = $("#app");
  if (!app) return;
  app.classList.toggle("nav-open", !!open);
  const scrim = $("#sidebarScrim");
  if (scrim) scrim.classList.toggle("show", !!open);
  const hb = $("#hamburger");
  if (hb) hb.setAttribute("aria-expanded", open ? "true" : "false");
  if (typeof syncDock === "function") syncDock();
}

let afterRender = null;
let keepScrollOnce = false; // set before a render() that must not jump to the top
function mount(html) {
  const c = $("#content");
  const y = keepScrollOnce && c ? c.scrollTop : 0;
  keepScrollOnce = false;
  c.innerHTML = html;
  c.scrollTop = y;
}
function flushAfterRender() {
  if (afterRender) { const f = afterRender; afterRender = null; f(); }
}

const SCREENS = {
  dashboard: renderDashboard,
  products: renderProducts,
  sales: (r) => (r.id ? renderSalesDetail(r.id) : renderSalesList(r)),
  picking: (r) => (r.id ? renderPickConsole(r.id) : renderQueueList("picking")),
  packing: (r) => (r.id ? renderPackConsole(r.id) : renderQueueList("packing")),
  "purchase-orders": (r) => (r.id ? renderPODetail(r.id) : renderPOList(r)),
  transfers: (r) => (r.id ? renderTransferDetail(r.id) : renderTransferList(r)),
  customers: () => renderParties("customers"),
  suppliers: () => renderParties("suppliers"),
  reports: renderReports,
};

function render() {
  const r = parseHash();
  closeDrawer();
  const fn = SCREENS[r.name] || renderDashboard;
  fn(r);
  paintShell(r.name);
  flushAfterRender(); // run the just-rendered screen's afterRender hook now, every time
}
window.addEventListener("hashchange", render);

/* ---------------------------------------------------------------
   8. shell: sidebar / bottom nav / topbar
--------------------------------------------------------------- */
const NAV = [
  { k: "dashboard", ic: "dashboard", label: "Dashboard", to: "#/dashboard" },
  { k: "products", ic: "box", label: "Products", to: "#/products" },
  { k: "stock", ic: "layers", label: "Stock", to: "#/products?tab=all" },
  { k: "sales", ic: "cart", label: "Sales", to: "#/sales" },
  { k: "picking", ic: "search", label: "Picking", to: "#/picking" },
  { k: "packing", ic: "pack", label: "Packing", to: "#/packing" },
  { k: "purchase-orders", ic: "poIcon", label: "Purchase Orders", to: "#/purchase-orders" },
  { k: "transfers", ic: "transfer", label: "Transfers", to: "#/transfers" },
  { k: "customers", ic: "users", label: "Customers", to: "#/customers" },
  { k: "suppliers", ic: "factory", label: "Suppliers", to: "#/suppliers" },
  { k: "reports", ic: "report", label: "Reports", to: "#/reports" },
];

function navCounts() {
  const sc = (s) => DB.sales.filter((o) => o.status === s).length;
  return {
    sales: DB.sales.filter((o) => ["DRAFT", "CONFIRMED"].includes(o.status)).length,
    picking: sc("PICKING"),
    packing: sc("PACKING"),
    "purchase-orders": DB.pos.filter((p) => ["CONFIRMED", "PARTIALLY_RECEIVED"].includes(p.status)).length,
    transfers: DB.transfers.filter((t) => ["IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(t.status)).length,
  };
}

function paintShell(active) {
  const counts = navCounts();
  const activeKey = active === "stock" ? "products" : active;
  $("#sidebar").innerHTML =
    `<button class="sidebar-search" data-act="palette" aria-label="Search products, orders, lots — opens the command palette">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <span>Search products, orders, lots&hellip;</span>
    </button>
    <div class="sidebar-menu-label">Menu</div>` +
    NAV.map((n) => {
      const on = n.k === activeKey || (activeKey === "products" && n.k === "products");
      const badge = counts[n.k] ? `<span class="nav-badge">${counts[n.k]}</span>` : "";
      return `<button class="nav-item${on ? " active" : ""}" data-act="nav" data-to="${n.to}" ${on ? 'aria-current="page"' : ""}>
        ${icon(n.ic, 16, "ic")}<span class="lbl">${n.label}</span>${badge}</button>`;
    }).join("") +
    `<div class="sidebar-foot">
      <button class="nav-item" data-act="sidebar-toggle">${icon("panelLeft", 16, "ic")}<span class="lbl">Collapse</span></button>
      <button class="nav-item" data-act="reset-demo">${icon("refresh", 16, "ic")}<span class="lbl">Reset demo</span></button>
    </div>`;

  const bn = [
    { k: "dashboard", ic: "dashboard", t: "Home", to: "#/dashboard" },
    { k: "products", ic: "box", t: "Stock", to: "#/products" },
    { k: "sales", ic: "cart", t: "Sales", to: "#/sales" },
    { k: "picking", ic: "scan", t: "Pick", to: "#/picking" },
    { k: "more", ic: "dots", t: "More", to: "#more" },
  ];
  $("#bottomNav").innerHTML = bn.map((n) =>
    `<button data-act="${n.k === "more" ? "open-nav" : "nav"}" data-to="${n.to}" class="${n.k === activeKey ? "active" : ""}">
      ${icon(n.ic, 19, "ic")}<span>${n.t}</span></button>`).join("");
}

/* ---------------------------------------------------------------
   9. generic list table (desktop table / mobile cards)
--------------------------------------------------------------- */
/* card composition (instead of squeezed tables) for phones AND iPad portrait;
   iPad landscape (>=1024) and desktop keep tables */
function isMobile() { return matchMedia("(max-width: 1023.98px)").matches; }

/* keep the Pick/Pack work list clear of the fixed mobile scan dock so the last
   line and its +/- controls are never hidden. On desktop / iPad landscape the
   dock is a sticky side panel and needs no list padding. */
function syncDock() {
  requestAnimationFrame(() => {
    const side = document.querySelector(".work-side");
    const main = document.querySelector(".work-main");
    if (!side || !main) return;
    if (getComputedStyle(side).position !== "fixed") { main.style.paddingBottom = ""; return; }
    const phone = matchMedia("(max-width:767.98px)").matches;
    const kb = document.documentElement.classList.contains("kb");
    const navH = phone && !kb ? 58 : 0; // bottom nav clearance on phones
    main.style.paddingBottom = (side.offsetHeight + navH + 20) + "px";
  });
}

/* iOS software keyboard: keep the fixed scan dock sitting just above the keyboard
   (visualViewport shrinks; position:fixed;bottom:0 would otherwise hide behind it) */
function trackKeyboardInset() {
  const vv = window.visualViewport;
  if (!vv) return;
  const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  document.documentElement.style.setProperty("--kb-inset", inset + "px");
  syncDock();
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", trackKeyboardInset);
  window.visualViewport.addEventListener("scroll", trackKeyboardInset);
}
window.addEventListener("resize", syncDock);

function listView(cfg) {
  // cfg: { columns:[{key,label,align,cell(row),sortable,sortVal(row)}], rows, onRow(row)->to, cardTitle, cardMeta, sortState }
  if (isMobile() && cfg.card) {
    if (!cfg.rows.length) return emptyState(cfg.empty);
    return `<div class="card-list">${cfg.rows.map((row) => {
      const c = cfg.card(row);
      return `<div class="entity-card" data-act="row" data-to="${cfg.onRow(row)}">
        <div class="ec-top"><div class="ec-title">${c.title}</div>${c.badge || ""}</div>
        <div class="ec-meta">${c.meta}</div></div>`;
    }).join("")}</div>`;
  }
  if (!cfg.rows.length) return emptyState(cfg.empty);
  const s = screenSort();
  const head = cfg.columns.map((col) => {
    const sortable = col.sortable !== false && col.sortVal;
    const sorted = s.key === col.key;
    const arrow = sorted ? (s.dir === "asc" ? "↑" : "↓") : "↕";
    const aria = sorted ? (s.dir === "asc" ? "ascending" : "descending") : "none";
    return `<th class="${col.align === "right" ? "num" : ""} ${sortable ? "sortable" : ""} ${sorted ? "sorted" : ""}"
      ${sortable ? `data-act="sort" data-col="${col.key}" tabindex="0" role="button" aria-sort="${aria}"` : ""}>${col.label}${sortable ? `<span class="arrow">${arrow}</span>` : ""}</th>`;
  }).join("");
  let rows = cfg.rows.slice();
  if (s.key) {
    const col = cfg.columns.find((c) => c.key === s.key);
    if (col && col.sortVal) rows.sort((a, b) => {
      const va = col.sortVal(a), vb = col.sortVal(b);
      const r = va < vb ? -1 : va > vb ? 1 : 0;
      return s.dir === "asc" ? r : -r;
    });
  }
  const body = rows.map((row) =>
    `<tr data-act="row" data-to="${cfg.onRow(row)}">${cfg.columns.map((col) =>
      `<td class="${col.align === "right" ? "num" : ""}">${col.cell(row)}</td>`).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table class="dt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function emptyState(txt) {
  return `<div class="state-block card">${icon("inbox", 34, "sb-ic")}
    <h3>Nothing here yet</h3><p>${esc(txt || "No records match the current filter.")}</p></div>`;
}

/* sort state is kept per screen (keyed by route name), so sorting one list
   never affects another. Three-state cycle per column:
   DEFAULT (screen's own row order) -> DESC -> ASC -> DEFAULT -> ... */
const sortStates = {};
function screenSort() { return sortStates[parseHash().name] || {}; }
function setSort(col) {
  const scr = parseHash().name;
  const st = sortStates[scr] || {};
  if (st.key !== col) sortStates[scr] = { key: col, dir: "desc" };
  else if (st.dir === "desc") sortStates[scr] = { key: col, dir: "asc" };
  else sortStates[scr] = {}; // third activation returns to the default ordering
  const c = $("#content");
  const y = c ? c.scrollTop : 0;
  const keptFocus = document.activeElement && document.activeElement.closest
    && document.activeElement.closest('th[data-act="sort"]');
  keepScrollOnce = true;
  render();
  const c2 = $("#content");
  if (c2) c2.scrollTop = y;
  // keep keyboard users on the same header so the three-state cycle can continue
  if (keptFocus) {
    const th2 = document.querySelector(`th[data-act="sort"][data-col="${col}"]`);
    if (th2) th2.focus();
  }
}

/* ---------------------------------------------------------------
   10. SCREENS
--------------------------------------------------------------- */

/* ---- Dashboard ---- */
function renderDashboard() {
  /* KPI totals derive only from product stock, so they stay visible even
     when there are no orders / receipts / transfers. */
  const tot = DB.products.reduce((a, p) => {
    const m = pm(p);
    a.owned += p.owned; a.avail += m.available; a.res += p.reserved; a.tr += p.transit;
    a.exp += m.expired; a.near += m.near;
    return a;
  }, { owned: 0, avail: 0, res: 0, tr: 0, exp: 0, near: 0 });

  const sc = (s) => DB.sales.filter((o) => o.status === s).length;
  const poRecv = DB.pos.filter((p) => ["CONFIRMED", "PARTIALLY_RECEIVED"].includes(p.status)).length;
  const trOpen = DB.transfers.filter((t) => ["IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(t.status)).length;

  // attention filters — rules unchanged from the previous dashboard
  const lowP = DB.products.filter((p) => pm(p).health === "LOW");
  const nearP = DB.products.filter((p) => { const m = pm(p); return m.near > 0 && m.expired === 0; });
  const blocked = DB.sales.filter((o) => o.blocked);

  // ---- KPI cards ----
  const tile = (k, v, to, cls, sub) =>
    `<button class="metric ${cls || ""}" data-act="nav" data-to="${to}">
      <div class="k">${k}</div><div class="v">${fmtQty(v)}</div>${sub ? `<div class="d muted">${sub}</div>` : ""}</button>`;

  // ---- Operational queues (single actionable list panel) ----
  const qRow = (ic, name, desc, count, to) =>
    `<button class="q-row" data-act="nav" data-to="${to}">
      <span class="q-ic">${icon(ic, 16)}</span>
      <span class="q-body"><span class="q-name">${name}</span><span class="q-desc">${desc}</span></span>
      <span class="q-count">${count}</span>
      <span class="q-chev">${icon("chevR", 15)}</span>
    </button>`;
  const queueActive = sc("PICKING") + sc("PACKING") + sc("READY_TO_SHIP") + poRecv + trOpen;

  // ---- Needs attention (narrow companion panel) ----
  const attnRow = (mod, name, fig, sub, to) =>
    `<button class="attn-row ${mod}" data-act="nav" data-to="${to}">
      <span class="attn-body"><span class="attn-name">${name}</span><span class="attn-sub">${sub}</span></span>
      <span class="attn-fig">${fig}</span>
      <span class="q-chev">${icon("chevR", 15)}</span>
    </button>`;
  const sale = (n) => (n === 1 ? "sale" : "sales");

  /* ---- Inventory condition: four mutually-exclusive slices of Owned ----
     available = owned - reserved - transit - expired  (see pm()).
     Near-expiry units are a SUBSET of Available, so they are shown as an
     overlay statistic, never a fifth stacked segment. */
  const condParts = [["s-avail", tot.avail], ["s-res", tot.res], ["s-tr", tot.tr], ["s-exp", tot.exp]];
  const condSum = condParts.reduce((n, s) => n + s[1], 0);
  const condDenom = condSum || 1;
  const condReconciles = condSum === tot.owned; // verified before we phrase it as "= Owned"
  const condBar = condParts
    .map(([cls, v]) => (v > 0 ? `<span class="${cls}" style="width:${(v / condDenom * 100).toFixed(1)}%"></span>` : ""))
    .join("");

  // ---- Recent activity (cross-entity feed, unchanged) ----
  const events = [];
  DB.sales.filter((o) => o.status !== "DRAFT").forEach((o) =>
    events.push({ w: o.created, ic: "cart", t: `${o.num} · ${STATUS[o.status].t}`, s: custName(o.cust), to: `#/sales/${o.id}` }));
  DB.pos.forEach((p) => p.receipts.forEach((rc) =>
    events.push({ w: rc.at === "seed" ? -6 : rc.at, ic: "poIcon",
      t: `${p.num} · Receipt #${rc.n}`,
      s: `${supName(p.sup)} · +${fmtQty(rc.lines.reduce((n, l) => n + l.qty, 0))}`,
      to: `#/purchase-orders/${p.id}` })));
  DB.pos.filter((p) => p.status === "CONFIRMED").forEach((p) =>
    events.push({ w: p.created, ic: "poIcon", t: `${p.num} · Confirmed`, s: supName(p.sup), to: `#/purchase-orders/${p.id}` }));
  DB.transfers.filter((t) => t.status !== "DRAFT").forEach((t) =>
    events.push({ w: t.created, ic: "transfer", t: `${t.num} · ${STATUS[t.status].t}`, s: `${WH[t.src]} → ${WH[t.dst]}`, to: `#/transfers/${t.id}` }));
  events.sort((a, b) => b.w - a.w);
  const laRows = events.slice(0, 10).map((e) =>
    `<button class="la-row" data-act="nav" data-to="${e.to}">
      <span class="la-when">${ago(e.w)}</span>
      <span class="la-ic">${icon(e.ic, 13)}</span>
      <span class="la-text"><span class="la-title">${esc(e.t)}</span><span class="la-sub">${esc(e.s)}</span></span>
    </button>`).join("");

  // ---- Today's summary (counts; 0 is valid) ----
  const workSummary = [
    ["Orders confirmed", sc("CONFIRMED")],
    ["In picking", sc("PICKING")],
    ["In packing", sc("PACKING")],
    ["Ready to ship", sc("READY_TO_SHIP")],
    ["Shipped", sc("SHIPPED")],
    ["PO receipts logged", DB.pos.reduce((n, p) => n + p.receipts.length, 0)],
    ["Transfers in transit", DB.transfers.filter((t) => t.status === "IN_TRANSIT").length],
    ["Blocked sales", blocked.length],
  ];

  mount(`
    <div class="dashboard-page">
      <div class="page-header">
        <div><div class="page-title">Dashboard</div>
        <div class="page-sub">Operational overview · as of ${isoDate(TODAY)} · business time UTC+7</div></div>
        <div class="page-actions">
          <button class="btn btn-secondary" data-act="reset-demo">${icon("refresh", 15, "ic")}Reset demo</button>
          <button class="btn btn-primary" data-act="palette">${icon("plus", 15, "ic")}Quick action</button>
        </div>
      </div>

      <section class="kpi-zone">
        <button class="metric kpi-hero" data-act="nav" data-to="#/products?tab=all">
          <div class="k">Operational available</div>
          <div class="v">${fmtQty(tot.avail)}</div>
          <div class="d">of ${fmtQty(tot.owned)} owned</div>
        </button>
        <div class="kpi-rest">
          ${tile("Owned", tot.owned, "#/products?tab=all", "")}
          ${tile("Reserved", tot.res, "#/products?tab=all", "")}
          ${tile("In transit", tot.tr, "#/products?tab=transit", "", trOpen + " transfers open")}
          ${tile("Expired", tot.exp, "#/products?tab=expired", "alert", "blocks " + blocked.length + " " + sale(blocked.length))}
          ${tile("Near expiry", tot.near, "#/products?tab=near", "warn", "within 90 days")}
        </div>
      </section>

      <section class="work-zone">
        <section class="panel queues-panel">
          <div class="panel-head"><h3>Operational queues</h3><span class="pct">${queueActive} active</span></div>
          <div class="q-list">
            ${qRow("search", "Picking", "orders being picked", sc("PICKING"), "#/picking")}
            ${qRow("pack", "Packing", "orders being verified", sc("PACKING"), "#/packing")}
            ${qRow("truck", "Ready to ship", "awaiting dispatch", sc("READY_TO_SHIP"), "#/sales?status=READY_TO_SHIP")}
            ${qRow("poIcon", "PO receiving", "purchase orders inbound", poRecv, "#/purchase-orders?status=receiving")}
            ${qRow("transfer", "Transfers", "in transit / partial", trOpen, "#/transfers?status=open")}
          </div>
        </section>

        <section class="panel attention-panel">
          <div class="panel-head"><h3>Needs attention</h3></div>
          <div class="attn-list">
            ${attnRow(lowP.length ? "" : "is-ok", "Low stock",
              `${lowP.length} ${lowP.length === 1 ? "SKU" : "SKUs"}`,
              lowP.length ? esc(lowP[0].name) + (lowP.length > 1 ? " +" + (lowP.length - 1) + " more" : "") : "all above reorder point",
              "#/products?tab=low")}
            ${attnRow(tot.exp > 0 ? "is-danger" : "is-ok", "Expired inventory",
              fmtQty(tot.exp),
              tot.exp > 0 ? `units · blocks ${blocked.length} ${sale(blocked.length)}` : "none expired",
              "#/products?tab=expired")}
            ${attnRow(tot.near > 0 ? "" : "is-ok", "Near expiry",
              fmtQty(tot.near),
              tot.near > 0 ? "units · subset of available, ≤ 90 days" : "none within 90 days",
              "#/products?tab=near")}
            ${attnRow(blocked.length ? "is-accent" : "is-ok", "Blocked sales",
              `${blocked.length} ${blocked.length === 1 ? "order" : "orders"}`,
              blocked.length ? esc(blocked[0].num) + " · " + esc(custName(blocked[0].cust)) : "no blocked orders",
              "#/sales?status=blocked")}
          </div>
        </section>
      </section>

      <section class="lower-zone">
        <section class="panel activity-panel">
          <div class="panel-head"><h3>Recent activity</h3><span class="pct">${events.length} total</span></div>
          <div class="la-list">${laRows || '<div class="mini-empty">No sales, purchase or transfer activity yet.</div>'}</div>
        </section>

        <section class="panel condition-card">
          <div class="panel-head"><h3>Inventory condition</h3><span class="pct">${fmtQty(tot.owned)} owned</span></div>
          <div class="panel-body">
            ${tot.owned > 0 ? `
            <div class="stacked">${condBar}</div>
            <div class="stacked-legend">
              <span><i class="s-avail"></i>Available ${fmtQty(tot.avail)}</span>
              <span><i class="s-res"></i>Reserved ${fmtQty(tot.res)}</span>
              <span><i class="s-tr"></i>In transit ${fmtQty(tot.tr)}</span>
              <span><i class="s-exp"></i>Expired ${fmtQty(tot.exp)}</span>
            </div>
            <div class="cond-recon muted">${condReconciles
              ? `Available + Reserved + In transit + Expired = ${fmtQty(condSum)} = Owned.`
              : `Segments shown sum to ${fmtQty(condSum)} of ${fmtQty(tot.owned)} owned.`}</div>
            <div class="cond-near" title="Near-expiry units are part of Available, not a separate slice">Near expiry ${fmtQty(tot.near)} · overlay</div>
            ` : `<div class="mini-empty">No stock on record.</div>`}
          </div>
        </section>

        <section class="panel summary-card">
          <div class="panel-head"><h3>Today’s summary</h3></div>
          <div class="panel-body">
            <div class="sum-list">
              ${workSummary.map(([k, v]) => `<div class="sum-row"><span>${esc(k)}</span><b>${v}</b></div>`).join("")}
            </div>
          </div>
        </section>
      </section>
    </div>
  `);
}

/* ---- Products / Stock ---- */
function renderProducts(r) {
  const tab = r.query.tab || "all";
  const q = (r.query.q || "").toLowerCase();
  const tabs = [
    ["all", "All"], ["low", "Low"], ["near", "Near expiry"], ["expired", "Expired"], ["transit", "In transit"],
  ];
  let rows = DB.products.map((p) => ({ p, m: pm(p) }));
  if (tab === "low") rows = rows.filter((x) => x.m.health === "LOW");
  if (tab === "near") rows = rows.filter((x) => x.m.near > 0 && x.m.expired === 0);
  if (tab === "expired") rows = rows.filter((x) => x.m.expired > 0);
  if (tab === "transit") rows = rows.filter((x) => x.p.transit > 0);
  if (q) rows = rows.filter((x) => (x.p.sku + " " + x.p.name + " " + x.p.barcode + " " + x.p.cat).toLowerCase().includes(q));

  const table = listView({
    columns: [
      { key: "sku", label: "SKU", sortable: false, cell: (x) => `<span class="sku">${x.p.sku}</span>` },
      { key: "name", label: "Product", sortVal: (x) => x.p.name.toLowerCase(), cell: (x) => `<div>${esc(x.p.name)}</div><div class="faint" style="font-size:11px">${x.p.trackBatch ? "batch" : "non-batch"}${x.p.trackExpiry ? " · expiry" : ""}</div>` },
      { key: "cat", label: "Category", sortVal: (x) => x.p.cat, cell: (x) => `<span class="muted">${x.p.cat}</span>` },
      { key: "avail", label: "Available", align: "right", sortVal: (x) => x.m.available, cell: (x) => qtyHTML(x.m.available) },
      { key: "owned", label: "Owned", align: "right", sortVal: (x) => x.p.owned, cell: (x) => qtyHTML(x.p.owned) },
      { key: "res", label: "Reserved", align: "right", sortVal: (x) => x.p.reserved, cell: (x) => x.p.reserved ? qtyHTML(x.p.reserved) : `<span class="faint">—</span>` },
      { key: "tr", label: "Transit", align: "right", sortVal: (x) => x.p.transit, cell: (x) => x.p.transit ? `<span class="badge b-accent dot">${fmtQty(x.p.transit)}</span>` : `<span class="faint">—</span>` },
      { key: "exp", label: "Expiry", sortable: false, cell: (x) => expiryBadge(x.m.soonest) },
      { key: "health", label: "Health", sortable: false, cell: (x) => healthBadge(x.m.health) },
    ],
    rows,
    onRow: (x) => `#drawer:product:${x.p.id}`,
    empty: "No products in this view.",
    card: (x) => ({
      title: esc(x.p.name),
      badge: healthBadge(x.m.health),
      meta: `<span class="sku">${x.p.sku}</span>
        <span>Avail <b>${fmtQty(x.m.available)}</b></span>
        <span>Owned <b>${fmtQty(x.p.owned)}</b></span>
        ${x.p.transit ? `<span>Transit <b>${fmtQty(x.p.transit)}</b></span>` : ""}
        ${x.m.soonest ? `<span>${expiryBadge(x.m.soonest)}</span>` : ""}`,
    }),
  });

  mount(`
    <div class="page-header">
      <div><div class="page-title">Products &amp; Stock</div>
      <div class="page-sub">${DB.products.length} products · quantities at fixed 2-decimal precision</div></div>
      <div class="page-actions">
        <button class="btn btn-secondary" data-act="toast" data-msg="Prototype: Stock in form opens here in Phase 1.">${icon("arrowDown", 15, "ic")}Stock in</button>
        <button class="btn btn-primary" data-act="toast" data-msg="Prototype: Create product opens here in Phase 1.">${icon("plus", 15, "ic")}New product</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="seg">${tabs.map(([k, l]) =>
        `<button class="${k === tab ? "on" : ""}" data-act="ptab" data-tab="${k}">${l}</button>`).join("")}</div>
      <div class="search-box">${icon("search", 14)}
        <input type="text" placeholder="SKU, name, barcode…" value="${esc(r.query.q || "")}" data-act="psearch" aria-label="Search products">
      </div>
      <span class="spacer"></span>
      <span class="pct">${rows.length} shown</span>
    </div>
    ${table}
    <div class="pager"><span>Page 1 of 1 · ${rows.length} of ${DB.products.length}</span>
      <div class="grp"><button class="btn btn-ghost" disabled>Prev</button><button class="btn btn-ghost" disabled>Next</button></div></div>
  `);
}

function productDrawer(id) {
  const p = prod(id); if (!p) return;
  const m = pm(p);
  const seg = (v, col) => v > 0 ? `<span style="width:${(v / Math.max(p.owned, 1) * 100).toFixed(1)}%;background:${col}"></span>` : "";
  openDrawer(p.name, `
    <div>
      <div class="row" style="justify-content:space-between">
        <span class="sku">${p.sku}</span>${healthBadge(m.health)}
      </div>
      <div class="faint" style="font-size:11px;margin-top:4px">barcode ${p.barcode} · ${p.cat} · ${p.trackBatch ? "batch tracked" : "non-batch"}${p.trackExpiry ? " · expiry tracked" : ""}</div>
    </div>
    <div>
      <div class="section-label" style="margin:0 0 6px">Inventory breakdown</div>
      <dl class="kv">
        <dt>Owned</dt><dd>${fmtQty(p.owned)}</dd>
        <dt>Operational available</dt><dd>${fmtQty(m.available)}</dd>
        <dt>Reserved</dt><dd>${fmtQty(p.reserved)}</dd>
        <dt>In transit</dt><dd>${fmtQty(p.transit)}</dd>
        <dt>Expired</dt><dd>${fmtQty(m.expired)}</dd>
        <dt>Near expiry</dt><dd>${fmtQty(m.near)}</dd>
      </dl>
      <div class="mini-stack">
        ${seg(m.available, "var(--success)")}${seg(p.reserved, "var(--faint)")}${seg(p.transit, "var(--accent)")}${seg(m.expired, "var(--danger)")}
      </div>
    </div>
    <div>
      <div class="section-label" style="margin:0 0 6px">Batches / lots</div>
      ${(p.batches || []).length ? `<div class="table-wrap"><table class="dt"><thead><tr><th>Lot</th><th class="num">Qty</th><th>Expiry</th></tr></thead><tbody>
        ${p.batches.map((b) => `<tr style="cursor:default"><td class="sku">${b.lot}</td><td class="num">${fmtQty(b.qty)}</td><td>${b.expDays == null ? '<span class="faint">—</span>' : expiryBadge(b)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="muted" style="font-size:12px">Non-batch product — no lots.</div>`}
    </div>
    <div>
      <div class="section-label" style="margin:0 0 6px">Location summary</div>
      <dl class="kv">
        ${p.locs.map((l) => `<dt>${l.wh === "TRANSIT" ? '<span class="badge b-accent dot">Transit</span>' : WH[l.wh] + " · " + l.loc}</dt><dd>${fmtQty(l.qty)}</dd>`).join("")}
      </dl>
    </div>
    <div class="row">
      <button class="btn btn-secondary btn-block" data-act="toast" data-msg="Prototype: full product page in Phase 1.">Open full page</button>
    </div>
  `);
}

/* ---- Sales list ---- */
function renderSalesList(r) {
  const st = r.query.status || "all";
  const map = { all: null, DRAFT: "DRAFT", CONFIRMED: "CONFIRMED", PICKING: "PICKING", PACKING: "PACKING", READY_TO_SHIP: "READY_TO_SHIP", SHIPPED: "SHIPPED", COMPLETED: "COMPLETED", CANCELLED: "CANCELLED" };
  let rows = DB.sales.slice();
  if (st === "blocked") rows = rows.filter((o) => o.blocked);
  else if (map[st]) rows = rows.filter((o) => o.status === st);

  const tabs = [["all", "All"], ["DRAFT", "Draft"], ["CONFIRMED", "Confirmed"], ["PICKING", "Picking"], ["PACKING", "Packing"], ["READY_TO_SHIP", "Ready"], ["SHIPPED", "Shipped"], ["COMPLETED", "Completed"], ["CANCELLED", "Cancelled"]];

  const table = listView({
    columns: [
      { key: "num", label: "Order", sortVal: (o) => o.num, cell: (o) => `<span class="mono">${o.num}</span>${o.blocked ? ` ${icon("alert", 12)}` : ""}` },
      { key: "cust", label: "Customer", sortVal: (o) => custName(o.cust), cell: (o) => esc(custName(o.cust)) },
      { key: "items", label: "Lines", align: "right", sortVal: (o) => o.items.length, cell: (o) => o.items.length },
      { key: "qty", label: "Qty", align: "right", sortVal: (o) => soQty(o), cell: (o) => qtyHTML(soQty(o)) },
      { key: "amt", label: "Amount", align: "right", sortVal: (o) => soAmt(o), cell: (o) => `<span class="money">${fmtMoney(soAmt(o))}</span>` },
      { key: "prog", label: "Progress", sortable: false, cell: (o) => soProgress(o) },
      { key: "status", label: "Status", sortable: false, cell: (o) => statusBadge(o.status) },
    ],
    rows,
    onRow: (o) => `#/sales/${o.id}`,
    empty: "No sales orders in this view.",
    card: (o) => ({
      title: `<span class="mono">${o.num}</span>`,
      badge: statusBadge(o.status),
      meta: `<span>${esc(custName(o.cust))}</span><span>${o.items.length} lines</span>
        <span>Qty <b>${fmtQty(soQty(o))}</b></span><span>${fmtMoney(soAmt(o))}</span>`,
    }),
  });

  mount(`
    <div class="page-header">
      <div><div class="page-title">Sales orders</div><div class="page-sub">DRAFT → CONFIRMED → PICKING → PACKING → READY → SHIPPED → COMPLETED</div></div>
      <div class="page-actions"><button class="btn btn-primary" data-act="toast" data-msg="Prototype: New sales order form in Phase 1.">${icon("plus", 15, "ic")}New sales order</button></div>
    </div>
    <div class="toolbar">
      <div class="seg">${tabs.map(([k, l]) => {
        const c = k === "all" ? DB.sales.length : DB.sales.filter((o) => o.status === k).length;
        return `<button class="${k === st ? "on" : ""}" data-act="stab" data-status="${k}">${l}<span class="c">${c}</span></button>`;
      }).join("")}</div>
    </div>
    ${st === "blocked" ? `<div class="attention-card accent" style="margin-bottom:12px;cursor:default"><div class="ac-h"><span class="ac-t">Blocked by expired allocation</span></div><ul><li class="muted">These orders cannot ship until re-allocated to an eligible lot.</li></ul></div>` : ""}
    ${table}
  `);
}
const soQty = (o) => o.items.reduce((a, i) => a + i.ordered, 0);
const soAmt = (o) => o.items.reduce((a, i) => a + i.ordered * i.price, 0);
function soProgress(o) {
  const total = soQty(o);
  const pk = Object.values(DB.state.pick[o.id] || {}).reduce((a, b) => a + b, 0);
  const pc = Object.values(DB.state.pack[o.id] || {}).reduce((a, b) => a + b, 0);
  if (["DRAFT", "CONFIRMED", "CANCELLED"].includes(o.status)) return `<span class="faint" style="font-size:11px">—</span>`;
  return `<div class="progress two" style="width:90px"><span class="p1" style="width:${pct(pc, total)}%"></span><span class="p2" style="width:${Math.max(0, pct(pk, total) - pct(pc, total))}%"></span></div>
    <span class="pct">pick ${pct(pk, total)}% · pack ${pct(pc, total)}%</span>`;
}

/* ---- Sales detail ---- */
const SO_FLOW = ["DRAFT", "CONFIRMED", "PICKING", "PACKING", "READY_TO_SHIP", "SHIPPED", "COMPLETED"];
function renderSalesDetail(id) {
  const o = DB.sales.find((s) => s.id === id);
  if (!o) return mount(errorScreen("Sales order not found"));
  const cancelled = o.status === "CANCELLED";
  const idx = SO_FLOW.indexOf(o.status);
  const tl = cancelled
    ? `<div class="timeline">${SO_FLOW.slice(0, 2).map((s, i) => `<div class="tl-node done"><span class="ring">${icon("check", 12)}</span><span class="lbl">${STATUS[s].t}</span></div>${i < 1 ? '<span class="tl-seg done"></span>' : ""}`).join("")}<span class="tl-seg"></span><div class="tl-node cancel"><span class="ring">${icon("x", 12)}</span><span class="lbl">Cancelled</span></div></div>`
    : `<div class="timeline">${SO_FLOW.map((s, i) => {
        const cls = i < idx ? "done" : i === idx ? "curr" : "";
        return `<div class="tl-node ${cls}"><span class="ring">${i < idx ? icon("check", 12) : ""}</span><span class="lbl">${STATUS[s].t}</span></div>${i < SO_FLOW.length - 1 ? `<span class="tl-seg ${i < idx ? "done" : ""}"></span>` : ""}`;
      }).join("")}</div>`;

  const total = soQty(o);
  const pickMap = DB.state.pick[o.id] || {};
  const packMap = DB.state.pack[o.id] || {};

  const itemsTable = `<div class="table-wrap"><table class="dt"><thead><tr>
      <th>Product</th><th>Lot / expiry</th><th class="num">Ordered</th><th class="num">Picked</th><th class="num">Packed</th><th class="num">Line total</th></tr></thead><tbody>
    ${o.items.map((it, i) => {
      const p = prod(it.pid);
      const allocTxt = it.allocs.length
        ? it.allocs.map((a) => a.lot ? `<span class="sku">${a.lot}</span> ${a.expDays != null ? (a.expDays < 0 ? `<span class="badge b-danger dot">${a.expDays}d</span>` : a.expDays <= 90 ? `<span class="badge b-warning dot">${a.expDays}d</span>` : "") : ""}` : '<span class="faint">non-batch</span>').join("<br>")
        : '<span class="faint">not allocated</span>';
      return `<tr style="cursor:default"><td>${esc(p.name)}<div class="sku">${p.sku}</div></td>
        <td>${allocTxt}</td>
        <td class="num">${fmtQty(it.ordered)}</td>
        <td class="num">${fmtQty(pickMap[i] || 0)}</td>
        <td class="num">${fmtQty(packMap[i] || 0)}</td>
        <td class="num money">${fmtMoney(it.ordered * it.price)}</td></tr>`;
    }).join("")}
    </tbody></table></div>`;

  // available actions gated by status
  const acts = soActions(o);

  const activity = [
    { w: "now", t: `Order at ${STATUS[o.status].t}`, who: "system" },
    o.status !== "DRAFT" ? { w: "-1d", t: "Order confirmed", who: "A. Thanawat" } : null,
    ["PICKING", "PACKING", "READY_TO_SHIP", "SHIPPED", "COMPLETED"].includes(o.status) ? { w: "-1d", t: "Picking started", who: "T. Areeya" } : null,
    ["PACKING", "READY_TO_SHIP", "SHIPPED", "COMPLETED"].includes(o.status) ? { w: "-6h", t: "Picking complete", who: "T. Areeya" } : null,
    ["SHIPPED", "COMPLETED"].includes(o.status) ? { w: "-2h", t: "Shipment created", who: "K. Somsak" } : null,
  ].filter(Boolean);

  mount(`
    <div class="breadcrumb"><button data-act="nav" data-to="#/sales">Sales</button>${icon("chevR", 12)}<span>${o.num}</span></div>
    <div class="page-header">
      <div><div class="page-title">${o.num} ${statusBadge(o.status)}</div>
        <div class="page-sub">${esc(custName(o.cust))} · ${o.items.length} lines · ${fmtMoney(soAmt(o))} · created ${fmtDate(o.created)}</div></div>
      <div class="page-actions">${acts}</div>
    </div>
    ${o.blocked ? `<div class="attention-card accent" style="margin-bottom:14px;cursor:default"><div class="ac-h"><span class="ac-t">${icon("alert", 13)} Blocked — expired allocation</span></div><ul><li class="muted">Allocation on <span class="mono">LOT-2404-EXP</span> expired ${fmtDate(-9)}. Re-allocate to an eligible lot before shipping.</li></ul></div>` : ""}

    <section class="panel" style="margin-bottom:14px"><div class="panel-body">${tl}</div></section>

    <div class="detail-grid">
      <div>
        <div class="section-label" style="margin-top:0">Items &amp; allocations</div>
        ${itemsTable}
      </div>
      <div>
        <div class="section-label" style="margin-top:0">Fulfilment</div>
        <div class="card" style="padding:14px">
          <div class="between"><span class="muted" style="font-size:12px">Picked</span><span class="pct">${pct(Object.values(pickMap).reduce((a, b) => a + b, 0), total)}%</span></div>
          <div class="progress" style="margin:6px 0 12px"><i style="width:${pct(Object.values(pickMap).reduce((a, b) => a + b, 0), total)}%"></i></div>
          <div class="between"><span class="muted" style="font-size:12px">Packed</span><span class="pct">${pct(Object.values(packMap).reduce((a, b) => a + b, 0), total)}%</span></div>
          <div class="progress" style="margin:6px 0 0"><i style="width:${pct(Object.values(packMap).reduce((a, b) => a + b, 0), total)}%"></i></div>
        </div>
        <div class="section-label">Activity</div>
        <div class="card" style="padding:6px 14px">
          <div class="activity">${activity.map((a) => `<div class="activity-item"><span class="a-when">${a.w}</span><span>${esc(a.t)}<br><span class="a-who">${a.who}</span></span></div>`).join("")}</div>
        </div>
      </div>
    </div>
  `);
}

function soActions(o) {
  // returns action buttons; invalid transitions are rendered disabled with a reason
  const B = (label, act, opt = {}) =>
    `<button class="btn ${opt.kind || "btn-secondary"}" ${opt.disabled ? `disabled title="${esc(opt.reason || "")}"` : `data-act="so-act" data-id="${o.id}" data-op="${act}"`}>${label}</button>`;
  const s = o.status;
  const out = [];
  if (s === "CANCELLED" || s === "COMPLETED") return `<span class="chip-inline">No further actions</span>`;
  out.push(B("Confirm", "confirm", { kind: "btn-primary", disabled: s !== "DRAFT", reason: s === "DRAFT" ? "" : "Order already confirmed" }));
  out.push(B("Start picking", "start-picking", { disabled: s !== "CONFIRMED", reason: s === "CONFIRMED" ? "" : "Confirm the order first" }));
  if (s === "PICKING") out.push(`<button class="btn btn-primary" data-act="nav" data-to="#/picking/${o.id}">Open pick console</button>`);
  if (s === "PACKING") out.push(`<button class="btn btn-primary" data-act="nav" data-to="#/packing/${o.id}">Open pack console</button>`);
  out.push(B("Ship", "ship", { kind: s === "READY_TO_SHIP" ? "btn-primary" : "btn-secondary", disabled: s !== "READY_TO_SHIP", reason: s === "READY_TO_SHIP" ? "" : "Packing not complete" }));
  out.push(B("Complete", "complete", { disabled: s !== "SHIPPED", reason: s === "SHIPPED" ? "" : "Order not shipped yet" }));
  out.push(B("Cancel", "cancel", { kind: "btn-danger", disabled: ["SHIPPED", "COMPLETED"].includes(s), reason: "Cannot cancel a shipped order" }));
  return out.join("");
}

function soAct(id, op) {
  const o = DB.sales.find((s) => s.id === id);
  if (!o) return;
  const go = (next, msg) => { o.status = next; saveDB(); toast(msg, "ok"); render(); };
  if (op === "confirm") return go("CONFIRMED", `${o.num} confirmed`);
  if (op === "start-picking") {
    DB.state.pick[o.id] = DB.state.pick[o.id] || {};
    o.status = "PICKING"; saveDB(); toast(`${o.num} — picking started`, "ok"); navigate(`#/picking/${o.id}`); return;
  }
  if (op === "ship") return confirmDialog({ title: `Ship ${o.num}?`, body: "Marks the order shipped and creates a shipment record.", confirmLabel: "Ship order", onConfirm: () => go("SHIPPED", `${o.num} shipped`) });
  if (op === "complete") return go("COMPLETED", `${o.num} completed`);
  if (op === "cancel") return confirmDialog({ title: `Cancel ${o.num}?`, body: "This releases any allocations. Cannot be undone.", danger: true, confirmLabel: "Cancel order", onConfirm: () => go("CANCELLED", `${o.num} cancelled`) });
}

/* ---- Queue lists (picking / packing) ---- */
function renderQueueList(kind) {
  const status = kind === "picking" ? "PICKING" : "PACKING";
  const rows = DB.sales.filter((o) => o.status === status);
  const body = rows.length ? `<div class="stack">${rows.map((o) => {
    const total = soQty(o);
    const done = Object.values((kind === "picking" ? DB.state.pick : DB.state.pack)[o.id] || {}).reduce((a, b) => a + b, 0);
    return `<button class="line-row" data-act="nav" data-to="#/${kind}/${o.id}" style="grid-template-columns:1fr auto;text-align:left">
      <div><div class="lr-name">${o.num} · ${esc(custName(o.cust))}</div>
      <div class="lr-meta">${o.items.length} lines · ${fmtQty(total)} units</div>
      <div class="progress ${done >= total ? "ok" : ""}" style="width:200px;margin-top:8px"><i style="width:${pct(done, total)}%"></i></div></div>
      <div class="lr-count">${pct(done, total)}<span class="req">%</span></div></button>`;
  }).join("")}</div>` : emptyState(`No orders in ${kind}.`);

  mount(`
    <div class="page-header"><div><div class="page-title">${kind === "picking" ? "Picking" : "Packing"} queue</div>
      <div class="page-sub">${rows.length} order${rows.length === 1 ? "" : "s"} ${kind === "picking" ? "to pick" : "to verify"} · tap an order to open the ${kind} console</div></div></div>
    ${body}
  `);
}

/* ---- Pick console (HIGH PRIORITY) ---- */
let scanState = "ready", scanMsg = "Scan or type a barcode. Focus is locked on the scan field.";
function renderPickConsole(id) {
  const o = DB.sales.find((s) => s.id === id);
  if (!o) return mount(errorScreen("Order not found"));
  if (o.status !== "PICKING") {
    return mount(`
      <div class="breadcrumb"><button data-act="nav" data-to="#/picking">Picking</button>${icon("chevR", 12)}<span>${o.num}</span></div>
      ${infoScreen(o.status === "PACKING" ? "Picking complete" : "Not in picking", `${o.num} is at ${STATUS[o.status].t}.`, o.status === "PACKING" ? `#/packing/${o.id}` : `#/sales/${o.id}`, o.status === "PACKING" ? "Open pack console" : "View order")}`);
  }
  scanState = "ready";
  DB.state.pick[o.id] = DB.state.pick[o.id] || {};
  const pk = DB.state.pick[o.id];
  const total = soQty(o);
  const doneQty = () => o.items.reduce((a, it, i) => a + (pk[i] || 0), 0);
  const allDone = () => o.items.every((it, i) => (pk[i] || 0) >= it.ordered);

  const lines = o.items.map((it, i) => {
    const p = prod(it.pid);
    const got = pk[i] || 0;
    const full = got >= it.ordered;
    const loc = (p.locs[0] || {});
    const lot = it.allocs[0] ? it.allocs[0].lot : null;
    return `<div class="line-row ${full ? "done" : ""}" id="line-${i}" data-idx="${i}">
      <div>
        <div class="lr-name">${esc(p.name)}</div>
        <div class="lr-meta">
          <span class="sku">${p.sku}</span>
          ${lot ? `<span>lot ${lot}</span>` : `<span class="faint">non-batch</span>`}
          ${it.allocs[0] && it.allocs[0].expDays != null ? `<span>${it.allocs[0].expDays < 0 ? `<span class="badge b-danger dot">exp ${it.allocs[0].expDays}d</span>` : it.allocs[0].expDays <= 90 ? `<span class="badge b-warning dot">${it.allocs[0].expDays}d</span>` : "ok"}</span>` : ""}
          <span>${WH[loc.wh] || loc.wh || "MAIN"} · ${loc.loc || "—"}</span>
        </div>
      </div>
      <div class="lr-count ${full ? "full" : ""}">
        <button type="button" class="icon-btn" data-act="pick-step" data-id="${o.id}" data-idx="${i}" data-dir="-1" aria-label="minus" ${got <= 0 ? "disabled" : ""}>${icon("minus", 14)}</button>
        <span style="margin:0 4px">${fmtQty(got)}<span class="req"> / ${fmtQty(it.ordered)}</span></span>
        <button type="button" class="icon-btn" data-act="pick-step" data-id="${o.id}" data-idx="${i}" data-dir="1" aria-label="plus" ${full ? "disabled" : ""}>${icon("plus", 14)}</button>
      </div>
    </div>`;
  }).join("");

  mount(`
    <div class="breadcrumb"><button data-act="nav" data-to="#/picking">Picking</button>${icon("chevR", 12)}<span>${o.num}</span></div>
    <div class="work-layout">
      <div class="work-main">
        <div class="order-head">
          <div><div class="oh-num">${o.num}</div><div class="muted" style="font-size:12px">${esc(custName(o.cust))} · ${o.items.length} lines</div></div>
          <div class="oh-ring">${ringHTML(pct(doneQty(), total))}</div>
        </div>
        <div class="stack" id="lineList">${lines}</div>
      </div>

      <div class="work-side">
        <div class="scan-panel state-${scanState}" id="scanPanel">
          <div class="scan-status"><span class="s-dot"></span><span id="scanStateLabel">Ready</span></div>
          <div class="scan-msg" id="scanMsg">${esc(scanMsg)}</div>
          <div class="scan-input-row">
            <input class="input input-lg" id="scanInput" type="text" inputmode="numeric" autocomplete="off" placeholder="Scan barcode…" aria-label="Barcode scan input">
            <button type="button" class="btn btn-secondary" data-act="scan-go">Enter</button>
          </div>
          <div class="scan-focuslock"><span class="lk"></span>Focus locked — hardware scanner ready</div>
          <div class="between">
            <label class="sound-toggle"><input type="checkbox" id="soundToggle" ${soundOn ? "checked" : ""}> audible feedback</label>
            <span class="scan-hints">try <code>885000000001</code></span>
          </div>
          <div class="scan-hints">
            <code>885000000001</code> correct · <code>885000000002</code> ambiguous lot · <code>885000000003</code> wrong item
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-lg btn-block" data-act="pick-complete" data-id="${o.id}" id="completeBtn" ${allDone() ? "" : "disabled"}>Complete picking</button>
        <div class="muted work-hint" style="font-size:11px">Enabled only when every line is fully picked.</div>
      </div>
    </div>
  `);

  afterRender = () => {
    const inp = $("#scanInput");
    if (inp && !isMobile()) inp.focus();
    inp && inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doScan(o.id, inp.value.trim()); inp.value = ""; } });
    inp && inp.addEventListener("focus", () => {
      if (isMobile()) setNav(false);          // never leave More open behind the dock
      document.documentElement.classList.add("kb");
      trackKeyboardInset(); syncDock();
    });
    inp && inp.addEventListener("blur", () => {
      document.documentElement.classList.remove("kb");
      document.documentElement.style.removeProperty("--kb-inset");
      syncDock();
    });
    const stog = $("#soundToggle");
    stog && stog.addEventListener("change", () => { soundOn = stog.checked; });
    syncDock();
  };
}

function ringHTML(p) {
  const r = 16, c = 2 * Math.PI * r, off = c * (1 - p / 100);
  return `<svg width="46" height="46" viewBox="0 0 46 46" aria-label="${p}%">
    <circle cx="23" cy="23" r="${r}" fill="none" stroke="var(--surface-sunken)" stroke-width="4"/>
    <circle cx="23" cy="23" r="${r}" fill="none" stroke="${p >= 100 ? "var(--success)" : "var(--accent)"}" stroke-width="4"
      stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 23 23)"/>
    <text x="23" y="27" text-anchor="middle" font-size="12" font-family="Sarabun, 'Segoe UI', system-ui, sans-serif" fill="var(--foreground)">${p}</text>
  </svg>`;
}

function setScan(state, msg) {
  scanState = state; scanMsg = msg;
  const panel = $("#scanPanel");
  if (!panel) return;
  panel.className = "scan-panel state-" + state;
  $("#scanStateLabel").textContent = state === "ready" ? "Ready" : state === "scanning" ? "Scanning" : state === "matched" ? "Matched" : state === "error" ? "Error" : "Completed";
  $("#scanMsg").textContent = msg;
}

function doScan(orderId, code) {
  if (!code) return;
  const o = DB.sales.find((s) => s.id === orderId);
  const pk = DB.state.pick[o.id];
  setScan("scanning", "Resolving " + code + "…");
  setTimeout(() => {
    const it = o.items.findIndex((x) => prod(x.pid).barcode === code);
    if (it === -1) {
      const other = DB.products.find((p) => p.barcode === code);
      setScan("error", other ? `Wrong item — ${other.name} is not on this order. Nothing counted.` : `Unknown barcode ${code}. Nothing counted.`);
      beep(false);
      flashLine(it, "miss");
      return;
    }
    const item = o.items[it];
    const got = pk[it] || 0;
    if (got >= item.ordered) {
      setScan("error", `Line already complete — over-scan blocked. ${prod(item.pid).name} stays at ${fmtQty(got)}/${fmtQty(item.ordered)}.`);
      beep(false);
      flashLine(it, "miss");
      return;
    }
    if (item.allocs.length > 1) {
      openAllocationModal(o.id, it, (chosen) => applyPick(o.id, it, chosen));
      return;
    }
    applyPick(o.id, it, item.allocs[0] ? item.allocs[0].lot : null);
  }, 260);
}

function applyPick(orderId, idx, lot) {
  const o = DB.sales.find((s) => s.id === orderId);
  const pk = DB.state.pick[o.id];
  const item = o.items[idx];
  pk[idx] = (pk[idx] || 0) + 1;
  saveDB();
  const p = prod(item.pid);
  setScan("matched", `${p.name}${lot ? " · " + lot : ""} · +1 → ${fmtQty(pk[idx])} / ${fmtQty(item.ordered)}`);
  beep(true);
  const row = $("#line-" + idx);
  if (row) { row.classList.remove("miss"); row.classList.add("hit"); setTimeout(() => row.classList.remove("hit"), 620); }
  syncPickLine(o, idx);
  paintShell("picking");
}

/* update one pick line + the ring + Complete button in place (no re-render) */
function syncPickLine(o, idx) {
  const pk = DB.state.pick[o.id];
  const item = o.items[idx];
  const total = soQty(o);
  const doneQty = o.items.reduce((a, x, i) => a + (pk[i] || 0), 0);
  const allDone = o.items.every((x, i) => (pk[i] || 0) >= x.ordered);
  const row = $("#line-" + idx);
  if (row) {
    const full = (pk[idx] || 0) >= item.ordered;
    row.classList.toggle("done", full);
    const cnt = row.querySelector(".lr-count");
    cnt.classList.toggle("full", full);
    cnt.querySelector("span").innerHTML = `${fmtQty(pk[idx] || 0)}<span class="req"> / ${fmtQty(item.ordered)}</span>`;
    const btns = row.querySelectorAll(".icon-btn");
    if (btns[0]) btns[0].disabled = (pk[idx] || 0) <= 0;
    if (btns[1]) btns[1].disabled = full;
  }
  const ring = $(".oh-ring");
  if (ring) ring.innerHTML = ringHTML(pct(doneQty, total));
  $$("#completeBtn, .mobile-actions button").forEach((b) => (b.disabled = !allDone));
  if (allDone) setScan("completed", "All lines picked. Review and complete picking.");
  else if (scanState === "completed") setScan("ready", "Keep picking — some lines are still short.");
}

function flashLine(idx, cls) {
  if (idx == null || idx < 0) return;
  const row = $("#line-" + idx);
  if (row) { row.classList.add(cls); setTimeout(() => row.classList.remove(cls), 520); }
}

function pickStep(orderId, idx, dir) {
  const o = DB.sales.find((s) => s.id === orderId);
  const pk = DB.state.pick[o.id];
  const item = o.items[idx];
  const cur = pk[idx] || 0;
  const next = Math.min(item.ordered, Math.max(0, cur + dir));
  if (next === cur) return;
  pk[idx] = next; saveDB();
  if (dir > 0) { beep(true); setScan("matched", `${prod(item.pid).name} · ${fmtQty(next)} / ${fmtQty(item.ordered)}`); }
  else setScan("ready", `${prod(item.pid).name} adjusted down · ${fmtQty(next)} / ${fmtQty(item.ordered)}`);
  syncPickLine(o, idx); // in-place update — no render(), scroll position preserved
  paintShell("picking");
}

function openAllocationModal(orderId, idx, cb) {
  const o = DB.sales.find((s) => s.id === orderId);
  const item = o.items[idx];
  const opts = item.allocs.slice().sort((a, b) => (a.expDays ?? 9999) - (b.expDays ?? 9999));
  const m = $("#modal");
  m.innerHTML = `
    <h3>Choose allocation — ${esc(prod(item.pid).name)}</h3>
    <p>More than one lot matches this scan. Pick the lot to count against (FEFO — earliest expiry first).</p>
    <div class="alloc-list">
      ${opts.map((a, i) => `<button class="alloc-opt ${i === 0 ? "rec" : ""}" data-lot="${a.lot}">
        <span class="a-lot">${a.lot}</span>
        <span class="a-meta">${a.expDays < 0 ? `<span class="badge b-danger dot">expired ${a.expDays}d</span>` : `exp ${fmtDate(a.expDays)} · ${a.expDays}d`}<br>${fmtQty(a.qty)} available</span>
      </button>`).join("")}
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" data-mc="cancel">Cancel</button></div>`;
  $("#modalOverlay").classList.add("show");
  m.onclick = (e) => {
    const opt = e.target.closest(".alloc-opt");
    if (opt) { modalClose(); cb(opt.dataset.lot); return; }
    if (e.target.closest('[data-mc="cancel"]')) { modalClose(); setScan("ready", "Cancelled — scan again."); }
  };
}

function pickComplete(orderId) {
  const o = DB.sales.find((s) => s.id === orderId);
  const pk = DB.state.pick[o.id];
  if (!o.items.every((x, i) => (pk[i] || 0) >= x.ordered)) { toast("Some lines are not fully picked", "warn"); return; }
  confirmDialog({
    title: `Complete picking for ${o.num}?`,
    body: "Moves the order to Packing. Picked quantities are locked in.",
    confirmLabel: "Complete picking",
    onConfirm: () => {
      o.status = "PACKING";
      DB.state.pack[o.id] = DB.state.pack[o.id] || {};
      saveDB();
      toast(`${o.num} → Packing`, "ok");
      navigate(`#/packing/${o.id}`);
    },
  });
}

/* ---- Pack console ---- */
function renderPackConsole(id) {
  const o = DB.sales.find((s) => s.id === id);
  if (!o) return mount(errorScreen("Order not found"));
  if (o.status !== "PACKING") {
    return mount(`<div class="breadcrumb"><button data-act="nav" data-to="#/packing">Packing</button>${icon("chevR", 12)}<span>${o.num}</span></div>
      ${infoScreen("Not in packing", `${o.num} is at ${STATUS[o.status].t}.`, `#/sales/${o.id}`, "View order")}`);
  }
  scanState = "ready";
  const pk = DB.state.pick[o.id] || {};
  DB.state.pack[o.id] = DB.state.pack[o.id] || {};
  const pc = DB.state.pack[o.id];
  // ensure picked seeded (came from pick complete) — default to ordered
  o.items.forEach((it, i) => { if (pk[i] == null) pk[i] = it.ordered; });
  const total = soQty(o);
  const packedQty = () => o.items.reduce((a, it, i) => a + (pc[i] || 0), 0);
  const allDone = () => o.items.every((it, i) => (pc[i] || 0) >= (pk[i] || it.ordered));

  const lines = o.items.map((it, i) => {
    const p = prod(it.pid);
    const picked = pk[i] || it.ordered;
    const packed = pc[i] || 0;
    const full = packed >= picked;
    return `<div class="line-row ${full ? "done" : ""}" id="line-${i}" data-idx="${i}">
      <div><div class="lr-name">${esc(p.name)}</div>
        <div class="lr-meta"><span class="sku">${p.sku}</span>
          ${it.allocs[0] && it.allocs[0].lot ? `<span>lot ${it.allocs[0].lot}</span>` : `<span class="faint">non-batch</span>`}
          <span>picked ${fmtQty(picked)}</span></div></div>
      <div class="lr-count ${full ? "full" : ""}">
        <button type="button" class="icon-btn" data-act="pack-step" data-id="${o.id}" data-idx="${i}" data-dir="-1" ${packed <= 0 ? "disabled" : ""}>${icon("minus", 14)}</button>
        <span style="margin:0 4px">${fmtQty(packed)}<span class="req"> / ${fmtQty(picked)}</span></span>
        <button type="button" class="icon-btn" data-act="pack-step" data-id="${o.id}" data-idx="${i}" data-dir="1" ${full ? "disabled" : ""}>${icon("plus", 14)}</button>
      </div></div>`;
  }).join("");

  const slip = JSON.stringify({
    packing_slip: o.num, customer: custName(o.cust),
    lines: o.items.map((it) => ({ sku: prod(it.pid).sku, qty: fmtQty(pk[o.items.indexOf(it)] || it.ordered), lot: it.allocs[0] ? it.allocs[0].lot : null })),
  }, null, 2);
  const label = JSON.stringify({
    ship_to: custName(o.cust), order: o.num, weight_kg: "12.40", parcels: 1,
    shipment_number: "SHP-" + o.id, service: "STANDARD",
  }, null, 2);

  mount(`
    <div class="breadcrumb"><button data-act="nav" data-to="#/packing">Packing</button>${icon("chevR", 12)}<span>${o.num}</span></div>
    <div class="work-layout">
      <div class="work-main">
        <div class="order-head">
          <div><div class="oh-num">${o.num}</div><div class="muted" style="font-size:12px">${esc(custName(o.cust))} · verify picked → packed</div></div>
          <div class="oh-ring">${ringHTML(pct(packedQty(), total))}</div>
        </div>
        <div class="stack" id="lineList">${lines}</div>
      </div>
      <div class="work-side">
        <div class="scan-panel state-${scanState}" id="scanPanel">
          <div class="scan-status"><span class="s-dot"></span><span id="scanStateLabel">Ready</span></div>
          <div class="scan-msg" id="scanMsg">Scan each item to confirm it matches what was picked.</div>
          <div class="scan-input-row">
            <input class="input input-lg" id="scanInput" type="text" inputmode="numeric" autocomplete="off" placeholder="Scan barcode…" aria-label="Barcode scan input">
            <button type="button" class="btn btn-secondary" data-act="scan-go-pack">Enter</button>
          </div>
          <div class="scan-focuslock"><span class="lk"></span>Focus locked</div>
          <div class="scan-hints"><code>885000000001</code> · <code>885000000004</code> match · other barcodes → mismatch</div>
        </div>
        <button type="button" class="btn btn-primary btn-lg btn-block" data-act="pack-complete" data-id="${o.id}" id="completeBtn" ${allDone() ? "" : "disabled"}>Complete packing</button>

        <div class="panel preview-panel">
          <div class="panel-head"><h3>${icon("slip", 13)} Packing slip data</h3></div>
          <div class="panel-body" style="padding:0"><pre>${esc(slip)}</pre></div>
        </div>
        <div class="panel preview-panel">
          <div class="panel-head"><h3>${icon("tag", 13)} Shipping label data</h3></div>
          <div class="panel-body" style="padding:0"><pre>${esc(label)}</pre></div>
        </div>
      </div>
    </div>
  `);

  afterRender = () => {
    const inp = $("#scanInput");
    if (inp && !isMobile()) inp.focus();
    inp && inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doScanPack(o.id, inp.value.trim()); inp.value = ""; } });
    inp && inp.addEventListener("focus", () => {
      if (isMobile()) setNav(false);          // never leave More open behind the dock
      document.documentElement.classList.add("kb");
      trackKeyboardInset(); syncDock();
    });
    inp && inp.addEventListener("blur", () => {
      document.documentElement.classList.remove("kb");
      document.documentElement.style.removeProperty("--kb-inset");
      syncDock();
    });
    syncDock();
  };
}

function doScanPack(orderId, code) {
  if (!code) return;
  const o = DB.sales.find((s) => s.id === orderId);
  const pk = DB.state.pick[o.id], pc = DB.state.pack[o.id];
  setScan("scanning", "Checking " + code + "…");
  setTimeout(() => {
    const idx = o.items.findIndex((x) => prod(x.pid).barcode === code);
    if (idx === -1) { setScan("error", "Mismatch — that item was not on this order. Packed count unchanged."); beep(false); flashLine(idx, "miss"); return; }
    const picked = pk[idx] || o.items[idx].ordered;
    if ((pc[idx] || 0) >= picked) { setScan("error", "Line already packed to the picked quantity. Over-scan blocked."); beep(false); flashLine(idx, "miss"); return; }
    pc[idx] = (pc[idx] || 0) + 1; saveDB();
    const p = prod(o.items[idx].pid);
    setScan("matched", `${p.name} verified · ${fmtQty(pc[idx])} / ${fmtQty(picked)}`);
    beep(true);
    packRerender(o, idx);
  }, 240);
}
function packStep(orderId, idx, dir) {
  const o = DB.sales.find((s) => s.id === orderId);
  const pk = DB.state.pick[o.id], pc = DB.state.pack[o.id];
  const picked = pk[idx] || o.items[idx].ordered;
  const cur = pc[idx] || 0;
  const next = Math.min(picked, Math.max(0, cur + dir));
  if (next === cur) return;
  pc[idx] = next; saveDB();
  if (dir > 0) beep(true);
  else setScan("ready", `${prod(o.items[idx].pid).name} adjusted down · ${fmtQty(next)} / ${fmtQty(picked)}`);
  packRerender(o, idx); // in-place update — no render(), scroll position preserved
  paintShell("packing");
}
function packRerender(o, idx) {
  const pk = DB.state.pick[o.id], pc = DB.state.pack[o.id];
  const total = soQty(o);
  const packedQty = o.items.reduce((a, x, i) => a + (pc[i] || 0), 0);
  const allDone = o.items.every((x, i) => (pc[i] || 0) >= (pk[i] || x.ordered));
  const row = $("#line-" + idx);
  if (row) {
    row.classList.add("hit"); setTimeout(() => row.classList.remove("hit"), 620);
    const picked = pk[idx] || o.items[idx].ordered;
    const full = (pc[idx] || 0) >= picked;
    row.classList.toggle("done", full);
    row.querySelector(".lr-count").classList.toggle("full", full);
    row.querySelector(".lr-count span").innerHTML = `${fmtQty(pc[idx] || 0)}<span class="req"> / ${fmtQty(picked)}</span>`;
  }
  $(".oh-ring") && ($(".oh-ring").innerHTML = ringHTML(pct(packedQty, total)));
  $$("#completeBtn, .mobile-actions button").forEach((b) => (b.disabled = !allDone));
  if (allDone) setScan("completed", "All lines verified. Complete packing to mark Ready to ship.");
  else if (scanState === "completed") setScan("ready", "Keep verifying picked → packed.");
}
function packComplete(orderId) {
  const o = DB.sales.find((s) => s.id === orderId);
  const pk = DB.state.pick[o.id], pc = DB.state.pack[o.id];
  if (!o.items.every((x, i) => (pc[i] || 0) >= (pk[i] || x.ordered))) { toast("Not all lines verified", "warn"); return; }
  o.status = "READY_TO_SHIP"; saveDB();
  toast(`${o.num} → Ready to ship`, "ok");
  navigate(`#/sales/${o.id}`);
}

/* ---- Purchase orders ---- */
function renderPOList(r) {
  const st = r.query.status || "all";
  let rows = DB.pos.slice();
  if (st === "receiving") rows = rows.filter((p) => ["CONFIRMED", "PARTIALLY_RECEIVED"].includes(p.status));
  else if (st !== "all") rows = rows.filter((p) => p.status === st);
  const tabs = [["all", "All"], ["DRAFT", "Draft"], ["CONFIRMED", "Confirmed"], ["PARTIALLY_RECEIVED", "Partial"], ["RECEIVED", "Received"], ["CANCELLED", "Cancelled"]];

  const table = listView({
    columns: [
      { key: "num", label: "PO", sortVal: (p) => p.num, cell: (p) => `<span class="mono">${p.num}</span>` },
      { key: "sup", label: "Supplier", sortVal: (p) => supName(p.sup), cell: (p) => esc(supName(p.sup)) },
      { key: "ord", label: "Ordered", align: "right", sortVal: (p) => poOrdered(p), cell: (p) => qtyHTML(poOrdered(p)) },
      { key: "rec", label: "Received", align: "right", sortVal: (p) => poReceived(p), cell: (p) => qtyHTML(poReceived(p)) },
      { key: "rem", label: "Remaining", align: "right", sortVal: (p) => poOrdered(p) - poReceived(p), cell: (p) => qtyHTML(poOrdered(p) - poReceived(p)) },
      { key: "prog", label: "Progress", sortable: false, cell: (p) => `<div class="progress ${poReceived(p) >= poOrdered(p) ? "ok" : ""}" style="width:80px"><i style="width:${pct(poReceived(p), poOrdered(p))}%"></i></div> <span class="pct">${pct(poReceived(p), poOrdered(p))}%</span>` },
      { key: "status", label: "Status", sortable: false, cell: (p) => statusBadge(p.status) },
    ],
    rows,
    onRow: (p) => `#/purchase-orders/${p.id}`,
    empty: "No purchase orders in this view.",
    card: (p) => ({
      title: `<span class="mono">${p.num}</span>`, badge: statusBadge(p.status),
      meta: `<span>${esc(supName(p.sup))}</span><span>Ord <b>${fmtQty(poOrdered(p))}</b></span><span>Rec <b>${fmtQty(poReceived(p))}</b></span><span>${pct(poReceived(p), poOrdered(p))}%</span>`,
    }),
  });

  mount(`
    <div class="page-header"><div><div class="page-title">Purchase orders</div>
      <div class="page-sub">DRAFT → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED · idempotent receiving</div></div>
      <div class="page-actions"><button class="btn btn-primary" data-act="toast" data-msg="Prototype: New PO form in Phase 1.">${icon("plus", 15, "ic")}New PO</button></div>
    </div>
    <div class="toolbar"><div class="seg">${tabs.map(([k, l]) =>
      `<button class="${k === st ? "on" : ""}" data-act="potab" data-status="${k}">${l}</button>`).join("")}</div></div>
    ${table}
  `);
}
const poOrdered = (p) => p.items.reduce((a, i) => a + i.ordered, 0);
function poReceived(p) {
  const m = DB.state.poReceived[p.id] || {};
  return p.items.reduce((a, i) => a + (m[i.pid] || 0), 0);
}

function renderPODetail(id) {
  const p = DB.pos.find((x) => x.id === id);
  if (!p) return mount(errorScreen("Purchase order not found"));
  DB.state.poReceived[p.id] = DB.state.poReceived[p.id] || {};
  const recMap = DB.state.poReceived[p.id];
  const canReceive = ["CONFIRMED", "PARTIALLY_RECEIVED"].includes(p.status);

  const flow = ["DRAFT", "CONFIRMED", "PARTIALLY_RECEIVED", "RECEIVED"];
  const idx = p.status === "CANCELLED" ? -1 : flow.indexOf(p.status);
  const tl = p.status === "CANCELLED"
    ? `<div class="timeline"><div class="tl-node done"><span class="ring">${icon("check", 12)}</span><span class="lbl">Draft</span></div><span class="tl-seg"></span><div class="tl-node cancel"><span class="ring">${icon("x", 12)}</span><span class="lbl">Cancelled</span></div></div>`
    : `<div class="timeline">${flow.map((s, i) =>
        `<div class="tl-node ${i < idx ? "done" : i === idx ? "curr" : ""}"><span class="ring">${i < idx ? icon("check", 12) : ""}</span><span class="lbl">${STATUS[s].t}</span></div>${i < flow.length - 1 ? `<span class="tl-seg ${i < idx ? "done" : ""}"></span>` : ""}`).join("")}</div>`;

  const lines = p.items.map((it) => {
    const pr = prod(it.pid);
    const rec = recMap[it.pid] || 0;
    const rem = it.ordered - rec;
    return `<div class="receive-line" data-pid="${it.pid}">
      <div class="rl-top">
        <div><div class="lr-name">${esc(pr.name)}</div><div class="sku">${pr.sku} · ${pr.trackBatch ? "batch" : "non-batch"}${pr.trackExpiry ? " · expiry" : ""}</div></div>
        <div class="rl-nums">
          <span>Ordered <b>${fmtQty(it.ordered)}</b></span>
          <span>Received <b>${fmtQty(rec)}</b></span>
          <span>Remaining <b>${fmtQty(rem)}</b></span>
        </div>
      </div>
      <div class="progress ${rec >= it.ordered ? "ok" : ""}"><i style="width:${pct(rec, it.ordered)}%"></i></div>
      ${canReceive && rem > 0 ? `<div class="rl-inputs">
        <div class="field"><label>Receive now</label><input class="input" type="number" min="0" max="${rem}" step="0.01" placeholder="0.00" data-rq="${it.pid}"></div>
        ${pr.trackBatch ? `<div class="field"><label>Lot number</label><input class="input" type="text" placeholder="LOT-…" data-rlot="${it.pid}"></div>` : ""}
        ${pr.trackExpiry ? `<div class="field"><label>Mfg date</label><input class="input" type="date" data-rmfg="${it.pid}"></div>
        <div class="field"><label>Expiry date</label><input class="input" type="date" data-rexp="${it.pid}"></div>` : ""}
      </div>` : rem <= 0 ? `<div class="chip-inline">${icon("check", 12)} line complete</div>` : ""}
    </div>`;
  }).join("");

  const receipts = p.receipts.length ? p.receipts.map((rc) =>
    `<div class="activity-item"><span class="a-when">${rc.at === "seed" ? "earlier" : fmtDate(rc.at)}</span>
      <span>Receipt #${rc.n} — ${rc.lines.map((l) => `${prod(l.pid).sku} ${fmtQty(l.qty)}`).join(", ")}<br>
      <span class="a-who">A. Thanawat · idempotency-key attached automatically</span></span></div>`).join("") : `<div class="muted" style="font-size:12px;padding:10px 0">No receipts yet.</div>`;

  mount(`
    <div class="breadcrumb"><button data-act="nav" data-to="#/purchase-orders">Purchase orders</button>${icon("chevR", 12)}<span>${p.num}</span></div>
    <div class="page-header">
      <div><div class="page-title">${p.num} ${statusBadge(p.status)}</div>
        <div class="page-sub">${esc(supName(p.sup))} · ${p.items.length} lines · ${pct(poReceived(p), poOrdered(p))}% received</div></div>
      <div class="page-actions">
        <button class="btn btn-primary" ${p.status === "DRAFT" ? `data-act="po-act" data-id="${p.id}" data-op="confirm"` : "disabled title='Already confirmed'"}>Confirm</button>
        <button class="btn btn-danger" ${["DRAFT", "CONFIRMED", "PARTIALLY_RECEIVED"].includes(p.status) ? `data-act="po-act" data-id="${p.id}" data-op="cancel"` : "disabled"}>Cancel</button>
      </div>
    </div>

    <section class="panel" style="margin-bottom:14px"><div class="panel-body">${tl}</div></section>

    <div class="detail-grid">
      <div>
        <div class="section-label" style="margin-top:0">Receiving</div>
        <div class="stack">${lines}</div>
        ${canReceive ? `<div class="row" style="margin-top:12px">
          <button class="btn btn-primary" data-act="po-receive" data-id="${p.id}">Submit receipt</button>
          <span class="muted" style="font-size:11px">Partial receipts allowed. The Idempotency-Key is generated once and reused on any retry — never shown or typed.</span>
        </div>` : ""}
      </div>
      <div>
        <div class="section-label" style="margin-top:0">Receipt history</div>
        <div class="card" style="padding:6px 14px"><div class="activity">${receipts}</div></div>
      </div>
    </div>
  `);
}

function poAct(id, op) {
  const p = DB.pos.find((x) => x.id === id);
  if (op === "confirm") { p.status = "CONFIRMED"; saveDB(); toast(`${p.num} confirmed`, "ok"); render(); }
  if (op === "cancel") confirmDialog({ title: `Cancel ${p.num}?`, danger: true, confirmLabel: "Cancel PO", onConfirm: () => { p.status = "CANCELLED"; saveDB(); toast(`${p.num} cancelled`, "ok"); render(); } });
}
function poReceiveSubmit(id) {
  const p = DB.pos.find((x) => x.id === id);
  const recMap = DB.state.poReceived[p.id];
  const key = (DB.state.poDraftKey = DB.state.poDraftKey || {});
  key[p.id] = key[p.id] || uid(); // generated once per draft, reused on retry
  const lines = [];
  let bad = false;
  p.items.forEach((it) => {
    const el = $(`[data-rq="${it.pid}"]`);
    if (!el || !el.value) return;
    const q = parseFloat(el.value);
    const rem = it.ordered - (recMap[it.pid] || 0);
    if (isNaN(q) || q <= 0) return;
    if (q > rem + 1e-9) { bad = true; el.classList.add("input"); el.style.borderColor = "var(--danger)"; return; }
    lines.push({ pid: it.pid, qty: q });
  });
  if (bad) { toast("A quantity exceeds what's remaining", "err"); return; }
  if (!lines.length) { toast("Enter a quantity to receive", "warn"); return; }
  lines.forEach((l) => (recMap[l.pid] = (recMap[l.pid] || 0) + l.qty));
  const full = p.items.every((it) => (recMap[it.pid] || 0) >= it.ordered - 1e-9);
  p.status = full ? "RECEIVED" : "PARTIALLY_RECEIVED";
  p.receipts.push({ n: p.receipts.length + 1, at: 0, key: key[p.id], lines });
  delete key[p.id]; // draft consumed → next receipt gets a fresh key
  saveDB();
  toast(`Receipt #${p.receipts.length} recorded — idempotency handled automatically`, "ok");
  render();
}

/* ---- Transfers ---- */
function renderTransferList(r) {
  const st = r.query.status || "all";
  let rows = DB.transfers.slice();
  if (st === "open") rows = rows.filter((t) => ["IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(t.status));
  else if (st !== "all") rows = rows.filter((t) => t.status === st);
  const tabs = [["all", "All"], ["DRAFT", "Draft"], ["IN_TRANSIT", "In transit"], ["PARTIALLY_RECEIVED", "Partial"], ["COMPLETED", "Completed"], ["CANCELLED", "Cancelled"]];

  const table = listView({
    columns: [
      { key: "num", label: "Transfer", sortVal: (t) => t.num, cell: (t) => `<span class="mono">${t.num}</span>` },
      { key: "route", label: "Route", sortable: false, cell: (t) => `${WH[t.src]} ${icon("chevR", 11)} ${WH[t.dst]}` },
      { key: "lines", label: "Lines", align: "right", sortVal: (t) => t.items.length, cell: (t) => t.items.length },
      { key: "disp", label: "Dispatched", align: "right", sortVal: (t) => trDisp(t), cell: (t) => qtyHTML(trDisp(t)) },
      { key: "rec", label: "Received", align: "right", sortVal: (t) => trRec(t), cell: (t) => qtyHTML(trRec(t)) },
      { key: "out", label: "Outstanding", align: "right", sortVal: (t) => trDisp(t) - trRec(t), cell: (t) => qtyHTML(Math.max(0, trDisp(t) - trRec(t))) },
      { key: "prog", label: "Progress", sortable: false, cell: (t) => `<div class="progress ${trRec(t) >= trTotal(t) ? "ok" : ""}" style="width:80px"><i style="width:${pct(trRec(t), trTotal(t))}%"></i></div> <span class="pct">${pct(trRec(t), trTotal(t))}%</span>` },
      { key: "status", label: "Status", sortable: false, cell: (t) => statusBadge(t.status) },
    ],
    rows,
    onRow: (t) => `#/transfers/${t.id}`,
    empty: "No transfers in this view.",
    card: (t) => ({
      title: `<span class="mono">${t.num}</span>`, badge: statusBadge(t.status),
      meta: `<span>${WH[t.src]} → ${WH[t.dst]}</span><span>Disp <b>${fmtQty(trDisp(t))}</b></span><span>Rec <b>${fmtQty(trRec(t))}</b></span><span>${pct(trRec(t), trTotal(t))}%</span>`,
    }),
  });

  mount(`
    <div class="page-header"><div><div class="page-title">Transfers</div>
      <div class="page-sub">DRAFT → IN_TRANSIT → PARTIALLY_RECEIVED → COMPLETED · stock held on a protected transit balance</div></div>
      <div class="page-actions"><button class="btn btn-primary" data-act="toast" data-msg="Prototype: New transfer form in Phase 1.">${icon("plus", 15, "ic")}New transfer</button></div>
    </div>
    <div class="toolbar"><div class="seg">${tabs.map(([k, l]) =>
      `<button class="${k === st ? "on" : ""}" data-act="trtab" data-status="${k}">${l}</button>`).join("")}</div></div>
    ${table}
  `);
}
const trTotal = (t) => t.items.reduce((a, i) => a + i.qty, 0);
function trDisp(t) { const m = DB.state.trDispatched[t.id] || {}; return t.items.reduce((a, i, idx) => a + (m[idx] || 0), 0); }
function trRec(t) { const m = DB.state.trReceived[t.id] || {}; return t.items.reduce((a, i, idx) => a + (m[idx] || 0), 0); }

function renderTransferDetail(id) {
  const t = DB.transfers.find((x) => x.id === id);
  if (!t) return mount(errorScreen("Transfer not found"));
  DB.state.trDispatched[t.id] = DB.state.trDispatched[t.id] || {};
  DB.state.trReceived[t.id] = DB.state.trReceived[t.id] || {};
  const disp = trDisp(t), rec = trRec(t), total = trTotal(t), out = Math.max(0, disp - rec);
  const canDispatch = t.status === "DRAFT";
  const canReceive = ["IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(t.status);

  const lines = t.items.map((it, idx) => {
    const pr = prod(it.pid);
    const d = (DB.state.trDispatched[t.id][idx]) || 0;
    const rc = (DB.state.trReceived[t.id][idx]) || 0;
    const o = Math.max(0, d - rc);
    return `<div class="receive-line" data-idx="${idx}">
      <div class="rl-top">
        <div><div class="lr-name">${esc(pr.name)}</div><div class="sku">${pr.sku}</div></div>
        <div class="rl-nums"><span>Total <b>${fmtQty(it.qty)}</b></span><span>Disp <b>${fmtQty(d)}</b></span><span>Rec <b>${fmtQty(rc)}</b></span><span>Out <b>${fmtQty(o)}</b></span></div>
      </div>
      <div class="progress ${rc >= it.qty ? "ok" : ""}"><i style="width:${pct(rc, it.qty)}%"></i></div>
      ${canReceive && o > 0 ? `<div class="rl-inputs"><div class="field"><label>Receive at ${WH[t.dst]}</label>
        <input class="input" type="number" min="0" max="${o}" step="0.01" placeholder="0.00" data-trq="${idx}"></div></div>` : ""}
    </div>`;
  }).join("");

  mount(`
    <div class="breadcrumb"><button data-act="nav" data-to="#/transfers">Transfers</button>${icon("chevR", 12)}<span>${t.num}</span></div>
    <div class="page-header">
      <div><div class="page-title">${t.num} ${statusBadge(t.status)}</div>
        <div class="page-sub">${WH[t.src]} → ${WH[t.dst]} · ${t.items.length} lines · ${pct(rec, total)}% received</div></div>
      <div class="page-actions">
        ${canDispatch ? `<button class="btn btn-primary" data-act="tr-act" data-id="${t.id}" data-op="dispatch">Dispatch</button>` : `<button class="btn btn-secondary" disabled title="Already dispatched">Dispatch</button>`}
        ${t.status === "DRAFT" ? `<button class="btn btn-danger" data-act="tr-act" data-id="${t.id}" data-op="cancel">Cancel</button>` : ""}
      </div>
    </div>

    <div class="detail-grid">
      <div>
        <div class="section-label" style="margin-top:0">Flow</div>
        <div class="transfer-flow">
          <div class="flow-stage"><span class="fs-ic">${icon("factory", 16)}</span>
            <div><div class="fs-name">${WH[t.src]}</div><div class="fs-sub">source · dispatched</div></div>
            <span class="fs-qty">${fmtQty(disp)}</span></div>
          <div class="flow-arrow">${icon("arrowDown", 16)}</div>
          <div class="flow-stage transit"><span class="fs-ic">${icon("truck", 16)}</span>
            <div><div class="fs-name">In transit</div><div class="fs-sub">protected transit balance · outstanding</div></div>
            <span class="fs-qty">${fmtQty(out)}</span></div>
          <div class="flow-arrow">${icon("arrowDown", 16)}</div>
          <div class="flow-stage"><span class="fs-ic">${icon("factory", 16)}</span>
            <div><div class="fs-name">${WH[t.dst]}</div><div class="fs-sub">destination · received</div></div>
            <span class="fs-qty">${fmtQty(rec)}</span></div>
        </div>
        <div class="progress ${rec >= total ? "ok" : ""}" style="max-width:420px;margin-top:12px"><i style="width:${pct(rec, total)}%"></i></div>
        <div class="pct" style="margin-top:5px">progress ${pct(rec, total)}%</div>
        <div class="transit-note">${icon("alert", 13)}<span>Transit is a system holding area. It is never selectable as an ordinary source or destination warehouse.</span></div>
      </div>
      <div>
        <div class="section-label" style="margin-top:0">Lines &amp; receiving</div>
        <div class="stack">${lines}</div>
        ${canReceive ? `<div class="row" style="margin-top:12px">
          <button class="btn btn-primary" data-act="tr-receive" data-id="${t.id}">Submit receipt</button>
          <span class="muted" style="font-size:11px">Partial receiving allowed — outstanding stays in transit until fully received.</span>
        </div>` : ""}
      </div>
    </div>
  `);
}

function trAct(id, op) {
  const t = DB.transfers.find((x) => x.id === id);
  if (op === "dispatch") {
    return confirmDialog({
      title: `Dispatch ${t.num}?`, body: `Moves ${fmtQty(trTotal(t))} units from ${WH[t.src]} into the protected transit balance.`,
      confirmLabel: "Dispatch",
      onConfirm: () => {
        t.items.forEach((it, idx) => (DB.state.trDispatched[t.id][idx] = it.qty));
        t.status = "IN_TRANSIT"; saveDB(); toast(`${t.num} dispatched — now in transit`, "ok"); render();
      },
    });
  }
  if (op === "cancel") confirmDialog({ title: `Cancel ${t.num}?`, danger: true, confirmLabel: "Cancel transfer", onConfirm: () => { t.status = "CANCELLED"; saveDB(); toast(`${t.num} cancelled`, "ok"); render(); } });
}
function trReceiveSubmit(id) {
  const t = DB.transfers.find((x) => x.id === id);
  const rm = DB.state.trReceived[t.id], dm = DB.state.trDispatched[t.id];
  let any = false, bad = false;
  t.items.forEach((it, idx) => {
    const el = $(`[data-trq="${idx}"]`); if (!el || !el.value) return;
    const q = parseFloat(el.value);
    const outLine = (dm[idx] || 0) - (rm[idx] || 0);
    if (isNaN(q) || q <= 0) return;
    if (q > outLine + 1e-9) { bad = true; el.style.borderColor = "var(--danger)"; return; }
    rm[idx] = (rm[idx] || 0) + q; any = true;
  });
  if (bad) { toast("A quantity exceeds the outstanding transit amount", "err"); return; }
  if (!any) { toast("Enter a quantity to receive", "warn"); return; }
  const fully = t.items.every((it, idx) => (rm[idx] || 0) >= (dm[idx] || 0) - 1e-9);
  t.status = fully ? "COMPLETED" : "PARTIALLY_RECEIVED";
  saveDB();
  toast(fully ? `${t.num} fully received — completed` : `${t.num} — partial receipt recorded`, "ok");
  render();
}

/* ---- Customers / Suppliers ---- */
function renderParties(kind) {
  const list = kind === "customers" ? DB.customers : DB.suppliers;
  const table = listView({
    columns: [
      { key: "name", label: "Name", sortVal: (x) => x.name.toLowerCase(), cell: (x) => `<b>${esc(x.name)}</b>` },
      { key: "city", label: "City", sortVal: (x) => x.city, cell: (x) => `<span class="muted">${x.city}</span>` },
      { key: "phone", label: "Phone", sortable: false, cell: (x) => `<span class="mono">${x.phone}</span>` },
    ],
    rows: list,
    onRow: (x) => `#drawer:${kind === "customers" ? "customer" : "supplier"}:${x.id}`,
    empty: `No ${kind}.`,
    card: (x) => ({ title: esc(x.name), badge: "", meta: `<span>${x.city}</span><span class="mono">${x.phone}</span>` }),
  });
  mount(`
    <div class="page-header"><div><div class="page-title">${kind === "customers" ? "Customers" : "Suppliers"}</div>
      <div class="page-sub">${list.length} records</div></div>
      <div class="page-actions"><button class="btn btn-primary" data-act="toast" data-msg="Prototype: create form in Phase 1.">${icon("plus", 15, "ic")}New ${kind === "customers" ? "customer" : "supplier"}</button></div>
    </div>
    ${table}
  `);
}
function partyDrawer(kind, id) {
  const list = kind === "customer" ? DB.customers : DB.suppliers;
  const x = list.find((r) => r.id === id); if (!x) return;
  const orders = kind === "customer"
    ? DB.sales.filter((o) => o.cust === id)
    : DB.pos.filter((p) => p.sup === id);
  openDrawer(x.name, `
    <dl class="kv"><dt>City</dt><dd>${x.city}</dd><dt>Phone</dt><dd>${x.phone}</dd>
    <dt>${kind === "customer" ? "Sales orders" : "Purchase orders"}</dt><dd>${orders.length}</dd></dl>
    <div>
      <div class="section-label" style="margin:0 0 6px">Recent ${kind === "customer" ? "orders" : "POs"}</div>
      ${orders.length ? `<div class="stack">${orders.slice(0, 5).map((o) =>
        `<button class="entity-card" data-act="row" data-to="#/${kind === "customer" ? "sales" : "purchase-orders"}/${o.id}" style="padding:10px 12px">
          <div class="ec-top"><span class="mono">${o.num}</span>${statusBadge(o.status)}</div></button>`).join("")}</div>`
        : `<div class="muted" style="font-size:12px">None yet.</div>`}
    </div>
    <div class="row">
      <button class="btn btn-secondary" data-act="toast" data-msg="Prototype: edit form in Phase 1.">Edit</button>
      <button class="btn btn-danger" data-act="party-delete" data-kind="${kind}" data-id="${id}">Delete</button>
    </div>
  `);
}

/* ---- Reports ---- */
function renderReports(r) {
  const type = r.query.type || "operational-stock";
  const defs = [
    ["operational-stock", "Operational stock"],
    ["low-stock", "Low stock"],
    ["near-expiry", "Near expiry"],
    ["in-transit", "In transit"],
    ["stock-movement", "Stock movement"],
    ["sales", "Sales orders"],
    ["purchase-orders", "Purchase orders"],
    ["transfers", "Transfers"],
  ];
  let head = [], rows = [];
  if (type === "operational-stock") {
    head = ["SKU", "Product", "Owned", "Available", "Reserved", "Expired", "Near expiry"];
    rows = DB.products.map((p) => { const m = pm(p); return [p.sku, p.name, fmtQty(p.owned), fmtQty(m.available), fmtQty(p.reserved), fmtQty(m.expired), fmtQty(m.near)]; });
  } else if (type === "low-stock") {
    head = ["SKU", "Product", "Available", "Minimum"];
    rows = DB.products.filter((p) => pm(p).health === "LOW").map((p) => [p.sku, p.name, fmtQty(pm(p).available), fmtQty(p.min)]);
  } else if (type === "near-expiry") {
    head = ["SKU", "Lot", "Qty", "Expiry", "Days"];
    rows = DB.products.flatMap((p) => (p.batches || []).filter((b) => b.expDays != null && b.expDays >= 0 && b.expDays <= 90).map((b) => [p.sku, b.lot, fmtQty(b.qty), fmtDate(b.expDays), b.expDays]));
  } else if (type === "in-transit") {
    head = ["SKU", "Product", "Transit qty", "Route"];
    rows = DB.products.filter((p) => p.transit > 0).map((p) => [p.sku, p.name, fmtQty(p.transit), "→ multiple"]);
  } else if (type === "stock-movement") {
    head = ["When", "SKU", "Type", "Qty", "Reference"];
    rows = [
      ["-6h", "WH-COFFEE-1KG", "OUT", "-6.00", "SO-104829"],
      ["-1d", "WH-FLOUR-1KG", "IN", "+20.00", "PO-2089"],
      ["-1d", "WH-FLOUR-1KG", "TRANSFER_OUT", "-200.00", "TRF-3313"],
      ["-2d", "WH-SUGAR-25KG", "IN", "+25.00", "PO-2089"],
      ["-2d", "WH-MILK-UHT-1L", "ADJUST", "-4.00", "expired write-off"],
    ];
  } else if (type === "sales") {
    head = ["Order", "Customer", "Qty", "Amount", "Status"];
    rows = DB.sales.map((o) => [o.num, custName(o.cust), fmtQty(soQty(o)), fmtMoney(soAmt(o)), STATUS[o.status].t]);
  } else if (type === "purchase-orders") {
    head = ["PO", "Supplier", "Ordered", "Received", "Status"];
    rows = DB.pos.map((p) => [p.num, supName(p.sup), fmtQty(poOrdered(p)), fmtQty(poReceived(p)), STATUS[p.status].t]);
  } else {
    head = ["Transfer", "Route", "Dispatched", "Received", "Status"];
    rows = DB.transfers.map((t) => [t.num, WH[t.src] + " → " + WH[t.dst], fmtQty(trDisp(t)), fmtQty(trRec(t)), STATUS[t.status].t]);
  }

  const table = rows.length ? `<div class="table-wrap"><table class="dt"><thead><tr>${head.map((h, i) =>
    `<th class="${i >= 2 && !isNaN(parseFloat(rows[0][i])) ? "num" : ""}">${h}</th>`).join("")}</tr></thead><tbody>
    ${rows.map((row) => `<tr style="cursor:default">${row.map((c, i) =>
      `<td class="${i >= 2 && !isNaN(parseFloat(String(c).replace(/[,฿+]/g, ""))) ? "num" : ""}">${i <= 1 ? `<span class="${i === 0 ? "sku" : ""}">${esc(c)}</span>` : esc(c)}</td>`).join("")}</tr>`).join("")}
  </tbody></table></div>` : emptyState("No rows for this report.");

  mount(`
    <div class="page-header"><div><div class="page-title">Reports</div>
      <div class="page-sub">Operational reports — quantities and money at 2-decimal precision</div></div>
      <div class="page-actions"><button class="btn btn-secondary" data-act="toast" data-msg="Prototype: streams an .xlsx from /reports/export/* (bounded to 50k rows server-side).">${icon("arrowDown", 15, "ic")}Export .xlsx</button></div>
    </div>
    <div class="rep-grid">
      <nav class="panel" style="align-self:start"><div style="padding:6px">
        ${defs.map(([k, l]) => `<button class="nav-item ${k === type ? "active" : ""}" data-act="nav" data-to="#/reports?type=${k}">${l}</button>`).join("")}
      </div></nav>
      <div>${table}<div class="pager"><span>${rows.length} rows</span></div></div>
    </div>
  `);
}

/* ---- misc screens ---- */
function errorScreen(msg) {
  return `<div class="state-block card">${icon("alert", 34, "sb-ic")}<h3>${esc(msg)}</h3>
    <p>Try the list view.</p><button class="btn btn-secondary" data-act="nav" data-to="#/dashboard">Back to dashboard</button></div>`;
}
function infoScreen(title, msg, to, cta) {
  return `<div class="state-block card">${icon("check", 34, "sb-ic")}<h3>${esc(title)}</h3><p>${esc(msg)}</p>
    <button class="btn btn-primary" data-act="nav" data-to="${to}">${esc(cta)}</button></div>`;
}

/* ---------------------------------------------------------------
   11. command palette
--------------------------------------------------------------- */
let paletteIndex = [], paletteFiltered = [], paletteActive = 0;
function buildIndex() {
  paletteIndex = [];
  DB.products.forEach((p) => paletteIndex.push({ type: "Product", label: p.name, sub: p.sku, to: `#drawer:product:${p.id}`, ic: "box", terms: (p.name + " " + p.sku + " " + p.barcode + " " + (p.batches || []).map((b) => b.lot).join(" ")).toLowerCase() }));
  DB.sales.forEach((o) => paletteIndex.push({ type: "Sales order", label: o.num, sub: custName(o.cust), to: `#/sales/${o.id}`, ic: "cart", terms: (o.num + " " + custName(o.cust)).toLowerCase() }));
  DB.pos.forEach((p) => paletteIndex.push({ type: "Purchase order", label: p.num, sub: supName(p.sup), to: `#/purchase-orders/${p.id}`, ic: "poIcon", terms: (p.num + " " + supName(p.sup)).toLowerCase() }));
  DB.transfers.forEach((t) => paletteIndex.push({ type: "Transfer", label: t.num, sub: WH[t.src] + " → " + WH[t.dst], to: `#/transfers/${t.id}`, ic: "transfer", terms: (t.num + " " + t.src + " " + t.dst).toLowerCase() }));
  DB.customers.forEach((c) => paletteIndex.push({ type: "Customer", label: c.name, sub: c.city, to: `#drawer:customer:${c.id}`, ic: "users", terms: c.name.toLowerCase() }));
  DB.suppliers.forEach((s) => paletteIndex.push({ type: "Supplier", label: s.name, sub: s.city, to: `#drawer:supplier:${s.id}`, ic: "factory", terms: s.name.toLowerCase() }));
}
const QUICK = [
  { type: "Quick action", label: "New Sales Order", ic: "plus", act: () => { navigate("#/sales"); toast("Prototype: the create form opens here in Phase 1.", "warn"); } },
  { type: "Quick action", label: "New Purchase Order", ic: "plus", act: () => { navigate("#/purchase-orders"); toast("Prototype: the create form opens here in Phase 1.", "warn"); } },
  { type: "Quick action", label: "Stock In", ic: "arrowDown", act: () => { navigate("#/products?tab=all"); toast("Prototype: Stock In opens here in Phase 1.", "warn"); } },
  { type: "Quick action", label: "New Transfer", ic: "transfer", act: () => { navigate("#/transfers"); toast("Prototype: the create form opens here in Phase 1.", "warn"); } },
];
function openPalette() {
  buildIndex();
  $("#paletteOverlay").classList.add("show");
  const inp = $("#paletteInput");
  inp.value = ""; filterPalette("");
  setTimeout(() => inp.focus(), 20);
}
function closePalette() { $("#paletteOverlay").classList.remove("show"); }
function filterPalette(q) {
  q = q.trim().toLowerCase();
  const matches = q ? paletteIndex.filter((r) => r.terms.includes(q)).slice(0, 12) : paletteIndex.slice(0, 6);
  const quick = q ? QUICK.filter((a) => a.label.toLowerCase().includes(q)) : QUICK;
  paletteFiltered = [...quick, ...matches];
  paletteActive = 0;
  renderPaletteResults(q);
}
function renderPaletteResults(q) {
  const box = $("#paletteResults");
  if (!paletteFiltered.length) { box.innerHTML = `<div class="p-empty">No matches for “${esc(q)}”.</div>`; return; }
  let html = "", lastType = null;
  paletteFiltered.forEach((r, i) => {
    if (r.type !== lastType) { html += `<div class="p-group-label">${r.type}</div>`; lastType = r.type; }
    html += `<div class="p-item ${i === paletteActive ? "active" : ""}" data-pi="${i}">
      ${icon(r.ic, 15, "p-ic")}<span>${esc(r.label)}</span>${r.sub ? `<span class="p-sub">${esc(r.sub)}</span>` : ""}</div>`;
  });
  box.innerHTML = html;
}
function runPalette(i) {
  const r = paletteFiltered[i]; if (!r) return;
  closePalette();
  if (r.act) r.act();
  else if (r.to.startsWith("#drawer:")) openFromToken(r.to);
  else navigate(r.to);
}

/* handle "#drawer:kind:id" pseudo-routes from rows / palette */
function openFromToken(tok) {
  const [, kind, id] = tok.split(":");
  if (kind === "product") productDrawer(id);
  else if (kind === "customer") partyDrawer("customer", id);
  else if (kind === "supplier") partyDrawer("supplier", id);
}

/* ---------------------------------------------------------------
   12. theme
--------------------------------------------------------------- */
function currentTheme() {
  const ex = document.documentElement.getAttribute("data-theme");
  if (ex) return ex;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyThemeIcon() {
  $("#themeIcon").innerHTML = currentTheme() === "dark" ? P.sun : P.moon;
}
function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("wc-proto-theme", next); } catch (e) {}
  applyThemeIcon();
}
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem("wc-proto-theme"); } catch (e) {}
  if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
})();

/* ---------------------------------------------------------------
   13. viewport (re-render on breakpoint change for table<->card)
--------------------------------------------------------------- */
function vpName() {
  if (matchMedia("(max-width:767.98px)").matches) return "mobile";
  if (matchMedia("(max-width:1023.98px)").matches) return "ipad-portrait";
  if (matchMedia("(max-width:1200px)").matches) return "laptop";
  return "desktop";
}
let lastVp = vpName();
let lastCards = isMobile();
document.documentElement.dataset.vp = lastVp;
["(max-width:767.98px)", "(max-width:1023.98px)", "(max-width:1200px)"].forEach((q) => {
  const mq = matchMedia(q);
  const on = () => {
    const v = vpName(), cards = isMobile();
    if (v !== lastVp || cards !== lastCards) {
      lastVp = v; lastCards = cards; document.documentElement.dataset.vp = v; render();
    }
  };
  mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
});

/* ---------------------------------------------------------------
   14. global event wiring
--------------------------------------------------------------- */
function handleAction(act, ds, e) {
  switch (act) {
    case "nav": navigate(ds.to); if (isMobile()) setNav(false); break;
    case "row": ds.to.startsWith("#drawer:") ? openFromToken(ds.to) : navigate(ds.to); break;
    case "open-drawer": openFromToken(ds.to); break;
    case "close-drawer": closeDrawer(); break;
    case "palette": setNav(false); openPalette(); break;
    case "toast": toast(ds.msg || "Prototype action", "warn"); break;
    case "theme": toggleTheme(); break;
    case "sidebar-toggle":
      $("#app").classList.toggle("sidebar-collapsed");
      try { localStorage.setItem("wc-proto-sidebar", $("#app").classList.contains("sidebar-collapsed") ? "1" : "0"); } catch (e) {}
      break;
    case "open-nav": setNav(true); break;
    case "reset-demo":
      confirmDialog({ title: "Reset the demo?", body: "Restores every order, receipt and transfer to its starting state.", confirmLabel: "Reset", danger: true, onConfirm: () => { resetDB(); toast("Demo reset", "ok"); render(); } });
      break;
    case "ptab": navigate("#/products?tab=" + ds.tab); break;
    case "psearch": break;
    case "stab": navigate("#/sales" + (ds.status === "all" ? "" : "?status=" + ds.status)); break;
    case "potab": navigate("#/purchase-orders" + (ds.status === "all" ? "" : "?status=" + ds.status)); break;
    case "trtab": navigate("#/transfers" + (ds.status === "all" ? "" : "?status=" + ds.status)); break;
    case "sort": setSort(ds.col); break;
    case "so-act": soAct(ds.id, ds.op); break;
    case "po-act": poAct(ds.id, ds.op); break;
    case "po-receive": poReceiveSubmit(ds.id); break;
    case "tr-act": trAct(ds.id, ds.op); break;
    case "tr-receive": trReceiveSubmit(ds.id); break;
    case "pick-step": pickStep(ds.id, +ds.idx, +ds.dir); break;
    case "pack-step": packStep(ds.id, +ds.idx, +ds.dir); break;
    case "pick-complete": pickComplete(ds.id); break;
    case "pack-complete": packComplete(ds.id); break;
    case "scan-go": { const v = $("#scanInput").value.trim(); const id = parseHash().id; doScan(id, v); $("#scanInput").value = ""; break; }
    case "scan-go-pack": { const v = $("#scanInput").value.trim(); const id = parseHash().id; doScanPack(id, v); $("#scanInput").value = ""; break; }
    case "party-delete":
      confirmDialog({
        title: "Delete this record?", danger: true, confirmLabel: "Delete",
        onConfirm: () => {
          const arr = ds.kind === "customer" ? DB.customers : DB.suppliers;
          const i = arr.findIndex((x) => x.id === ds.id);
          if (i > -1) arr.splice(i, 1);
          saveDB(); closeDrawer(); toast("Record deleted", "ok"); render();
        },
      });
      break;
  }
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (t) { e.preventDefault(); handleAction(t.dataset.act, t.dataset, e); return; }
  // palette item
  const pi = e.target.closest(".p-item");
  if (pi) { runPalette(+pi.dataset.pi); return; }
  // scrims / overlays
  if (e.target.id === "drawerScrim") closeDrawer();
  if (e.target.id === "paletteOverlay") closePalette();
  if (e.target.id === "modalOverlay") modalClose();
  if (e.target.id === "sidebarScrim") setNav(false);
});

// direct topbar bindings
$("#themeBtn").addEventListener("click", toggleTheme);
$("#searchTrigger").addEventListener("click", openPalette);
$("#hamburger").addEventListener("click", () => setNav(!$("#app").classList.contains("nav-open")));
$("#userChip").addEventListener("click", () => toast("A. Thanawat · ADMIN · (prototype user menu)", "warn"));
$("#notifBtn").addEventListener("click", () => toast("No notifications — placeholder only in V1.", "warn"));

// palette input
$("#paletteInput").addEventListener("input", (e) => filterPalette(e.target.value));
$("#paletteInput").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); paletteActive = Math.min(paletteFiltered.length - 1, paletteActive + 1); renderPaletteResults($("#paletteInput").value); }
  else if (e.key === "ArrowUp") { e.preventDefault(); paletteActive = Math.max(0, paletteActive - 1); renderPaletteResults($("#paletteInput").value); }
  else if (e.key === "Enter") { e.preventDefault(); runPalette(paletteActive); }
});

// keyboard: Cmd/Ctrl+K, Esc, [ to collapse
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#paletteOverlay").classList.contains("show") ? closePalette() : openPalette(); return; }
  if (e.key === "Escape") {
    if ($("#paletteOverlay").classList.contains("show")) return closePalette();
    if ($("#modalOverlay").classList.contains("show")) return modalClose();
    if ($("#drawer").classList.contains("open")) return closeDrawer();
    if ($("#app").classList.contains("nav-open")) return setNav(false);
  }
  if (e.key === "[" && !/input|textarea/i.test((e.target.tagName || ""))) handleAction("sidebar-toggle", {});
  // keyboard activation for sortable column headers — same three-state cycle as click
  if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
    const th = e.target.closest && e.target.closest('[data-act="sort"]');
    if (th) { e.preventDefault(); handleAction("sort", th.dataset, e); }
  }
});

/* live product search (delegated input) */
document.addEventListener("input", (e) => {
  const t = e.target.closest('[data-act="psearch"]');
  if (!t) return;
  const v = t.value;
  clearTimeout(window._psT);
  window._psT = setTimeout(() => {
    const r = parseHash();
    const tab = r.query.tab || "all";
    const next = `#/products?tab=${tab}` + (v ? `&q=${encodeURIComponent(v)}` : "");
    let replaced = false;
    try { history.replaceState(null, "", next); replaced = true; } catch (e) {}
    if (replaced) render(); else { location.hash = next; }
    const el = document.querySelector('[data-act="psearch"]');
    if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
  }, 160);
});

/* ---------------------------------------------------------------
   15. init
--------------------------------------------------------------- */
(function init() {
  try { if (localStorage.getItem("wc-proto-sidebar") === "1") $("#app").classList.add("sidebar-collapsed"); } catch (e) {}
  applyThemeIcon();
  $("#kHint").textContent = navigator.platform.toLowerCase().includes("mac") ? "⌘ K" : "Ctrl K";
  if (!location.hash || location.hash === "#" || location.hash === "#/" || location.hash.startsWith("#drawer:")) location.hash = "#/dashboard";
  render();
})();

})();
