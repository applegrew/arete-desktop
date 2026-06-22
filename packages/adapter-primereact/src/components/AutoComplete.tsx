import { useState } from 'react';
import { useControlledValue } from '../useControlledValue';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { AutoComplete as PrimeAutoComplete } from 'primereact/autocomplete';
import { useAction } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const autoCompleteSchema = z.object({
  value: z.string().optional(),
  suggestions: z.array(z.unknown()).optional(),
  placeholder: z.string().optional(),
  dropdown: z.boolean().optional(),
  multiple: z.boolean().optional(),
  field: z.string().optional(),
  label: z.string().optional(),
  weight: z.number().optional(),
  action: actionSchema.optional(),
});

export const AutoCompleteApi: ComponentApi<typeof autoCompleteSchema> = {
  name: 'AutoComplete',
  schema: autoCompleteSchema,
};

export const AutoComplete = createComponentImplementation(AutoCompleteApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });
  const [value, setValue] = useControlledValue<unknown>(props.value, '');
  const [filteredSuggestions, setFilteredSuggestions] = useState<unknown[]>([]);
  const wrapStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column',
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  const suggestions = Array.isArray(props.suggestions) ? props.suggestions : [];
  const field = props.field;
  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' };

  const search = (query: string) => {
    const q = query.toLowerCase();
    const filtered = suggestions.filter((s) => {
      const label = field && typeof s === 'object' && s !== null ? String((s as Record<string, unknown>)[field] ?? '') : String(s);
      return label.toLowerCase().includes(q);
    });
    setFilteredSuggestions(filtered);
  };

  return (
    <div style={wrapStyle}>
      {props.label && <label style={labelStyle}>{props.label}</label>}
      <PrimeAutoComplete
        value={value}
        suggestions={filteredSuggestions}
        field={props.field}
        placeholder={props.placeholder}
        dropdown={props.dropdown}
        multiple={props.multiple}
        completeMethod={(e) => search(e.query)}
        onChange={(e) => {
          const v = e.value ?? '';
          setValue(v);
          if (props.action) {
            // Selecting an object suggestion yields the whole object; the schema
            // declares a string, so emit the display field (or coerce) instead.
            const dispatched =
              v && typeof v === 'object' && props.field
                ? (v as Record<string, unknown>)[props.field]
                : v;
            dispatchAction({
              name: props.action.event.name,
              context: { value: dispatched, ...(props.action.event.context ?? {}) },
            });
          }
        }}
      />
    </div>
  );
});
