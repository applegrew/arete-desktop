import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { PickList as PrimePickList } from 'primereact/picklist';
import { useAction } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const pickListSchema = z.object({
  source: z.array(z.unknown()).optional(),
  target: z.array(z.unknown()).optional(),
  sourceHeader: z.string().optional(),
  targetHeader: z.string().optional(),
  filter: z.boolean().optional(),
  weight: z.number().optional(),
  action: actionSchema.optional(),
});

export const PickListApi: ComponentApi<typeof pickListSchema> = {
  name: 'PickList',
  schema: pickListSchema,
};

export const PickList = createComponentImplementation(PickListApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });

  const source = Array.isArray(props.source) ? [...props.source] : [];
  const target = Array.isArray(props.target) ? [...props.target] : [];

  // itemTemplate renders label or toString
  const itemTemplate = (item: unknown) => {
    if (typeof item === 'string') return <span>{item}</span>;
    if (item && typeof item === 'object') {
      const r = item as Record<string, unknown>;
      return <span>{String(r.label ?? r.name ?? JSON.stringify(item))}</span>;
    }
    return <span>{String(item)}</span>;
  };

  const style: React.CSSProperties = {
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <PrimePickList
      source={source}
      target={target}
      sourceHeader={props.sourceHeader ?? 'Available'}
      targetHeader={props.targetHeader ?? 'Selected'}
      itemTemplate={itemTemplate}
      filter={props.filter !== false ? true : undefined}
      filterBy="label"
      dataKey="id"
      onChange={(e) => {
        if (props.action) {
          dispatchAction({
            name: props.action.event.name,
            context: { source: e.source, target: e.target, ...(props.action.event.context ?? {}) },
          });
        }
      }}
      style={style}
    />
  );
});
