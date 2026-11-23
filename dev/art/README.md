# How the award room and the skeleton were made

Everything here was run once, offline; its results are in `frontend/public/dev/award`
and `frontend/public/dev/spine`. Nothing here ships to the site.

| script | makes |
| --- | --- |
| `lettering.cjs` | the carved verse and the coin's words, as masks (Chromium shapes the Tamil; Noto Serif Tamil and Cinzel, both OFL) |
| `bake_coin.py` | `coin_a.webp`, `coin_b.webp`: the coin's two faces as height fields |
| `bake_wall.py` | `wall_h.webp`, `wall_gold.webp`: the carved wall's height, and its gold |
| `bake_door.py` | `door.webp`: one leaf of the doors |
| `surroundings.html` | `env.webp`: what the room's metal reflects, prefiltered (a page for a static server that also serves three.js) |
| `vertebra.py` + `pack_vertebra.mjs` | `spine/bone_*.bin`: the vertebrae, modelled as distance fields, meshed, simplified and packed |
| `simplify_chest.mjs` | the chest's meshes at a third of their triangles |

The drawings are our own: a temple wheel, pilasters, elephants, a lamp on an open book.
The verse is Thirukkural 400. The stone (`stone_diff`, `stone_nor`) is Poly Haven's
Sandstone Blocks 08 (CC0).
