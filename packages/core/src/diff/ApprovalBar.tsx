import type React from 'react';
import { approvalBar, diffPalette } from './visual-tokens';

export type ApprovalBarVariant = 'content' | 'pinSurface' | 'setPageLayout' | 'destructive';

export type ApprovalBarPlacement = 'overlay' | 'inline';

export interface ApprovalBarProps {
  variant: ApprovalBarVariant;
  message: string;
  approveLabel?: string;
  rejectLabel?: string;
  onApprove: () => void;
  onReject: () => void;
  /**
   * `overlay` (default) — floats bottom-center over the surface. Good for tall page regions.
   * `inline` — sits in document flow below the surface. Use in scrollable chat lists where the
   * surface card is shorter than the bar and floating would occlude content.
   */
  placement?: ApprovalBarPlacement;
}

export function ApprovalBar({
  variant,
  message,
  approveLabel,
  rejectLabel,
  onApprove,
  onReject,
  placement = 'overlay',
}: ApprovalBarProps) {
  const isDestructive = variant === 'destructive';
  const approve =
    approveLabel ??
    (variant === 'pinSurface'
      ? 'Confirm Pin'
      : variant === 'setPageLayout'
        ? 'Commit Layout Change'
        : isDestructive
          ? 'Commit Layout Change'
          : 'Approve Changes');
  const reject = rejectLabel ?? (isDestructive ? 'Cancel' : 'Reject');

  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: approvalBar.bottomOffset,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: approvalBar.zIndex,
    boxShadow: approvalBar.shadow,
    whiteSpace: 'nowrap',
    maxWidth: 'calc(100% - 16px)',
  };
  const inlineStyle: React.CSSProperties = {
    position: 'relative',
    marginTop: 8,
    alignSelf: 'stretch',
    flexWrap: 'wrap',
  };

  return (
    <div
      role="dialog"
      aria-label="Approve or reject changes"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: '#FFFFFF',
        color: '#111',
        padding: `${approvalBar.paddingY}px ${approvalBar.paddingX}px`,
        borderRadius: approvalBar.borderRadius,
        fontSize: 13,
        ...(placement === 'overlay' ? overlayStyle : inlineStyle),
      }}
    >
      {isDestructive && (
        <span aria-hidden style={{ color: diffPalette.changed.border, fontSize: 16, lineHeight: 1 }}>
          ⚠
        </span>
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{message}</span>
      <button
        type="button"
        onClick={onReject}
        style={{
          background: 'transparent',
          color: '#111',
          border: '1px solid #D1D5DB',
          borderRadius: 4,
          padding: '4px 12px',
          fontWeight: 500,
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        {reject}
      </button>
      <button
        type="button"
        onClick={onApprove}
        style={{
          background: '#2563EB',
          color: '#FFF',
          border: 'none',
          borderRadius: 4,
          padding: '4px 12px',
          fontWeight: 600,
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        {approve}
      </button>
    </div>
  );
}

