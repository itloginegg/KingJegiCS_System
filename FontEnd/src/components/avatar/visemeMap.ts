/**
 * Azure Speech viseme id (0–21) → the avatar's morph target.
 *
 * The Avaturn export ships the Oculus/OVR 15-viseme set natively (`viseme_sil`,
 * `viseme_PP`, …) alongside its ARKit blendshapes, and Azure's viseme ids are defined
 * against that same Oculus grouping. So this is a direct lookup rather than a table of
 * weighted ARKit blends — fewer moving parts, and the shapes were authored for exactly
 * these phoneme groups instead of being approximated from jaw/lip primitives.
 *
 * Ids and their phoneme groups come from Azure's viseme documentation; several ids share
 * a mouth shape because the distinction between them is tongue position the camera can't
 * see at this framing (e.g. 9 "aʊ" and 11 "aɪ" both open to `aa`).
 */

/** Morph target names present on Head_Mesh, Teeth_Mesh and Tongue_Mesh. */
export const VISEME_TARGETS = [
  'viseme_sil', 'viseme_PP', 'viseme_FF', 'viseme_TH', 'viseme_DD',
  'viseme_kk', 'viseme_CH', 'viseme_SS', 'viseme_nn', 'viseme_RR',
  'viseme_aa', 'viseme_E', 'viseme_I', 'viseme_O', 'viseme_U',
] as const;

export type VisemeTarget = (typeof VISEME_TARGETS)[number];

/** Indexed by Azure viseme id; the comment on each line is Azure's phoneme group. */
export const AZURE_VISEME_TO_TARGET: readonly VisemeTarget[] = [
  'viseme_sil',  //  0  silence
  'viseme_aa',   //  1  æ, ə, ʌ
  'viseme_aa',   //  2  ɑ
  'viseme_O',    //  3  ɔ
  'viseme_E',    //  4  ɛ, ʊ
  'viseme_RR',   //  5  ɝ
  'viseme_I',    //  6  j, i, ɪ
  'viseme_U',    //  7  w, u
  'viseme_O',    //  8  o
  'viseme_aa',   //  9  aʊ
  'viseme_O',    // 10  ɔɪ
  'viseme_aa',   // 11  aɪ
  'viseme_sil',  // 12  h   — breath, no distinct shape
  'viseme_RR',   // 13  ɹ
  'viseme_nn',   // 14  l
  'viseme_SS',   // 15  s, z
  'viseme_CH',   // 16  ʃ, tʃ, dʒ, ʒ
  'viseme_TH',   // 17  ð
  'viseme_FF',   // 18  f, v
  'viseme_DD',   // 19  d, t, n, θ
  'viseme_kk',   // 20  k, g, ŋ
  'viseme_PP',   // 21  p, b, m
];

export function targetForVisemeId(id: number): VisemeTarget {
  return AZURE_VISEME_TO_TARGET[id] ?? 'viseme_sil';
}

/**
 * Peak influence per shape. Uniform 1.0 over-articulates — real speech barely reaches the
 * extremes of a blendshape, and a mouth that hits full `viseme_PP` on every "b" reads as
 * a puppet. Plosives and rounded vowels carry more because they're the shapes a viewer
 * actually reads lip movement from.
 */
export const VISEME_INTENSITY: Record<VisemeTarget, number> = {
  viseme_sil: 0,
  viseme_PP: 0.9,
  viseme_FF: 0.85,
  viseme_TH: 0.7,
  viseme_DD: 0.65,
  viseme_kk: 0.6,
  viseme_CH: 0.8,
  viseme_SS: 0.7,
  viseme_nn: 0.6,
  viseme_RR: 0.7,
  viseme_aa: 0.9,
  viseme_E: 0.75,
  viseme_I: 0.7,
  viseme_O: 0.85,
  viseme_U: 0.9,
};

/**
 * Co-articulation time constants, in milliseconds. Mouths don't snap between shapes —
 * they ease, and the closing side lags the opening side. Without this the avatar
 * flickers through visemes like a slideshow, which is the single most common way
 * lip-sync looks wrong even when the timing data is perfect.
 */
export const VISEME_ATTACK_MS = 70;
export const VISEME_RELEASE_MS = 110;
