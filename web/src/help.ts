import {el} from './ui';

const seenKey='bob-pick:help-seen:v1';
const otherPages=new Set(['account','favorites','community','requests','admin','terms','privacy','sources']);

export function initHelp(){
  const container=el('site-help-container'),button=el<HTMLButtonElement>('site-help-toggle');
  const panel=el('site-help'),close=el<HTMLButtonElement>('site-help-close');
  let shown=false;
  function hasSeen(){
    try{return shown||localStorage.getItem(seenKey)==='1';}catch{return shown;}
  }
  function show(){
    panel.hidden=false;button.setAttribute('aria-expanded','true');
    shown=true;
    // The guide is a browser preference; it does not depend on login or the API.
    try{localStorage.setItem(seenKey,'1');}catch{/* Still works when browser storage is unavailable. */}
    close.focus({preventScroll:true});
  }
  function dismiss(restoreFocus=false){
    if(panel.hidden)return;
    panel.hidden=true;button.setAttribute('aria-expanded','false');
    if(restoreFocus)button.focus({preventScroll:true});
  }
  button.addEventListener('click',()=>{
    if(!panel.hidden){dismiss(true);return;}
    show();
  });
  close.addEventListener('click',()=>dismiss(true));
  document.addEventListener('pointerdown',event=>{
    if(event.target instanceof Node&&!container.contains(event.target))dismiss();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!panel.hidden){event.preventDefault();dismiss(true);}
  });
  container.addEventListener('focusout',event=>{
    if(event.relatedTarget instanceof Node&&!container.contains(event.relatedTarget))dismiss();
  });
  function visit(){
    if(otherPages.has(location.hash.slice(1))){dismiss();return;}
    if(!hasSeen())show();
  }
  window.addEventListener('hashchange',visit);
  visit();
}
