import { useControlledValue } from '../useControlledValue';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Chips as PrimeChips } from 'primereact/chips';
import { useAction } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const chipsSchema = z.object({
  value: z.array(z.string()).optional(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  separator: z.string().optional(),
  max: z.number().optional(),
  weight: z.number().optional(),
  action: actionSchema.optional(),
});

export const ChipsApi: ComponentApi<typeof chipsSchema> = {
  name: 'Chips',
  schema: chipsSchema,
};

export const Chips = createComponentImplementation(ChipsApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });
  const [value, setValue] = useControlledValue<string[]>(props.value, []);

  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' };
  const wrapStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column',
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <div style={wrapStyle}>
      {props.label && <label style={labelStyle}>{props.label}</label>}
      <PrimeChips
        value={value}
        placeholder={props.placeholder}
        separator={props.separator}
        max={props.max}
        onChange={(e) => {
          setValue(e.value ?? []);
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
