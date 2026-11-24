# How the award room and the skeleton were made

Everything here was run once, offline; its results are in `frontend/public/dev/award`
and `frontend/public/dev/spine`. Nothing here ships to the site.

| script | makes |
| --- | --- |
| `lettering.cjs` | the carved verse and the coin's words, as masks (Chromium shapes the Tamil; Noto Serif Tamil and Cinzel, both OFL) |
| `bake_coin.py` | `coin_a.webp`, `coin_b.webp`: the coin's two faces as height fields |
| `verse.cjs` | the wall's verse, its English and its smallest letters, as masks (the same two fonts): for `bake_wall.py` |
| `bake_wall.py` | `wall_x`, `wall_y` (the carved wall's slopes), `wall_c` (how open and how worn), `wall_deep` (its height), `wall_gilt` (its gold), `verse`, `verse_t` (the verse as distances); each again as `_s`, the middle of it for a phone |
| `bake_door.py` | `door.webp`: one leaf of the doors |
| `surroundings.html` | `env.webp`: what the room's metal reflects, prefiltered (a page for a static server that also serves three.js) |
| `vertebra.py` + `pack_vertebra.mjs` | `spine/bone_*.bin`: the vertebrae, modelled as distance fields, meshed, simplified and packed |
| `simplify_chest.mjs` | the chest's meshes at a third of their triangles |

The drawings are our own: a temple wheel, pilasters, elephants, a lamp on an open book.
The verse is Thirukkural 400. The stone (`stone_diff`, `stone_nor`) is Poly Haven's
Sandstone Blocks 08 (CC0).

## The skeleton's bones in pieces (§104.3)

`fracture.py` cuts the same vertebra into nineteen closed pieces along rough faces (a Voronoi
diagram whose walls are bent by noise, so neighbours fit each other), `simplify_pieces.mjs`
brings them down, and `fracture.py … pack` gives them their normals and packs them:

    python fracture.py OUT 0 cut
    node simplify_pieces.mjs OUT 0 3400
    python fracture.py OUT 0 pack ../../frontend/public/dev/spine/break_a.bin

(variant 1 is `break_b`; 2200 triangles for the `_s` files, the phone's).
