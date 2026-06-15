import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { ScrollPanel as PrimeScrollPanel } from 'primereact/scrollpanel';

const scrollPanelSchema = z.object({
  child: z.string().optional(),
  style: z.object({ width: z.string().optional(), height: z.string().optional() }).optional(),
  weight: z.number().optional(),
});

export const ScrollPanelApi: ComponentApi<typeof scrollPanelSchema> = {
  name: 'ScrollPanel',
  schema: scrollPanelSchema,
};

export const ScrollPanel = createComponentImplementation(ScrollPanelApi, ({ props, buildChild }) => {
  const wrapStyle: React.CSSProperties = {
    width: props.style?.width ?? '100%',
    height: props.style?.height ?? '200px',
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <PrimeScrollPanel style={wrapStyle}>
      {props.child ? buildChild(props.child) : null}
    </PrimeScrollPanel>
  );
});
