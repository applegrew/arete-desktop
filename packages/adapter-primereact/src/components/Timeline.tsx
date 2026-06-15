import { Fragment } from 'react';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Timeline as PrimeTimeline } from 'primereact/timeline';
import { Card as PrimeCard } from 'primereact/card';

const itemSchema = z.object({
  icon: z.string().optional(),
  color: z.string().optional(),
  label: z.string().optional(),
  content: z.string().optional(),
  child: z.string().optional(),
});

const timelineSchema = z.object({
  items: z.array(itemSchema),
  align: z.enum(['left', 'right', 'alternate']).optional(),
  layout: z.enum(['vertical', 'horizontal']).optional(),
  weight: z.number().optional(),
});

export const TimelineApi: ComponentApi<typeof timelineSchema> = {
  name: 'Timeline',
  schema: timelineSchema,
};

export const Timeline = createComponentImplementation(TimelineApi, ({ props, buildChild }) => {
  const style: React.CSSProperties = {
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  const events = (props.items ?? []).map((item) => ({
    icon: item.icon,
    color: item.color,
    status: item.label,
    children: (
      <div>
        {item.content && <p style={{ margin: 0, fontSize: 13 }}>{item.content}</p>}
        {item.child ? buildChild(item.child) : null}
      </div>
    ),
  }));

  return (
    <PrimeTimeline
      value={events}
      align={props.align ?? 'left'}
      layout={props.layout ?? 'vertical'}
      style={style}
    />
  );
});
