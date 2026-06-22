import { useControlledValue } from '../useControlledValue';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { TreeSelect as PrimeTreeSelect } from 'primereact/treeselect';
import { useAction } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const treeSelectSchema = z.object({
  value: z.unknown().optional(),
  options: z.array(z.unknown()),
  filter: z.boolean().optional(),
  placeholder: z.string().optional(),
  selectionMode: z.enum(['single', 'multiple', 'checkbox']).optional(),
  label: z.string().optional(),
  weight: z.number().optional(),
  action: actionSchema.optional(),
});

export const TreeSelectApi: ComponentApi<typeof treeSelectSchema> = {
  name: 'TreeSelect',
  schema: treeSelectSchema,
};

export const TreeSelect = createComponentImplementation(TreeSelectApi, ({ props, context }) => {
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
      <PrimeTreeSelect
        value={value as string | null}
        options={props.options as []}
        filter={props.filter}
        placeholder={props.placeholder ?? 'Select…'}
        selectionMode={props.selectionMode}
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
