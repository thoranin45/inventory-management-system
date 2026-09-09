"use client";

import * as React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { useSession } from "@/components/session-provider";
import { canShowAction } from "@/lib/auth/permissions";
import { isApiError } from "@/lib/api/errors";
import { masterDataErrorCopy } from "@/lib/api/schemas/master-data";
import { useListParams } from "@/lib/list-params";
import { DeleteConfirmDialog, toastMutationError } from "./delete-confirm";

/* ------------------------------------------------------------------ types === */

export interface MasterField {
  name: string;
  label: string;
  kind?: "text" | "email" | "tel" | "textarea";
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
}

interface UseListResult<Row> {
  data?: { items: Row[]; pagination: { page: number; page_size: number; total_items: number; total_pages: number } };
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

interface Mutation<TArgs> {
  mutateAsync: (args: TArgs) => Promise<unknown>;
  isPending: boolean;
}

export interface MasterDataConfig<Row, Input> {
  /** singular lower-case noun, e.g. "category" */
  resource: string;
  title: string;
  /** subtitle given the current total */
  subtitle: (total: number | undefined) => string;
  searchPlaceholder: string;
  sortFields: readonly string[];
  columns: Column<Row>[];
  card: (row: Row) => { title: React.ReactNode; meta: React.ReactNode; badge?: React.ReactNode };
  /** zod schema for the create/edit form; its parse output must be `Input` */
  schema: z.ZodTypeAny;
  fields: MasterField[];
  /** row → form default values */
  toForm: (row: Row) => Record<string, string>;
  emptyForm: Record<string, string>;
  rowId: (row: Row) => number;
  rowName: (row: Row) => string;
  /** copy explaining what a delete does / when it is blocked */
  deleteBody: (row: Row) => React.ReactNode;
  deleteConfirmLabel?: string;
  useList: (query: Record<string, string | number | undefined>) => UseListResult<Row>;
  useCreate: () => Mutation<Input>;
  useUpdate: () => Mutation<{ id: number; patch: Input }>;
  useDelete: () => Mutation<number>;
}

/* ------------------------------------------------------------------- form === */

const inputCls =
  "min-h-11 w-full rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px] outline-none focus-visible:outline-2 focus-visible:outline-[var(--focus)]";

function zodFieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

function MasterForm<Row, Input>({
  cfg,
  row,
  onClose,
  onSaved,
  onRequestDelete,
}: {
  cfg: MasterDataConfig<Row, Input>;
  row: Row | null;
  onClose: () => void;
  onSaved: (mode: "create" | "edit") => void;
  onRequestDelete?: (row: Row) => void;
}) {
  const mode: "create" | "edit" = row ? "edit" : "create";
  const create = cfg.useCreate();
  const update = cfg.useUpdate();
  const pending = create.isPending || update.isPending;

  const [values, setValues] = React.useState<Record<string, string>>(() => (row ? cfg.toForm(row) : cfg.emptyForm));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<{ message: string; requestId?: string } | null>(null);

  const set = (name: string, v: string) => {
    setValues((s) => ({ ...s, [name]: v }));
    setErrors((e) => (e[name] ? { ...e, [name]: "" } : e));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = cfg.schema.safeParse(values);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    const payload = parsed.data as Input;
    try {
      if (mode === "create") await create.mutateAsync(payload);
      else await update.mutateAsync({ id: cfg.rowId(row as Row), patch: payload });
      toast.success(mode === "create" ? `${cfg.resource} created` : `${cfg.resource} updated`);
      onSaved(mode);
      onClose();
    } catch (error) {
      if (isApiError(error) && error.kind === "validation" && error.details.length) {
        const fieldErrs: Record<string, string> = {};
        for (const d of error.details) if (d.field) fieldErrs[d.field] = d.message;
        setErrors((prev) => ({ ...prev, ...fieldErrs }));
        if (!Object.keys(fieldErrs).length) {
          setFormError({ message: error.userMessage, requestId: error.requestId });
        }
        return;
      }
      if (isApiError(error)) {
        setFormError({
          message: masterDataErrorCopy(error.message) ?? error.userMessage,
          requestId: error.requestId,
        });
        return;
      }
      setFormError({ message: "Something went wrong." });
    }
  };

  return (
    // noValidate: our Zod messages are the source of truth, not the browser's
    // native email/required bubbles.
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {cfg.fields.map((f) => {
        const id = `md-${cfg.resource}-${f.name}`;
        return (
          <label key={f.name} className="flex flex-col gap-1" htmlFor={id}>
            <span className="text-[12px] font-semibold text-[var(--muted)]">
              {f.label}
              {f.required ? <span className="text-[var(--danger)]"> *</span> : null}
            </span>
            {f.kind === "textarea" ? (
              <textarea
                id={id}
                className={`${inputCls} min-h-[76px] py-2`}
                placeholder={f.placeholder}
                autoComplete={f.autoComplete}
                value={values[f.name] ?? ""}
                onChange={(e) => set(f.name, e.currentTarget.value)}
              />
            ) : (
              <input
                id={id}
                type={f.kind === "email" ? "email" : f.kind === "tel" ? "tel" : "text"}
                className={inputCls}
                placeholder={f.placeholder}
                autoComplete={f.autoComplete}
                value={values[f.name] ?? ""}
                onChange={(e) => set(f.name, e.currentTarget.value)}
              />
            )}
            {f.hint && !errors[f.name] ? <span className="text-[11px] text-[var(--faint)]">{f.hint}</span> : null}
            {errors[f.name] ? <span className="text-[11px] text-[var(--danger)]">{errors[f.name]}</span> : null}
          </label>
        );
      })}

      {formError ? (
        <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
          {formError.message}
          {formError.requestId ? (
            <span className="mt-1 block text-[11px] text-[var(--muted)]">
              Request ID: <span className="mono select-all">{formError.requestId}</span>
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-4 pt-3">
        {mode === "edit" && onRequestDelete && row ? (
          <Button variant="danger" className="mr-auto" onClick={() => onRequestDelete(row)}>
            Delete {cfg.resource}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? `Create ${cfg.resource}` : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

/* ----------------------------------------------------------------- screen === */

export function MasterDataScreen<Row, Input>({ cfg }: { cfg: MasterDataConfig<Row, Input> }) {
  const { user } = useSession();
  const canWrite = canShowAction(user.role, "master:write");
  const { state, setSearch, setPage, cycleSort } = useListParams({ sortOrder: "asc" });

  const query = React.useMemo(
    () => ({
      page: state.page,
      page_size: state.pageSize,
      search: state.search || undefined,
      sort_by: state.sortBy || undefined,
      sort_order: state.sortBy ? state.sortOrder : undefined,
    }),
    [state.page, state.pageSize, state.search, state.sortBy, state.sortOrder],
  );

  const { data, isLoading, isFetching, isError, error, refetch } = cfg.useList(query);
  const del = cfg.useDelete();

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [deleting, setDeleting] = React.useState<Row | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (row: Row) => {
    setEditing(row);
    setFormOpen(true);
  };

  const columns: Column<Row>[] = [
    ...cfg.columns,
    ...(canWrite
      ? [
          {
            key: "_actions",
            header: "",
            align: "right" as const,
            cell: (row: Row) => (
              <span className="inline-flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Edit ${cfg.rowName(row)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(row);
                  }}
                >
                  <Pencil aria-hidden className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete ${cfg.rowName(row)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleting(row);
                  }}
                >
                  <Trash2 aria-hidden className="h-4 w-4 text-[var(--danger)]" />
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={cfg.title}
        subtitle={cfg.subtitle(data?.pagination.total_items)}
        actions={
          canWrite ? (
            <Button variant="primary" onClick={openCreate}>
              <Plus aria-hidden className="h-4 w-4" />
              New {cfg.resource}
            </Button>
          ) : null
        }
      />

      <SearchInput
        value={state.search}
        onCommit={setSearch}
        placeholder={cfg.searchPlaceholder}
        ariaLabel={`Search ${cfg.title.toLowerCase()}`}
        className="max-w-[320px]"
      />

      <DataTable<Row>
        columns={columns}
        rows={data?.items ?? []}
        getRowKey={(r) => String(cfg.rowId(r))}
        onRowActivate={canWrite ? openEdit : undefined}
        isLoading={isLoading}
        isFetching={isFetching}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        emptyMessage={`No ${cfg.title.toLowerCase()} yet.`}
        sort={state.sortBy ? { field: state.sortBy, order: state.sortOrder } : null}
        onSort={(field) => {
          if (!cfg.sortFields.includes(field)) return;
          cycleSort(field);
        }}
        pagination={
          data
            ? {
                page: data.pagination.page,
                pageSize: data.pagination.page_size,
                totalItems: data.pagination.total_items,
                totalPages: data.pagination.total_pages,
                onPageChange: setPage,
              }
            : undefined
        }
        renderCard={(row) => {
          const c = cfg.card(row);
          return {
            title: c.title,
            badge: c.badge,
            // The card is itself a <button> (row-activate) — never nest controls
            // here. Mobile: tap the card → edit drawer, which hosts Delete.
            meta: (
              <>
                {c.meta}
                {canWrite ? <span className="mt-1 w-full text-[11px] text-[var(--accent)]">Tap to edit</span> : null}
              </>
            ),
          };
        }}
      />

      {canWrite ? (
        <Drawer open={formOpen} onOpenChange={setFormOpen}>
          <DrawerContent title={editing ? `Edit ${cfg.resource}` : `New ${cfg.resource}`}>
            {formOpen ? (
              <MasterForm
                cfg={cfg}
                row={editing}
                onClose={() => setFormOpen(false)}
                onSaved={() => void refetch()}
                onRequestDelete={(row) => {
                  setFormOpen(false);
                  setDeleting(row);
                }}
              />
            ) : null}
          </DrawerContent>
        </Drawer>
      ) : null}

      {canWrite && deleting ? (
        <DeleteConfirmDialog
          open={!!deleting}
          onOpenChange={(v) => !v && setDeleting(null)}
          title={`Delete ${cfg.rowName(deleting)}?`}
          body={cfg.deleteBody(deleting)}
          confirmLabel={cfg.deleteConfirmLabel ?? `Delete ${cfg.resource}`}
          pending={del.isPending}
          onConfirm={async () => {
            await del.mutateAsync(cfg.rowId(deleting));
            toast.success(`${cfg.rowName(deleting)} deleted`);
            setDeleting(null);
            void refetch();
          }}
        />
      ) : null}
    </div>
  );
}

export { toastMutationError };
