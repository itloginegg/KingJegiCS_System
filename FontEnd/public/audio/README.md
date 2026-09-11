# Background audio for the public browsing pages

`AmbientAudio.tsx` expects **`ambient.mp3`** in this directory, and AppRoutes
mounts it on `/`, `/packages`, `/menus` and `/rentals`. Not on `/book`, `/cart`
or `/dashboard` — people are entering details or reviewing money there.

Requirements:

- **Lowercase `.mp3`.** The dev server and Windows are case-insensitive, so an
  `ambient.MP3` works locally and then 404s on a case-sensitive host.
- **Under ~1 MB.** It downloads on the first browsing page a visitor opens.
  The file currently committed is ~1.5 MB, so it is over budget — worth a
  re-encode (mono, ~96 kbps) before this ships.
- **Seamlessly loopable** — it plays with `loop`, so any gap or click at the
  boundary repeats forever and is very noticeable.
- Quiet and non-percussive. It starts muted and is opt-in, but it plays behind
  a page people are reading.

Until the file exists the feature degrades cleanly: the `<audio>` element fires
`onError`, and the toggle hides itself rather than offering sound that isn't
there. Nothing else on the page is affected.
