/**
 * How the avatar is framed.
 *
 * Its own module so AvatarStage can name a framing without importing AvatarModel, which
 * would pull three/R3F/drei back into the main bundle and defeat the lazy boundary.
 *
 *  - `bust` — head and shoulders, for the 175px banner inside the chat panel.
 *  - `full` — the whole standing figure, for the persistent on-page avatar.
 *
 * The two are not interchangeable: they differ in camera distance, field of view, which
 * meshes are visible (shoes), and how much the absence of a body animation clip shows.
 */
export type AvatarFraming = 'bust' | 'full';

/** Field of view per framing. Narrow reads as a portrait lens; wider suits a full body. */
export const FOV_BY_FRAMING: Record<AvatarFraming, number> = {
  // A long lens at close range: flattering on a face, and the framing the chat panel
  // banner was designed around.
  bust: 20,
  // Wide enough to take in a standing figure without the camera retreating so far that
  // the head becomes too small to read expression on.
  full: 30,
};
