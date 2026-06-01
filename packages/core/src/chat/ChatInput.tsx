import { useState, type FormEvent } from 'react';

export interface ChatInputProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSubmit, disabled, placeholder }: ChatInputProps) {
  const [value, setValue] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue('');
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        gap: 8,
        padding: 12,
        borderTop: '1px solid var(--hairline, #2a2a2a)',
        background: 'rgba(255,255,255,0.025)',
        backdropFilter: 'var(--blur)',
        WebkitBackdropFilter: 'var(--blur)',
      }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder={placeholder ?? 'Ask the agent…'}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'rgba(124,131,255,0.6)';
          e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124,131,255,0.18)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--glass-border, #333)';
          e.currentTarget.style.boxShadow = 'none';
        }}
        style={{
          flex: 1,
          padding: '11px 16px',
          borderRadius: 999,
          border: '1px solid var(--glass-border, #333)',
          background: 'var(--glass, #0f0f0f)',
          color: 'var(--text, #fff)',
          fontFamily: 'inherit',
          fontSize: 14,
          outline: 'none',
          transition: 'border-color 0.18s ease, box-shadow 0.18s ease',
        }}
      />
      <button
        type="submit"
        disabled={disabled}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-1px)';
          e.currentTarget.style.boxShadow = '0 10px 26px -8px rgba(124,131,255,0.8)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = '0 6px 18px -8px rgba(124,131,255,0.7)';
        }}
        style={{
          padding: '11px 20px',
          borderRadius: 999,
          border: '1px solid rgba(124,131,255,0.5)',
          background: 'linear-gradient(135deg, var(--accent, #3b82f6), var(--accent-strong, #5b63f5))',
          color: '#fff',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 14,
          boxShadow: '0 6px 18px -8px rgba(124,131,255,0.7), inset 0 1px 0 rgba(255,255,255,0.3)',
          transition: 'transform 0.18s ease, box-shadow 0.18s ease',
        }}
      >
        Send
      </button>
    </form>
  );
}
