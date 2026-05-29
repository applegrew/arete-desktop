import { createComponentImplementation } from '@a2ui/react/v0_9';
import { RowApi } from '@a2ui/web_core/v0_9/basic_catalog';
import { Fragment } from 'react';

const mapJustify = (j: string | undefined): string => {
  switch (j) {
    case 'center': return 'center';
    case 'end': return 'flex-end';
    case 'spaceAround': return 'space-around';
    case 'spaceBetween': return 'space-between';
    case 'spaceEvenly': return 'space-evenly';
    case 'stretch': return 'stretch';
    default: return 'flex-start';
  }
};

const mapAlign = (a: string | undefined): string => {
  switch (a) {
    case 'start': return 'flex-start';
    case 'center': return 'center';
    case 'end': return 'flex-end';
    case 'stretch': return 'stretch';
    default: return 'stretch';
  }
};

export const Row = createComponentImplementation(RowApi, ({ props, buildChild }) => {
  const children = props.children;
  const childIds: string[] = Array.isArray(children)
    ? children
    : (children as { componentId: string }[])?.map((c) => c.componentId) ?? [];
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        justifyContent: mapJustify(props.justify),
        alignItems: mapAlign(props.align),
        gap: 'var(--a2ui-row-gap, 8px)',
        ...(typeof props.weight === 'number'
          ? { flex: props.weight, minWidth: 0, minHeight: 0 }
          : {}),
      }}
    >
      {childIds.map((id) => (
        <Fragment key={id}>{buildChild(id)}</Fragment>
      ))}
    </div>
  );
});
