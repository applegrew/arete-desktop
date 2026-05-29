/**
 * Inject diff-engine keyframes + helper classes once per document.
 *
 * Idempotent: the function tags the style element with a sentinel data attribute
 * so repeat calls are no-ops. Safe to call from every DiffOverlay mount.
 */

const STYLE_ID = 'arete-ui-diff-styles';

const STYLE_CONTENT = `
  @keyframes arete-pulse-amber {
    0%, 100% { box-shadow: 0 0 0 0 rgba(217, 119, 6, 0); border-color: #D97706; }
    50% { box-shadow: 0 0 0 4px rgba(217, 119, 6, 0.2); border-color: #B45309; }
  }
  @keyframes arete-fade-out {
    from { opacity: 1; }
    to { opacity: 0; }
  }
  .arete-diff-box-changed {
    animation: arete-pulse-amber 2s ease-in-out infinite;
  }
`;

export function injectDiffStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE_CONTENT;
  document.head.appendChild(style);
}
