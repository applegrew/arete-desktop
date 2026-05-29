export type ChatDockState = 'page' | 'dock' | 'rail';

export interface ShellState {
  activeTabId: string | null;
  chatDockState: ChatDockState;
}

export const defaultShellState: ShellState = {
  activeTabId: null,
  chatDockState: 'dock',
};
