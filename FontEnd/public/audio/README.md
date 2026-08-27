# Landing-page background audio

`AmbientAudio.tsx` expects **`ambient.mp3`** in this directory.

Requirements:

- **Under ~1 MB.** It downloads on every landing-page visit.
- **Seamlessly loopable** — it plays with `loop`, so any gap or click at the
  boundary repeats forever and is very noticeable.
- Quiet and non-percussive. It starts muted and is opt-in, but it plays behind
  a page people are reading.

Until the file exists the feature degrades cleanly: the `<audio>` element fires
`onError`, and the toggle hides itself rather than offering sound that isn't
there. Nothing else on the page is affected.
