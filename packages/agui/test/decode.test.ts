import { describe, it, expect, vi } from 'vitest';
import { EventType, type BaseEvent } from '@ag-ui/core';
import { AgUiDecoder, ARETE_EMISSION_EVENT } from '../src/decode';
import type { Emission } from '@arete-ui/core';

function ev(obj: Record<string, unknown>): BaseEvent {
  return obj as unknown as BaseEvent;
}

describe('AgUiDecoder', () => {
  it('accumulates streaming text and emits start/delta/end', () => {
    const onTextStart = vi.fn();
    const onTextDelta = vi.fn();
    const onTextEnd = vi.fn();
    const d = new AgUiDecoder({ onTextStart, onTextDelta, onTextEnd });

    d.handleAll([
      ev({ type: EventType.TEXT_MESSAGE_START, messageId: 'm1', role: 'assistant' }),
      ev({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'Hello ' }),
      ev({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'world' }),
      ev({ type: EventType.TEXT_MESSAGE_END, messageId: 'm1' }),
    ]);

    expect(onTextStart).toHaveBeenCalledWith({ messageId: 'm1', role: 'assistant' });
    expect(onTextDelta).toHaveBeenCalledTimes(2);
    expect(onTextEnd).toHaveBeenCalledWith({ messageId: 'm1', text: 'Hello world' });
  });

  it('decodes a CUSTOM arete.emission carrying an a2ui Emission', () => {
    const onEmission = vi.fn();
    const onCustom = vi.fn();
    const d = new AgUiDecoder({ onEmission, onCustom });

    const emission: Emission = {
      kind: 'a2ui',
      targetSurfaceId: 'agent-sfc-1',
      messages: [{ version: 'v0.9', createSurface: { surfaceId: 'agent-sfc-1' } } as never],
    };
    d.handle(ev({ type: EventType.CUSTOM, name: ARETE_EMISSION_EVENT, value: emission }));

    expect(onEmission).toHaveBeenCalledWith(emission);
    expect(onCustom).not.toHaveBeenCalled();
  });

  it('decodes a CUSTOM arete.emission carrying a pageOp Emission', () => {
    const onEmission = vi.fn();
    const d = new AgUiDecoder({ onEmission });
    const emission: Emission = {
      kind: 'pageOp',
      op: { name: 'setPageRegion', pageId: 'tickets', regionId: 'top-left', surfaceId: 'agent-sfc-1' },
    };
    d.handle(ev({ type: EventType.CUSTOM, name: ARETE_EMISSION_EVENT, value: emission }));
    expect(onEmission).toHaveBeenCalledWith(emission);
  });

  it('routes non-arete CUSTOM events to onCustom, not onEmission', () => {
    const onEmission = vi.fn();
    const onCustom = vi.fn();
    const d = new AgUiDecoder({ onEmission, onCustom });
    d.handle(ev({ type: EventType.CUSTOM, name: 'something.else', value: { a: 1 } }));
    expect(onEmission).not.toHaveBeenCalled();
    expect(onCustom).toHaveBeenCalledWith('something.else', { a: 1 });
  });

  it('falls back to onCustom when an arete.emission value is malformed', () => {
    const onEmission = vi.fn();
    const onCustom = vi.fn();
    const d = new AgUiDecoder({ onEmission, onCustom });
    d.handle(ev({ type: EventType.CUSTOM, name: ARETE_EMISSION_EVENT, value: { kind: 'a2ui' } }));
    expect(onEmission).not.toHaveBeenCalled();
    expect(onCustom).toHaveBeenCalledWith(ARETE_EMISSION_EVENT, { kind: 'a2ui' });
  });

  it('dispatches tool-call and run lifecycle events', () => {
    const h = {
      onToolCallStart: vi.fn(),
      onToolResult: vi.fn(),
      onToolCallEnd: vi.fn(),
      onRunStarted: vi.fn(),
      onRunFinished: vi.fn(),
      onRunError: vi.fn(),
    };
    const d = new AgUiDecoder(h);
    d.handleAll([
      ev({ type: EventType.RUN_STARTED, threadId: 't1', runId: 'r1' }),
      ev({ type: EventType.TOOL_CALL_START, toolCallId: 'c1', toolCallName: 'search' }),
      ev({ type: EventType.TOOL_CALL_RESULT, toolCallId: 'c1', messageId: 'm9', content: 'ok' }),
      ev({ type: EventType.TOOL_CALL_END, toolCallId: 'c1' }),
      ev({ type: EventType.RUN_FINISHED, threadId: 't1', runId: 'r1' }),
    ]);
    expect(h.onRunStarted).toHaveBeenCalledWith({ threadId: 't1', runId: 'r1' });
    expect(h.onToolCallStart).toHaveBeenCalledWith({ toolCallId: 'c1', toolCallName: 'search' });
    expect(h.onToolResult).toHaveBeenCalledWith({ toolCallId: 'c1', content: 'ok' });
    expect(h.onToolCallEnd).toHaveBeenCalledWith({ toolCallId: 'c1' });
    expect(h.onRunFinished).toHaveBeenCalledOnce();
    expect(h.onRunError).not.toHaveBeenCalled();
  });

  it('dispatches state snapshot and delta', () => {
    const onState = vi.fn();
    const d = new AgUiDecoder({ onState });
    d.handle(ev({ type: EventType.STATE_SNAPSHOT, snapshot: { a: 1 } }));
    d.handle(ev({ type: EventType.STATE_DELTA, delta: [{ op: 'replace', path: '/a', value: 2 }] }));
    expect(onState).toHaveBeenNthCalledWith(1, { kind: 'snapshot', snapshot: { a: 1 } });
    expect(onState).toHaveBeenNthCalledWith(2, {
      kind: 'delta',
      delta: [{ op: 'replace', path: '/a', value: 2 }],
    });
  });
});
