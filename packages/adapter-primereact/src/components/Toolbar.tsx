import { Fragment } from 'react';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Toolbar as PrimeToolbar } from 'primereact/toolbar';

const toolbarSchema = z.object({
  left: z.array(z.string()).optional(),
  right: z.array(z.string()).optional(),
  center: z.array(z.string()).optional(),
  weight: z.number().optional(),
});

export const ToolbarApi: ComponentApi<typeof toolbarSchema> = {
  name: 'Toolbar',
  schema: toolbarSchema,
};

const buildChildren = (ids: string[] | undefined, buildChild: (id: string) => React.ReactNode) => {
  if (!ids || ids.length === 0) return null;
  return ids.map((id) => <Fragment key={id}>{buildChild(id)}</Fragment>);
};

export const Toolbar = createComponentImplementation(ToolbarApi, ({ props, buildChild }) => {
  const style: React.CSSProperties = {
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  const leftContent = buildChildren(props.left, buildChild);
  const rightContent = buildChildren(props.right, buildChild);
  const centerContent = buildChildren(props.center, buildChild);

  if (!leftContent && !rightContent && !centerContent) {
    return <PrimeToolbar style={style} />;
  }

  return (
    <PrimeToolbar
      style={style}
      left={leftContent}
      right={rightContent}
      center={centerContent}
    />
  );
});
