import { Fragment } from 'react';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { TabView as PrimeTabView, TabPanel } from 'primereact/tabview';

const tabSchema = z.object({
  header: z.string(),
  child: z.string().optional(),
  icon: z.string().optional(),
  disabled: z.boolean().optional(),
});

const tabViewSchema = z.object({
  tabs: z.array(tabSchema),
  activeIndex: z.number().optional(),
  scrollable: z.boolean().optional(),
  weight: z.number().optional(),
});

export const TabViewApi: ComponentApi<typeof tabViewSchema> = {
  name: 'TabView',
  schema: tabViewSchema,
};

export const TabView = createComponentImplementation(TabViewApi, ({ props, buildChild }) => {
  const style: React.CSSProperties = {
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <PrimeTabView activeIndex={props.activeIndex ?? 0} scrollable={props.scrollable} style={style}>
      {(props.tabs ?? []).map((tab, i) => (
        <TabPanel key={i} header={tab.header} disabled={tab.disabled}>
          {tab.child ? buildChild(tab.child) : null}
        </TabPanel>
      ))}
    </PrimeTabView>
  );
});
