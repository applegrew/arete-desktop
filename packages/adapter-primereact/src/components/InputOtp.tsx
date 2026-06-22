import { useControlledValue } from '../useControlledValue';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { InputOtp as PrimeInputOtp } from 'primereact/inputotp';
import { useAction } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const inputOtpSchema = z.object({
  value: z.string().optional(),
  length: z.number().optional(),
  mask: z.boolean().optional(),
  integerOnly: z.boolean().optional(),
  label: z.string().optional(),
  weight: z.number().optional(),
  action: actionSchema.optional(),
});

export const InputOtpApi: ComponentApi<typeof inputOtpSchema> = {
  name: 'InputOtp',
  schema: inputOtpSchema,
};

export const InputOtp = createComponentImplementation(InputOtpApi, ({ props, context }) => {
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
      <PrimeInputOtp
        value={value}
        length={props.length ?? 4}
        mask={props.mask}
        integerOnly={props.integerOnly}
        onChange={(e) => {
          setValue(e.value != null ? String(e.value) : '');
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
