import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

interface OtpCodeInputProps {
  /** The code entered so far, e.g. "42" while the user is mid-entry. */
  value: string;
  onChange: (value: string) => void;
  /** Number of digit boxes. Defaults to the backend's 6-digit codes. */
  length?: number;
  disabled?: boolean;
  invalid?: boolean;
  /** Ties the boxes to an external error message for screen readers. */
  ariaDescribedBy?: string;
}

/**
 * One-box-per-digit code entry. Typing auto-advances, Backspace walks left,
 * and pasting a full code from the email fills every box at once. The value
 * is kept as a single string so the parent just checks `value.length === 6`.
 */
export function OtpCodeInput({
  value,
  onChange,
  length = 6,
  disabled = false,
  invalid = false,
  ariaDescribedBy,
}: OtpCodeInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  const focusIndex = (index: number) =>
    refs.current[Math.max(0, Math.min(length - 1, index))]?.focus();

  const handleInput = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, '').slice(-1);
    if (!digit) {
      // The box was cleared (select-all + delete) — drop that position.
      onChange(value.slice(0, index) + value.slice(index + 1));
      return;
    }
    const next = (value.slice(0, index) + digit + value.slice(index + 1)).slice(
      0,
      length,
    );
    onChange(next);
    focusIndex(index + 1);
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (value[index]) {
        onChange(value.slice(0, index) + value.slice(index + 1));
      } else if (index > 0) {
        onChange(value.slice(0, index - 1) + value.slice(index));
        focusIndex(index - 1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusIndex(index - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusIndex(index + 1);
    }
  };

  const handlePaste = (index: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const digits = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!digits) return;
    const next = (value.slice(0, index) + digits).slice(0, length);
    onChange(next);
    focusIndex(next.length);
  };

  return (
    <div className="flex justify-center gap-2 sm:gap-3">
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={2}
          value={value[i] ?? ''}
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onFocus={(e) => e.target.select()}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          aria-describedby={ariaDescribedBy}
          className={boxClasses(invalid)}
        />
      ))}
    </div>
  );
}

function boxClasses(invalid: boolean): string {
  return [
    'h-12 w-10 rounded-lg border bg-[var(--surface)] text-center text-lg font-semibold text-[var(--text-primary)] shadow-sm',
    'transition-colors sm:h-14 sm:w-12 sm:text-xl',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0',
    'disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:opacity-60',
    invalid
      ? 'border-[var(--danger)] focus-visible:ring-[var(--danger)]'
      : 'border-[var(--border-strong)] focus-visible:ring-[var(--primary)]',
  ].join(' ');
}
