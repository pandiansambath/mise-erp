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

## The skeleton's bones in pieces (§104.3)

`fracture.py` cuts the same vertebra into nineteen closed pieces along rough faces (a Voronoi
diagram whose walls are bent by noise, so neighbours fit each other), `simplify_pieces.mjs`
brings them down, and `fracture.py … pack` gives them their normals and packs them:

    python fracture.py OUT 0 cut
    node simplify_pieces.mjs OUT 0 3400
    python fracture.py OUT 0 pack ../../frontend/public/dev/spine/break_a.bin

(variant 1 is `break_b`; 2200 triangles for the `_s` files, the phone's).

## The worlds the cards curl into (§104.6)

`worlds.py RAW OUT` fills, grades and shrinks the maps (and simulates Saturn's and Neptune's
bands and Earth's clouds). RAW holds public-domain mission imagery, from Wikimedia Commons
unless said otherwise:

| file | what |
| --- | --- |
| earth.jpg | Land shallow topo 2048.jpg (NASA Blue Marble) |
| lights.jpg | City Lights 2012 - Flat map.jpg (NASA/NOAA Suomi NPP) |
| moon.jpg, moonh.jpg | NASA SVS 4720: lroc_color_2k.jpg, ldem_3_8bit.jpg (LRO) |
| mars.jpg | Mars Viking MDIM21 ClrMosaic 1km.jpg (NASA/JPL/USGS) |
| jupiter.jpg | Jupiter Cylindrical Map - Dec 2000 PIA07782.jpg (NASA/JPL/SSI Cassini) |
| venus.jpg | Cylindrical Map of Venus.jpg (NASA/JPL Magellan) |
| mercury.png | Mercury map by MESSENGER global mosaic enhancedcolor over completebasemap.png (NASA/JHUAPL) |
| europa.jpg | Europa Voyager GalileoSSI global mosaic.jpg (NASA/JPL/USGS) |
| enceladus.jpg | Enceladus Color Map.jpg (NASA/JPL/SSI/LPI Cassini, PIA18435) |
| pluto.jpg | Pluto color mapmosaic.jpg (NASA/JHUAPL/SwRI New Horizons) |
