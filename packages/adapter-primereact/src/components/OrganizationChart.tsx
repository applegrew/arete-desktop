import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { OrganizationChart as PrimeOrgChart } from 'primereact/organizationchart';
import { useAction, useReportDiagnostics, type DiagnosticInput } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const orgChartSchema = z.object({
  value: z.array(z.record(z.unknown())),
  selectionMode: z.enum(['single', 'multiple']).optional(),
  weight: z.number().optional(),
  action: actionSchema.optional(),
});

export const OrganizationChartApi: ComponentApi<typeof orgChartSchema> = {
  name: 'OrganizationChart',
  schema: orgChartSchema,
};

export const OrganizationChart = createComponentImplementation(OrganizationChartApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });

  const diagnostics: DiagnosticInput[] = [];
  if (!Array.isArray(props.value) || props.value.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'orgchart.no-data',
      message: 'OrganizationChart has no data; provide a non-empty array of tree node objects with label, children etc.',
    });
  }
  useReportDiagnostics(context.componentModel.id, diagnostics);

  const style: React.CSSProperties = {
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  const nodeTemplate = (node: Record<string, unknown>) => {
    const imgSrc = node.image ? String(node.image) : '';
    const label = String(node.label ?? node.name ?? '');
    const titleText = node.title ? String(node.title) : '';
    return (
      <div style={{ padding: 8, textAlign: 'center' }}>
        {imgSrc ? (
          <img src={imgSrc} alt="" style={{ width: 40, height: 40, borderRadius: '50%', marginBottom: 4 }} />
        ) : null}
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        {titleText ? <div style={{ fontSize: 11, color: '#888' }}>{titleText}</div> : null}
      </div>
    );
  };

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <PrimeOrgChart
      value={props.value as unknown as any}
      selectionMode={props.selectionMode}
      nodeTemplate={nodeTemplate}
      onNodeSelect={props.action ? (e: any) => {
        dispatchAction({
          name: props.action!.event.name,
          context: { node: e.data, ...(props.action!.event.context ?? {}) },
        });
      } : undefined}
      style={style}
    />
  );
});
