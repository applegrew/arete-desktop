import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { Message as PrimeMessage } from 'primereact/message';

const messageSchema = z.object({
  severity: z.enum(['success', 'info', 'warn', 'error']).optional(),
  text: z.string(),
  icon: z.string().optional(),
  weight: z.number().optional(),
});

export const MessageApi: ComponentApi<typeof messageSchema> = {
  name: 'Message',
  schema: messageSchema,
};

export const Message = createComponentImplementation(MessageApi, ({ props }) => {
  const style: React.CSSProperties = {
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <PrimeMessage
      severity={props.severity ?? 'info'}
      text={props.text}
      icon={props.icon}
      style={style}
    />
  );
});

const messagesSchema = z.object({
  items: z.array(messageSchema).optional(),
  weight: z.number().optional(),
});

export const MessagesApi: ComponentApi<typeof messagesSchema> = {
  name: 'Messages',
  schema: messagesSchema,
};

export const Messages = createComponentImplementation(MessagesApi, ({ props }) => {

  const wrapStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 4,
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };

  return (
    <div style={wrapStyle}>
      {(props.items ?? []).map((item, i) => (
        <PrimeMessage
          key={i}
          severity={item.severity ?? 'info'}
          text={item.text}
          icon={item.icon}
        />
      ))}
    </div>
  );
});
