// Dev page for the character creator and the Barber screen (dev/creator.html, under `npm run dev`; not in any build).
// URL: ?mode=create|barber  &free=0|1  &gold=120  &name=1 (a name is needed)  &tab=people|body|face|hair|colours|style|outfit|name
//      &seed=3 (the starting look: defaultLook('dev-<seed>'))  &nopreview=1 (no 3D preview)
// window.__creatorDev: { ready, state(), result } and the open handle.
import { defaultLook, validateAdventurerName } from '@sg2/shared';
import { injectStyles } from './style';
import { openCreator, setCreatorPreview } from './creator';
import { createCreatorPreview } from '../player/creatorPreview';

const qs = new URLSearchParams(location.search);
injectStyles();
document.getElementById('game')?.remove();
if (!qs.has('nopreview')) setCreatorPreview(createCreatorPreview);
const handle = openCreator(document.body, {
  look: defaultLook(`dev-${qs.get('seed') ?? '3'}`),
  mode: qs.get('mode') === 'barber' ? 'barber' : 'create',
  needsName: qs.get('name') === '1',
  gold: Number(qs.get('gold') ?? 120),
  free: qs.get('free') !== '0',
  validateName: validateAdventurerName,
});
const dev = { ready: true, handle, result: null as unknown };
(window as unknown as Record<string, unknown>).__creatorDev = dev;
const tab = qs.get('tab');
if (tab) (document.querySelector(`.sg-cr-tab[data-tab="${tab}"]`) as HTMLElement | null)?.click();
void handle.done.then((r) => { dev.result = r; });
