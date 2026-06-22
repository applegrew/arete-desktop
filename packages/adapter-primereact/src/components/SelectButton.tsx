import { useControlledValue } from '../useControlledValue';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { SelectButton as PrimeSelectButton } from 'primereact/selectbutton';
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

const selectButtonSchema = z.object({
  value: z.unknown().optional(),
  options: z.array(optionSchema),
  multiple: z.boolean().optional(),
  label: z.string().optional(),
  weight: z.number().optional(),
  action: actionSchema.optional(),
});

export const SelectButtonApi: ComponentApi<typeof selectButtonSchema> = {
  name: 'SelectButton',
  schema: selectButtonSchema,
};

function normalizeOptions(options: (string | { label: string; value?: unknown })[]): { label: string; value: unknown }[] {
  return options.map((o) =>
    typeof o === 'string' ? { label: o, value: o } : { label: o.label, value: o.value },
  );
}

export const SelectButton = createComponentImplementation(SelectButtonApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });
  const [value, setValue] = useControlledValue<unknown>(props.value, props.multiple ? [] : null);

  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' };
  const wrapStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column',
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <div style={wrapStyle}>
      {props.label && <label style={labelStyle}>{props.label}</label>}
      <PrimeSelectButton
        value={value}
        options={normalizeOptions(props.options ?? [])}
        optionLabel="label"
        multiple={props.multiple}
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
    </div>
  );
});
