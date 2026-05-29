import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAction } from '../src/action/use-action';
import { HookProvider } from '../src/shell/HookContext';
import { ActionHarnessProvider } from '../src/action/ActionHarnessContext';
import { ActionHarness } from '../src/action/ActionHarness';
import type { UserAction } from '../src/types/hooks';
import { defaultHooks } from '../src/types/hooks';

describe('useAction', () => {
  it('dispatches through harness when harness is mounted', () => {
    const onUserAction = vi.fn();
    const harness = new ActionHarness();
    harness.setHooks({ ...defaultHooks, onUserAction });

    function Btn() {
      const d = useAction({ sourceComponentId: 'btn-1' });
      return <button onClick={() => d({ name: 'click', context: { x: 1 } })}>Click</button>;
    }

    render(
      <HookProvider hooks={{ ...defaultHooks, onUserAction }}>
        <ActionHarnessProvider harness={harness}>
          <Btn />
        </ActionHarnessProvider>
      </HookProvider>,
    );
    fireEvent.click(screen.getByText('Click'));

    expect(onUserAction).toHaveBeenCalledTimes(1);
    const action = onUserAction.mock.calls[0]![0] as UserAction;
    expect(action.name).toBe('click');
    expect(action.sourceComponentId).toBe('btn-1');
    expect(action.context).toEqual({ x: 1 });
    expect(action.timestamp).toBeTruthy();
    expect(harness.getRecent()).toHaveLength(1);
    expect(harness.getRecent()[0]?.name).toBe('click');
  });

  it('dispatches through hook when no harness is mounted', () => {
    const onUserAction = vi.fn();

    function Btn() {
      const d = useAction();
      return <button onClick={() => d({ name: 'click', context: { x: 1 } })}>Click</button>;
    }

    render(
      <HookProvider hooks={{ ...defaultHooks, onUserAction }}>
        <Btn />
      </HookProvider>,
    );
    fireEvent.click(screen.getByText('Click'));

    expect(onUserAction).toHaveBeenCalledTimes(1);
    const action = onUserAction.mock.calls[0]![0] as UserAction;
    expect(action.name).toBe('click');
    expect(action.context).toEqual({ x: 1 });
  });

  it('passes custom context correctly', () => {
    const onUserAction = vi.fn();
    const harness = new ActionHarness();
    harness.setHooks({ ...defaultHooks, onUserAction });

    function Btn() {
      const d = useAction({ sourceComponentId: 'custom' });
      return (
        <button onClick={() => d({ name: 'select', context: { label: 'A', value: 42 } })}>
          Select
        </button>
      );
    }

    render(
      <HookProvider hooks={{ ...defaultHooks, onUserAction }}>
        <ActionHarnessProvider harness={harness}>
          <Btn />
        </ActionHarnessProvider>
      </HookProvider>,
    );
    fireEvent.click(screen.getByText('Select'));

    const action = onUserAction.mock.calls[0]![0] as UserAction;
    expect(action.name).toBe('select');
    expect(action.sourceComponentId).toBe('custom');
    expect(action.context).toEqual({ label: 'A', value: 42 });
  });

  it('defaults to empty context when none provided', () => {
    const onUserAction = vi.fn();
    const harness = new ActionHarness();
    harness.setHooks({ ...defaultHooks, onUserAction });

    function Btn() {
      const d = useAction();
      return <button onClick={() => d({ name: 'noCtx' })}>NoCtx</button>;
    }

    render(
      <HookProvider hooks={{ ...defaultHooks, onUserAction }}>
        <ActionHarnessProvider harness={harness}>
          <Btn />
        </ActionHarnessProvider>
      </HookProvider>,
    );
    fireEvent.click(screen.getByText('NoCtx'));

    const action = onUserAction.mock.calls[0]![0] as UserAction;
    expect(action.name).toBe('noCtx');
    expect(action.context).toEqual({});
  });

  it('returns a stable callback across re-renders', () => {
    const harness = new ActionHarness();
    harness.setHooks(defaultHooks);
    const refs: Array<ReturnType<typeof useAction>> = [];

    function Stable() {
      const d = useAction({ sourceComponentId: 'stable' });
      refs.push(d);
      return <div>ok</div>;
    }

    const { rerender } = render(
      <HookProvider hooks={defaultHooks}>
        <ActionHarnessProvider harness={harness}>
          <Stable />
        </ActionHarnessProvider>
      </HookProvider>,
    );

    rerender(
      <HookProvider hooks={defaultHooks}>
        <ActionHarnessProvider harness={harness}>
          <Stable />
        </ActionHarnessProvider>
      </HookProvider>,
    );

    expect(refs).toHaveLength(2);
    expect(refs[0]).toBe(refs[1]);
  });

  it('harness accumulates multiple dispatches in order', () => {
    const harness = new ActionHarness();
    harness.setHooks(defaultHooks);

    function Multi() {
      const d = useAction();
      return (
        <div>
          <button onClick={() => d({ name: 'a' })}>A</button>
          <button onClick={() => d({ name: 'b' })}>B</button>
        </div>
      );
    }

    render(
      <HookProvider hooks={defaultHooks}>
        <ActionHarnessProvider harness={harness}>
          <Multi />
        </ActionHarnessProvider>
      </HookProvider>,
    );
    fireEvent.click(screen.getByText('A'));
    fireEvent.click(screen.getByText('B'));
    fireEvent.click(screen.getByText('A'));

    expect(harness.getRecent().map((a) => a.name)).toEqual(['a', 'b', 'a']);
  });

  it('leaves harness history empty when no actions dispatched', () => {
    const harness = new ActionHarness();
    harness.setHooks(defaultHooks);

    function Quiet() {
      return <div>nothing to click</div>;
    }

    render(
      <HookProvider hooks={defaultHooks}>
        <ActionHarnessProvider harness={harness}>
          <Quiet />
        </ActionHarnessProvider>
      </HookProvider>,
    );

    expect(harness.getRecent()).toEqual([]);
  });
});
