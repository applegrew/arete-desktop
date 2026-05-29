import { createComponentImplementation } from '@a2ui/react/v0_9';
import { DividerApi } from '@a2ui/web_core/v0_9/basic_catalog';
import { Divider as PrimeDivider } from 'primereact/divider';

export const Divider = createComponentImplementation(DividerApi, ({ props }) => {
  return (
    <PrimeDivider
      layout={props.axis === 'vertical' ? 'vertical' : 'horizontal'}
      style={
        props.axis === 'vertical' ? { height: '100%' } : undefined
      }
    />
  );
});
