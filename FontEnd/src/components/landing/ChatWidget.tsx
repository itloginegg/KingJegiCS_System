import { useState } from 'react';

/** Floating chat bubble — static, design only. */
export function ChatWidget() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <div
          style={{
            position: 'fixed',
            right: '1.5rem',
            bottom: '5.5rem',
            zIndex: 40,
            width: 260,
            background: 'var(--surface)',
            border: '1px solid var(--border-accent)',
            borderRadius: 'var(--r-xl)',
            padding: '1.25rem',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
            Kumusta! 👋
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.6, fontWeight: 300 }}>
            Planning an event? Message us and we'll help you pick the perfect package.
          </p>
          <a
            href="/#availability"
            onClick={() => setOpen(false)}
            style={{
              background: 'var(--primary)',
              color: 'var(--primary-text)',
              padding: '0.6rem 1.25rem',
              marginTop: '0.9rem',
              fontFamily: 'var(--font-body)',
              fontSize: '0.68rem',
              fontWeight: 500,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              textDecoration: 'none',
              borderRadius: 'var(--r-full)',
              display: 'inline-block',
              transition: 'background 0.25s',
            }}
          >
            Start Booking
          </a>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close chat' : 'Chat with support'}
        style={{
          position: 'fixed',
          right: '1.5rem',
          bottom: '1.5rem',
          zIndex: 40,
          width: 54,
          height: 54,
          borderRadius: '50%',
          border: 'none',
          cursor: 'pointer',
          background: 'var(--accent)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'var(--shadow-gold)',
          transition: 'transform 0.2s',
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </button>
    </>
  );
}
