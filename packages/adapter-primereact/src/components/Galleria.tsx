import { Fragment } from 'react';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Galleria as PrimeGalleria } from 'primereact/galleria';

const galleriaSchema = z.object({
  items: z.array(z.string()).optional(),
  numVisible: z.number().optional(),
  circular: z.boolean().optional(),
  showThumbnails: z.boolean().optional(),
  showIndicators: z.boolean().optional(),
  showNavigators: z.boolean().optional(),
  autoplayInterval: z.number().optional(),
  weight: z.number().optional(),
});

export const GalleriaApi: ComponentApi<typeof galleriaSchema> = {
  name: 'Galleria',
  schema: galleriaSchema,
};

export const Galleria = createComponentImplementation(GalleriaApi, ({ props, buildChild }) => {
  const style: React.CSSProperties = {
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  const items = props.items ?? [];

  const itemTemplate = (childId: string) => (
    <div style={{ padding: 4 }}>{buildChild(childId)}</div>
  );

  const thumbnailTemplate = (childId: string) => (
    <div style={{ width: 60, height: 40, overflow: 'hidden' }}>{buildChild(childId)}</div>
  );

  return (
    <PrimeGalleria
      value={items}
      numVisible={props.numVisible ?? 1}
      circular={props.circular}
      showThumbnails={props.showThumbnails ?? true}
      showIndicators={props.showIndicators}
      showItemNavigators={props.showNavigators}
      autoPlay={typeof props.autoplayInterval === 'number'}
      transitionInterval={props.autoplayInterval ?? 4000}
      item={itemTemplate}
      thumbnail={props.showThumbnails !== false ? thumbnailTemplate : undefined}
      style={style}
    />
  );
});
