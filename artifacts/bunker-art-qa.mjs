import { chromium } from '@playwright/test';
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>console.log('ERROR',e.message));
await page.goto('http://localhost:5173');
await page.evaluate(async()=>{
const {WorldRenderer}=await import('/src/render/world.ts');const {CharView}=await import('/src/render/chars.ts');
const {createWorld}=await import('/@fs/C:/code/bunkerdream/packages/shared/src/world/create.ts');
document.body.innerHTML='';const canvas=document.createElement('canvas');document.body.append(canvas);const renderer=new WorldRenderer(canvas);
const w=createWorld('ART',783,{});w.phase='day';for(const r of Object.values(w.rooms))r.lit=true;
renderer.sync(w,null);renderer.follow=false;renderer.camX=24;renderer.camY=-1.6;renderer.viewH=9.6;renderer.updateCamera();
for(const [x,lv,col,hat] of [[18,1,0x38979c,1],[25,0,0xcb4f67,6],[28,0,0xcf9c39,10],[27,1,0x577b57,3]]) {const c=new CharView(String(x),col,hat,1);c.root.position.set(x,-lv*2-2+.16,-.45);renderer.scene.add(c.root);}
window.qa={renderer};const frame=()=>{renderer.frame(.016,w,null,null);requestAnimationFrame(frame)};frame();
});await page.waitForTimeout(2200);await page.screenshot({path:'artifacts/bunker-art-pass.png'});console.log(await page.evaluate(()=>({render:window.qa.renderer.renderer.info.render,memory:window.qa.renderer.renderer.info.memory})));await browser.close();
