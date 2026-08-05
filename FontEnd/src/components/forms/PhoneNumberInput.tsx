import type { InputHTMLAttributes } from 'react';
import { PH_PHONE_PLACEHOLDER, formatPhPhone } from '../../lib/phone';

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
>;

export interface PhoneNumberInputProps extends NativeInputProps {
  /** The masked display value, e.g. "+63 917-123-4567". */
  value: string;
  /** Receives the re-masked value. Use `toE164()` if the API needs E.164. */
  onChange: (masked: string) => void;
}

/**
 * A `+63 000-000-0000` masked phone field.
 *
 * Styling stays with the caller — the five host forms use five different CSS
 * conventions (`bk-input`, `adm-input`, `pbg-input`, `mnu-co-input`, Tailwind),
 * so this owns the masking behaviour only and takes `className` as-is.
 */
export function PhoneNumberInput({
  value,
  onChange,
  placeholder = PH_PHONE_PLACEHOLDER,
  ...rest
}: PhoneNumberInputProps) {
  return (
    <input
      {...rest}
      type="tel"
      inputMode="tel"
      autoComplete={rest.autoComplete ?? 'tel'}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(formatPhPhone(e.target.value))}
    />
  );
}
