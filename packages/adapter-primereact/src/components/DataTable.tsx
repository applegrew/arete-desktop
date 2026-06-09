import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { DataTable as PrimeDataTable, type DataTableRowClickEvent } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { useAction, useReportDiagnostics, type DiagnosticInput } from '@arete-ui/core';

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
  /** Row objects keyed by the columns' `field`s. */
  data: z.array(z.record(z.unknown())),
  /** Enables built-in client-side pagination when > 0. */
  rowsPerPage: z.number().optional(),
  title: z.string().optional(),
  weight: z.number().optional(),
  /**
   * Optional action fired on row click. Auto-context: `{ row, index }` merged
   * with any spec-declared context.
   */
  action: actionSchema.optional(),
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

  const paginator = typeof props.rowsPerPage === 'number' && props.rowsPerPage > 0;

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
        rows={paginator ? props.rowsPerPage : undefined}
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
