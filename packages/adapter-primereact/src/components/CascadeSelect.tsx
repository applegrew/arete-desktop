import { useControlledValue } from '../useControlledValue';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { CascadeSelect as PrimeCascadeSelect } from 'primereact/cascadeselect';
import { useAction } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const cascadeSelectSchema = z.object({
  value: z.unknown().optional(),
  options: z.array(z.unknown()),
  placeholder: z.string().optional(),
  label: z.string().optional(),
  weight: z.number().optional(),
  action: actionSchema.optional(),
});

export const CascadeSelectApi: ComponentApi<typeof cascadeSelectSchema> = {
  name: 'CascadeSelect',
  schema: cascadeSelectSchema,
};

export const CascadeSelect = createComponentImplementation(CascadeSelectApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });
  const [value, setValue] = useControlledValue<unknown>(props.value, null);

  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' };
  const wrapStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column',
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <div style={wrapStyle}>
      {props.label && <label style={labelStyle}>{props.label}</label>}
      <PrimeCascadeSelect
        value={value as string | null}
        options={props.options as []}
        placeholder={props.placeholder ?? 'Select…'}
        onChange={(e) => {
          setValue(e.value);
          if (props.action) {
            dispatchAction({
              name: props.action.event.name,
              context: { value: e.value, ...(props.action.event.context ?? {}) },
            });
          }
        }}
        style={{ minWidth: 200 }}
      />
    </div>
  );
});
