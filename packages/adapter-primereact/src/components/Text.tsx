import { useEffect, useState } from 'react';
import { createComponentImplementation } from '@a2ui/react/v0_9';
import { TextApi } from '@a2ui/web_core/v0_9/basic_catalog';
import { useMarkdownRenderer } from '@a2ui/react/v0_9';

export const Text = createComponentImplementation(TextApi, ({ props }) => {
  const text = typeof props.text === 'string' ? props.text : String(props.text ?? '');
  const renderMarkdown = useMarkdownRenderer();
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!renderMarkdown) {
      setHtml(null);
      return;
    }
    const result = renderMarkdown(text);
    if (typeof result === 'string') {
      setHtml(result);
      return;
    }
    let cancelled = false;
    Promise.resolve(result).then((resolved) => {
      if (!cancelled) setHtml(typeof resolved === 'string' ? resolved : null);
    });
    return () => {
      cancelled = true;
    };
  }, [text, renderMarkdown]);

  const style = {
    ...(typeof props.weight === 'number'
      ? { flex: props.weight, minWidth: 0, minHeight: 0 }
      : {}),
  };
  if (html != null) {
    return <div style={style} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <div style={style}>{text}</div>;
});
