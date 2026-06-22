import { useControlledValue } from '../useControlledValue';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Rating as PrimeRating, RatingChangeEvent } from 'primereact/rating';
import { useAction } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const ratingSchema = z.object({
  value: z.number().optional(),
  stars: z.number().optional(),
  cancel: z.boolean().optional(),
  readonly: z.boolean().optional(),
  label: z.string().optional(),
  weight: z.number().optional(),
  action: actionSchema.optional(),
});

export const RatingApi: ComponentApi<typeof ratingSchema> = {
  name: 'Rating',
  schema: ratingSchema,
};

export const Rating = createComponentImplementation(RatingApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });
  const [value, setValue] = useControlledValue<number | undefined>(props.value, undefined);

  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' };
  const wrapStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 4,
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <div style={wrapStyle}>
      {props.label && <label style={labelStyle}>{props.label}</label>}
      <PrimeRating
        value={value}
        stars={props.stars ?? 5}
        cancel={props.cancel ?? true}
        readOnly={props.readonly}
        onChange={(e: RatingChangeEvent) => {
          setValue(e.value ?? undefined);
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
