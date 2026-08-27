/**
 * Azure Speech viseme id (0–21) → the avatar's mouth shape.
 *
 * PURE DATA, AND IT MUST STAY THAT WAY. AvatarLabPage imports this module and is itself
 * statically imported by AppRoutes, so anything this file pulls in lands in the main
 * bundle. Importing three or @pixiv/three-vrm here would drag the whole 3D stack across
 * the lazy boundary that AvatarStage exists to maintain. The code that turns the recipes
 * below into actual VRM expressions lives in visemeExpressions.ts for exactly that reason.
 *
 * WHERE THE SHAPES COME FROM — two different places, deliberately.
 *
 * Azure's viseme ids are defined against the Oculus/OVR 15-viseme grouping, which the
 * previous Avaturn export happened to ship natively. This VRM does not. Its expression
 * vocabulary is vowel-only: `aa ih ou ee oh` and nothing else for the mouth. Every
 * consonant — including the closures a viewer actually reads lips from, `PP` for p/b/m
 * and `FF` for f/v — has no preset.
 *
 * So the five vowels map onto the model's own presets, and the nine consonants are
 * CUSTOM expressions we register ourselves out of the raw `Fcl_MTH_*` shapes the face
 * mesh carries but no preset claims. That split is why the names below look inconsistent:
 * a bare name is the model's, a `viseme_`-prefixed one is ours. The prefix is not
 * decoration — it tells you which shapes exist because an artist authored them and which
 * exist because we assembled them.
 */

/**
 * Silence. Intentionally NOT a shape and intentionally not registered anywhere.
 *
 * It exists so `activeTarget` always has a value. The driver eases every real target
 * toward zero whenever this is the active one, which is what closing the mouth means —
 * there is nothing to drive positively.
 */
export const VISEME_SILENCE = 'sil';

export const VISEME_TARGETS = [
  VISEME_SILENCE,
  // Ours — see CONSONANT_RECIPES.
  'viseme_PP', 'viseme_FF', 'viseme_TH', 'viseme_DD',
  'viseme_kk', 'viseme_CH', 'viseme_SS', 'viseme_nn', 'viseme_RR',
  // The model's own presets.
  'aa', 'ee', 'ih', 'oh', 'ou',
] as const;

export type VisemeTarget = (typeof VISEME_TARGETS)[number];

/**
 * The custom consonant expressions, as blends of unowned `Fcl_MTH_*` morph targets.
 *
 * Every shape named here was checked against the model: all are present on the face mesh
 * and none is bound by any of the 14 presets, so driving them cannot collide with
 * `aa`/`ih`/`ou`/`ee`/`oh` or with `relaxed`. (Expression weights accumulate onto morph
 * influences, so a collision would silently double up rather than error.)
 *
 * CONVENTION — these are UNIT SHAPES, not amplitudes. The dominant morph in each recipe
 * is 1.0 and the others are proportions of it, so a recipe describes what the mouth is
 * doing and nothing about how hard. All amplitude lives in VISEME_INTENSITY, exactly as
 * it did when these were fifteen authored OVR shapes.
 *
 * Keep it that way. The first cut of this table wrote absolute values (`Fcl_MTH_Large`
 * at 0.30 for `kk`), which multiplied against an intensity of 0.60 to a final influence
 * of 0.18 — a consonant so faint it may as well not fire, and two coupled knobs to
 * discover before you could fix it. Scaling a recipe down to soften a phoneme is the same
 * mistake in miniature: turn its intensity down instead.
 *
 * TUNING CAVEAT — read before trusting these numbers. The blends are reasoned from what
 * each phoneme group does with the lips, not measured against reference footage, and they
 * have not been eyeballed on a running render. The structure is right and the arithmetic
 * is verified; the aesthetics are a starting point. Check `viseme_PP` first — a plosive
 * that doesn't fully close reads as wrong immediately — and then whether the mid vowels
 * and consonants sit at comparable amplitude, which is what VISEME_INTENSITY controls.
 */
export const CONSONANT_RECIPES: Record<string, Record<string, number>> = {
  // p, b, m — lips pressed shut. The most legible shape in the whole set.
  viseme_PP: { Fcl_MTH_Close: 1.0 },
  // f, v — lower lip to upper teeth: narrowed, nearly closed, not sealed.
  viseme_FF: { Fcl_MTH_Small: 1.0, Fcl_MTH_Close: 0.82 },
  // θ, ð — barely open with the tongue forward.
  viseme_TH: { Fcl_MTH_Small: 1.0, Fcl_MTH_Large: 0.73 },
  // d, t, n — small neutral opening.
  viseme_DD: { Fcl_MTH_Large: 1.0, Fcl_MTH_Neutral: 0.89 },
  // k, g, ŋ — opening slightly further back and lower.
  viseme_kk: { Fcl_MTH_Large: 1.0, Fcl_MTH_Down: 0.50 },
  // ʃ, tʃ, dʒ, ʒ — rounded and pushed forward.
  viseme_CH: { Fcl_MTH_Small: 1.0, Fcl_MTH_Surprised: 0.45 },
  // s, z — narrow, teeth close together.
  viseme_SS: { Fcl_MTH_Small: 1.0, Fcl_MTH_Close: 0.29 },
  // n, l — slightly open, relaxed.
  viseme_nn: { Fcl_MTH_Neutral: 1.0, Fcl_MTH_Large: 0.38 },
  // ɹ — a little rounding, no closure.
  viseme_RR: { Fcl_MTH_Small: 1.0, Fcl_MTH_Surprised: 0.57 },
};

/**
 * Indexed by Azure viseme id; the comment on each line is Azure's phoneme group.
 *
 * Several ids share a shape because the distinction between them is tongue position the
 * camera can't see at this framing (e.g. 9 "aʊ" and 11 "aɪ" both open to `aa`).
 */
export const AZURE_VISEME_TO_TARGET: readonly VisemeTarget[] = [
  VISEME_SILENCE, //  0  silence
  'aa',           //  1  æ, ə, ʌ
  'aa',           //  2  ɑ
  'oh',           //  3  ɔ
  'ee',           //  4  ɛ, ʊ
  'viseme_RR',    //  5  ɝ
  'ih',           //  6  j, i, ɪ
  'ou',           //  7  w, u
  'oh',           //  8  o
  'aa',           //  9  aʊ
  'oh',           // 10  ɔɪ
  'aa',           // 11  aɪ
  VISEME_SILENCE, // 12  h   — breath, no distinct shape
  'viseme_RR',    // 13  ɹ
  'viseme_nn',    // 14  l
  'viseme_SS',    // 15  s, z
  'viseme_CH',    // 16  ʃ, tʃ, dʒ, ʒ
  'viseme_TH',    // 17  ð
  'viseme_FF',    // 18  f, v
  'viseme_DD',    // 19  d, t, n, θ
  'viseme_kk',    // 20  k, g, ŋ
  'viseme_PP',    // 21  p, b, m
];

export function targetForVisemeId(id: number): VisemeTarget {
  return AZURE_VISEME_TO_TARGET[id] ?? VISEME_SILENCE;
}

/**
 * Peak influence per shape. Uniform 1.0 over-articulates — real speech barely reaches the
 * extremes of a blendshape, and a mouth that hits full `viseme_PP` on every "b" reads as
 * a puppet. Plosives and rounded vowels carry more because they're the shapes a viewer
 * actually reads lip movement from.
 *
 * Because CONSONANT_RECIPES are unit shapes, this is the ONLY amplitude control, and a
 * number here means the same thing for a model preset and for one of ours: the fraction
 * of the full shape at the peak of the phoneme. That is what makes the vowels and
 * consonants comparable — every entry below lands between 0.6 and 0.9 of its own shape.
 */
export const VISEME_INTENSITY: Record<VisemeTarget, number> = {
  [VISEME_SILENCE]: 0,
  viseme_PP: 0.9,
  viseme_FF: 0.85,
  viseme_TH: 0.7,
  viseme_DD: 0.65,
  viseme_kk: 0.6,
  viseme_CH: 0.8,
  viseme_SS: 0.7,
  viseme_nn: 0.6,
  viseme_RR: 0.7,
  aa: 0.9,
  ee: 0.75,
  ih: 0.7,
  oh: 0.85,
  ou: 0.9,
};

/**
 * Co-articulation time constants, in milliseconds. Mouths don't snap between shapes —
 * they ease, and the closing side lags the opening side. Without this the avatar
 * flickers through visemes like a slideshow, which is the single most common way
 * lip-sync looks wrong even when the timing data is perfect.
 *
 * Shape-agnostic, so these carried across the VRM migration untouched. This is the part
 * that makes lip-sync read correctly; leave it alone unless the timing itself is wrong.
 */
export const VISEME_ATTACK_MS = 70;
export const VISEME_RELEASE_MS = 110;
