import { useState } from 'react';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { InputNumber as PrimeInputNumber } from 'primereact/inputnumber';
import { useAction } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const inputNumberSchema = z.object({
  value: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  suffix: z.string().optional(),
  prefix: z.string().optional(),
  currency: z.string().optional(),
  locale: z.string().optional(),
  placeholder: z.string().optional(),
  label: z.string().optional(),
  weight: z.number().optional(),
  action: actionSchema.optional(),
});

export const InputNumberApi: ComponentApi<typeof inputNumberSchema> = {
  name: 'InputNumber',
  schema: inputNumberSchema,
};

export const InputNumber = createComponentImplementation(InputNumberApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });
  const [value, setValue] = useState<number | null>(props.value ?? null);

  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' };
  const wrapStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column',
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <div style={wrapStyle}>
      {props.label && <label style={labelStyle}>{props.label}</label>}
      <PrimeInputNumber
        value={value}
        min={props.min}
        max={props.max}
        step={props.step}
        suffix={props.suffix}
        prefix={props.prefix}
        currency={props.currency}
        locale={props.locale}
        placeholder={props.placeholder}
        onChange={(e) => {
          setValue(e.value ?? null);
          if (props.action) {
            dispatchAction({
              name: props.action.event.name,
              context: { value: e.value, ...(props.action.event.context ?? {}) },
            });
          }
        }}
      />
    </div>
  );
});
