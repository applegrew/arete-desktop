import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Dialog as PrimeDialog } from 'primereact/dialog';
import { useControlledValue } from '../useControlledValue';

const dialogSchema = z.object({
  header: z.string().optional(),
  child: z.string().optional(),
  footer: z.string().optional(),
  visible: z.boolean().optional(),
  closable: z.boolean().optional(),
  closeOnEscape: z.boolean().optional(),
  modal: z.boolean().optional(),
  draggable: z.boolean().optional(),
  resizable: z.boolean().optional(),
  position: z.enum(['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
  style: z.object({
    width: z.string().optional(),
    minWidth: z.string().optional(),
    height: z.string().optional(),
  }).optional(),
  weight: z.number().optional(),
});

export const DialogApi: ComponentApi<typeof dialogSchema> = {
  name: 'Dialog',
  schema: dialogSchema,
};

export const Dialog = createComponentImplementation(DialogApi, ({ props, buildChild }) => {
  // Local visibility synced from props, so the X / Escape / mask click actually
  // close the (controlled) dialog instead of being inert. Re-syncs if the agent
  // pushes a new `visible`.
  const [visible, setVisible] = useControlledValue<boolean>(props.visible, true);

  const wrapperStyle: React.CSSProperties = {
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  const dialogStyle: React.CSSProperties | undefined =
    props.style
      ? {
          width: props.style.width,
          minWidth: props.style.minWidth,
          height: props.style.height,
        }
      : undefined;

  return (
    <div style={wrapperStyle}>
      <PrimeDialog
        header={props.header}
        visible={visible}
        closable={props.closable ?? true}
        closeOnEscape={props.closeOnEscape ?? true}
        modal={props.modal ?? true}
        draggable={props.draggable ?? true}
        resizable={props.resizable ?? true}
        position={props.position ?? 'center'}
        style={dialogStyle}
        footer={props.footer ? buildChild(props.footer) : undefined}
        onHide={() => setVisible(false)}
      >
        {props.child ? buildChild(props.child) : null}
      </PrimeDialog>
    </div>
  );
});
