import { describe, it, expect } from 'vitest';
import { extractUiResources } from '../src/mcp';

/** Shape of an MCP tool-result content array (loosely typed, as it arrives over the wire). */
const content = (...items: Array<Record<string, unknown>>) => items;

describe('extractUiResources', () => {
  it('captures an inline text/html resource as srcDoc html', () => {
    const r = extractUiResources(
      'show_widget',
      content({ type: 'resource', resource: { uri: 'ui://app/widget', mimeType: 'text/html', text: '<h1>hi</h1>' } }),
    );
    expect(r).toEqual([
      { tool: 'show_widget', uri: 'ui://app/widget', mimeType: 'text/html', html: '<h1>hi</h1>' },
    ]);
  });

  it('treats a ui:// resource with no mimeType as html (defaulting mimeType)', () => {
    const r = extractUiResources('t', content({ type: 'resource', resource: { uri: 'ui://x/y', text: '<p>z</p>' } }));
    expect(r).toEqual([{ tool: 't', uri: 'ui://x/y', mimeType: 'text/html', html: '<p>z</p>' }]);
  });

  it('accepts text/html with charset parameters', () => {
    const r = extractUiResources(
      't',
      content({ type: 'resource', resource: { uri: 'ui://x', mimeType: 'text/html; charset=utf-8', text: '<b>x</b>' } }),
    );
    expect(r[0]?.html).toBe('<b>x</b>');
    expect(r[0]?.mimeType).toBe('text/html; charset=utf-8');
  });

  it('extracts the first real URL from a text/uri-list resource (skipping comments/blanks)', () => {
    const r = extractUiResources(
      't',
      content({
        type: 'resource',
        resource: { uri: 'ui://list', mimeType: 'text/uri-list', text: '# a comment\n\nhttps://example.com/app\nhttps://second.example' },
      }),
    );
    expect(r).toEqual([{ tool: 't', uri: 'ui://list', mimeType: 'text/uri-list', url: 'https://example.com/app' }]);
    expect(r[0]?.html).toBeUndefined();
  });

  it('captures a resource_link with an html mimeType as an external url', () => {
    const r = extractUiResources(
      't',
      content({ type: 'resource_link', uri: 'https://app.example/embed', name: 'embed', mimeType: 'text/html' }),
    );
    expect(r).toEqual([{ tool: 't', uri: 'https://app.example/embed', mimeType: 'text/html', url: 'https://app.example/embed' }]);
  });

  it('ignores a resource_link without an html mimeType', () => {
    const r = extractUiResources('t', content({ type: 'resource_link', uri: 'https://x', mimeType: 'application/json' }));
    expect(r).toEqual([]);
  });

  it('ignores a non-html, non-ui:// resource (e.g. JSON data)', () => {
    const r = extractUiResources(
      't',
      content({ type: 'resource', resource: { uri: 'file://data.json', mimeType: 'application/json', text: '{}' } }),
    );
    expect(r).toEqual([]);
  });

  it('ignores plain text content', () => {
    expect(extractUiResources('t', content({ type: 'text', text: 'hello' }))).toEqual([]);
  });

  it('extracts multiple resources in order and stamps the tool name on each', () => {
    const r = extractUiResources(
      'srv',
      content(
        { type: 'text', text: 'done' },
        { type: 'resource', resource: { uri: 'ui://a', mimeType: 'text/html', text: '<i>a</i>' } },
        { type: 'resource_link', uri: 'https://b/embed', mimeType: 'text/html' },
      ),
    );
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.tool)).toEqual(['srv', 'srv']);
    expect(r[0]?.html).toBe('<i>a</i>');
    expect(r[1]?.url).toBe('https://b/embed');
  });

  it('handles an empty content array', () => {
    expect(extractUiResources('t', content())).toEqual([]);
  });
});
