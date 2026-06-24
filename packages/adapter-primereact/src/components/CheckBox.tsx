import { useId } from 'react';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Checkbox } from 'primereact/checkbox';
import { useAction } from '@arete-desktop/core';
import { useControlledValue } from '../useControlledValue';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

// Custom schema (the basic_catalog CheckBoxApi has no `action`). A checkbox toggle
// dispatches `action` with auto-context `{ value }` — the same contract as InputSwitch —
// so the agent can react to marking/unmarking (e.g. persist the change).
const checkBoxSchema = z.object({
  value: z.boolean().optional(),
  label: z.string().optional(),
  action: actionSchema.optional(),
});

export const CheckBoxApi: ComponentApi<typeof checkBoxSchema> = {
  name: 'CheckBox',
  schema: checkBoxSchema,
};

export const CheckBox = createComponentImplementation(CheckBoxApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });
  const [value, setValue] = useControlledValue<boolean>(props.value, false);
  const uniqueId = useId();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Checkbox
        inputId={uniqueId}
        checked={value}
        onChange={(e) => {
          const next = e.checked ?? false;
          setValue(next);
          if (props.action) {
            dispatchAction({
              name: props.action.event.name,
              context: { value: next, ...(props.action.event.context ?? {}) },
            });
          }
        }}
      />
      {props.label && (
        <label htmlFor={uniqueId} style={{ fontSize: 13, cursor: 'pointer' }}>
          {props.label}
        </label>
      )}
    </div>
  );
});
