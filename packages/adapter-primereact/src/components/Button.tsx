import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Button as PrimeButton } from 'primereact/button';
import { useAction } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const buttonSchema = z.object({
  variant: z.enum(['primary', 'secondary', 'borderless']).optional(),
  /** Text label (the common case). Use `child` to render a custom component instead. */
  label: z.string().optional(),
  child: z.string().optional(),
  isValid: z.boolean().optional(),
  weight: z.number().optional(),
  /** Optional action fired on click. Auto-context: `{}` (imperative trigger). */
  action: actionSchema.optional(),
});

export const ButtonApi: ComponentApi<typeof buttonSchema> = {
  name: 'Button',
  schema: buttonSchema,
};

export const Button = createComponentImplementation(ButtonApi, ({ props, buildChild, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });
  const action = props.action;

  // Prefer an explicit `child` component; otherwise fall back to the `label` text.
  const childContent = props.child ? buildChild(props.child) : null;
  return (
    <PrimeButton
      label={childContent ? undefined : (props.label ?? '')}
      severity={props.variant === 'primary' ? 'info' : undefined}
      text={props.variant === 'borderless'}
      onClick={() => {
        if (!action) return;
        dispatchAction({
          name: action.event.name,
          context: action.event.context ?? {},
        });
      }}
      disabled={props.isValid === false}
      style={{
        ...(typeof props.weight === 'number'
          ? { flex: props.weight, minWidth: 0, minHeight: 0 }
          : {}),
      }}
    >
      {childContent}
    </PrimeButton>
  );
});
