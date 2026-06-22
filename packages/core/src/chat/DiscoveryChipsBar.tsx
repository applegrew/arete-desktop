import type { DiscoveryChip } from '../types/hooks';

export interface DiscoveryChipsBarProps {
  chips: DiscoveryChip[];
  /** Submit a chip's prompt as if the user typed it. */
  onChipClick: (prompt: string) => void;
}

/**
 * A row of discovery chips rendered just above the chat input. Each chip is pure
 * prompt-injection — clicking it submits its `prompt` as a user message. There is
 * no dismiss affordance; the set is driven by app state / the agent.
 */
export function DiscoveryChipsBar({ chips, onChipClick }: DiscoveryChipsBarProps) {
  if (chips.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        padding: '8px 14px 0',
      }}
    >
      {chips.map((chip, i) => (
        <button
          key={`${chip.label}-${i}`}
          type="button"
          onClick={() => onChipClick(chip.prompt)}
          title={chip.prompt}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 999,
            fontSize: 12.5,
            fontFamily: 'inherit',
            color: 'var(--text-dim, #c7d2fe)',
            background: 'var(--glass, rgba(124,131,255,0.1))',
            border: '1px solid var(--glass-border, rgba(124,131,255,0.28))',
            cursor: 'pointer',
          }}
        >
          <span aria-hidden style={{ opacity: 0.7 }}>✦</span>
          <span>{chip.label}</span>
        </button>
      ))}
    </div>
  );
}
