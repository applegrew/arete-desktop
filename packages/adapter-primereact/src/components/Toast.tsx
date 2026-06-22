import { useRef, useEffect } from 'react';
import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Toast as PrimeToast } from 'primereact/toast';

const toastSchema = z.object({
  severity: z.enum(['success', 'info', 'warn', 'error']).optional(),
  summary: z.string(),
  detail: z.string().optional(),
  life: z.number().optional(),
  sticky: z.boolean().optional(),
  position: z.enum(['top-right', 'top-left', 'bottom-right', 'bottom-left', 'top-center', 'bottom-center']).optional(),
  weight: z.number().optional(),
});

export const ToastApi: ComponentApi<typeof toastSchema> = {
  name: 'Toast',
  schema: toastSchema,
};

export const Toast = createComponentImplementation(ToastApi, ({ props }) => {
  const toast = useRef<PrimeToast>(null);
  // Key of the last toast actually shown, so identical content isn't popped again
  // (StrictMode double-invoke, a remount, or an unrelated re-render re-running the
  // effect). A genuinely new message — any field differs — still shows.
  const lastShown = useRef<string | null>(null);

  useEffect(() => {
    if (!toast.current) return;
    const key = JSON.stringify([props.severity, props.summary, props.detail, props.life, props.sticky]);
    if (key === lastShown.current) return;
    lastShown.current = key;
    toast.current.show({
      severity: props.severity ?? 'info',
      summary: props.summary,
      detail: props.detail,
      life: props.life ?? 3000,
      sticky: props.sticky,
    });
  }, [props.severity, props.summary, props.detail, props.life, props.sticky]);

  const style: React.CSSProperties = {
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return <PrimeToast ref={toast} position={props.position ?? 'top-right'} style={style} />;
});
