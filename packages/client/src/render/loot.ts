import * as THREE from "three";
import { ITEMS } from "@bunker/shared";
import { box, cyl, mat } from "./palette";

/** Small physical supply props, shared by floor loot and the prologue. */
export function buildLoot(item: string): THREE.Group {
  const g = new THREE.Group();
  const d = ITEMS[item];
  if (item.includes("water") || item === "batteries" || item === "fuel") {
    const water = item.includes("water");
    const col = water ? 0x599fae : 0xc99a46;
    g.add(box(.24,.37,.2,col,0,0,0), box(.18,.09,.16,col,0,.37,0), box(.1,.05,.1,0xddd8bd,0,.46,0));
    g.add(box(.245,.12,.205,water ? 0xb6d3cf : 0x514d3b,0,.14,0));
  } else if (item.includes("food") && !item.includes("box")) {
    g.add(cyl(.15,.29,0x9bada2,0,0,0,12), cyl(.158,.025,0xbec9b8,0,.29,0,12));
    g.add(box(.24,.16,.012,0xc35a39,0,.065,.149), box(.11,.08,.014,0xe8ce8a,0,.1,.158));
  } else if (item.includes("aid") || item === "meds" || item === "toolbox") {
    const col = item === "toolbox" ? 0xc69036 : 0xb94b3d;
    g.add(box(.48,.31,.25,col,0,0,0),box(.25,.04,.06,0x423c32,0,.4,0));
    g.add(box(.035,.1,.05,0x423c32,-.12,.31,0),box(.035,.1,.05,0x423c32,.12,.31,0));
    if (item !== "toolbox") g.add(box(.23,.06,.015,0xe8dfc7,0,.13,.135),box(.065,.23,.015,0xe8dfc7,0,.045,.14));
  } else if (item.includes("seed")) {
    g.add(box(.25,.33,.045,0xd1ba7a,0,0,0),box(.15,.16,.01,0x709746,0,.065,.03));
  } else if (item === "guitar") {
    g.add(cyl(.17,.08,0xad7735,0,.08,0,10),box(.06,.57,.06,0x725132,0,.13,0));
  } else {
    const large = !!d?.large;
    const w = large ? .55 : .3, ht = large ? .4 : .3;
    g.add(box(w,ht,.3,0x997343,0,0,0));
    g.add(box(w+.015,.045,.315,0x4a4838,0,.07,0),box(.045,ht+.01,.315,0x5e5940,0,0,0));
  }
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.27,12),new THREE.MeshBasicMaterial({color:0x151510,transparent:true,opacity:.32,depthWrite:false}));
  shadow.rotation.x=-Math.PI/2; shadow.position.y=.005; g.add(shadow);
  const ring = new THREE.Mesh(new THREE.RingGeometry(.26,.285,24),mat(0xe7c572,{emissive:0x665021,opacity:.75}));
  ring.rotation.x=-Math.PI/2; ring.position.y=.012; g.add(ring);
  return g;
}
