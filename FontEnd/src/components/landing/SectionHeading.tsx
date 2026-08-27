import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface SectionHeadingProps {
  /** Small mono label above the title. */
  kicker: string;
  title: ReactNode;
  /** Optional trailing link, right-aligned on the heading's baseline. */
  linkLabel?: string;
  linkTo?: string;
  /** Free-form node in the trailing slot, when a plain link isn't enough. */
  aside?: ReactNode;
}

/**
 * Flush-left section header.
 *
 * Replaces the centred eyebrow-chip header the page used everywhere. Centred
 * headers made every section start from the middle and read as six unrelated
 * posters; a left rag gives the page one spine, and frees the right end of the
 * line for the "see all" link that used to sit orphaned below the grid.
 */
export function SectionHeading({ kicker, title, linkLabel, linkTo, aside }: SectionHeadingProps) {
  return (
    <div className="ui-sec-head">
      <div>
        <div className="ui-kicker">{kicker}</div>
        <h2 className="ui-h2">{title}</h2>
      </div>
      {aside ?? (linkLabel && linkTo
        ? <Link to={linkTo} className="ui-sec-link">{linkLabel} →</Link>
        : null)}
    </div>
  );
}

export default SectionHeading;
