// What combat looks like, from the server's fx events, for everyone in view: floating numbers (your damage, combos,
// damage to you, heals, other adventurers' hits, "Dodged", "Parried"), hit flashes and flinches, the attacker's
// pose, arrows flying at 40 m/s and short blade-arc trails; casts (the cast pose, how one ended), heals, shields,
// revives and reactions as words. Poses for others' charging and deaths come from state.
// Spells and support (spells.ts): elemental projectiles and impacts, Light beams, reactions, heals, shields, buffs,
// taunts and revives from the fx; and from the state, every frame, for everyone in view: the weapon each job
// carries, the cast pose and the ground ring under a caster, shield bubbles, Aegis, Shelter's tether, Mist Form's
// fade, lasting buffs, and the marks and debuffs on enemies. The Bow keeps Plan 3's arrows; staff autos fly a
// small bolt in the staff's tint; melee weapons keep the blade arc.
import { Color3, Matrix, Mesh, MeshBuilder, StandardMaterial, Vector3, VertexData, type Scene } from '@babylonjs/core';
import {
  ABILITIES, BEDROCK_R, BUFF_BITS, ENEMY_ATTACKS, JOBS, MELEE_REACH, TICK_HZ, WEAPONS, isJobId, type AbilityId, type FxEvent, type WeaponId,
} from '@sg2/shared';
import { castTone, createSpells, spellVisualFor, staffTint, type Spells } from './spells';
import { capeFor } from '../player/character';
import type { CharacterView, HudApi, Pose } from '../core/contracts';
import type { Game } from '../boot';
import type { EnemyView } from './enemies';
import type { Enemies } from '../net/enemies';
import type { Remotes } from '../net/remotes';
import type { PlayerView, ZoneRoom } from '../net/session';

const ARROW_SPEED = 40;
const POOL = 16;
const TRAIL_S = 0.24;

type Who =
  | { kind: 'me' | 'remote'; view: CharacterView; x: number; y: number; z: number; h: number; weapon: string }
  | { kind: 'enemy'; view: EnemyView; x: number; y: number; z: number; h: number };

export interface Effects {
  handle(events: readonly FxEvent[], me: number): void;
  update(dt: number): void;
  /** Pooled spell visuals live now, and instances drawn last frame (playtests and budgets). */
  readonly spells: { readonly live: number; readonly drawn: number };
  dispose(): void;
}

export interface EffectsOpts { game: Game; hud: HudApi; room: ZoneRoom; remotes: Remotes; enemies: Enemies }

const isWeapon = (w: string): w is WeaponId => Object.prototype.hasOwnProperty.call(WEAPONS, w);
/** A weapon whose autos fly (the Bow, the Staff). */
const ranged = (w: string) => isWeapon(w) && WEAPONS[w].autoRange > MELEE_REACH;
const CAST_END: Record<string, string> = { fizzle: 'Fizzled', dodge: 'Cancelled', interrupt: 'Interrupted!', cancel: 'Cancelled' };
const word = (id: string) => id.charAt(0).toUpperCase() + id.slice(1) + '!';

const isAbility = (b: string): b is AbilityId => Object.prototype.hasOwnProperty.call(ABILITIES, b);

export function createEffects(o: EffectsOpts): Effects {
  const { game, hud, room } = o;
  const scene: Scene = game.scene;
  let me = -1;

  // ── who is an entity id ──
  const who = (eid: number): Who | null => {
    if (eid === me) {
      const r = game.rig, p = room.state.players?.get(room.sessionId);
      return { kind: 'me', view: r.view, x: r.position.x, y: r.position.y, z: r.position.z, h: r.view.height, weapon: p?.weapon ?? 'blade' };
    }
    const e = o.enemies.get(eid);
    if (e) return { kind: 'enemy', view: e.view, x: e.x, y: e.y, z: e.z, h: e.view.height };
    let found: Who | null = null;
    room.state.players?.forEach((p, sid) => {
      if (found || p.eid !== eid || sid === room.sessionId) return;
      const v = o.remotes.viewOf(sid);
      if (v) found = { kind: 'remote', view: v, x: v.root.position.x, y: v.root.position.y, z: v.root.position.z, h: v.height, weapon: p.weapon ?? 'blade' };
    });
    return found;
  };

  // ── floating numbers ──
  const proj = new Vector3(), floatAt = new Vector3();
  const float = (w: Who | null, text: string, kind: Parameters<HudApi['floatText']>[3], lift = 0.9) => {
    if (!w) return;
    const camera = scene.activeCamera;
    const canvas = scene.getEngine().getRenderingCanvas();
    if (!camera || !canvas) return;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    Vector3.ProjectToRef(floatAt.set(w.x, w.y + w.h * lift, w.z), Matrix.IdentityReadOnly, scene.getTransformMatrix(), camera.viewport.toGlobal(cw, ch), proj);
    if (proj.z <= 0 || proj.z >= 1 || proj.x < -50 || proj.x > cw + 50 || proj.y < -50 || proj.y > ch + 50) return;
    hud.floatText(proj.x, proj.y, text, kind);
  };

  // ── arrows ──
  const arrowMat = new StandardMaterial('fxArrowMat', scene);
  arrowMat.disableLighting = true; arrowMat.emissiveColor = Color3.FromHexString('#ffe6a8');
  const arrowSrc = MeshBuilder.CreateCylinder('fxArrow', { height: 0.9, diameterTop: 0, diameterBottom: 0.07, tessellation: 4 }, scene);
  arrowSrc.rotation.x = Math.PI / 2; arrowSrc.bakeCurrentTransformIntoVertices();
  arrowSrc.material = arrowMat; arrowSrc.isPickable = false; arrowSrc.setEnabled(false);
  const arrows: { m: Mesh; from: Vector3; to: Vector3; t: number; dur: number; on: boolean; big: boolean }[] = [];
  for (let i = 0; i < POOL; i++) {
    const m = arrowSrc.clone(`fxArrow_${i}`) as Mesh;
    m.setEnabled(false);
    arrows.push({ m, from: new Vector3(), to: new Vector3(), t: 0, dur: 0, on: false, big: false });
  }
  let nextArrow = 0;
  const shoot = (a: Who, b: Who, big: boolean) => {
    const s = arrows[nextArrow]; nextArrow = (nextArrow + 1) % POOL;
    s.from.set(a.x, a.y + a.h * 0.7, a.z); s.to.set(b.x, b.y + b.h * 0.55, b.z);
    s.dur = Math.max(0.05, Vector3.Distance(s.from, s.to) / ARROW_SPEED); s.t = 0; s.on = true; s.big = big;
    s.m.scaling.setAll(big ? 1.8 : 1);
    s.m.position.copyFrom(s.from); s.m.lookAt(s.to); s.m.setEnabled(true);
  };

  // ── blade arcs ──
  const trailMat = new StandardMaterial('fxTrailMat', scene);
  trailMat.disableLighting = true; trailMat.emissiveColor = Color3.FromHexString('#fff3d0'); trailMat.backFaceCulling = false;
  trailMat.alpha = 0.8; trailMat.disableDepthWrite = true;
  const arc = new Mesh('fxArc', scene);
  {
    const pos: number[] = [], idx: number[] = [], N = 14;
    for (let i = 0; i <= N; i++) {
      const a = -1.2 + (i / N) * 2.4, r0 = 0.55, r1 = 1.55, y = 1.15 + 0.35 * (i / N - 0.5);
      pos.push(Math.sin(a) * r0, y, Math.cos(a) * r0, Math.sin(a) * r1, y + 0.08, Math.cos(a) * r1);
      if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const vd = new VertexData(); vd.positions = pos; vd.indices = idx; vd.applyToMesh(arc);
  }
  arc.isPickable = false; arc.setEnabled(false);
  const trails: { m: Mesh; mat: StandardMaterial; t: number; on: boolean; big: boolean }[] = [];
  for (let i = 0; i < 8; i++) {
    const m = arc.clone(`fxArc_${i}`) as Mesh; const mat = trailMat.clone(`fxTrailMat_${i}`);
    m.material = mat; m.setEnabled(false);
    trails.push({ m, mat, t: 0, on: false, big: false });
  }
  let nextTrail = 0;
  const slash = (a: Who, big: boolean) => {
    const s = trails[nextTrail]; nextTrail = (nextTrail + 1) % trails.length;
    s.m.position.set(a.x, a.y, a.z);
    s.m.rotation.y = a.view.root.rotation.y;
    s.m.scaling.setAll(big ? 1.35 : 1);
    s.t = 0; s.on = true; s.big = big;
    s.mat.emissiveColor = Color3.FromHexString(big ? '#ffd27a' : '#fff3d0');
    s.m.setEnabled(true);
  };

  const pose = (w: Who | null, p: Pose) => { if (w && w.kind !== 'enemy') w.view.setPose(p); };
  const face = (src: Who, dst: Who | null) => { if (dst) src.view.root.rotation.y = Math.atan2(dst.x - src.x, dst.z - src.z) || src.view.root.rotation.y; };
  const attackFx = (src: Who | null, dst: Who | null, big: boolean, flies: boolean | undefined, srcEid: number, dstEid: number) => {
    if (!src || src.kind === 'enemy') return;
    pose(src, 'attack');
    face(src, dst);
    if (src.weapon === 'staff' && (flies ?? true)) {
      // a staff auto: a small bolt in the staff's tint (spells.ts), not an arrow
      if (dst) spells.play({ kind: 'staffBolt', src: srcEid, dst: dstEid, dur: 0.3, tint: staffTint(jobOfEid.get(srcEid) ?? '') });
      return;
    }
    if (flies ?? ranged(src.weapon)) { if (dst) shoot(src, dst, big); } else slash(src, big);
  };

  // ── spells (pooled; spells.ts) ──
  /** Where an entity stands now, for the spell visuals (false: not in view). */
  const locate = (eid: number, out: { x: number; y: number; z: number; h: number }): boolean => {
    if (eid < 0) return false;
    if (eid === me) { const r = game.rig; out.x = r.position.x; out.y = r.position.y; out.z = r.position.z; out.h = r.view.height; return true; }
    const e = o.enemies.get(eid);
    if (e) { out.x = e.x; out.y = e.y; out.z = e.z; out.h = e.view.height; return true; }
    const v = viewByEid.get(eid);
    if (v) { out.x = v.root.position.x; out.y = v.root.position.y; out.z = v.root.position.z; out.h = v.height; return true; }
    return false;
  };
  const spells: Spells = createSpells(scene, { quality: () => game.quality, locate });
  /** Engine id → its character view (remotes), refreshed every frame. */
  const viewByEid = new Map<number, CharacterView>();
  const jobOfEid = new Map<number, string>();
  /** Who cast Aegis on whom (the Paladin's own is a dome, an ally's a sigil) and who shelters whom, from buff fx. */
  const aegisKind = new Map<number, 'aegis' | 'aegis_ally'>();
  const shelterBy = new Map<number, number>();
  /** Each adventurer's weapon look and cast pose as last applied (by session id). */
  const looks = new Map<string, { key: string; casting: boolean; faded: boolean }>();
  const A = { x: 0, y: 0, z: 0, h: 1.8 };
  let clockT = 0;
  /** This adventurer's own look as last applied: its weapon (and staff tint), the cast pose and Mist Form's fade. */
  const mine = { weapon: '', job: '', casting: false, faded: false };
  /** Seconds into a cast that began at `castAt` (the state's clock). */
  const castSecs = (castAt: number | undefined) => {
    const clock = room.state.clock;
    return typeof clock === 'number' && typeof castAt === 'number' ? Math.max(0, (clock - castAt) / TICK_HZ) : clockT;
  };
  const collect = (p: PlayerView, sid: string) => {
    if (p.eid === undefined || p.eid < 0) return;
    jobOfEid.set(p.eid, p.job ?? '');
    if (sid === room.sessionId) {
      // this adventurer's weapon follows its job; its cast pose its cast; Mist Form fades it (remotes.ts does the others)
      const v = game.rig.view, w = p.weapon ?? '', j = p.job ?? '';
      if (w !== mine.weapon || j !== mine.job) {
        mine.weapon = w; mine.job = j;
        v.setWeapon(isWeapon(w) ? w : isJobId(j) ? JOBS[j].weapon : 'blade', staffTint(j));
        v.setCape(capeFor(j));
      }
      const casting = !p.dead && !!p.cast;
      if (casting !== mine.casting) { mine.casting = casting; v.setCasting(casting); }
      const faded = !p.dead && !!((p.buffs ?? 0) & BUFF_BITS.mist);
      if (faded !== mine.faded) { mine.faded = faded; v.setFade(faded ? 0.5 : 1); }
      return;
    }
    const v = o.remotes.viewOf(sid);
    if (v) viewByEid.set(p.eid, v);
  };
  const drawPlayer = (p: PlayerView, sid: string) => {
    if (p.dead || p.eid === undefined || p.eid < 0) return;
    const self = sid === room.sessionId;
    const v = self ? game.rig.view : viewByEid.get(p.eid);
    if (!v) return;
    const pos = self ? game.rig.position : v.root.position;
    const x = pos.x, y = pos.y, z = pos.z, h = v.height;
    if (p.cast) spells.caster(x, y, z, castTone(p.cast), castSecs(p.castAt));
    if ((p.shield ?? 0) > 0) spells.shield(x, y, z, h, clockT);
    const bits = p.buffs ?? 0;
    if (bits & BUFF_BITS.aegis) spells.aegis(x, y, z, aegisKind.get(p.eid) === 'aegis', clockT);
    else aegisKind.delete(p.eid);
    if (bits & BUFF_BITS.sheltered) {
      const by = shelterBy.get(p.eid);
      if (by !== undefined && locate(by, A)) spells.tether(A.x, A.y, A.z, x, y, z, clockT);
    } else shelterBy.delete(p.eid);
    if (bits) spells.aura(x, y, z, h, bits, clockT);
  };
  const drawEnemy = (eid: number, d: { view: { height: number }; x: number; y: number; z: number }) => {
    const e = room.state.enemies?.get(String(eid));
    if (!e || e.mode === 'dead') return;
    const marks = e.marks ?? 0, debuffs = e.debuffs ?? 0;
    if (marks || debuffs) spells.enemy(d.x, d.y, d.z, d.view.height, marks, debuffs, clockT);
  };

  // ── per-frame state poses: others charging or dead ──
  const acts = new Map<string, string>();
  let meDead = false;

  return {
    handle(events, myEid) {
      me = myEid;
      for (const ev of events) {
        const sp = spellVisualFor(ev);
        if (sp) spells.play(sp);
        if (ev.t === 'buff') {
          if (ev.buff === 'aegis' || ev.buff === 'aegis_ally') { if (ev.on) aegisKind.set(ev.dst, ev.buff); }
          else if (ev.buff === 'sheltered') { if (ev.on) shelterBy.set(ev.dst, ev.src); else shelterBy.delete(ev.dst); }
        } else if (ev.t === 'react' && ev.reaction === 'bedrock' && locate(ev.dst, A)) {
          // a stone ring rises round each adventurer the reaction shields
          room.state.players?.forEach((p) => {
            if (p.dead || p.eid === undefined || p.eid < 0) return;
            const at = p.eid === me ? game.rig.position : null;
            const x = at ? at.x : p.x, z = at ? at.z : p.z;
            if (Math.hypot(x - A.x, z - A.z) <= BEDROCK_R) spells.play({ kind: 'bedrockRing', src: p.eid, dst: p.eid, dur: 1.5, big: true });
          });
        }
        switch (ev.t) {
          case 'hit': {
            const dst = who(ev.dst);
            const mine = ev.src === me, onMe = ev.dst === me;
            if (dst?.kind === 'enemy') { dst.view.hit(); dst.view.flash(); }
            else if (dst) { dst.view.flash(); if (ev.amount > 0) pose(dst, 'hit'); }
            if (onMe && ev.amount > 0) hud.danger('flash');
            if (ev.amount > 0) {
              const n = String(Math.round(ev.amount));
              if (onMe) float(dst, `−${n}`, 'hurt');
              else if (mine && ev.combo?.length) float(dst, `Combo! ${n}`, 'combo', 1.15);
              // beside the body, not on the name and bar above it (the HUD floats them out to the side)
              else if (mine) float(dst, n, 'damage', 0.6);
              else float(dst, n, 'other', 0.6);
            }
            if (ev.absorbed > 0 && (onMe || mine)) float(dst, `Shield ${Math.round(ev.absorbed)}`, 'info', 1.25);
            // enemy telegraph hits strike their release (in case the wind-up's end was not seen)
            if (ev.by in ENEMY_ATTACKS) { const s = who(ev.src); if (s?.kind === 'enemy') s.view.strike(); }
            break;
          }
          case 'heal': {
            if (ev.amount <= 0) break;
            float(who(ev.dst), `+${Math.round(ev.amount)}`, 'heal');
            if (ev.src === me && ev.dst !== me) o.remotes.pulse(ev.dst); // who this adventurer's heal landed on
            break;
          }
          case 'shield': {
            if (ev.src === me || ev.dst === me) float(who(ev.dst), `Shield ${Math.round(ev.amount)}`, 'info', 1.25);
            if (ev.src === me && ev.dst !== me) o.remotes.pulse(ev.dst);
            break;
          }
          case 'buff': if (ev.on && ev.src === me && ev.dst !== me) o.remotes.pulse(ev.dst); break;
          case 'gift': if (ev.dst === me || ev.src === me) float(who(ev.dst), `+${Math.round(ev.amount)} Momentum`, 'info', 1.25); break;
          case 'revive': float(who(ev.dst), 'Revived!', 'combo', 1.2); if (ev.src === me) o.remotes.pulse(ev.dst); break;
          case 'react': float(who(ev.dst), word(ev.reaction), 'combo', 1.3); break;
          case 'cast': break; // the cast pose and ground ring follow the state's `cast` (update), for everyone in view
          case 'castEnd': if (!ev.ok) float(who(ev.src), CAST_END[ev.reason ?? 'cancel'] ?? 'Cancelled', 'info', 1.25); break;
          case 'use': {
            const src = who(ev.src), dst = ev.dst !== undefined ? who(ev.dst) : null;
            const a = isAbility(ev.ability) ? ABILITIES[ev.ability] : null;
            if (!a) break;
            if (ev.ability === 'parry') pose(src, 'parry');
            else if (a.kind === 'damage' && (a.element || a.school)) {
              // a spell: the hit's own visual flies (spells.ts); the caster releases it
              if (src && src.kind !== 'enemy') { pose(src, 'attack'); face(src, dst); }
            } else if (a.kind === 'damage') attackFx(src, dst, a.role !== 'quick' || (ev.frac ?? 0) > 0.5, a.range > MELEE_REACH, ev.src, ev.dst ?? -1);
            else pose(src, 'cast');
            break;
          }
          case 'swing': {
            const src = who(ev.src), dst = who(ev.dst);
            if (src?.kind === 'enemy') src.view.strike();
            else attackFx(src, dst, false, undefined, ev.src, ev.dst);
            break;
          }
          case 'miss': {
            const dst = who(ev.dst);
            if (ev.dst === me || ev.src === me) float(dst, ev.perfect ? 'Perfect dodge!' : 'Dodged', 'info', 1.2);
            break;
          }
          case 'parry': float(who(ev.src), 'Parried!', 'info', 1.2); break;
          case 'break': float(who(ev.dst), 'Break!', 'combo', 1.2); break;
          case 'interrupt': float(who(ev.dst), 'Interrupted!', 'info', 1.3); break;
          default: break;
        }
      }
    },
    update(dt) {
      for (const s of arrows) {
        if (!s.on) continue;
        s.t += dt;
        const k = Math.min(1, s.t / s.dur);
        Vector3.LerpToRef(s.from, s.to, k, s.m.position);
        if (k >= 1) { s.on = false; s.m.setEnabled(false); }
      }
      for (const s of trails) {
        if (!s.on) continue;
        s.t += dt;
        const k = s.t / TRAIL_S;
        s.mat.alpha = Math.max(0, 0.85 * (1 - k));
        s.m.rotation.y += dt * 5;
        if (k >= 1) { s.on = false; s.m.setEnabled(false); }
      }
      // others charging a shot, or dead; and this adventurer's own death and charge
      room.state.players?.forEach((p, sid) => {
        const act = p.dead ? 'dead' : p.act ?? '';
        if (sid === room.sessionId) {
          if (!!p.dead !== meDead) { meDead = !!p.dead; game.rig.view.setPose(meDead ? 'dead' : 'idle'); }
          const was = acts.get(sid) ?? '';
          if (act !== was) { acts.set(sid, act); if (act === 'charge') game.rig.view.setPose('charge'); else if (was === 'charge') game.rig.view.setPose('idle'); }
          return;
        }
        const was = acts.get(sid) ?? '';
        if (act === was) return;
        acts.set(sid, act);
        const v = o.remotes.viewOf(sid);
        if (!v) return;
        if (act === 'dead') v.setPose('dead');
        else if (act === 'charge') v.setPose('charge');
        else v.setPose('idle');
      });
      // forget those no longer in the state (out of view, or gone): one that comes back is posed afresh
      for (const sid of acts.keys()) if (!room.state.players?.get(sid)) acts.delete(sid);

      // ── the lasting looks, from the state: everyone in view ──
      clockT += dt;
      viewByEid.clear(); jobOfEid.clear();
      room.state.players?.forEach(collect);
      spells.begin();
      room.state.players?.forEach(drawPlayer);
      o.enemies.forEach(drawEnemy);
      spells.update(dt);
      for (const eid of aegisKind.keys()) if (!jobOfEid.has(eid)) aegisKind.delete(eid);
      for (const eid of shelterBy.keys()) if (!jobOfEid.has(eid)) shelterBy.delete(eid);
    },
    get spells() { return spells; },
    dispose() {
      spells.dispose();
      for (const s of arrows) s.m.dispose();
      for (const s of trails) { s.m.dispose(); s.mat.dispose(); }
      arrowSrc.dispose(); arc.dispose(); arrowMat.dispose(); trailMat.dispose();
    },
  };
}
