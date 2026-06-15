import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Fieldset as PrimeFieldset } from 'primereact/fieldset';

const fieldsetSchema = z.object({
  legend: z.string().optional(),
  child: z.string().optional(),
  toggleable: z.boolean().optional(),
  collapsed: z.boolean().optional(),
  weight: z.number().optional(),
});

export const FieldsetApi: ComponentApi<typeof fieldsetSchema> = {
  name: 'Fieldset',
  schema: fieldsetSchema,
};

export const Fieldset = createComponentImplementation(FieldsetApi, ({ props, buildChild }) => {
  const style: React.CSSProperties = {
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <PrimeFieldset
      legend={props.legend}
      toggleable={props.toggleable}
      collapsed={props.collapsed}
      style={style}
    >
      {props.child ? buildChild(props.child) : null}
    </PrimeFieldset>
  );
});
