import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Chart as PrimeChart } from 'primereact/chart';
import { useAction, useReportDiagnostics, type DiagnosticInput } from '@arete-ui/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const chartSchema = z.object({
  type: z.enum(['pie', 'doughnut', 'bar', 'line']).default('pie'),
  labels: z.array(z.string()),
  data: z.array(z.number()),
  colors: z.array(z.string()).optional(),
  title: z.string().optional(),
  weight: z.number().optional(),
  /**
   * Optional action fired when a chart segment / data point is clicked.
   * Auto-context merged in: `{ label, value, index }` for the clicked element.
   */
  action: actionSchema.optional(),
});

export const ChartApi: ComponentApi<typeof chartSchema> = {
  name: 'Chart',
  schema: chartSchema,
};

const DEFAULT_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
];

export const Chart = createComponentImplementation(ChartApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });
  const action = props.action;

  // Report spec-level rendering problems back to the agent loop so it can
  // self-correct (these are fixable by changing the emitted spec).
  const diagnostics: DiagnosticInput[] = [];
  if (props.labels.length !== props.data.length) {
    diagnostics.push({
      severity: 'warning',
      code: 'chart.labels-data-mismatch',
      message: `Chart has ${props.labels.length} labels but ${props.data.length} data values; they must be equal-length or bars/segments render unlabeled or missing.`,
    });
  }
  if (props.data.length === 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'chart.no-data',
      message: 'Chart has no data values, so nothing renders. Provide a non-empty data array.',
    });
  }
  useReportDiagnostics(context.componentModel.id, diagnostics);

  const colors =
    props.colors && props.colors.length > 0
      ? props.colors
      : DEFAULT_COLORS.slice(0, props.labels.length);

  // Per-segment legend (pie/doughnut) is driven by `labels`; bar/line legend is
  // driven by the dataset's `label`. Always set one so it never renders as
  // "undefined", and hide the (redundant) single-series legend on bar/line.
  const isCategorical = props.type === 'pie' || props.type === 'doughnut';

  const data = {
    labels: props.labels,
    datasets: [
      {
        label: props.title ?? 'Value',
        data: props.data,
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 1,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: isCategorical,
        position: 'bottom' as const,
        labels: { color: '#e5e7eb' },
      },
      title: props.title
        ? { display: true, text: props.title, color: '#e5e7eb' }
        : { display: false },
    },
    scales:
      props.type === 'bar' || props.type === 'line'
        ? {
            x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
            y: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
          }
        : undefined,
    onClick: action
      ? (_e: unknown, elements: Array<{ index: number }>) => {
          const first = elements[0];
          if (!first) return;
          const idx = first.index;
          const autoContext = {
            label: props.labels[idx],
            value: props.data[idx],
            index: idx,
          };
          dispatchAction({
            name: action.event.name,
            context: { ...autoContext, ...(action.event.context ?? {}) },
          });
        }
      : undefined,
  };

  const style: React.CSSProperties = {
    width: '100%',
    height: 240,
    cursor: action ? 'pointer' : 'default',
    ...(typeof props.weight === 'number'
      ? { flex: props.weight, minWidth: 0, minHeight: 0 }
      : {}),
  };

  return (
    <div style={style}>
      <PrimeChart type={props.type} data={data} options={options} style={{ height: '100%' }} />
    </div>
  );
});
