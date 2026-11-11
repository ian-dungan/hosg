# Second Age: target render

**Style:** "Lanternlit Ruin-Iso". Stylised-realism isometric 3D: a hopeful solarpunk village grown over moss-covered ancient stone, lit at night.

**Palette:** `#05080D` night base · `#0B1622` deep blue · `#1F8F86` teal mid · `#1FFFDB` arcane teal · `#C7FFF2` orb core · `#FF8F33` lantern amber · `#FFD9A0` window glow · `#2E5A2A` moss · `#7A8A88` statue stone

**Rendering pillars**
1. **Emissive-driven lighting.** Teal conduits, glyph bands, the orb and amber windows/lanterns are the real light sources, and each casts a pool on the ground.
2. **Layered atmosphere.** Height fog, volumetric in-scatter around lights, drifting wisps and motes.
3. **Bloom and god-rays.** An HDR bright pass with ACES tonemap and a teal/amber grade.
4. **Overgrowth as material.** Moss, vines and glowing cracks come from procedural masks (normal and noise) on the stone.

**Browser tech:** Three.js or Babylon.js on WebGPU, with a WebGL2 fallback. Use a fixed iso orthographic camera, clustered forward lighting for many small lights, baked AO/lightmaps for the static town, and post effects (bloom, height fog, LUT grade) via pmndrs/postprocessing.
