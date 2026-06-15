import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { ProgressSpinner as PrimeProgressSpinner } from 'primereact/progressspinner';

const progressSpinnerSchema = z.object({
  strokeWidth: z.string().optional(),
  animationDuration: z.string().optional(),
  label: z.string().optional(),
  weight: z.number().optional(),
});

export const ProgressSpinnerApi: ComponentApi<typeof progressSpinnerSchema> = {
  name: 'ProgressSpinner',
  schema: progressSpinnerSchema,
};

export const ProgressSpinner = createComponentImplementation(ProgressSpinnerApi, ({ props }) => {
  const wrapStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <div style={wrapStyle}>
      <PrimeProgressSpinner
        strokeWidth={props.strokeWidth ?? '2'}
        animationDuration={props.animationDuration ?? '2s'}
        style={{ width: 48, height: 48 }}
      />
      {props.label && <span style={{ fontSize: 13, color: 'var(--text-dim, #888)' }}>{props.label}</span>}
    </div>
  );
});
