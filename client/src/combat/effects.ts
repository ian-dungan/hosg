// What combat looks like, from the server's fx events, for everyone in view: floating numbers (your damage, combos,
// damage to you, heals, other adventurers' hits, "Dodged", "Parried"), hit flashes and flinches, the attacker's
// pose, arrows flying at 40 m/s and short blade-arc trails. Poses for others' charging and deaths come from state.
import { Color3, Matrix, Mesh, MeshBuilder, StandardMaterial, Vector3, VertexData, type Scene } from '@babylonjs/core';
import { ABILITIES, ENEMY_ATTACKS, type AbilityId, type FxEvent } from '@sg2/shared';
import type { CharacterView, HudApi, Pose } from '../core/contracts';
import type { Game } from '../boot';
import type { EnemyView } from './enemies';
import type { Enemies } from '../net/enemies';
import type { Remotes } from '../net/remotes';
import type { ZoneRoom } from '../net/session';

const ARROW_SPEED = 40;
const POOL = 16;
const TRAIL_S = 0.24;

type Who =
  | { kind: 'me' | 'remote'; view: CharacterView; x: number; y: number; z: number; h: number; weapon: string }
  | { kind: 'enemy'; view: EnemyView; x: number; y: number; z: number; h: number };

export interface Effects {
  handle(events: readonly FxEvent[], me: number): void;
  update(dt: number): void;
  dispose(): void;
}

export interface EffectsOpts { game: Game; hud: HudApi; room: ZoneRoom; remotes: Remotes; enemies: Enemies }

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
  const attackFx = (src: Who | null, dst: Who | null, big: boolean) => {
    if (!src || src.kind === 'enemy') return;
    pose(src, 'attack');
    if (dst) src.view.root.rotation.y = Math.atan2(dst.x - src.x, dst.z - src.z) || src.view.root.rotation.y;
    if (src.weapon === 'bow') { if (dst) shoot(src, dst, big); } else slash(src, big);
  };

  // ── per-frame state poses: others charging or dead ──
  const acts = new Map<string, string>();
  let meDead = false;

  return {
    handle(events, myEid) {
      me = myEid;
      for (const ev of events) {
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
          case 'heal': if (ev.amount > 0) float(who(ev.dst), `+${Math.round(ev.amount)}`, 'heal'); break;
          case 'use': {
            const src = who(ev.src), dst = ev.dst !== undefined ? who(ev.dst) : null;
            const a = isAbility(ev.ability) ? ABILITIES[ev.ability] : null;
            if (!a) break;
            if (ev.ability === 'parry') pose(src, 'parry');
            else if (a.kind === 'damage') attackFx(src, dst, a.role !== 'quick' || (ev.frac ?? 0) > 0.5);
            else pose(src, 'cast');
            break;
          }
          case 'swing': {
            const src = who(ev.src), dst = who(ev.dst);
            if (src?.kind === 'enemy') src.view.strike();
            else attackFx(src, dst, false);
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
    },
    dispose() {
      for (const s of arrows) s.m.dispose();
      for (const s of trails) { s.m.dispose(); s.mat.dispose(); }
      arrowSrc.dispose(); arc.dispose(); arrowMat.dispose(); trailMat.dispose();
    },
  };
}
