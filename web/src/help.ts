import {el} from './ui';

export function initHelp(){
  const container=el('site-help-container'),button=el<HTMLButtonElement>('site-help-toggle');
  const panel=el('site-help'),close=el<HTMLButtonElement>('site-help-close');
  function dismiss(restoreFocus=false){
    if(panel.hidden)return;
    panel.hidden=true;button.setAttribute('aria-expanded','false');
    if(restoreFocus)button.focus({preventScroll:true});
  }
  button.addEventListener('click',()=>{
    if(!panel.hidden){dismiss(true);return;}
    panel.hidden=false;button.setAttribute('aria-expanded','true');close.focus({preventScroll:true});
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
}
