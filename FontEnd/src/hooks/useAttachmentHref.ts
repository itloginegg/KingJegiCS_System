import { useEffect, useState } from 'react';
import { attachmentUrl } from '../api/supportApi';
import { readSession } from '../lib/tokenStorage';

export type AttachmentHref =
  | { status: 'loading'; href: null }
  | { status: 'ready'; href: string }
  | { status: 'failed'; href: null };

const LOCAL_URL = /^(blob:|data:)/;

/**
 * Turns a support attachment's server path into something an <img> or <a> can use.
 *
 * Attachments are served only through an authorized endpoint now — customer files
 * aren't public static files any more — and neither <img src> nor <a href> can send
 * an Authorization header. So the file is fetched here with the session token and
 * handed back as a blob: URL, which is revoked when the message unmounts or the path
 * changes. A path that is already a blob:/data: URL (a local preview) passes through.
 *
 * The fetched result is stored against the URL it was fetched for, so a changed path
 * reads as 'loading' until its own answer arrives rather than showing the old file.
 */
export function useAttachmentHref(urlPath?: string | null): AttachmentHref {
  const url = attachmentUrl(urlPath);
  const [fetched, setFetched] = useState<{ url: string; href: string | null } | null>(null);

  useEffect(() => {
    if (!url || LOCAL_URL.test(url)) return;

    const controller = new AbortController();
    let objectUrl: string | null = null;

    fetch(url, {
      headers: { Authorization: `Bearer ${readSession()?.token ?? ''}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        objectUrl = URL.createObjectURL(await res.blob());
        setFetched({ url, href: objectUrl });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFetched({ url, href: null });
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (!url) return { status: 'failed', href: null };
  if (LOCAL_URL.test(url)) return { status: 'ready', href: url };
  if (fetched?.url !== url) return { status: 'loading', href: null };
  return fetched.href ? { status: 'ready', href: fetched.href } : { status: 'failed', href: null };
}
