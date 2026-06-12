import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { DataTable as PrimeDataTable, type DataTableRowClickEvent, type DataTablePageEvent } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { useAction, useReportDiagnostics, type DiagnosticInput } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const columnSchema = z.object({
  /** Key into each row object. */
  field: z.string(),
  /** Column header label (defaults to `field`). */
  header: z.string().optional(),
  sortable: z.boolean().optional(),
});

const dataTableSchema = z.object({
  columns: z.array(columnSchema),
  /** Row objects keyed by the columns' `field`s. In lazy mode this is just the current page. */
  data: z.array(z.record(z.unknown())),
  /** Page size. Enables built-in client-side pagination when > 0 (and the page size in lazy mode). */
  rowsPerPage: z.number().optional(),
  title: z.string().optional(),
  weight: z.number().optional(),
  /**
   * Server-side / lazy pagination: `data` holds only the current page; the table
   * shows `totalRecords` total and fires `pageAction` on page change so the agent
   * (or a data tool) returns the next page. No client-side slicing.
   */
  lazy: z.boolean().optional(),
  /** Zero-based index of the first row in `data` (lazy mode). */
  first: z.number().optional(),
  /** Total row count across all pages (lazy mode). */
  totalRecords: z.number().optional(),
  /** Show a loading overlay while the next page is being fetched (lazy mode). */
  loading: z.boolean().optional(),
  /**
   * Optional action fired on row click. Auto-context: `{ row, index }` merged
   * with any spec-declared context.
   */
  action: actionSchema.optional(),
  /**
   * Lazy-mode action fired on page change. Auto-context: `{ first, rows, page }`.
   * The agent should reply by updating this same surface with that page's `data`
   * and the new `first`.
   */
  pageAction: actionSchema.optional(),
});

export const DataTableApi: ComponentApi<typeof dataTableSchema> = {
  name: 'DataTable',
  schema: dataTableSchema,
};

export const DataTable = createComponentImplementation(DataTableApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });
  const action = props.action;

  // Spec-level rendering problems → fed back to the agent loop for self-correction.
  const diagnostics: DiagnosticInput[] = [];
  if (props.columns.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'datatable.no-columns',
      message: 'DataTable has no columns, so nothing renders. Provide a non-empty columns array.',
    });
  }
  useReportDiagnostics(context.componentModel.id, diagnostics);

  const lazy = props.lazy === true;
  const pageAction = props.pageAction;
  const paginator = lazy || (typeof props.rowsPerPage === 'number' && props.rowsPerPage > 0);
  const rows = props.rowsPerPage ?? (lazy ? props.data.length || 10 : undefined);

  // Lazy/server-pagination props are spread ONLY in lazy mode — passing them
  // (even as undefined) in client mode disturbs PrimeReact's internal paging.
  const lazyProps: Record<string, unknown> = lazy
    ? {
        lazy: true,
        first: props.first ?? 0,
        totalRecords: props.totalRecords ?? props.data.length,
        loading: props.loading,
        onPage: pageAction
          ? (e: DataTablePageEvent) =>
              dispatchAction({
                name: pageAction.event.name,
                context: { first: e.first, rows: e.rows, page: e.page, ...(pageAction.event.context ?? {}) },
              })
          : undefined,
      }
    : {};

  const style: React.CSSProperties = {
    width: '100%',
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <div style={style}>
      {props.title && (
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text, #e5e7eb)' }}>
          {props.title}
        </div>
      )}
      <PrimeDataTable
        value={props.data}
        paginator={paginator}
        rows={paginator ? rows : undefined}
        {...lazyProps}
        size="small"
        stripedRows
        removableSort
        emptyMessage="No rows"
        style={{ cursor: action ? 'pointer' : 'default' }}
        onRowClick={
          action
            ? (e: DataTableRowClickEvent) =>
                dispatchAction({
                  name: action.event.name,
                  context: { row: e.data, index: e.index, ...(action.event.context ?? {}) },
                })
            : undefined
        }
      >
        {props.columns.map((c) => (
          <Column key={c.field} field={c.field} header={c.header ?? c.field} sortable={c.sortable ?? true} />
        ))}
      </PrimeDataTable>
    </div>
  );
});
