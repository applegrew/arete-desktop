import { z } from 'zod';
import type { ComponentApi } from '@a2ui/web_core/v0_9';
import { createComponentImplementation } from '@a2ui/react/v0_9';

/**
 * Embed — a sandboxed iframe used to render MCP-UI / MCP Apps resources returned
 * by MCP tools. Framework-managed: the agent loop synthesizes Embed surfaces from
 * tool results; the model does not emit these directly.
 */
const embedSchema = z.object({
  /** Inline HTML rendered via iframe `srcDoc`. */
  html: z.string().optional(),
  /** External URL rendered via iframe `src`. */
  url: z.string().optional(),
  mimeType: z.string().optional(),
  /** Source resource URI (e.g. ui://...), shown as a caption. */
  uri: z.string().optional(),
  title: z.string().optional(),
  height: z.number().optional(),
  weight: z.number().optional(),
});

export const EmbedApi: ComponentApi<typeof embedSchema> = {
  name: 'Embed',
  schema: embedSchema,
};

export const Embed = createComponentImplementation(EmbedApi, ({ props }) => {
  const height = typeof props.height === 'number' ? props.height : 360;
  const frameStyle: React.CSSProperties = {
    width: '100%',
    height,
    border: 'none',
    borderRadius: 4,
    background: '#fff',
  };
  const wrapStyle: React.CSSProperties = {
    width: '100%',
    border: '1px solid #333',
    borderRadius: 4,
    overflow: 'hidden',
    ...(typeof props.weight === 'number' ? { flex: props.weight, minWidth: 0, minHeight: 0 } : {}),
  };
  // Sandbox WITHOUT `allow-same-origin`: embedded MCP-UI content may run scripts
  // but cannot reach the host page, its cookies, or storage.
  const sandbox = 'allow-scripts allow-forms allow-popups';
  const title = props.title ?? 'Embedded content';

  let frame: React.ReactNode = (
    <div style={{ color: '#777', fontSize: 13, padding: 8 }}>No embeddable content.</div>
  );
  if (typeof props.html === 'string' && props.html.length > 0) {
    frame = <iframe title={title} sandbox={sandbox} srcDoc={props.html} referrerPolicy="no-referrer" style={frameStyle} />;
  } else if (typeof props.url === 'string' && props.url.length > 0) {
    frame = <iframe title={title} sandbox={sandbox} src={props.url} referrerPolicy="no-referrer" style={frameStyle} />;
  }

  return (
    <div style={wrapStyle}>
      <div style={{ fontSize: 11, color: '#888', padding: '4px 8px', background: '#0a0a0a', borderBottom: '1px solid #222' }}>
        {title}
        {props.uri ? <span style={{ color: '#555' }}> · {props.uri}</span> : null}
      </div>
      {frame}
    </div>
  );
});
