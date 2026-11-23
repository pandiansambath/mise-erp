# The award room's models

All from **Poly Haven** (https://polyhaven.com), released under **CC0**:
public domain, no attribution required. They are credited anyway, because
knowing where a file came from is the difference between an asset and a
liability.

- `treasure_chest/`: **Treasure Chest** by **Rico Cilliers**
  (https://polyhaven.com/a/treasure_chest). It is photo-real: wood grain and
  wear, iron with rust and scratches, in colour, normal and
  roughness/metal maps. The lid (`treasure_chest_lid`, origin on the back
  hinge) and the lock (`treasure_chest_lock`) are separate nodes, so the lid
  can be hinged open and the lock snapped off.
- `cross_pein_hammer/`: **Cross Pein Hammer** by **Tics**
  (https://polyhaven.com/a/cross_pein_hammer).

- `vault_floor/`: **Large Sandstone Blocks 01** by **Rob Tuytel**
  (https://polyhaven.com/a/large_sandstone_blocks_01), scaled to 768 px (the
  occlusion/roughness map to 512) with ffmpeg.

The two models are the 1k glTF downloads. Their textures were re-encoded with ffmpeg as
JPEG, -q:v 4, and -q:v 2 for the normal maps. The chest's vertex data is
quantized (KHR_mesh_quantization, which three.js reads natively): 2.8 MB
became 1.7 MB.

They load only for the award room (`/award`, `dev/AwardStage.tsx`). The
profile page warms them only on a connection that can spare it
(`dev/awardFiles.ts`).

They replace `chest.glb`, a low-poly pirate chest (Poly Pizza, by dook, CC0).
Its stylised look read as a cartoon (§102.1).
