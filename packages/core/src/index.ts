export const ARETE_UI_VERSION = '0.0.1';

export { Shell } from './shell/Shell';
export type { ShellProps, ShellTab, ChatTabConfig } from './shell/Shell';
export { TabRail } from './shell/TabRail';
export type { TabDef } from './shell/TabRail';
export { HookProvider, useHooks } from './shell/HookContext';

export { Chat } from './chat/Chat';
export type { ChatProps, ChatMode } from './chat/Chat';
export { ChatStore, useChatEntries } from './chat/ChatStore';
export type { ChatEntry, ChatRole } from './chat/ChatStore';

// Agent-loop scaffold — arete-desktop provides the transcript, the emission/response
// contract, and a context-snapshot builder; the loop itself is consumer-owned.
export { entriesToTranscript } from './agent/transcript';
export type { AgentMessage, AgentRole, TranscriptOptions } from './agent/transcript';
export { isA2uiEmission, isPageOpEmission } from './agent/contract';
export type {
  Emission,
  A2uiEmission,
  PageOpEmission,
  AgentResponse,
} from './agent/contract';
export { buildAgentContext } from './agent/context';
export type {
  SurfaceSnapshot,
  PageContextEntry,
  AgentContextSnapshot,
  BuildAgentContextInput,
} from './agent/context';
export { RenderDiagnosticsStore } from './diagnostics/RenderDiagnosticsStore';
export type {
  RenderDiagnostic,
  DiagnosticInput,
  DiagnosticSeverity,
} from './diagnostics/RenderDiagnosticsStore';
export {
  RenderDiagnosticsProvider,
  useRenderDiagnosticsStore,
  useReportDiagnostics,
} from './diagnostics/RenderDiagnosticsContext';

export type {
  HookContextValue,
  OnBeforeApply,
  OnPrompt,
  OnPageOp,
  OnUserAction,
  OnProposed,
  OnApprove,
  OnReject,
  ResolveDataPath,
  A2uiInboundMessage,
  UserAction,
  Diff,
} from './types/hooks';
export { defaultHooks } from './types/hooks';

export type { ActionSpec } from './types/action';
export { ActionHarness } from './action/ActionHarness';
export {
  ActionHarnessProvider,
  useActionHarness,
  SurfaceIdProvider,
  useSurfaceId,
} from './action/ActionHarnessContext';
export { useAction } from './action/use-action';
export type { DispatchAction, DispatchActionInput, UseActionOpts } from './action/use-action';

export type { ShellState, ChatDockState } from './types/shell-state';
export { defaultShellState } from './types/shell-state';

export type {
  ContentDiff,
  PageDiff,
  DiffKind,
  PageMapping,
} from './types/diff';
export { isContentDiff, isPageDiff } from './types/diff';

export type {
  PageOp,
  PageOpName,
  PinSurfaceOp,
  UnpinSurfaceOp,
  SetPageLayoutOp,
  MoveSurfaceOp,
  SetPageRegionOp,
} from './types/page-ops';

export type {
  LayoutDescriptor,
  GridLayout,
  RowLayout,
  ColumnLayout,
  DockLayout,
  RegionSpec,
} from './page/layout-descriptor';
export { regionIds, toGridStyle } from './page/layout-descriptor';

export { uid } from './util/id';
export { deepEqual } from './util/deep-equal';

export { Page } from './page/Page';
export type { PageProps } from './page/Page';
export { RegionLayout } from './page/RegionLayout';
export type { RegionLayoutProps } from './page/RegionLayout';

export { ingest } from './ingest/ingest';

export { DiffRouter } from './diff/diff-router';
export { DiffOverlay } from './diff/DiffOverlay';
export type { DiffOverlayProps } from './diff/DiffOverlay';
export { computeContentDiff, diffIsEmpty } from './diff/diff-engine';
export { withComponentIds } from './diff/with-component-ids';
export { ApprovalBar } from './diff/ApprovalBar';
export type {
  ApprovalBarProps,
  ApprovalBarVariant,
  ApprovalBarPlacement,
} from './diff/ApprovalBar';
export { formatContentDiffMessage, deriveSurfaceLabel, describeContentChange } from './diff/describe';
export {
  diffPalette,
  liveDim,
  approvalBar as approvalBarTokens,
  pendingDot,
  transitions,
} from './diff/visual-tokens';

export { PageOpsHarness } from './harness/PageOpsHarness';
export type { PageRegistration } from './harness/PageOpsHarness';
export { pageOpSchemas } from './harness/schemas';
export { applyPinSurface } from './harness/ops/pinSurface';
export { applySetPageLayout } from './harness/ops/setPageLayout';
export { applyUnpinSurface } from './harness/ops/unpinSurface';
export { applyMoveSurface } from './harness/ops/moveSurface';
export { applySetPageRegion } from './harness/ops/setPageRegion';
