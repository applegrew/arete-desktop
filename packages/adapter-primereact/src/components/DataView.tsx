import { Fragment } from 'react';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { DataView as PrimeDataView } from 'primereact/dataview';

const dataViewSchema = z.object({
  data: z.array(z.record(z.unknown())),
  layout: z.enum(['list', 'grid']).optional(),
  paginator: z.boolean().optional(),
  rows: z.number().optional(),
  rowsPerPageOptions: z.array(z.number()).optional(),
  title: z.string().optional(),
  weight: z.number().optional(),
  listTemplate: z.string().optional(),
  gridTemplate: z.string().optional(),
});

export const DataViewApi: ComponentApi<typeof dataViewSchema> = {
  name: 'DataView',
  schema: dataViewSchema,
};

export const DataView = createComponentImplementation(DataViewApi, ({ props, buildChild }) => {
  const style: React.CSSProperties = {
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  const data = Array.isArray(props.data) ? props.data : [];

  const itemTemplate = (item: Record<string, unknown>) => {
    const templateId = props.layout === 'grid' ? props.gridTemplate : props.listTemplate;
    if (templateId) {
      return buildChild(templateId);
    }
    return (
      <div style={{ padding: 8 }}>
        {Object.entries(item).map(([k, v]) => (
          <div key={k} style={{ fontSize: 13 }}>
            <strong>{k}:</strong> {String(v ?? '')}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={style}>
      {props.title && (
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--text, #e5e7eb)' }}>{props.title}</div>
      )}
      <PrimeDataView
        value={data}
        layout={props.layout ?? 'list'}
        paginator={props.paginator}
        rows={props.rows}
        rowsPerPageOptions={props.rowsPerPageOptions}
        itemTemplate={itemTemplate}
      />
    </div>
  );
});
