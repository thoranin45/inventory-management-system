# FIFO = earliest received first (P9)

**Rule (Owner decision, 2026-11-17).** `POST /api/v1/stock/out-fifo` issues
stock from the lot that was **received** earliest. Lot number and
manufacturing date play no part. Expiry plays no part either, except that
expired lots are never issued (see "FEFO / FIFO stock out" in
`database-v3.md`).

## How the server implements it

The FIFO key is `ProductBatch.created_at ASC, ProductBatch.id ASC`
(`StockRepository.get_fifo_batches_for_update`).

`created_at` is the receipt time because a lot only comes into existence by
being received, and only once:

| Way stock of a lot enters | Creates the lot? | Where |
| --- | --- | --- |
| `POST /batches` (Stock In of a lot) | Yes, in the same transaction as the receipt movement | `batch_service.create_batch_service` |
| `POST /purchase-orders/{id}/receive` with `lot_no` | Yes, in the receipt transaction | `purchase_order_service` (`create_if_lot_not_exists`) |
| Receiving an **existing** lot again, by either path | No. Refused with 409 `DuplicateLotNumber` | both services |
| Transfer receive, sales return, adjustment | No. Moves stock of an existing lot, keeping its place in the FIFO order | transfer, sales-return and adjustment services |
| `POST /stock/in` | Batch-tracked products are refused | `stock_service` |

`created_at` is PostgreSQL `now()`, the start time of the receiving
transaction. Two lots received in the same transaction (one PO receipt with
two lots of one product) have the same time. Their tie is broken by `id`,
which is insertion order.

## What the screen shows

Each stock-balance row carries `batch_received_at`, the lot's
`created_at` (additive field). The Stock Out screen's FIFO preview lists lots
by `batch_received_at`, then `batch_id`, the same key the server uses. If any
row lacks the field, it lists the lots without claiming an order. The preview
is advisory. The server still selects the lots when the stock-out is confirmed.

## Tests

- `tests/test_p9_fifo_receipt_order.py`:
  - receipt order wins over lot number and expiry;
  - PO receipts and direct receipts interleave by receipt time;
  - a lot cannot be received twice by either path;
  - balance rows expose the FIFO key.
- `frontend/src/components/stock/stock-out-console.test.tsx`: preview order, the tie-break, and the fallback.
- `frontend/e2e/smoke/stock-out.spec.ts`: the full browser flow against a real database.

## Guard for future features

Any change that lets a lot exist **before** it is received, or lets the same lot
be received again, breaks the rule above. Examples:

- pre-registering lots from an ASN;
- "top up an existing lot";
- importing lots with historic dates.

Such a change must add an explicit `received_at` to `ProductBatch` (backfilled
from `created_at`), switch the FIFO order and `batch_received_at` to it, and
extend `tests/test_p9_fifo_receipt_order.py`.
