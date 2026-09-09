# Repository Guidelines

## Project Structure & Module Organization

This is an existing production-oriented FastAPI inventory backend using Python 3.12. `app/main.py` assembles the application. Keep HTTP endpoints in `app/routers/`, business logic in `app/services/`, database access in `app/repositories/`, and Pydantic contracts in `app/schemas/`. SQLAlchemy models live in `app/models.py`; shared configuration, security, and transaction helpers live in `app/core/`.

`tests/` contains API and database tests. `alembic/versions/` holds schema migrations, `scripts/` contains maintenance utilities, and `docs/database-v3.md` documents database design. Generated files belong in `uploads/`, `exports/`, or `app/static/invoices/`. Docker and Nginx configuration lives at the root and in `nginx/`.

## Build, Test, and Development Commands

Run commands from the repository root with a Python 3.12 virtual environment activated:

- `python -m pip install -r requirements.txt`: install pinned dependencies.
- `alembic upgrade head`: apply migrations to the configured database.
- `uvicorn app.main:app --reload --port 8081`: start the local API.
- `python -m pytest`: run the test suite.
- `python -m pytest tests/test_stock.py`: run focused stock tests.
- `python -m pytest --cov=app --cov-report=term-missing --cov-fail-under=90`: enforce CI's 90% coverage threshold.
- `docker compose up --build`: build and start PostgreSQL, the API, and Nginx after configuring `.env.api` and `.env.db` from their example files.

## Coding Style & Naming Conventions

Always inspect and reuse existing models, schemas, repositories, services, routers, migrations, and conventions before creating new ones. Never redesign or rewrite working architecture without a demonstrated technical requirement. Do not create duplicate abstractions. Prefer small incremental changes and preserve API backward compatibility where reasonable.

Use four-space indentation, type annotations, `snake_case` functions/modules, and `PascalCase` classes. Follow feature suffixes such as `product_router.py`, `product_service.py`, and `product_repository.py`. Preserve the router/service/repository separation and use existing `UnitOfWork` transaction patterns. No formatter or linter is configured; match surrounding code.

## Inventory Integrity

- Every inventory change must be traceable through an inventory transaction. Never directly change stock without an auditable business transaction.
- Use database transactions for multi-step inventory operations; prevent duplicate processing where practical.
- Treat `on_hand`, `reserved`, and `available` as distinct concepts: `available = on_hand - reserved`.
- Prevent negative available inventory unless an existing documented business rule explicitly permits it.

## Orders, Receiving, Transfers & Batches

- **Orders:** Confirmation should reserve inventory when reservation is implemented. Picking and packing must not silently deduct physical inventory. Shipment must atomically deduct inventory and consume reservations, with protection against double processing. Cancellation before shipment must release reservations.
- **Purchase receiving:** Create traceable stock-in transactions and safely support partial receiving where required.
- **Transfers:** Preserve traceability from source to destination; never implement transfers as arbitrary direct edits of two stock quantities.
- **Batch/expiry:** Preserve batch/lot history, support expiry-aware inventory behavior, and keep the architecture compatible with FEFO (first-expired, first-out).

## Database Changes

All schema changes require Alembic migrations. Review foreign keys, unique constraints, indexes, nullability, and referential integrity.

## Testing Guidelines

Recorded baseline: **167 passed, 7 warnings on Python 3.12.10**. Run relevant tests after each change and the full suite before declaring a phase complete. Never delete tests or weaken assertions just to make tests pass. Add regression tests for bugs.

Tests use pytest, FastAPI `TestClient`, and shared fixtures in `tests/conftest.py`. Name files `test_*.py` and functions `test_*`. Cover successful operations, validation, authorization, and inventory integrity when relevant. CI runs against PostgreSQL 18 with a 90% coverage threshold. Use a dedicated test database through `TEST_DATABASE_URL`: fixtures drop and recreate its tables. Follow the secret-handling rules below.

## Commit & Pull Request Guidelines

History mixes imperative summaries with prefixes such as `feat:`, `docs:`, and `ci:`. Use concise, action-oriented subjects. PRs should explain behavior changes, link relevant issues, report validation results, and describe migration or configuration impacts. Ensure CI passes.

## Security & Configuration

Never print, expose, copy, commit, or modify secret values from `.env` files (including `.env.*`). Never commit credentials, populated environment files, database dumps, or generated exports; document configuration using placeholders in example files.

Do not modify `backups/`, `exports/`, `logs/`, `uploads/`, `venv/`, or `venv_py38_backup/` unless explicitly instructed.

## Workflow

1. Inspect.
2. Explain what already exists.
3. Identify gaps.
4. Propose the smallest coherent change.
5. Implement.
6. Add migration if necessary.
7. Add tests.
8. Run tests.
9. Inspect git diff.
10. Report changes and remaining risks.

## V1 Target

- Authentication; Admin/Warehouse roles; Dashboard.
- Products/SKU; Barcode/QR.
- Inventory; inventory transaction ledger; Stock In / Stock Out; Inventory Adjustment; Batch/Lot and Expiry.
- Sales Orders; Inventory Reservation; Picking/Packing/Shipping.
- Purchase Orders; partial and full PO receiving; Warehouse Transfers.
- Basic Reports; Audit Log; search/filter/sort/pagination where appropriate.

## Out of Scope for V1

- Accounting/General Ledger; AR/AP.
- Marketplace integrations; AI forecasting; automatic purchasing.
- Advanced picking waves; advanced warehouse routing; offline synchronization.
- Advanced permission designer.
