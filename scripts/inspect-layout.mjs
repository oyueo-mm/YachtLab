import {chromium} from '@playwright/test';
const browser=await chromium.launch();
try{
 const page=await browser.newPage({viewport:{width:320,height:740}});
 for(const route of ['play','analysis','watch']){
  await page.goto(`http://127.0.0.1:5173/YachtLab/#${route}`);
  console.log(route,await page.evaluate(()=>({width:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('main *')].filter(x=>x.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(x=>({tag:x.tagName,cls:x.className,w:x.getBoundingClientRect().width,right:x.getBoundingClientRect().right,text:x.textContent.slice(0,50)}))})));
 }
}finally{await browser.close();}
