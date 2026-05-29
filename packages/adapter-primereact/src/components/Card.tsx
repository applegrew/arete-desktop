import { createComponentImplementation } from '@a2ui/react/v0_9';
import { CardApi } from '@a2ui/web_core/v0_9/basic_catalog';
import { Card as PrimeCard } from 'primereact/card';

export const Card = createComponentImplementation(CardApi, ({ props, buildChild }) => {
  return (
    <PrimeCard
      style={{
        ...(typeof props.weight === 'number'
          ? { flex: props.weight, minWidth: 0, minHeight: 0 }
          : {}),
      }}
    >
      {props.child ? buildChild(props.child) : null}
    </PrimeCard>
  );
});
