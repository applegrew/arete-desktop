import { useState } from 'react';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { InputSwitch as PrimeInputSwitch } from 'primereact/inputswitch';
import { useAction } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const inputSwitchSchema = z.object({
  value: z.boolean().optional(),
  label: z.string().optional(),
  weight: z.number().optional(),
  action: actionSchema.optional(),
});

export const InputSwitchApi: ComponentApi<typeof inputSwitchSchema> = {
  name: 'InputSwitch',
  schema: inputSwitchSchema,
};

export const InputSwitch = createComponentImplementation(InputSwitchApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });
  const [value, setValue] = useState<boolean>(props.value ?? false);

  const wrapStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <div style={wrapStyle}>
      <PrimeInputSwitch
        checked={value}
        onChange={(e) => {
          setValue(e.value ?? false);
          if (props.action) {
            dispatchAction({
              name: props.action.event.name,
              context: { value: e.value, ...(props.action.event.context ?? {}) },
            });
          }
        }}
      />
      {props.label && <span style={{ fontSize: 13 }}>{props.label}</span>}
    </div>
  );
});
