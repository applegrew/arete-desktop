import { useControlledValue } from '../useControlledValue';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { ColorPicker as PrimeColorPicker } from 'primereact/colorpicker';
import { useAction } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const colorPickerSchema = z.object({
  value: z.string().optional(),
  inline: z.boolean().optional(),
  format: z.enum(['hex', 'rgb', 'hsb']).optional(),
  label: z.string().optional(),
  weight: z.number().optional(),
  action: actionSchema.optional(),
});

export const ColorPickerApi: ComponentApi<typeof colorPickerSchema> = {
  name: 'ColorPicker',
  schema: colorPickerSchema,
};

export const ColorPicker = createComponentImplementation(ColorPickerApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });
  const [value, setValue] = useControlledValue<string>(props.value, '#000000');

  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' };
  const wrapStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column',
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <div style={wrapStyle}>
      {props.label && <label style={labelStyle}>{props.label}</label>}
      <PrimeColorPicker
        value={value}
        inline={props.inline}
        format={props.format ?? 'hex'}
        onChange={(e) => {
          const v = typeof e.value === 'string' ? e.value : `#${e.value?.toString() ?? '000000'}`;
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
