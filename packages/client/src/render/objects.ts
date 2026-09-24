import * as THREE from "three";
import { PAL, box, cyl, mat, sphGeo } from "./palette";

// Each object is built from primitives, with its origin at the floor, horizontally centered in its cell.
// `vkey` returns the subset of state that changes visuals; the mesh is rebuilt when it changes.

export function vkey(o: any): string {
  const s = o.st ?? {};
  switch (o.kind) {
    case "hydro_tray":
      return `${s.crop}|${s.stage}|${s.health > 50 ? 1 : 0}|${s.pests > 30 ? 1 : 0}|${s.mold > 30 ? 1 : 0}|${s.ready}|${s.water > 15 ? 1 : 0}|${o.broken}`;
    case "mushroom_bed":
      return `${Math.floor((s.growth ?? 0) * 4)}|${s.ready}|${s.compost > 0 ? 1 : 0}`;
    case "rabbit_hutch":
      return `${s.rabbits}|${s.dirty > 50 ? 1 : 0}`;
    case "door_blast":
      return `${s.closed}|${s.barricade}`;
    case "intercom":
      return `${s.ring ? 1 : 0}`;
    case "trash_bin":
      return `${s.fill > 70 ? 1 : 0}`;
    case "compost":
      return `${Math.min(3, Math.floor(s.amount ?? 0))}`;
    case "nutrient_tank":
      return `${Math.floor((s.level ?? 0) / 25)}`;
    case "still":
      return `${s.mash > 0 ? 1 : 0}`;
    case "grave":
      return s.name ?? "";
    default:
      return `${o.broken ? 1 : 0}|${o.on ? 1 : 0}`;
  }
}

const CROP_COLORS: Record<string, [number, number]> = {
  lettuce: [0x8fd16a, 0x8fd16a],
  potato: [0x5f9e45, 0xc9a86b],
  tomato: [0x4f8a3a, 0xd9412b],
  soy: [0x6ea34c, 0xb9b46a],
  carrot: [0x6fbf4e, 0xe0782a],
  peas: [0x69b04d, 0x9fd46a],
  herbs: [0x7fae63, 0xa7d18e],
  tobacco: [0x78a34d, 0xc2b060],
  hops: [0x7ab050, 0xc3e07a],
  strawberry: [0x4f9a41, 0xe0304a],
  sunflower: [0x5d9a3e, 0xf2c230],
  mushroom: [0xd9cbb0, 0xb07a4a],
};

export function buildObject(o: any): THREE.Group {
  const g = new THREE.Group();
  const s = o.st ?? {};
  const Z = -0.95; // default depth: against the back wall
  switch (o.kind) {
    case "bed": {
      g.add(box(0.95, 0.35, 0.8, PAL.metalDark, 0.45, 0, Z + 0.1));
      g.add(box(0.95, 0.14, 0.78, 0x6f7f5a, 0.45, 0.35, Z + 0.1));
      g.add(box(0.28, 0.1, 0.6, 0xe8e0cc, 0.08, 0.49, Z + 0.1));
      g.add(box(0.06, 0.6, 0.06, PAL.metalDark, -0.02, 0, Z - 0.25));
      break;
    }
    case "shelf": {
      g.add(box(0.9, 1.6, 0.5, PAL.woodDark, 0, 0, Z));
      for (let i = 0; i < 4; i++) {
        g.add(box(0.86, 0.04, 0.5, PAL.wood, 0, 0.2 + i * 0.4, Z + 0.05));
        for (let j = 0; j < 3; j++) {
          const c = [0x9a8a5a, 0x6a7a8a, 0xa05a3a, 0x7a9a6a][(i + j) % 4];
          g.add(box(0.2, 0.22, 0.3, c, -0.28 + j * 0.28, 0.24 + i * 0.4, Z + 0.1));
        }
      }
      break;
    }
    case "bike_gen": {
      g.add(cyl(0.3, 0.06, 0x2a2a2a, 0.25, 0.3, Z + 0.25, 14).rotateX(Math.PI / 2));
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 6, 16), mat(0x2a2a2a));
      wheel.position.set(0.25, 0.34, Z + 0.25);
      g.add(wheel);
      g.add(box(0.7, 0.06, 0.08, PAL.rust, 0, 0.5, Z + 0.25));
      g.add(box(0.06, 0.55, 0.08, PAL.rust, -0.2, 0.1, Z + 0.25));
      g.add(box(0.22, 0.06, 0.16, 0x222222, -0.2, 0.66, Z + 0.25));
      g.add(box(0.06, 0.4, 0.06, PAL.rust, 0.35, 0.5, Z + 0.25));
      g.add(box(0.3, 0.3, 0.3, PAL.metal, -0.25, 0, Z - 0.2));
      break;
    }
    case "battery": {
      g.add(box(0.7, 0.8, 0.5, 0x3a4a3a, 0, 0, Z));
      for (let i = 0; i < 3; i++) g.add(box(0.14, 0.08, 0.14, 0xcfa640, -0.2 + i * 0.2, 0.8, Z));
      g.add(box(0.5, 0.08, 0.02, 0x8fe07a, 0, 0.55, Z + 0.26, mat(0x8fe07a, { emissive: 0x2a5a20 })));
      break;
    }
    case "air_filter": {
      g.add(cyl(0.3, 1.2, PAL.metal, 0, 0, Z, 10));
      g.add(cyl(0.08, 0.7, PAL.metalDark, 0, 1.2, Z, 6));
      g.add(box(0.5, 0.08, 0.5, PAL.metalDark, 0, 0.6, Z));
      g.add(fan(0, 0.9, Z + 0.31));
      break;
    }
    case "water_filter": {
      g.add(box(0.7, 1.0, 0.5, 0x4a6a7a, 0, 0, Z));
      g.add(cyl(0.12, 0.5, 0x8fb3c2, -0.15, 1.0, Z, 8));
      g.add(cyl(0.05, 0.4, PAL.metalDark, 0.2, 1.0, Z, 6));
      g.add(box(0.2, 0.1, 0.1, 0x3fa0d0, 0, 0.6, Z + 0.27));
      break;
    }
    case "hand_pump": {
      g.add(cyl(0.12, 0.8, PAL.metalDark, 0, 0, Z + 0.2, 8));
      g.add(box(0.5, 0.05, 0.05, PAL.metal, 0.2, 0.85, Z + 0.2).rotateZ(-0.3));
      g.add(box(0.18, 0.08, 0.1, PAL.metal, -0.15, 0.55, Z + 0.2));
      g.add(cyl(0.18, 0.25, 0x6a6a6a, -0.25, 0, Z + 0.35, 8));
      break;
    }
    case "water_tank":
      g.add(cyl(0.38, 1.1, 0x4f6f7f, 0, 0, Z, 12));
      break;
    case "nutrient_tank": {
      g.add(cyl(0.3, 0.9, 0xb0c4b0, 0, 0, Z, 10));
      const lvl = Math.max(0.05, ((s.level ?? 0) / 100) * 0.85);
      g.add(cyl(0.28, lvl, 0x6fbf7a, 0, 0.02, Z, 10));
      g.add(cyl(0.05, 0.5, PAL.metalDark, 0.25, 0.9, Z, 6));
      break;
    }
    case "hydro_tray": {
      g.add(box(0.9, 0.35, 0.7, 0x8a8a80, 0, 0.35, Z + 0.1));
      g.add(box(0.06, 0.35, 0.06, PAL.metalDark, -0.4, 0, Z + 0.1));
      g.add(box(0.06, 0.35, 0.06, PAL.metalDark, 0.4, 0, Z + 0.1));
      g.add(box(0.84, 0.05, 0.64, s.water > 15 ? 0x3a5f6f : 0x6a5a4a, 0, 0.66, Z + 0.1));
      // grow lamp
      g.add(box(0.8, 0.06, 0.3, 0x444444, 0, 1.62, Z));
      g.add(box(0.7, 0.03, 0.22, 0xff6ad5, 0, 1.6, Z, mat(0xff8ae0, { emissive: o.on ? 0x8a2a70 : 0 })));
      g.add(box(0.03, 0.4, 0.03, 0x444444, 0, 1.68, Z));
      if (s.crop) addPlant(g, s.crop, s.stage ?? 0, s.health > 50, s.pests > 30, s.mold > 30, !!s.ready, Z + 0.1);
      break;
    }
    case "mushroom_bed": {
      g.add(box(0.9, 0.3, 0.7, 0x4a3a2a, 0, 0, Z + 0.1));
      if (s.compost > 0) g.add(box(0.84, 0.06, 0.64, 0x2e2418, 0, 0.3, Z + 0.1));
      const n = Math.floor((s.growth ?? 0) * 5) + (s.ready ? 3 : 0);
      for (let i = 0; i < n; i++) {
        const x = -0.35 + ((i * 37) % 70) / 100;
        const z = -0.2 + ((i * 53) % 40) / 100;
        g.add(cyl(0.02, 0.1, 0xe8dcc0, x, 0.34, Z + 0.1 + z, 5));
        g.add(cyl(0.08, 0.04, 0xb07a4a, x, 0.44, Z + 0.1 + z, 7, 0.03));
      }
      break;
    }
    case "compost": {
      g.add(box(0.8, 0.6, 0.6, PAL.woodDark, 0, 0, Z));
      const a = Math.min(3, Math.floor(s.amount ?? 0));
      if (a > 0) g.add(box(0.72, 0.1 * a + 0.05, 0.52, 0x3a2a18, 0, 0.6, Z));
      break;
    }
    case "rabbit_hutch": {
      g.add(box(1.4, 0.7, 0.7, PAL.wood, 0.25, 0.2, Z));
      g.add(box(1.3, 0.55, 0.02, 0x999999, 0.25, 0.28, Z + 0.36, mat(0x999999, { opacity: 0.4 })));
      for (let i = 0; i < Math.min(4, s.rabbits ?? 0); i++) {
        g.add(ball(0.1, mat(i % 2 ? 0xeeeeee : 0x9a7a5a), -0.2 + i * 0.28, 0.35, Z + 0.1));
        g.add(box(0.03, 0.1, 0.03, 0xeeeeee, -0.2 + i * 0.28, 0.42, Z + 0.1));
      }
      g.add(box(0.06, 0.2, 0.06, PAL.woodDark, -0.4, 0, Z));
      g.add(box(0.06, 0.2, 0.06, PAL.woodDark, 0.9, 0, Z));
      break;
    }
    case "notice_board": {
      g.add(box(0.9, 0.7, 0.05, 0xb5885a, 0, 0.8, Z - 0.3));
      for (let i = 0; i < 6; i++) g.add(box(0.18, 0.2, 0.02, [0xf2ead0, 0xf7d77a, 0xa7d1e8][i % 3], -0.3 + (i % 3) * 0.3, 0.92 + Math.floor(i / 3) * -0.28, Z - 0.26));
      break;
    }
    case "dining_table": {
      g.add(box(1.8, 0.08, 0.8, PAL.wood, 0.5, 0.72, Z + 0.2));
      for (const [dx, dz] of [[-0.3, -0.3], [1.3, -0.3], [-0.3, 0.3], [1.3, 0.3]]) g.add(box(0.07, 0.72, 0.07, PAL.woodDark, dx, 0, Z + 0.2 + dz));
      g.add(cyl(0.05, 0.2, 0xe8dcc0, 0.5, 0.8, Z + 0.2, 6));
      g.add(ball(0.04, mat(0xffcc55, { emissive: 0xff9900 }), 0.5, 1.03, Z + 0.2));
      break;
    }
    case "game_table": {
      g.add(cyl(0.45, 0.06, 0x2f5a3a, 0, 0.72, Z + 0.2, 16));
      g.add(cyl(0.07, 0.72, PAL.woodDark, 0, 0, Z + 0.2, 6));
      for (let i = 0; i < 3; i++) g.add(box(0.1, 0.02, 0.14, 0xf2f2ee, -0.15 + i * 0.13, 0.79, Z + 0.25));
      // chairs
      g.add(box(0.3, 0.45, 0.3, PAL.wood, -0.55, 0, Z + 0.2));
      g.add(box(0.3, 0.45, 0.3, PAL.wood, 0.55, 0, Z + 0.2));
      break;
    }
    case "game_shelf": {
      g.add(box(0.7, 1.2, 0.35, PAL.woodDark, 0, 0, Z - 0.1));
      for (let i = 0; i < 5; i++) g.add(box(0.5, 0.08, 0.28, [0xc8553d, 0x3d6b8c, 0xc9a227, 0x5a7d4a, 0x8e5572][i], 0, 0.15 + i * 0.2, Z - 0.05));
      break;
    }
    case "radio": {
      g.add(box(0.5, 0.7, 0.4, PAL.woodDark, 0, 0, Z));
      g.add(box(0.55, 0.36, 0.42, PAL.wood, 0, 0.7, Z));
      g.add(box(0.36, 0.1, 0.02, 0xf2d68a, 0, 0.9, Z + 0.22, mat(0xf2d68a, { emissive: o.on ? 0x664400 : 0 })));
      g.add(cyl(0.05, 0.03, 0x222222, -0.12, 0.76, Z + 0.22, 8).rotateX(Math.PI / 2));
      g.add(cyl(0.05, 0.03, 0x222222, 0.12, 0.76, Z + 0.22, 8).rotateX(Math.PI / 2));
      g.add(box(0.02, 0.4, 0.02, 0x999999, 0.2, 1.06, Z).rotateZ(-0.3));
      g.add(box(0.3, 0.45, 0.3, PAL.wood, 0.55, 0, Z + 0.25));
      break;
    }
    case "stove": {
      g.add(box(0.8, 0.85, 0.6, 0xd8d2c0, 0, 0, Z));
      g.add(cyl(0.12, 0.03, 0x333333, -0.18, 0.85, Z, 10));
      g.add(cyl(0.12, 0.03, 0x333333, 0.18, 0.85, Z, 10));
      g.add(cyl(0.15, 0.2, 0x8a8a8a, 0.18, 0.88, Z, 10));
      g.add(box(0.5, 0.35, 0.02, 0x333333, 0, 0.2, Z + 0.31));
      break;
    }
    case "sink":
      g.add(box(0.7, 0.8, 0.5, 0xb8b8b0, 0, 0, Z));
      g.add(box(0.5, 0.05, 0.35, 0x8a9aa0, 0, 0.8, Z));
      g.add(cyl(0.03, 0.3, PAL.metal, 0, 0.8, Z - 0.2, 6));
      break;
    case "kettle":
      g.add(box(0.4, 0.8, 0.4, PAL.woodDark, 0, 0, Z));
      g.add(cyl(0.12, 0.2, 0xb0b0b0, 0, 0.8, Z, 8, 0.15));
      break;
    case "trash_bin":
      g.add(cyl(0.2, 0.5, 0x4a5a4a, 0, 0, Z + 0.3, 8, 0.17));
      if (s.fill > 70) g.add(new THREE.Mesh(sphGeo(0.2), mat(0x2a2a2a))).position.set(0, 0.55, Z + 0.3);
      break;
    case "med_bed":
      g.add(box(0.95, 0.5, 0.7, 0xdadada, 0.45, 0, Z + 0.1));
      g.add(box(0.95, 0.1, 0.68, 0xf2f2f2, 0.45, 0.5, Z + 0.1));
      g.add(box(0.05, 1.1, 0.05, PAL.metal, 0.95, 0, Z - 0.2));
      g.add(box(0.12, 0.18, 0.06, 0xaaddff, 0.95, 1.0, Z - 0.2));
      break;
    case "med_cabinet":
      g.add(box(0.6, 1.2, 0.35, 0xf2f2ee, 0, 0.3, Z - 0.1));
      g.add(box(0.2, 0.06, 0.02, PAL.red, 0, 1.2, Z + 0.08));
      g.add(box(0.06, 0.2, 0.02, PAL.red, 0, 1.13, Z + 0.08));
      break;
    case "workbench":
    case "research_desk":
    case "ammo_bench":
    case "chem_bench": {
      const top = o.kind === "chem_bench" ? 0xcfd8d0 : PAL.wood;
      g.add(box(0.95, 0.08, 0.6, top, 0, 0.78, Z));
      g.add(box(0.07, 0.78, 0.07, PAL.woodDark, -0.4, 0, Z));
      g.add(box(0.07, 0.78, 0.07, PAL.woodDark, 0.4, 0, Z));
      if (o.kind === "workbench") {
        g.add(box(0.25, 0.15, 0.15, PAL.metal, -0.2, 0.86, Z));
        g.add(box(0.8, 0.5, 0.03, 0x5a4a3a, 0, 1.1, Z - 0.3));
      } else if (o.kind === "chem_bench") {
        g.add(cyl(0.06, 0.2, 0x7fdcb0, -0.2, 0.86, Z, 6));
        g.add(cyl(0.08, 0.14, 0xd0a0ff, 0.1, 0.86, Z, 6, 0.1));
      } else if (o.kind === "research_desk") {
        g.add(box(0.3, 0.02, 0.4, PAL.paper, 0, 0.86, Z));
        g.add(cyl(0.03, 0.3, 0x333333, 0.3, 0.86, Z - 0.1, 6));
      } else g.add(box(0.3, 0.3, 0.2, PAL.metalDark, 0, 0.86, Z));
      break;
    }
    case "tool_rack":
      g.add(box(0.8, 1.0, 0.05, PAL.woodDark, 0, 0.5, Z - 0.3));
      g.add(box(0.05, 0.6, 0.03, PAL.metal, -0.2, 0.7, Z - 0.26));
      g.add(box(0.3, 0.05, 0.03, PAL.metal, 0.15, 1.1, Z - 0.26));
      break;
    case "still":
      g.add(cyl(0.25, 0.6, 0xb87333, 0, 0, Z, 10));
      g.add(cyl(0.05, 0.6, 0xb87333, 0.3, 0.5, Z, 6).rotateZ(0.8));
      g.add(cyl(0.15, 0.3, 0x9aa0a0, 0.55, 0, Z, 8));
      break;
    case "radio_station":
      g.add(box(0.9, 0.8, 0.5, PAL.metalDark, 0, 0, Z));
      g.add(box(0.8, 0.45, 0.45, 0x55605a, 0, 0.8, Z));
      for (let i = 0; i < 4; i++) g.add(cyl(0.04, 0.02, 0xdddddd, -0.3 + i * 0.2, 0.95, Z + 0.23, 6).rotateX(Math.PI / 2));
      g.add(box(0.25, 0.12, 0.02, 0x7fe07a, 0.2, 1.1, Z + 0.23, mat(0x7fe07a, { emissive: 0x2a6a20 })));
      g.add(box(0.03, 0.8, 0.03, 0x999999, -0.35, 1.25, Z));
      break;
    case "weapon_rack":
      g.add(box(0.8, 1.2, 0.1, PAL.woodDark, 0, 0.3, Z - 0.3));
      for (let i = 0; i < 3; i++) g.add(box(0.06, 0.9, 0.06, 0x333333, -0.25 + i * 0.25, 0.45, Z - 0.2));
      break;
    case "target":
      g.add(cyl(0.35, 0.05, 0xf2f2ee, 0, 0.8, Z, 16).rotateX(Math.PI / 2));
      g.add(cyl(0.2, 0.06, PAL.red, 0, 0.8, Z + 0.01, 16).rotateX(Math.PI / 2));
      g.add(box(0.06, 0.8, 0.06, PAL.woodDark, 0, 0, Z - 0.05));
      break;
    case "pullup_bar":
      g.add(box(0.05, 1.8, 0.05, PAL.metal, -0.35, 0, Z));
      g.add(box(0.05, 1.8, 0.05, PAL.metal, 0.35, 0, Z));
      g.add(box(0.75, 0.04, 0.04, PAL.metal, 0, 1.7, Z));
      break;
    case "darts":
      g.add(cyl(0.25, 0.04, 0x2a2a2a, 0, 1.2, Z - 0.3, 16).rotateX(Math.PI / 2));
      g.add(cyl(0.18, 0.045, 0xd9c27a, 0, 1.2, Z - 0.29, 16).rotateX(Math.PI / 2));
      break;
    case "armchair":
      g.add(box(0.8, 0.4, 0.6, 0x7a3a2a, 0, 0, Z + 0.2));
      g.add(box(0.8, 0.6, 0.15, 0x7a3a2a, 0, 0.4, Z - 0.05));
      g.add(box(0.12, 0.3, 0.6, 0x6a2a1a, -0.38, 0.4, Z + 0.2));
      g.add(box(0.12, 0.3, 0.6, 0x6a2a1a, 0.38, 0.4, Z + 0.2));
      break;
    case "bookshelf":
      g.add(box(0.85, 1.7, 0.35, PAL.woodDark, 0, 0, Z - 0.1));
      for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) g.add(box(0.1, 0.28, 0.25, [0x8a2a2a, 0x2a4a6a, 0x5a6a2a, 0x7a5a2a, 0x4a2a5a][(r * 3 + i) % 5], -0.3 + i * 0.12, 0.1 + r * 0.4, Z - 0.05));
      break;
    case "piano":
      g.add(box(1.0, 1.1, 0.5, 0x2a1a12, 0, 0, Z));
      g.add(box(0.9, 0.05, 0.25, 0xf2f2ee, 0, 0.72, Z + 0.3));
      for (let i = 0; i < 6; i++) g.add(box(0.05, 0.04, 0.14, 0x111111, -0.35 + i * 0.14, 0.76, Z + 0.25));
      break;
    case "drawing_wall":
      g.add(box(0.95, 0.9, 0.03, 0xe8e0cc, 0, 0.7, Z - 0.35));
      break;
    case "tape_player":
      g.add(box(0.5, 0.7, 0.35, PAL.woodDark, 0, 0, Z));
      g.add(box(0.5, 0.25, 0.3, 0x333333, 0, 0.7, Z));
      g.add(cyl(0.06, 0.02, 0xcccccc, -0.12, 0.82, Z + 0.16, 8).rotateX(Math.PI / 2));
      g.add(cyl(0.06, 0.02, 0xcccccc, 0.12, 0.82, Z + 0.16, 8).rotateX(Math.PI / 2));
      break;
    case "altar":
      g.add(box(0.8, 0.8, 0.4, PAL.woodDark, 0, 0, Z - 0.1));
      for (let i = 0; i < 5; i++) {
        g.add(cyl(0.03, 0.12 + (i % 3) * 0.06, 0xf2e8d0, -0.3 + i * 0.15, 0.8, Z - 0.1, 5));
        g.add(ball(0.025, mat(0xffcc55, { emissive: 0xff8800 }), -0.3 + i * 0.15, 0.96 + (i % 3) * 0.06, Z - 0.1));
      }
      break;
    case "cell_bars":
      for (let i = 0; i < 6; i++) g.add(box(0.04, 2, 0.04, PAL.metalDark, -0.4 + i * 0.16 + 0.5, 0, Z + 0.7));
      break;
    case "pillar":
      g.add(box(0.35, 2, 0.35, PAL.wood, 0, 0, Z + 0.3));
      g.add(box(0.9, 0.18, 0.5, PAL.woodDark, 0, 1.82, Z + 0.3));
      break;
    case "sandbags":
      for (let r = 0; r < 3; r++) for (let i = 0; i < 3; i++) g.add(box(0.36, 0.2, 0.5, 0xa89a70, -0.3 + i * 0.32 + (r % 2) * 0.12, r * 0.2, Z + 0.5));
      break;
    case "loophole":
      g.add(box(0.9, 0.3, 0.05, PAL.concreteDark, 0, 1.1, Z - 0.3));
      g.add(box(0.5, 0.08, 0.06, 0x111111, 0, 1.2, Z - 0.28));
      break;
    case "turret":
      g.add(cyl(0.3, 0.3, PAL.metalDark, 0, 0, Z + 0.2, 10));
      g.add(box(0.4, 0.3, 0.35, PAL.metal, 0, 0.3, Z + 0.2));
      g.add(cyl(0.05, 0.6, 0x222222, 0.35, 0.45, Z + 0.2, 6).rotateZ(Math.PI / 2));
      break;
    case "intercom": {
      // a wall box by the blast door: speaker grille, handset, a lamp that blinks while it rings
      g.add(box(0.34, 0.46, 0.08, 0x5b5e57, 0.18, 1.05, Z - 0.55));
      for (let i = 0; i < 4; i++) g.add(box(0.2, 0.025, 0.02, 0x2b2d2a, 0.18, 1.18 - i * 0.05, Z - 0.5));
      g.add(box(0.08, 0.26, 0.07, 0x1f2120, 0.3, 0.92, Z - 0.48));
      const lamp = box(0.07, 0.07, 0.04, s.ring ? 0xff4030 : 0x5a2a24, 0.08, 1.24, Z - 0.49, s.ring ? mat(0xff4030, { emissive: 0xcc2010 }) : undefined);
      lamp.name = s.ring ? "blink" : "";
      g.add(lamp);
      break;
    }
    case "periscope":
      g.add(cyl(0.08, 1.9, PAL.metal, 0, 0, Z - 0.1, 8));
      g.add(box(0.25, 0.18, 0.2, PAL.metalDark, 0, 1.0, Z + 0.05));
      g.add(box(0.14, 0.14, 0.14, PAL.metalDark, 0.1, 1.2, Z + 0.1));
      break;
    case "door_blast": {
      const closed = s.closed !== 0;
      g.add(box(0.2, 1.9, 1.2, 0x6e6a60, -0.4, 0, -0.8));
      const door = new THREE.Group();
      door.add(box(0.12, 1.7, 0.95, 0x8a8575, 0, 0.05, 0));
      door.add(cyl(0.18, 0.05, PAL.red, 0.07, 0.8, 0, 12).rotateZ(Math.PI / 2));
      door.position.set(-0.25, 0, -0.8);
      if (!closed) door.rotation.y = 1.2;
      g.add(door);
      if (s.barricade) for (let i = 0; i < 3; i++) g.add(box(0.1, 0.12, 1.2, PAL.wood, -0.1, 0.3 + i * 0.5, -0.8).rotateX(0.2 * (i - 1)));
      break;
    }
    case "hatch_ladder":
      g.add(box(0.1, 2, 0.08, PAL.metal, -0.2, 0, Z));
      g.add(box(0.1, 2, 0.08, PAL.metal, 0.2, 0, Z));
      for (let i = 0; i < 6; i++) g.add(box(0.4, 0.05, 0.05, PAL.metal, 0, 0.2 + i * 0.3, Z));
      g.add(cyl(0.38, 0.12, 0x6e6a60, 0, 1.9, Z + 0.1, 12));
      break;
    case "ladder":
      g.add(box(0.07, 2.1, 0.06, PAL.wood, -0.22, 0, -0.35));
      g.add(box(0.07, 2.1, 0.06, PAL.wood, 0.22, 0, -0.35));
      for (let i = 0; i < 7; i++) g.add(box(0.44, 0.05, 0.05, PAL.woodDark, 0, 0.15 + i * 0.3, -0.35));
      break;
    case "sortie_terminal":
      g.add(box(0.5, 1.1, 0.35, PAL.metalDark, 0, 0, Z));
      g.add(box(0.4, 0.3, 0.02, 0x7fe07a, 0, 0.8, Z + 0.18, mat(0x3a8a3a, { emissive: 0x1a5a1a })));
      break;
    case "geiger":
      g.add(box(0.3, 0.2, 0.15, 0xd9c27a, 0, 1.2, Z - 0.3));
      g.add(cyl(0.04, 0.15, 0x333333, 0.1, 1.4, Z - 0.3, 6));
      break;
    case "dirt_chute":
      g.add(box(0.8, 0.6, 0.6, PAL.metalDark, 0, 0, Z));
      g.add(box(0.6, 0.05, 0.5, 0x111111, 0, 0.6, Z));
      break;
    case "diesel_gen":
      g.add(box(1.4, 0.8, 0.7, 0x8a6a2a, 0.3, 0, Z));
      g.add(cyl(0.08, 0.8, 0x333333, 0.7, 0.8, Z - 0.1, 6));
      g.add(box(0.3, 0.3, 0.3, PAL.metalDark, -0.2, 0.8, Z));
      break;
    case "thermal_gen":
      g.add(box(0.8, 1.2, 0.5, 0x8a4a3a, 0, 0, Z));
      g.add(box(0.6, 0.1, 0.02, 0xff7a3a, 0, 0.9, Z + 0.26, mat(0xff7a3a, { emissive: 0xaa3a10 })));
      break;
    case "stream":
      g.add(box(0.95, 0.1, 1.2, PAL.water, 0, 0, -0.8, mat(PAL.water, { opacity: 0.8 })));
      break;
    case "grave":
      g.add(box(0.4, 0.6, 0.15, 0x777777, 0, 0, Z));
      g.add(box(0.15, 0.3, 0.02, 0x555555, 0, 0.62, Z));
      g.add(ball(0.04, mat(0xffcc55, { emissive: 0xff8800 }), 0.2, 0.08, Z + 0.2));
      break;
    case "pet_bed":
      g.add(cyl(0.3, 0.1, 0x8a5a4a, 0, 0, Z + 0.4, 10));
      break;
    case "washtub":
      g.add(cyl(0.35, 0.35, 0x9aa0a0, 0, 0, Z + 0.1, 12, 0.3));
      break;
    case "rat_trap":
      g.add(box(0.3, 0.06, 0.15, PAL.wood, 0, 0, Z + 0.6));
      break;
    case "shower":
      g.add(box(0.9, 0.05, 0.9, 0xbac0c0, 0, 0, Z));
      g.add(cyl(0.03, 1.8, PAL.metal, 0.35, 0, Z - 0.3, 6));
      g.add(cyl(0.12, 0.05, PAL.metal, 0.2, 1.8, Z - 0.1, 8));
      break;
    case "projector":
      g.add(box(0.4, 0.3, 0.3, 0x333333, 0, 0.9, Z));
      g.add(cyl(0.12, 0.2, 0x333333, -0.1, 1.2, Z, 8).rotateX(Math.PI / 2));
      g.add(box(0.05, 0.9, 0.05, 0x333333, 0, 0, Z));
      break;
    case "guitar_stand": {
      // an acoustic guitar leaning on a little stand
      const gt = new THREE.Group();
      gt.add(cyl(0.22, 0.1, 0xad7735, 0, 0.1, 0, 12).rotateX(Math.PI / 2));
      gt.add(cyl(0.16, 0.1, 0xad7735, 0, 0.42, 0, 12).rotateX(Math.PI / 2));
      gt.add(cyl(0.05, 0.02, 0x2a1d12, 0, 0.3, 0.06, 10).rotateX(Math.PI / 2));
      gt.add(box(0.06, 0.62, 0.04, 0x5a3a20, 0, 0.5, 0));
      gt.add(box(0.1, 0.12, 0.05, 0x3a2a18, 0, 1.12, 0));
      gt.position.set(0, 0.12, Z - 0.1);
      gt.rotation.z = 0.18;
      g.add(gt);
      g.add(box(0.3, 0.12, 0.2, 0x2a2a2a, 0, 0, Z - 0.1));
      break;
    }
    case "cache":
      g.add(box(0.7, 0.5, 0.5, 0x6a5a3a, 0, 0, Z + 0.2));
      g.add(box(0.72, 0.08, 0.52, 0x4a3a2a, 0, 0.5, Z + 0.2));
      break;
    case "ai_capsule":
      g.add(cyl(0.35, 1.5, 0x9ab0b8, 0, 0, Z, 12));
      g.add(box(0.3, 0.2, 0.02, 0x3adfff, 0, 1.0, Z + 0.36, mat(0x3adfff, { emissive: 0x1a6a80 })));
      break;
    case "bones":
      g.add(box(0.5, 0.08, 0.2, 0xe8e0cc, 0, 0, Z + 0.4));
      g.add(ball(0.12, mat(0xe8e0cc), 0.3, 0.1, Z + 0.4));
      break;
    case "nest":
      g.add(ball(0.45, mat(0x3a2a1a), 0, 0.3, Z + 0.3));
      break;
    case "metro":
      g.add(box(0.95, 1.9, 0.1, 0x1a1a1a, 0, 0, -1.5));
      g.add(box(0.9, 0.1, 1.2, 0x5a4a3a, 0, 0, -0.9));
      break;
    case "rug":
      g.add(box(1.4, 0.02, 1.0, 0x8a2a2a, 0, 0.001, -0.6));
      g.add(box(1.2, 0.025, 0.8, 0xb8864a, 0, 0.001, -0.6));
      break;
    case "poster": {
      const cols = [0xc8553d, 0x3d6b8c, 0x5a7d4a, 0xc9a227];
      const col = cols[(o.x * 7 + o.lv) % cols.length];
      g.add(box(0.6, 0.8, 0.02, 0xe8dcc0, 0, 0.8, -1.52));
      g.add(box(0.5, 0.35, 0.025, col, 0, 1.1, -1.51));
      g.add(box(0.45, 0.06, 0.025, 0x2a2320, 0, 0.92, -1.51));
      break;
    }
    case "plant":
      g.add(cyl(0.16, 0.3, 0xa0522d, 0, 0, Z + 0.4, 8, 0.12));
      for (let i = 0; i < 5; i++) {
        const lf = box(0.3, 0.06, 0.14, PAL.plant, Math.cos(i * 1.3) * 0.12, 0.35 + i * 0.12, Z + 0.4);
        lf.rotation.z = (i % 2 ? 1 : -1) * 0.6;
        g.add(lf);
      }
      break;
    case "lamp":
      g.add(cyl(0.02, 1.3, 0x333333, 0, 0, Z + 0.3, 6));
      g.add(cyl(0.12, 0.22, 0xe8c080, 0, 1.3, Z + 0.3, 8, 0.2));
      g.add(ball(0.06, mat(0xfff0c0, { emissive: 0xffb050 }), 0, 1.38, Z + 0.3));
      break;
    case "keepsake": {
      g.add(box(0.8, 0.05, 0.3, PAL.wood, 0, 1.2, Z - 0.3));
      g.add(box(0.05, 0.25, 0.25, PAL.woodDark, -0.35, 0.95, Z - 0.3));
      g.add(box(0.05, 0.25, 0.25, PAL.woodDark, 0.35, 0.95, Z - 0.3));
      // the keepsake itself stands on the shelf, recognisable at a glance
      const it = o.st?.item;
      const zz = Z - 0.25;
      if (it === "gnome") {
        g.add(box(0.2, 0.18, 0.16, 0x3d6b8c, 0, 1.25, zz), box(0.16, 0.12, 0.14, 0xf0c9a5, 0, 1.43, zz), box(0.16, 0.08, 0.05, 0xeeeeee, 0, 1.39, zz + 0.08));
        g.add(cyl(0.1, 0.2, 0xc8553d, 0, 1.55, zz, 6, 0.01));
      } else if (it === "teddy") {
        g.add(box(0.22, 0.2, 0.16, 0x9a6a3a, 0, 1.25, zz), box(0.18, 0.16, 0.15, 0xa8784a, 0, 1.45, zz));
        g.add(box(0.06, 0.06, 0.05, 0x9a6a3a, -0.08, 1.61, zz), box(0.06, 0.06, 0.05, 0x9a6a3a, 0.08, 1.61, zz), box(0.06, 0.04, 0.03, 0x3a2a1a, 0, 1.47, zz + 0.08));
      } else if (it === "album") {
        g.add(box(0.3, 0.26, 0.06, 0x7a2e3a, 0, 1.25, zz), box(0.26, 0.22, 0.01, 0xe8dcc0, 0, 1.27, zz + 0.035));
      } else if (it === "iron") {
        g.add(box(0.3, 0.06, 0.14, 0x888888, 0, 1.25, zz), box(0.2, 0.08, 0.12, 0x5a5a5a, -0.02, 1.31, zz), box(0.14, 0.04, 0.04, 0x2a2a2a, 0, 1.4, zz));
      } else if (it === "radio_portable") {
        g.add(box(0.3, 0.2, 0.12, 0x3a3a3a, 0, 1.25, zz), cyl(0.06, 0.02, 0x999999, -0.07, 1.33, zz + 0.07, 8).rotateX(Math.PI / 2), box(0.02, 0.2, 0.02, 0xaaaaaa, 0.1, 1.45, zz));
      } else g.add(box(0.25, 0.28, 0.2, 0x999999, 0, 1.25, zz));
      break;
    }
    default:
      g.add(box(0.6, 0.6, 0.5, PAL.concrete, 0, 0, Z));
  }
  if (o.broken) {
    g.add(ball(0.08, mat(0xffee88, { emissive: 0xffaa00 }), 0.2, 0.9, Z + 0.4));
    g.userData.sparks = true;
  }
  g.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return g;
}

function ball(r: number, m: THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(sphGeo(r), m);
  mesh.position.set(x, y, z);
  return mesh;
}

function fan(x: number, y: number, z: number) {
  const f = new THREE.Group();
  f.position.set(x, y, z);
  for (let i = 0; i < 3; i++) {
    const b = box(0.06, 0.22, 0.02, 0x333333, 0, 0, 0);
    b.position.y = 0;
    b.rotation.z = (i * Math.PI * 2) / 3;
    f.add(b);
  }
  f.name = "fan";
  return f;
}

function addPlant(g: THREE.Group, crop: string, stage: number, healthy: boolean, pests: boolean, mold: boolean, ready: boolean, z: number) {
  const [leaf0, fruit] = CROP_COLORS[crop] ?? [PAL.plant, PAL.plant];
  const leaf = healthy ? leaf0 : PAL.plantDry;
  const n = 3;
  for (let i = 0; i < n; i++) {
    const x = -0.28 + i * 0.28;
    const h = [0.05, 0.18, 0.36, 0.55, 0.62][Math.min(4, stage)];
    if (stage <= 0) {
      g.add(box(0.05, 0.05, 0.05, 0x5a4a30, x, 0.7, z));
      continue;
    }
    const stem = cyl(0.025, h, leaf, x, 0.7, z, 5);
    if (!healthy) stem.rotation.z = 0.35 * (i - 1);
    g.add(stem);
    const leaves = crop === "sunflower" ? 2 : 3;
    for (let j = 0; j < leaves; j++) {
      const lf = box(0.16 + stage * 0.03, 0.05, 0.1, leaf, x + (j % 2 ? 0.07 : -0.07), 0.7 + h * (0.35 + j * 0.25), z);
      lf.rotation.z = j % 2 ? -0.5 : 0.5;
      if (!healthy) lf.rotation.z *= 2.2;
      g.add(lf);
    }
    if (stage >= 3) {
      const fr = crop === "potato" || crop === "carrot" ? 0.08 : 0.07;
      const count = ready ? 3 : stage >= 4 ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const m = new THREE.Mesh(sphGeo(crop === "sunflower" ? 0.12 : fr), mat(fruit));
        const fy = crop === "potato" || crop === "carrot" ? 0.72 : 0.7 + h * (0.5 + k * 0.15);
        m.position.set(x + (k - 1) * 0.06, fy, z + 0.08);
        g.add(m);
      }
    }
  }
  if (pests) for (let i = 0; i < 6; i++) g.add(box(0.03, 0.03, 0.03, 0x2a3a1a, -0.3 + i * 0.12, 0.85 + (i % 2) * 0.1, z + 0.1));
  if (mold) g.add(box(0.8, 0.02, 0.6, 0xd8d8c8, 0, 0.71, z, mat(0xe8e8d8, { opacity: 0.6 })));
}
