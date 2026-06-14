import type { A2uiMessage } from '@a2ui/web_core/v0_9';
import type { ContentDiff, PageDiff } from './diff';
import type { PageOp } from './page-ops';
import type { OnUserAction } from './action';

export type { UserAction, ActionSpec, OnUserAction } from './action';

export type Diff = ContentDiff | PageDiff;

export interface HookContextValue {
  onBeforeApply: OnBeforeApply;
  resolveDataPath: ResolveDataPath;
  onUserAction: OnUserAction;
  onPrompt: OnPrompt;
  /** True while an agent turn is in-flight — the chat input shows Cancel instead of Send. */
  busy?: boolean;
  /** Abort the in-flight agent turn(s). Wired to the chat input's Cancel button. */
  onCancelPrompt?: () => void;
  onPageOp: OnPageOp;
  onProposed: OnProposed;
  onApprove: OnApprove;
  onReject: OnReject;
  /** A page op could not be applied (e.g. invalid region). Consumers surface this
   *  to the user AND feed it back to the agent — page ops must not fail silently. */
  onOpError?: OnOpError;
}

export type A2uiInboundMessage = A2uiMessage;

export interface ApplyContext {
  surfaceId?: string;
}

export type OnBeforeApply = (
  messages: A2uiInboundMessage[],
  ctx: ApplyContext,
) => A2uiInboundMessage[] | null;

export interface DataPathContext {
  surfaceId?: string;
}

export type ResolveDataPath = (path: string, ctx: DataPathContext) => unknown;

export type OnPrompt = (text: string) => void;

export interface PageOpContext {
  pageId: string;
}

export type OnPageOp = (op: PageOp, ctx: PageOpContext) => PageOp | null;

export type OnProposed = (diff: Diff) => void;
export type OnApprove = (diff: Diff) => void;
export type OnReject = (diff: Diff) => void;

/** Reports a page op that failed to apply. */
export interface OpError {
  pageId: string;
  op: PageOp;
  message: string;
}
export type OnOpError = (error: OpError) => void;

export const defaultHooks: HookContextValue = {
  onBeforeApply: (messages) => messages,
  resolveDataPath: () => undefined,
  onUserAction: () => {},
  onPrompt: () => {},
  onPageOp: (op) => op,
  onProposed: () => {},
  onApprove: () => {},
  onReject: () => {},
};
