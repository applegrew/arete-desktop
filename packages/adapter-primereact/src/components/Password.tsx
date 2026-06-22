import { useControlledValue } from '../useControlledValue';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Password as PrimePassword } from 'primereact/password';
import { useAction } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const passwordSchema = z.object({
  value: z.string().optional(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  feedback: z.boolean().optional(),
  toggleMask: z.boolean().optional(),
  weight: z.number().optional(),
  action: actionSchema.optional(),
});

export const PasswordApi: ComponentApi<typeof passwordSchema> = {
  name: 'Password',
  schema: passwordSchema,
};

export const Password = createComponentImplementation(PasswordApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });
  const [value, setValue] = useControlledValue<string>(props.value, '');

  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' };
  const wrapStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column',
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <div style={wrapStyle}>
      {props.label && <label style={labelStyle}>{props.label}</label>}
      <PrimePassword
        value={value}
        placeholder={props.placeholder}
        feedback={props.feedback ?? true}
        toggleMask={props.toggleMask}
        onChange={(e) => {
          setValue(e.target.value);
          if (props.action) {
            dispatchAction({
              name: props.action.event.name,
              context: { value: e.target.value, ...(props.action.event.context ?? {}) },
            });
          }
        }}
      />
    </div>
  );
});
