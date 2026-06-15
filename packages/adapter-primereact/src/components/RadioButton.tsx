import { useState } from 'react';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { RadioButton as PrimeRadioButton } from 'primereact/radiobutton';
import { useAction } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const optionSchema = z.union([
  z.string(),
  z.object({ label: z.string(), value: z.unknown() }),
]);

const radioButtonSchema = z.object({
  value: z.unknown().optional(),
  options: z.array(optionSchema),
  label: z.string().optional(),
  weight: z.number().optional(),
  action: actionSchema.optional(),
});

export const RadioButtonApi: ComponentApi<typeof radioButtonSchema> = {
  name: 'RadioButton',
  schema: radioButtonSchema,
};

function normalizeOptions(options: (string | { label: string; value?: unknown })[]): { label: string; value: unknown }[] {
  return options.map((o) =>
    typeof o === 'string' ? { label: o, value: o } : { label: o.label, value: o.value },
  );
}

export const RadioButton = createComponentImplementation(RadioButtonApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });
  const [value, setValue] = useState<unknown>(props.value);

  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' };
  const wrapStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 4,
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  const options = normalizeOptions(props.options ?? []);

  return (
    <div style={wrapStyle}>
      {props.label && <label style={labelStyle}>{props.label}</label>}
      {options.map((opt, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PrimeRadioButton
            inputId={`rb-${i}`}
            value={opt.value}
            checked={value === opt.value}
            onChange={(e) => {
              setValue(e.value);
              if (props.action) {
                dispatchAction({
                  name: props.action.event.name,
                  context: { value: e.value, ...(props.action.event.context ?? {}) },
                });
              }
            }}
          />
          <label htmlFor={`rb-${i}`} style={{ fontSize: 13, cursor: 'pointer' }}>{opt.label}</label>
        </div>
      ))}
    </div>
  );
});
