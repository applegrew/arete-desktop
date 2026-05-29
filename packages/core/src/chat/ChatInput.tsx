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
        padding: 8,
        borderTop: '1px solid #2a2a2a',
        background: '#111',
      }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder={placeholder ?? 'Ask the agent…'}
        style={{
          flex: 1,
          padding: '8px 12px',
          borderRadius: 6,
          border: '1px solid #333',
          background: '#0f0f0f',
          color: '#fff',
          fontFamily: 'inherit',
          fontSize: 14,
        }}
      />
      <button
        type="submit"
        disabled={disabled}
        style={{
          padding: '8px 16px',
          borderRadius: 6,
          border: 'none',
          background: '#3b82f6',
          color: '#fff',
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        Send
      </button>
    </form>
  );
}
