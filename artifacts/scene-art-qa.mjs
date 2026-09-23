import { chromium } from '@playwright/test';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:900}});
await page.goto('http://localhost:5173');
await page.evaluate(async()=>{
  const THREE=await import('/node_modules/.vite/deps/three.js');
  const {SiteRenderer}=await import('/src/render/site.ts');
  const {CharView}=await import('/src/render/chars.ts');
  document.body.innerHTML=''; const canvas=document.createElement('canvas'); document.body.append(canvas);
  const renderer = new THREE.WebGLRenderer({canvas,antialias:true}); renderer.setSize(1440,900); renderer.outputColorSpace=THREE.SRGBColorSpace;
  const site = new SiteRenderer(); const walk=new Array(80).fill(false);
  for(let x=1;x<39;x++) walk[40+x]=true;
  for(const [a,b] of [[2,9],[11,17],[23,30],[32,38]])for(let x=a;x<b;x++)walk[x]=true;
  site.build({cols:40,floors:2,walk,ladders:['3,1','12,1','24,1','33,1'],covers:[],doors:[],exits:[]});
  for (const [x,lv] of [[20,1],[17,1],[14,0]]) {const c=new CharView(String(x),0xc15a53,1,1); c.root.position.set(x,site.pos(x,lv)[1],-.4);site.dyn.add(c.root);}
  site.follow=false;site.camX=20;site.camY=-2.4;site.viewH=7;
  window.qa={site,renderer}; const frame=()=>{site.render(renderer); requestAnimationFrame(frame)};frame();
});
await page.waitForTimeout(2000);
await page.screenshot({path:'artifacts/site-art-pass.png'});
console.log(await page.evaluate(()=>({render:window.qa.renderer.info.render,memory:window.qa.renderer.info.memory})));
await browser.close();
