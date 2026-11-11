# Afterlight: Art Target

**Style:** "Lantern Diorama", HD-2D pixel art. Sprites are drawn at 400x225, upscaled x4 and lit at 1600x900.

**Palette:** `#100f28` `#322c66` `#6b4085` `#b55a83` `#ea8a72` `#ffd486` · stone `#1e1b2c` `#48405c` `#93808f` `#d4b49e` · lamp `#ffd27a` `#fff2c0` `#f07a2a` · cobble `#2f2b42` · accents `#28346e` `#a83038` `#2e6a74`

**Pillars**
1. **Crisp pixels, soft light.** Sprites use a limited palette with no anti-aliasing. Lighting runs at full resolution.
2. **Light map.** A cool ambient layer is blended by hard-light, with warm lamps added on top that pool on the ground.
3. **Volumetric glow.** God rays come from the occluded sun. Bloom and particles sit over everything.
4. **Depth.** Parallax layers, tilt-shift blur and foreground bokeh.

**Tech:** a WebGL2 2D renderer (PixiJS v8 or custom) with normal-mapped sprite lighting, deferred lights, and bloom and god-ray post shaders. This demo uses Canvas2D.
