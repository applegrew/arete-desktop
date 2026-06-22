import { useControlledValue } from '../useControlledValue';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Calendar as PrimeCalendar } from 'primereact/calendar';
import { useAction } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const calendarSchema = z.object({
  value: z.union([z.string(), z.array(z.string()), z.tuple([z.string(), z.string()])]).optional(),
  selectionMode: z.enum(['single', 'multiple', 'range']).optional(),
  dateFormat: z.string().optional(),
  minDate: z.string().optional(),
  maxDate: z.string().optional(),
  inline: z.boolean().optional(),
  showTime: z.boolean().optional(),
  placeholder: z.string().optional(),
  label: z.string().optional(),
  weight: z.number().optional(),
  action: actionSchema.optional(),
});

export const CalendarApi: ComponentApi<typeof calendarSchema> = {
  name: 'Calendar',
  schema: calendarSchema,
};

export const Calendar = createComponentImplementation(CalendarApi, ({ props, context }) => {
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
      <PrimeCalendar
        value={value as Date | Date[] | undefined}
        selectionMode={props.selectionMode ?? 'single'}
        dateFormat={props.dateFormat ?? 'mm/dd/yy'}
        minDate={props.minDate ? new Date(props.minDate) : undefined}
        maxDate={props.maxDate ? new Date(props.maxDate) : undefined}
        inline={props.inline}
        showTime={props.showTime}
        placeholder={props.placeholder}
        onChange={(e) => {
          setValue(e.value);
          if (props.action) {
            // The agent's schema declares `value` as a string; PrimeReact hands back
            // Date objects. Serialize to ISO so the round-trip value matches the spec.
            const toIso = (v: unknown): unknown =>
              v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(toIso) : v;
            dispatchAction({
              name: props.action.event.name,
              context: { value: toIso(e.value), ...(props.action.event.context ?? {}) },
            });
          }
        }}
      />
    </div>
  );
});
