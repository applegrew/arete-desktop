import { Fragment } from 'react';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Accordion as PrimeAccordion, AccordionTab } from 'primereact/accordion';

const tabSchema = z.object({
  header: z.string(),
  child: z.string().optional(),
  icon: z.string().optional(),
  disabled: z.boolean().optional(),
});

const accordionSchema = z.object({
  tabs: z.array(tabSchema),
  multiple: z.boolean().optional(),
  activeIndex: z.number().optional(),
  weight: z.number().optional(),
});

export const AccordionApi: ComponentApi<typeof accordionSchema> = {
  name: 'Accordion',
  schema: accordionSchema,
};

export const Accordion = createComponentImplementation(AccordionApi, ({ props, buildChild }) => {
  const style: React.CSSProperties = {
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <PrimeAccordion multiple={props.multiple} activeIndex={props.activeIndex} style={style}>
      {(props.tabs ?? []).map((tab, i) => (
        <AccordionTab key={i} header={tab.header} disabled={tab.disabled}>
          {tab.child ? buildChild(tab.child) : null}
        </AccordionTab>
      ))}
    </PrimeAccordion>
  );
});
