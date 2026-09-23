import * as THREE from "three";
import { ITEMS, itemName, listPrologueActions, type PAction } from "@bunker/shared";
import { audio } from "../audio/audio";
import { net } from "../net";
import { CharView } from "../render/chars";
import { box, cyl } from "../render/palette";
import { buildLoot } from "../render/loot";
import { SiteRenderer, buildEnemy } from "../render/site";
import type { WorldRenderer } from "../render/world";
import { add, clear, h, isModalOpen, ui, toast } from "./dom";

/** Click a supply to walk and take it; return to the hatch to deliver. */
export class PrologueUI {
  site = new SiteRenderer();
  dyn = new THREE.Group();
  chars = new Map<string, CharView>();
  npcs = new Map<string, THREE.Object3D>();
  loot = new Map<string, THREE.Group>();
  markers = h("div.layer.prologue-markers.hidden");
  labels = new Map<string, HTMLElement>();
  hud = h("div.prologue-hud.hidden");
  prompt = h("div.prompt.action-dock.prologue-actions.hidden");
  flash = h("div.flash.hidden");
  hatchLabel = h("button.hatch-marker", { onclick: () => this.returnHome() }, "↓ УБЕЖИЩЕ", h("small", null, "Отнести припасы"));
  active = false;
  actions: PAction[] = [];
  sel = 0;
  onNavigate: ((x: number, lv: number, done?: () => void) => void) | null = null;
  private built = false;
  private hudKey = "";
  private promptKey = "";
  private lastSiren = -1;
  private lastDelivered = 0;

  constructor(private r: WorldRenderer) {
    this.site.scene.add(this.dyn);
    this.markers.append(this.hatchLabel);
    ui().append(this.hud, this.prompt, this.markers, this.flash);
  }
  get p(): any { return net.pub?.phase === "prologue" ? net.pub.mods?.prologue : null; }
  update() {
    const p = this.p;
    this.active = !!p;
    this.hud.classList.toggle("hidden", !p);
    this.markers.classList.toggle("hidden", !p);
    if (!p) { this.prompt.classList.add("hidden"); this.flash.classList.add("hidden"); this.built = false; return; }
    if (!this.built) {
      const floors = p.H / 2, walk: boolean[] = [];
      for (let lv = 0; lv < floors; lv++) for (let x = 0; x < p.W; x++) walk.push(p.grid[lv * 2 * p.W + x] === 0);
      this.site.mode = "street";
      this.site.street = { hatch: p.hatchX, names: p.houses.map((h: any) => h.name.toUpperCase()) };
      this.site.build({ cols: p.W, floors, walk, ladders: Object.keys(p.ladders), covers: [], doors: [], exits: [] });
      this.built = true;
      this.dyn.clear(); this.loot.clear(); this.npcs.clear(); this.chars.clear();
      for (const el of this.labels.values()) el.remove();
      this.labels.clear();
      const [hx, hy] = this.site.pos(p.hatchX, 1);
      this.dyn.add(cyl(.66,.12,0x616a57,hx,hy,-.4,12),box(.08,.9,.08,0xd3b961,hx+.7,hy,-.6));
      this.site.camX = net.myChar()?.x ?? p.hatchX;
      this.site.camY = -1.3;
    }
    const left = Math.max(0, Math.ceil(p.dur-p.t));
    const saved = Object.values(p.delivered as Record<string,number>).reduce((a,b)=>a+b,0);
    const key = `${left}|${saved}|${p.done}`;
    if (key !== this.hudKey) {
      this.hudKey = key; clear(this.hud);
      add(this.hud,
        h("div.mission-caption", null, "ПОСЛЕДНИЙ СБОР"),
        h("div.prologue-timer" + (left <= 20 ? ".urgent" : ""), null, p.done ? "ВСПЫШКА" : `${Math.floor(left/60)}:${String(left%60).padStart(2,"0")}`),
        h("div", null, p.done ? "Держитесь. Люк закрывается…" : "Лучшее — в дальних домах и на вторых этажах. Успейте к люку!"),
        h("div.countdown-track", null, h("i", {style:{width:`${100*left/p.dur}%`}})),
        h("div.mission-saved", null, `В убежище: ${saved} припасов`, h("span.dim",null," · общий запас")));
      if (saved > this.lastDelivered) audio.sfx("find",.3);
      this.lastDelivered = saved;
      if (left <= 20 && left !== this.lastSiren && left%5 === 0) { this.lastSiren=left; audio.sfx("siren",.5); }
    }
    this.flash.classList.toggle("hidden", !p.done);
    if (p.done) this.flash.style.opacity = String(Math.max(0,1-p.flashT/4));
  }
  returnHome() {
    const p = this.p; if (!p || p.done) return;
    this.onNavigate?.(p.hatchX+.5,1,()=>{
      if (net.myChar()?.hands.length) net.send({k:"pdo",a:"drop",id:"hatch"});
      else toast("Вы у люка. Здесь безопасно во время вспышки.");
    });
  }
  selectItem(id: string) {
    const it = this.p?.items.find((o:any)=>o.id===id); if (!it) return;
    this.onNavigate?.(it.x,it.lv,()=>{
      const c=net.myChar(), p=this.p;
      const a=c && p && listPrologueActions(p,c).find(a=>a.id===id);
      if (a?.reason) toast(a.reason+" — отнесите припасы к люку");
      else if (a) { net.send({k:"pdo",a:"pick",id}); audio.sfx("find",.5); }
    });
  }
  handleClick(sx:number,sy:number) {
    if (!this.p || isModalOpen()) return;
    let best:any=null, distance=48;
    for(const it of this.p.items) {
      const [x,y]=this.site.pos(it.x-.5,it.lv), [px,py]=this.site.toScreen(x,y+.25);
      const d=Math.hypot(px-sx,py-sy);
      if(d<distance) {distance=d;best=it;}
    }
    if(best) {this.selectItem(best.id);return;}
    const [x,y]=this.site.toWorld(sx,sy);
    const lv=Math.max(0,Math.min(1,Math.floor(-y/2)));
    if(lv===1&&Math.abs(x-this.p.hatchX-.5)<.9) this.returnHome();
    else this.onNavigate?.(x,lv);
  }
  frame(dt:number):boolean {
    const p=this.p; if(!p) return false;
    const v=net.pub!, seen=new Set<string>();
    for(const it of p.items) {
      seen.add(it.id); let g=this.loot.get(it.id);
      if(!g) {g=buildLoot(it.item);this.loot.set(it.id,g);this.dyn.add(g);}
      const [x,y]=this.site.pos(it.x-.5,it.lv); g.position.set(x,y,-.12);
    }
    for(const [id,g] of this.loot) if(!seen.has(id)) {this.dyn.remove(g);this.loot.delete(id);}
    for(const n of p.npcs) {
      let g=this.npcs.get(n.id);
      if(!g) {g=buildEnemy("marauder",0x7a8aa0);this.npcs.set(n.id,g);this.dyn.add(g);}
      g.visible=n.state!=="saved";
      const [x,y]=this.site.pos(n.x-.5,n.lv); g.position.set(x,y,-.4); g.rotation.y=n.dir>0?.4:-.4;
    }
    for(const c of Object.values(v.chars) as any[]) {
      let cv=this.chars.get(c.id);
      if(!cv) {cv=new CharView(c.id,c.card.color,c.card.hat,1);cv.x=c.x;cv.y=c.y;this.chars.set(c.id,cv);this.dyn.add(cv.root);}
      const mine=c.id===net.priv?.char&&net.pred;
      const tx=mine?net.pred!.x:c.x, ty=mine?net.pred!.y:c.y;
      cv.x+=(tx-cv.x)*Math.min(1,dt*14); cv.y+=(ty-cv.y)*Math.min(1,dt*14);
      const moving=Math.abs(tx-cv.userPrevX)>.002; cv.userPrevX=tx;
      cv.setCarry(c.hands??[]); cv.update(dt,c.climbing?"climb":moving?"run":"idle",c.dir??1);
      cv.root.position.set(cv.x,-cv.y+.16,-.45); cv.setMine(c.id===net.priv?.char);
    }
    const me=net.myChar();
    if(me) {
      const x=net.pred?.x??me.x; this.site.follow=false;
      this.site.viewH=window.innerWidth<800?9:8;
      this.site.camX+=(x-this.site.camX)*Math.min(1,dt*4); this.site.camY=-1.0;
    }
    this.site.render(this.r.renderer);
    const [hx,hy]=this.site.pos(p.hatchX,1),[hsx,hsy]=this.site.toScreen(hx,hy+1.1);
    this.hatchLabel.style.left=Math.max(90,Math.min(window.innerWidth-90,hsx))+"px";
    this.hatchLabel.style.top=Math.max(220,Math.min(window.innerHeight-110,hsy))+"px";
    this.updateMarkers(p,me); this.updatePrompt(); return true;
  }
  updateMarkers(p:any,me:any) {
    const nearby=[...p.items].sort((a,b)=>Math.abs(a.x-(me?.x??0))-Math.abs(b.x-(me?.x??0))).slice(0,7);
    const seen=new Set<string>();
    nearby.forEach((it:any,i:number)=>{
      const [x,y]=this.site.pos(it.x-.5,it.lv),[sx,sy]=this.site.toScreen(x,y+.55);
      if(sx<40||sx>window.innerWidth-40||sy<180||sy>window.innerHeight-120) return;
      if(nearby.slice(0,i).some((o:any)=>o.lv===it.lv&&Math.abs(o.x-it.x)<1.4)) return;
      seen.add(it.id); let el=this.labels.get(it.id);
      if(!el) {el=h("button.loot-marker",{onclick:()=>this.selectItem(it.id)},h("small",null,"ВЗЯТЬ"),itemName(it.item));this.labels.set(it.id,el);this.markers.append(el);}
      el.style.left=sx+"px";el.style.top=sy+"px";
    });
    for(const [id,el] of this.labels) if(!seen.has(id)) {el.remove();this.labels.delete(id);}
  }
  updatePrompt() {
    const p=this.p,c=net.myChar();
    if(!p||!c||p.done||isModalOpen()) {this.prompt.classList.add("hidden");return;}
    const me={...c,x:net.pred?.x??c.x,lv:net.pred?.lv??c.lv,climbing:net.pred?.climbing??c.climbing};
    this.actions=listPrologueActions(p,me).slice(0,6);
    if(this.sel>=this.actions.length)this.sel=0;
    const task=p.tasks?.[c.id], key=JSON.stringify([this.actions,c.hands,Math.round((task?.t??0)*3)]);
    this.prompt.classList.remove("hidden");
    if(key===this.promptKey)return;
    this.promptKey=key;clear(this.prompt);
    this.prompt.append(h("div.dock-heading",null,"ВАШИ ПРИПАСЫ",h("span.dim",null,`${c.hands.length} / 3`)));
    this.prompt.append(h("div.carry-slots",null,c.hands.length?c.hands.map((it:any)=>h("span.carry-slot",null,ITEMS[it.item]?.icon??"□"," ",itemName(it.item))):h("span.dim",null,"Руки свободны. Нажмите на припас.")));
    this.prompt.append(h("button.primary.return-hatch",{onclick:()=>this.returnHome()},"↓ ",c.hands.length?"Отнести в убежище":"Вернуться к люку"));
    if(task)this.prompt.append(h("div.warn",null,`Уговариваю соседа… ${Math.min(100,Math.round(task.t/3*100))}%`));
    this.actions.forEach((a,i)=>this.prompt.append(h("button.opt"+(a.reason?".dis":""),{disabled:!!a.reason,onclick:()=>this.trigger(i)},a.label.replace(" (держите E)",""),a.reason?h("small.dim",null,a.reason):null)));
    if(c.hands.length)this.prompt.append(h("button.small",{onclick:()=>net.send({k:"pthrow"})},"Передать броском →"));
  }
  trigger(i=this.sel) {
    const a=this.actions[i];if(!a||a.reason)return;
    net.send({k:"pdo",a:a.a,id:a.id});audio.sfx(a.a==="drop"?"find":"click",.5);
  }
  handleKey(e:KeyboardEvent,down:boolean):boolean {
    if(!this.active||!down)return false;
    if(e.code==="KeyE") {this.trigger();return true;}
    if(e.code==="KeyQ") {net.send({k:"pthrow"});return true;}
    if(/^Digit[1-6]$/.test(e.code)){this.trigger(Number(e.code.slice(5))-1);return true;}
    return !["KeyC","Enter","Escape","KeyO"].includes(e.code);
  }
}
