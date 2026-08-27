import { useId, type CSSProperties } from 'react';
import {
  SERVICE_AREA_CITIES,
  SERVICE_AREA_NOTE,
  type VenueAddress,
} from '../../lib/venue';

export interface VenueAddressFieldsProps {
  value: VenueAddress;
  onChange: (next: VenueAddress) => void;
  /** Class for each field's wrapper — e.g. "bk-field", "form-row". */
  fieldClassName?: string;
  /** Class for each `<label>` — e.g. "bk-label", "pbg-label". */
  labelClassName?: string;
  /** Class for the `<input>`/`<select>` — e.g. "bk-input", "adm-input". */
  inputClassName?: string;
  /** Class on the grid wrapper, for slotting into a host page's own layout. */
  className?: string;
  /** Merged over the default grid, so a host can override columns or span. */
  style?: CSSProperties;
  /** Zip is part of the baseline format; hide it where it would be noise. */
  showZip?: boolean;
  disabled?: boolean;
  required?: boolean;
  /** Defaults to "Street"/"City"/"Zip Code". */
  labels?: { street?: string; city?: string; zip?: string };
  /** Caption under the city select. Pass null to drop it. */
  note?: string | null;
}

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: '0.9rem',
};

/**
 * Street + city + zip, with the city restricted to the four Laguna cities the
 * business actually serves.
 *
 * Extracted from BookingPage step 1, which was the only form enforcing the
 * format. Styling is passed in rather than owned here because the host forms
 * use different CSS conventions; the markup shape
 * (`div > label + input`) is the one all of them already style correctly.
 */
export function VenueAddressFields({
  value,
  onChange,
  fieldClassName,
  labelClassName,
  inputClassName,
  className,
  style,
  showZip = true,
  disabled,
  required,
  labels,
  note = SERVICE_AREA_NOTE,
}: VenueAddressFieldsProps) {
  const uid = useId();
  const set = (part: keyof VenueAddress) => (next: string) =>
    onChange({ ...value, [part]: next });

  return (
    <div className={className} style={{ ...gridStyle, ...style }}>
      <div className={fieldClassName}>
        <label className={labelClassName} htmlFor={`${uid}-street`}>
          {labels?.street ?? 'Street'}
        </label>
        <input
          id={`${uid}-street`}
          className={inputClassName}
          placeholder="123 Main St."
          autoComplete="address-line1"
          value={value.street}
          disabled={disabled}
          required={required}
          onChange={(e) => set('street')(e.target.value)}
        />
      </div>

      <div className={fieldClassName}>
        <label className={labelClassName} htmlFor={`${uid}-city`}>
          {labels?.city ?? 'City'}
        </label>
        <select
          id={`${uid}-city`}
          className={inputClassName}
          value={value.city}
          disabled={disabled}
          required={required}
          onChange={(e) => set('city')(e.target.value)}
        >
          <option value="" disabled>Select a city</option>
          {SERVICE_AREA_CITIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        {note && (
          <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', marginTop: '.25rem', textTransform: 'none', letterSpacing: 'normal' }}>
            {note}
          </div>
        )}
      </div>

      {showZip && (
        <div className={fieldClassName}>
          <label className={labelClassName} htmlFor={`${uid}-zip`}>
            {labels?.zip ?? 'Zip Code'}
          </label>
          <input
            id={`${uid}-zip`}
            className={inputClassName}
            placeholder="4027"
            inputMode="numeric"
            autoComplete="postal-code"
            value={value.zip}
            disabled={disabled}
            onChange={(e) => set('zip')(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
        </div>
      )}
    </div>
  );
}
