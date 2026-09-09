# Warehouse Console — Phase 0.5 clickable prototype

A standalone, **no-build** interactive prototype of the Industrial Premium
design system from the approved Frontend Phase 0 blueprint. It exists for
**UX validation only** — mock data, no backend, no framework.

> This is **not** production source. It does not call FastAPI. It does not
> change any backend behaviour. Phase 1 (the real Next.js app) has not started.

## Run it

Open `index.html` in a browser. That's it.

```
frontend-prototype/
  index.html    – app shell markup + overlay mounts
  styles.css    – the Industrial Premium token system + components
  app.js        – vanilla hash-router, mock data, all interactions
  README.md     – this file
```

No server, no `npm install`, no bundler. An internet connection is only used
to load the web fonts (Sarabun for UI text — Thai-friendly — plus IBM Plex
Mono for data) from Google Fonts; offline it falls back to system fonts and
still works.

Tested in current Chrome, Edge, Firefox and Safari.

## What to try

| Area | Do this |
|---|---|
| **Command palette** | Press <kbd>Ctrl/⌘ K</kbd>. Search `coffee`, `SO-104829`, `PO-2087`, `Siam`. Run a quick action. |
| **Dashboard** | Click any metric tile, queue row, or attention card — each navigates to the matching filtered screen. |
| **Products / Stock** | Filter tabs (All / Low / Near expiry / Expired / In transit), search, sort a column, click a row → **right-side drawer** (batches, locations, breakdown). <kbd>Esc</kbd> closes it. |
| **Picking** `#/picking/104829` | Type a mock barcode + <kbd>Enter</kbd> (or use `+`/`−`): <br>`885000000001` correct scan (success flash + count + beep) · `885000000002` **ambiguous lot** → allocation picker · `885000000003` **wrong item** (red, no change) · scan `885000000001` a 7th time → **over-scan blocked**. “Complete picking” stays disabled until every line is full. |
| **Packing** `#/packing/104832` | Verify picked → packed by scanning; mismatch is rejected. Packing-slip and shipping-label data previews on the right. |
| **Purchase order receiving** `#/purchase-orders/2087` | Confirm the draft, then receive `3.00` → 30 %, receive `2.00` → 50 %. Batch line shows lot + mfg + expiry fields; non-batch lines don’t. The Idempotency-Key is generated once per receipt and never shown. |
| **Transfer** `#/transfers/3313` | See SOURCE → **IN TRANSIT** → DESTINATION with dispatched / outstanding / received. Receive the remaining `80.00` → transfer completes. `#/transfers/3314` is a draft you can **Dispatch**. |
| **Theme** | Toggle in the top bar — instant, persisted to `localStorage`, both themes contrast-checked. |
| **Responsive** | Resize to ~1440 / 1024 / 834 / 390. Tables become cards on mobile; the sidebar becomes a slide-over on tablet; a bottom nav appears on mobile; the scan panel sticks to the bottom on small screens. |
| **Reset** | “Reset demo” (sidebar foot or Dashboard) restores every order, receipt and transfer to its starting state. |

## Demo state

All workflow progress (order status, picked/packed counts, PO receipts,
transfer receipts) is kept in JavaScript and mirrored to `localStorage`
(`wc-proto-db-v1`). It persists as you click around and across reloads until
you **Reset demo**. Theme lives in `wc-proto-theme`; sidebar collapse in
`wc-proto-sidebar`.

## Mock data highlights

`WH-COFFEE-1KG` healthy + near-expiry lot · `WH-MILK-UHT-1L` has an **expired**
lot (blocks `SO-104836`) · `WH-SUGAR-25KG` **low stock** · `WH-FLOUR-1KG`
reserved + in transit · `WH-BOX-M` mostly in transit · `WH-SALT-500G`
non-batch (the wrong-item scan) · `WH-OIL-5L` batch-tracked but **not**
expiry-tracked · sales orders at every lifecycle state · `PO-2089` partially
received · `TRF-3313` in transit at 60 %. All quantities and money render
at a fixed 2-decimal precision (prototype display decision only — the backend
Decimal contract is unchanged).

## Known prototype compromises

- Create/edit forms (new order, new PO, new transfer, stock-in, product edit)
  are stubs that toast “opens in Phase 1” — the flows to validate here are the
  *lifecycle*, *scanning*, *receiving* and *navigation*, not data entry.
- Sorting is client-side on the mock array; pagination is a static footer.
- Barcode entry is keyboard/typed only (matches a hardware wedge scanner). No
  camera decoding — that’s deferred per the blueprint.
- One shared `sortState` across screens (cosmetic only).
- The audit log route from the blueprint is omitted (role-gated, low UX risk).

## Refinements over the first Phase 0.5 build

- **Font:** UI text uses **Sarabun** (Thai-friendly) consistently for body and
  headings; IBM Plex Mono is kept for data (SKUs, lots, quantities, IDs).
- **Decimals:** displayed quantities and money render at **2 places** (not 3).
  Display-only — the backend Decimal contract is unchanged.
- **Content gutter:** every screen is wrapped in `.screen` with a modest,
  balanced horizontal gutter (`--pad-l` / `--pad-r`, ~30 / 22px desktop,
  scaling down responsively) plus a `max-width` so wide displays are not
  edge-to-edge. Left inset is a little larger than the right so the page reads
  as deliberately inset from the sidebar divider.
- **Operational queues:** redesigned from the stacked narrow rows into an
  equal-height 5-up card grid (`.queue-grid` / `.queue-card`) — each card shows
  icon, count, queue name and a short description; it collapses to 3 / 2
  columns on smaller screens and sits as a full-width band aligned with the
  metric grid and the Needs-attention grid.
- **Dashboard header:** subtitle is lighter (`--faint`, 400 weight) with a
  touch more spacing; the title block aligns with the cards below.
