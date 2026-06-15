import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Carousel as PrimeCarousel } from 'primereact/carousel';

const carouselSchema = z.object({
  items: z.array(z.string()).optional(),
  numVisible: z.number().optional(),
  numScroll: z.number().optional(),
  circular: z.boolean().optional(),
  autoplayInterval: z.number().optional(),
  showIndicators: z.boolean().optional(),
  showNavigators: z.boolean().optional(),
  weight: z.number().optional(),
});

export const CarouselApi: ComponentApi<typeof carouselSchema> = {
  name: 'Carousel',
  schema: carouselSchema,
};

export const Carousel = createComponentImplementation(CarouselApi, ({ props, buildChild }) => {
  const style: React.CSSProperties = {
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  const items = props.items ?? [];

  const itemTemplate = (childId: string) => (
    <div style={{ padding: 4 }}>{buildChild(childId)}</div>
  );

  return (
    <PrimeCarousel
      value={items}
      numVisible={props.numVisible ?? 1}
      numScroll={props.numScroll ?? 1}
      circular={props.circular}
      autoplayInterval={props.autoplayInterval}
      showIndicators={props.showIndicators ?? true}
      showNavigators={props.showNavigators ?? true}
      itemTemplate={itemTemplate}
      style={style}
    />
  );
});
