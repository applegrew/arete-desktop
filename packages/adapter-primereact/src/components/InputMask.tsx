import { useState } from 'react';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { InputMask as PrimeInputMask } from 'primereact/inputmask';
import { useAction } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const inputMaskSchema = z.object({
  value: z.string().optional(),
  mask: z.string(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  slotChar: z.string().optional(),
  weight: z.number().optional(),
  action: actionSchema.optional(),
});

export const InputMaskApi: ComponentApi<typeof inputMaskSchema> = {
  name: 'InputMask',
  schema: inputMaskSchema,
};

export const InputMask = createComponentImplementation(InputMaskApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });
  const [value, setValue] = useState<string>(props.value ?? '');

  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' };
  const wrapStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column',
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <div style={wrapStyle}>
      {props.label && <label style={labelStyle}>{props.label}</label>}
      <PrimeInputMask
        value={value}
        mask={props.mask}
        placeholder={props.placeholder}
        slotChar={props.slotChar ?? '_'}
        onChange={(e) => {
          const v = e.target.value ?? '';
          setValue(v);
          if (props.action) {
            dispatchAction({
              name: props.action.event.name,
              context: { value: v, ...(props.action.event.context ?? {}) },
            });
          }
        }}
      />
    </div>
  );
});
