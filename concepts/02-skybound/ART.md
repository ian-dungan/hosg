# Skybound: Art Target

**Style:** *Gilded Facet*. Painterly low-poly with flat-shaded facets, a warm toon ramp and inked silhouettes under a golden-hour sky.

**Palette:** `#1754D1` `#479AF2` sky, `#FCB380` horizon gold, `#FFFAF3` cloud, `#ECD9B8` statue stone, `#EC6A4C` coral roof, `#3FB0A6` teal, `#8FD16A` meadow, `#C0605A` cliff rose, `#5D4675` deep rock, `#F2B742` lantern gold.

**Pillars**
1. **Facets, not textures:** vertex-coloured flat-normal meshes with per-facet colour jitter and a world-noise wash.
2. **Three-tone toon light:** warm sun, lavender shadow, gold rim and soft shadow maps.
3. **Ink and contact:** a depth/ID outline pass plus near-field SSAO, so silhouettes read crisply.
4. **Air is the vista:** fog sampled from the sky gradient, so distant islands dissolve into the sky.

**Browser tech:** three.js (WebGL2, later WebGPU) with a custom toon ShaderMaterial, Blender glTF vertex-colour assets, instanced clouds, cascaded shadows, and EffectComposer passes for outline, SSAO and bloom.
