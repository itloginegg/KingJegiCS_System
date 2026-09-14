/**
 * The Announcements tab, which is two independent tools on one screen:
 *
 *   - the announcement composer and its history. Posting fans out to every active
 *     customer's notification bell and cannot be edited or unsent.
 *   - the public event gallery. Uploading or removing a photo notifies nobody.
 *
 * Everything either of them reads or writes lives here; the dashboard passes
 * only `notify`. Both lists load on mount, which is when the dashboard used to
 * load them - on entering the tab.
 */
import { useEffect, useState, type ChangeEvent } from 'react';
import {
  getAnnouncements,
  postAnnouncement,
  AnnouncementApiError,
  type Announcement,
} from '../../../api/announcementsApi';
import {
  fetchGalleryForAdmin,
  uploadGalleryImage,
  deleteGalleryImage,
  getFullImageUrl as getGalleryImageUrl,
  GalleryApiError,
  GALLERY_ACCEPTED_TYPES,
  GALLERY_MAX_IMAGE_BYTES,
  type GalleryImageAdmin,
} from '../../../api/galleryApi';
import { readSession } from '../../../lib/tokenStorage';
import { fmtDate, fmtDateTime } from '../../../lib/format';

export interface AnnouncementsTabProps {
  notify: (kind: 'success' | 'error' | 'info', message: string) => void;
}

export function AnnouncementsTab({ notify }: AnnouncementsTabProps) {
  /* announcements — admin broadcasts, delivered through the customer notification feed */
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [annLoading, setAnnLoading] = useState(false);
  const [annError, setAnnError] = useState<string | null>(null);
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annPosting, setAnnPosting] = useState(false);

  const loadAnnouncements = async () => {
    const session = readSession();
    if (!session?.token) {
      setAnnError('You are not signed in. Sign in with an Owner or Assistant account.');
      return;
    }
    setAnnLoading(true);
    setAnnError(null);
    try {
      setAnnouncements(await getAnnouncements(session.token));
    } catch (err) {
      setAnnError(
        err instanceof AnnouncementApiError ? err.message : 'Could not load announcements. Please try again.',
      );
    } finally {
      setAnnLoading(false);
    }
  };

  const submitAnnouncement = async () => {
    const session = readSession();
    if (!session?.token) { notify('error', 'You are signed out. Sign in as Owner/Assistant.'); return; }
    if (!annTitle.trim() || !annBody.trim()) {
      notify('error', 'An announcement needs both a title and a message.');
      return;
    }

    setAnnPosting(true);
    try {
      const posted = await postAnnouncement(session.token, {
        title: annTitle.trim(),
        body: annBody.trim(),
      });
      setAnnouncements((prev) => [posted, ...prev]);
      setAnnTitle('');
      setAnnBody('');
      // NotifiedCount is the real fan-out result, so say what actually happened
      // rather than assuming everyone was reached.
      notify(
        posted.notifiedCount > 0 ? 'success' : 'info',
        posted.notifiedCount > 0
          ? `Announcement posted — ${posted.notifiedCount} customer${posted.notifiedCount === 1 ? '' : 's'} notified.`
          : 'Announcement posted, but no customers were notified. Check that active customers exist.',
      );
    } catch (err) {
      notify('error', err instanceof AnnouncementApiError ? err.message : 'Could not post the announcement.');
    } finally {
      setAnnPosting(false);
    }
  };

  /* ── gallery images ───────────────────────────────────────────────────────
     The public "Events by King Jegi" gallery. Deliberately independent of the
     announcement composer above: separate state, separate submit, separate
     endpoint. Posting an announcement never touches these, and uploading here
     never creates an announcement. */
  const [galleryImages, setGalleryImages] = useState<GalleryImageAdmin[]>([]);
  const [galLoading, setGalLoading] = useState(false);
  const [galError, setGalError] = useState<string | null>(null);
  const [galUploading, setGalUploading] = useState(false);
  const [galDeletingId, setGalDeletingId] = useState<string | null>(null);
  const [galCaption, setGalCaption] = useState('');

  const loadGallery = async () => {
    const session = readSession();
    if (!session?.token) {
      setGalError('You are not signed in. Sign in with an Owner or Assistant account.');
      return;
    }
    setGalLoading(true);
    setGalError(null);
    try {
      setGalleryImages(await fetchGalleryForAdmin(session.token));
    } catch (err) {
      setGalError(
        err instanceof GalleryApiError ? err.message : 'Could not load the gallery. Please try again.',
      );
    } finally {
      setGalLoading(false);
    }
  };

  const uploadGalleryImages = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ''; // let the same file be re-picked after a removal
    if (picked.length === 0) return;

    const session = readSession();
    if (!session?.token) {
      setGalError('You are not signed in. Sign in with an Owner or Assistant account.');
      return;
    }

    const problems: string[] = [];
    const queue: File[] = [];
    for (const file of picked) {
      if (!GALLERY_ACCEPTED_TYPES.includes(file.type)) {
        problems.push(`${file.name} — only JPG, PNG or WebP.`);
      } else if (file.size > GALLERY_MAX_IMAGE_BYTES) {
        problems.push(`${file.name} — over 5 MB.`);
      } else {
        queue.push(file);
      }
    }

    setGalUploading(true);
    setGalError(null);
    let uploaded = 0;
    try {
      for (const file of queue) {
        // The caption applies to the whole batch — one caption box, so a
        // multi-file pick shares it rather than silently captioning only the first.
        const saved = await uploadGalleryImage(session.token, file, galCaption);
        uploaded += 1;
        // Merged as each lands, so a mid-batch failure still shows what succeeded.
        setGalleryImages((prev) => [...prev, saved]);
      }
      if (uploaded > 0) setGalCaption('');
    } catch (err) {
      problems.push(err instanceof GalleryApiError ? err.message : 'One of the uploads failed.');
    } finally {
      setGalUploading(false);
      setGalError(problems.length > 0 ? problems.join(' ') : null);
      if (uploaded > 0) {
        notify('success', `${uploaded} image${uploaded === 1 ? '' : 's'} added to the gallery.`);
      }
    }
  };

  const removeGalleryImage = async (id: string) => {
    const session = readSession();
    if (!session?.token) {
      setGalError('You are not signed in. Sign in with an Owner or Assistant account.');
      return;
    }
    setGalDeletingId(id);
    setGalError(null);
    try {
      await deleteGalleryImage(session.token, id);
      setGalleryImages((prev) => prev.filter((img) => img.id !== id));
      notify('success', 'Image removed from the gallery.');
    } catch (err) {
      setGalError(err instanceof GalleryApiError ? err.message : 'Could not remove that image.');
    } finally {
      setGalDeletingId(null);
    }
  };

  useEffect(() => {
    void loadAnnouncements();
    void loadGallery();
  }, []);

  return (
    <div className="fade-up" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: '16px', padding: '24px', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600, letterSpacing: '-0.028em', color: 'var(--text-primary)' }}>Announcements</h2>
        <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1.4, color: 'var(--text-muted)' }}>
          Posting one notifies every active customer through their notification bell.
        </p>
      </div>

      {/* compose */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '22px' }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '16px' }}>New Announcement</div>
        <label htmlFor="ann-title" style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>Title</label>
        <input
          id="ann-title"
          maxLength={150}
          placeholder="Holiday hours for December"
          value={annTitle}
          onChange={(e) => setAnnTitle(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-body)', fontSize: '14px', fontWeight: 400, lineHeight: 1, color: 'var(--text-primary)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '12px', padding: '13px', marginBottom: '16px' }}
        />
        <label htmlFor="ann-body" style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>Message</label>
        <textarea
          id="ann-body"
          rows={5}
          maxLength={2000}
          placeholder="What do you want every customer to know?"
          value={annBody}
          onChange={(e) => setAnnBody(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-body)', fontSize: '14px', fontWeight: 400, lineHeight: 1.55, color: 'var(--text-primary)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '12px', padding: '13px', minHeight: '104px', resize: 'vertical' }}
        />
        <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 400, lineHeight: 1, color: 'var(--text-muted)', marginTop: '8px' }}>
          {annBody.length} / 2000
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', marginTop: '16px' }}>
          <span style={{ flex: 1, minWidth: '200px', fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 400, lineHeight: 1.4, color: 'var(--text-muted)' }}>
            Announcements can't be edited or unsent once posted.
          </span>
          <button
            type="button"
            disabled={annPosting || !annTitle.trim() || !annBody.trim()}
            onClick={() => void submitAnnouncement()}
            style={{ fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 600, lineHeight: 1, background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', padding: '14px 22px', borderRadius: '999px', opacity: (annPosting || !annTitle.trim() || !annBody.trim()) ? 0.45 : 1, cursor: (annPosting || !annTitle.trim() || !annBody.trim()) ? 'not-allowed' : 'pointer' }}
          >
            {annPosting ? 'Posting...' : 'Post announcement'}
          </button>
        </div>
      </div>

      {/* ── Event gallery ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '22px' }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: '10px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '16px' }}>Event Gallery</div>

        <label htmlFor="gal-caption" style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>Caption</label>
        <input
          id="gal-caption"
          maxLength={200}
          placeholder="Golden anniversary at Villa Estrella"
          value={galCaption}
          disabled={galUploading}
          onChange={(e) => setGalCaption(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-body)', fontSize: '14px', fontWeight: 400, lineHeight: 1, color: 'var(--text-primary)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '12px', padding: '13px', marginBottom: '4px' }}
        />
        <div style={{ fontFamily: 'var(--font-body)', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '16px' }}>Optional, used as alt text.</div>

        <label htmlFor="gal-images" style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 600, lineHeight: 1, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>Photos</label>
        <input
          id="gal-images"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={galUploading}
          onChange={uploadGalleryImages}
          style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-body)', fontSize: '14px', fontWeight: 400, lineHeight: 1, color: 'var(--text-primary)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '12px', padding: '10px 13px', marginBottom: '4px' }}
        />
        <div style={{ fontFamily: 'var(--font-body)', fontSize: '11px', color: 'var(--text-muted)' }}>JPG/PNG/WebP, 5 MB each. Uploading here notifies nobody and posts nothing.</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', marginTop: '16px' }}>
          <span style={{ flex: 1, minWidth: '200px', fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 400, lineHeight: 1.4, color: 'var(--text-muted)' }}>
            {galUploading
              ? 'Uploading…'
              : `${galleryImages.length} ${galleryImages.length === 1 ? 'image' : 'images'} in the gallery`}
          </span>
          <button
            type="button"
            disabled={galLoading || galUploading}
            onClick={() => void loadGallery()}
            style={{ fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 600, lineHeight: 1, background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', padding: '14px 22px', borderRadius: '999px', opacity: (galLoading || galUploading) ? 0.45 : 1, cursor: (galLoading || galUploading) ? 'not-allowed' : 'pointer' }}
          >
            {galLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {galError && (
          <div
            role="alert"
            style={{
              marginTop: '0.7rem', padding: '0.6rem 0.8rem',
              border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
              borderRadius: 'var(--r-lg)', background: 'var(--danger-muted)',
              fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--danger)', lineHeight: 1.5,
            }}
          >
            {galError}
          </div>
        )}

        {galLoading ? (
          <div style={{ marginTop: '0.9rem', display: 'flex', gap: '0.7rem' }} aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="adm-skel" style={{ height: 104, flex: 1, borderRadius: 'var(--r-lg)' }} />
            ))}
          </div>
        ) : galleryImages.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.9rem' }}>
            No gallery photos yet. The public gallery section stays hidden until you add one.
          </p>
        ) : (
          <div
            style={{
              marginTop: '0.9rem', display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.7rem',
            }}
          >
            {galleryImages.map((img, i) => (
              <div
                key={img.id}
                style={{
                  border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                  overflow: 'hidden', background: 'var(--bg-subtle)',
                  display: 'flex', flexDirection: 'column',
                }}
              >
                <img
                  src={getGalleryImageUrl(img.url) ?? undefined}
                  alt={img.caption ?? `Gallery photo ${i + 1}`}
                  loading="lazy"
                  style={{ width: '100%', height: 104, objectFit: 'cover', display: 'block' }}
                />
                <div style={{ padding: '0.45rem 0.55rem', flex: 1 }}>
                  <div
                    title={img.caption ?? undefined}
                    style={{
                      fontFamily: 'var(--font-body)', fontSize: '0.66rem', fontWeight: 500,
                      color: img.caption ? 'var(--text-primary)' : 'var(--text-dim)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {img.caption ?? 'No caption'}
                  </div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.58rem', color: 'var(--text-dim)', marginTop: '0.15rem' }}>
                    {img.uploadedByName} · {fmtDateTime(img.uploadedAt)}
                  </div>
                </div>
                <button
                  type="button"
                  className="adm-btn danger"
                  disabled={galDeletingId === img.id}
                  onClick={() => void removeGalleryImage(img.id)}
                  aria-label={`Remove gallery photo ${i + 1}`}
                  style={{ width: '100%', fontSize: '0.55rem', padding: '0.32rem', borderRadius: 0 }}
                >
                  {galDeletingId === img.id ? 'Removing…' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {annError && !annLoading && (
        <div style={{ padding: '1.4rem 1.6rem', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: '16px', background: 'var(--surface)' }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: '0.8rem', fontWeight: 300, color: 'var(--danger)', margin: 0 }}>
            {annError}
          </p>
        </div>
      )}

      {annLoading && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '1.4rem 1.6rem' }} aria-hidden="true">
          <div className="adm-skel" style={{ height: '0.8rem', width: 140, marginBottom: '1.2rem' }} />
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ padding: '0.75rem 0', borderBottom: i < 2 ? '1px solid var(--border)' : 'none' }}>
              <div className="adm-skel" style={{ height: '0.9rem', width: '35%', marginBottom: '0.45rem' }} />
              <div className="adm-skel" style={{ height: '0.6rem', width: '75%' }} />
            </div>
          ))}
        </div>
      )}
      {/* history */}
      {!annLoading && !annError && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '4px 20px' }}>
          {announcements.length === 0 ? (
            <div style={{ padding: '15px 0', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: '12px', color: 'var(--text-muted)' }}>
              Nothing posted yet. Your first announcement will appear here.
            </div>
          ) : (
            announcements.map((a, idx) => (
              <div key={a.id} style={{ padding: '15px 0', borderBottom: idx < announcements.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: '14px', fontWeight: 500, lineHeight: 1.3, color: 'var(--text-primary)' }}>
                  {a.title}
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 400, lineHeight: 1.5, color: 'var(--text-secondary)', marginTop: '5px', whiteSpace: 'pre-wrap' }}>
                  {a.body}
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: '11px', fontWeight: 400, lineHeight: 1, color: 'var(--text-muted)', marginTop: '8px' }}>
                  Posted {fmtDate(a.createdAt)} · sent to {a.notifiedCount} customers
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
