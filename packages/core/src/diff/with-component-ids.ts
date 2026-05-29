import { createBinderlessComponentImplementation, type ReactComponentImplementation } from '@a2ui/react/v0_9';
import { Catalog, type ComponentApi } from '@a2ui/web_core/v0_9';
import { createElement, type ReactNode } from 'react';

export function withComponentIds<T extends ComponentApi = ReactComponentImplementation>(
  catalog: Catalog<T>,
): Catalog<T> {
  const wrapped: T[] = [];
  for (const impl of catalog.components.values()) {
    wrapped.push(wrapImpl(impl as unknown as ReactComponentImplementation) as unknown as T);
  }
  return new Catalog<T>(catalog.id, wrapped) as Catalog<T>;
}

function wrapImpl(impl: ReactComponentImplementation): ReactComponentImplementation {
  const Original = impl.render;
  const wrapped = createBinderlessComponentImplementation(impl, ({ context, buildChild }) => {
    const child: ReactNode = createElement(Original, { context, buildChild });
    return createElement(
      'div',
      {
        'data-a2ui-component-id': context.componentModel.id,
        style: { display: 'contents' },
      },
      child,
    );
  });
  return wrapped;
}
