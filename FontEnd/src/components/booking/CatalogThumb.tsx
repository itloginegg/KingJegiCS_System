import { useState } from 'react';

/**
 * Photo strip across the top of a booking-wizard catalog card, with the same
 * monogram fallback as RentalThumb: no image and a broken image (a path that
 * 404s) both land on the item's first letter rather than a broken-image glyph.
 *
 * The negative margins cancel `.bk-catalog-card`'s 1.1rem padding so the photo
 * runs edge to edge; the top radius is the card's, less its 1px border.
 */
export function CatalogThumb({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const showMonogram = !src || failed;

  return (
    <div
      style={{
        position: 'relative',
        aspectRatio: '4 / 3',
        margin: '-1.1rem -1.1rem .85rem',
        overflow: 'hidden',
        background: 'var(--bg-subtle)',
        borderTopLeftRadius: 'calc(var(--r-xl) - 1px)',
        borderTopRightRadius: 'calc(var(--r-xl) - 1px)',
      }}
    >
      {showMonogram ? (
        <div
          aria-hidden="true"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            fontFamily: 'var(--font-display)',
            fontSize: '2.5rem',
            lineHeight: 1,
            color: 'var(--text-dim)',
            userSelect: 'none',
          }}
        >
          {name.charAt(0).toUpperCase()}
        </div>
      ) : (
        <img
          src={src ?? undefined}
          alt={name}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', filter: 'var(--menu-img-filter)' }}
        />
      )}
    </div>
  );
}
