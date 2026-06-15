import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Panel as PrimePanel } from 'primereact/panel';

const panelSchema = z.object({
  header: z.string().optional(),
  child: z.string().optional(),
  toggleable: z.boolean().optional(),
  collapsed: z.boolean().optional(),
  weight: z.number().optional(),
});

export const PanelApi: ComponentApi<typeof panelSchema> = {
  name: 'Panel',
  schema: panelSchema,
};

export const Panel = createComponentImplementation(PanelApi, ({ props, buildChild }) => {
  const style: React.CSSProperties = {
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <PrimePanel
      header={props.header}
      toggleable={props.toggleable}
      collapsed={props.collapsed}
      style={style}
    >
      {props.child ? buildChild(props.child) : null}
    </PrimePanel>
  );
});
