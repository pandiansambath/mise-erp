// The award room's models (§102.1), and every file their loader asks for, so
// the profile page can warm them and the award page can start them with its
// HTML. Poly Haven, CC0 (public/dev/models/CREDITS.md). The chest's vertex data
// is quantized (KHR_mesh_quantization, read natively by three.js): 2.8 MB of
// floats became 1.7 MB.

export const CHEST_GLTF = "/dev/models/treasure_chest/treasure_chest_1k.gltf";
export const HAMMER_GLTF = "/dev/models/cross_pein_hammer/cross_pein_hammer_1k.gltf";
/** The vault's stone floor: colour, normals, and occlusion/roughness. */
export const FLOOR_TEX = { diff: "/dev/models/vault_floor/diff.jpg", nor: "/dev/models/vault_floor/nor_gl.jpg", arm: "/dev/models/vault_floor/arm.jpg" };

/** The hall (§103.5): the carved back wall's height and its gold, the stone it is
 *  cut in (Poly Haven, CC0). */
export const HALL_TEX = { wall: "/dev/award/wall_h.webp", gold: "/dev/award/wall_gold.webp", stone: "/dev/award/stone_diff.webp", stoneN: "/dev/award/stone_nor.webp" };
/** The coin's two faces, as heights (§103.3). */
export const COIN_TEX = { front: "/dev/award/coin_a.webp", back: "/dev/award/coin_b.webp" };
/** What the metal in it reflects, prefiltered (awardRoom, surroundings). */
export const ENV_TEX = "/dev/award/env.webp";
/** One leaf of the doors it is entered by (§103.2). */
export const DOOR_IMG = "/dev/award/door.webp";

export const AWARD_MODEL_FILES = [
  CHEST_GLTF,
  "/dev/models/treasure_chest/treasure_chest_1k.bin",
  "/dev/models/treasure_chest/textures/treasure_chest_diff_1k.jpg",
  "/dev/models/treasure_chest/textures/treasure_chest_nor_gl_1k.jpg",
  "/dev/models/treasure_chest/textures/treasure_chest_arm_1k.jpg",
  HAMMER_GLTF,
  "/dev/models/cross_pein_hammer/cross_pein_hammer.bin",
  "/dev/models/cross_pein_hammer/textures/cross_pein_hammer_diff_1k.jpg",
  "/dev/models/cross_pein_hammer/textures/cross_pein_hammer_nor_gl_1k.jpg",
  "/dev/models/cross_pein_hammer/textures/cross_pein_hammer_arm_1k.jpg",
  FLOOR_TEX.diff,
  FLOOR_TEX.nor,
  FLOOR_TEX.arm,
  HALL_TEX.wall,
  HALL_TEX.gold,
  HALL_TEX.stone,
  HALL_TEX.stoneN,
  COIN_TEX.front,
  COIN_TEX.back,
  ENV_TEX,
];

/** Warm ~3.9 MB ahead of time only on a connection that can spare it: not
 *  when the visitor asked to save data, not on 2G or 3G. */
export function canWarmAward(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !(c?.saveData || /2g|3g/.test(c?.effectiveType ?? ""));
}
