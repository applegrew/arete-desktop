import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { ProgressBar as PrimeProgressBar } from 'primereact/progressbar';

const progressBarSchema = z.object({
  value: z.number().optional(),
  showValue: z.boolean().optional(),
  mode: z.enum(['determinate', 'indeterminate']).optional(),
  color: z.string().optional(),
  label: z.string().optional(),
  weight: z.number().optional(),
});

export const ProgressBarApi: ComponentApi<typeof progressBarSchema> = {
  name: 'ProgressBar',
  schema: progressBarSchema,
};

export const ProgressBar = createComponentImplementation(ProgressBarApi, ({ props }) => {
  const wrapStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 4,
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <div style={wrapStyle}>
      {props.label && <span style={{ fontSize: 13, fontWeight: 600 }}>{props.label}</span>}
      <PrimeProgressBar
        value={props.value ?? 0}
        showValue={props.showValue ?? true}
        mode={props.mode ?? 'determinate'}
        color={props.color}
        style={{ height: 6 }}
      />
    </div>
  );
});
