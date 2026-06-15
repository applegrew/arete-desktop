import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { OrderList as PrimeOrderList } from 'primereact/orderlist';
import { useAction } from '@arete-desktop/core';

const actionSchema = z.object({
  event: z.object({
    name: z.string(),
    context: z.record(z.unknown()).optional(),
  }),
});

const orderListSchema = z.object({
  value: z.array(z.unknown()).optional(),
  options: z.array(z.unknown()).optional(),
  header: z.string().optional(),
  dragdrop: z.boolean().optional(),
  filter: z.boolean().optional(),
  weight: z.number().optional(),
  action: actionSchema.optional(),
});

export const OrderListApi: ComponentApi<typeof orderListSchema> = {
  name: 'OrderList',
  schema: orderListSchema,
};

export const OrderList = createComponentImplementation(OrderListApi, ({ props, context }) => {
  const dispatchAction = useAction({ sourceComponentId: context.componentModel.id });

  const list = props.value ?? props.options ?? [];

  const style: React.CSSProperties = {
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <PrimeOrderList
      value={list}
      header={props.header}
      dragdrop={props.dragdrop}
      filter={props.filter !== false}
      filterBy="label"
      onChange={(e) => {
        if (props.action) {
          dispatchAction({
            name: props.action.event.name,
            context: { value: e.value, ...(props.action.event.context ?? {}) },
          });
        }
      }}
      dataKey="id"
      style={style}
    />
  );
});
