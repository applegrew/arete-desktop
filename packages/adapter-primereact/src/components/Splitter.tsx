import { Fragment } from 'react';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Splitter as PrimeSplitter, SplitterPanel } from 'primereact/splitter';

const panelSchema = z.object({
  child: z.string().optional(),
  size: z.number().optional(),
  minSize: z.number().optional(),
});

const splitterSchema = z.object({
  panels: z.array(panelSchema),
  layout: z.enum(['horizontal', 'vertical']).optional(),
  weight: z.number().optional(),
});

export const SplitterApi: ComponentApi<typeof splitterSchema> = {
  name: 'Splitter',
  schema: splitterSchema,
};

export const Splitter = createComponentImplementation(SplitterApi, ({ props, buildChild }) => {
  const style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    minHeight: 200,
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <PrimeSplitter layout={props.layout ?? 'horizontal'} style={style}>
      {(props.panels ?? []).map((panel, i) => (
        <SplitterPanel key={i} size={panel.size} minSize={panel.minSize}>
          {panel.child ? buildChild(panel.child) : null}
        </SplitterPanel>
      ))}
    </PrimeSplitter>
  );
});
