/**
 * Centralised visual tokens for the diff engine. All overlay rendering reads from
 * here so palette changes stay in one place.
 *
 * Palette is A11Y-compliant (WCAG AA on dark and light backgrounds).
 */

export const diffPalette = {
  added: {
    bg: '#D1FAE5',
    border: '#059669',
    text: '#065F46',
  },
  removed: {
    bg: '#FEE2E2',
    border: '#DC2626',
    text: '#991B1B',
  },
  changed: {
    bg: '#FEF3C7',
    border: '#D97706',
    text: '#92400E',
  },
} as const;

export const liveDim = {
  contentPending: 0.8,
  regionPending: 0.45,
  ghost: 0.6,
} as const;

export const approvalBar = {
  bottomOffset: 8,
  borderRadius: 6,
  paddingX: 12,
  paddingY: 8,
  shadow: '0 4px 12px rgba(0,0,0,0.25)',
  zIndex: 10,
} as const;

export const pendingDot = {
  size: 8,
  color: diffPalette.changed.border,
} as const;

export const transitions = {
  rejectFadeMs: 200,
} as const;
