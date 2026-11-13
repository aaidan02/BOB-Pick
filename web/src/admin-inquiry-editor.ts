import {rpc} from './supabase';
import {requireUser} from './auth';
import {action,el,node} from './ui';
type Row={id:string;user_id:string|null;kind:string;status:string;revision:number;payload:Record<string,any>;message:string;request_reviews?:any};
function textField(parent:HTMLElement,title:string,value:unknown,kind='input'){
  const label=node('label',title),field=kind==='textarea'?node('textarea'):node('input');field.value=String(value??'');label.append(field);parent.append(label);return field;
}
function amount(parent:HTMLElement,title:string,value:unknown){const field=textField(parent,title,value) as HTMLInputElement;field.type='number';field.step='1000';field.min=String(Math.max(0,Number(value??0))%1000);field.oninput=()=>{const n=Number(field.value);field.min=Number.isInteger(n)&&n>=0?String(n%1000):'0';};return field;}
function check(parent:HTMLElement,title:string,value:boolean){const label=node('label',title,'checkbox'),field=node('input');field.type='checkbox';field.checked=value;label.prepend(field);parent.append(label);return field;}
function choice(parent:HTMLElement,title:string,source:string,values:string[]){
  const fieldset=node('fieldset','','moderation-choices');fieldset.append(node('legend',title));const selected=new Map<string,HTMLInputElement>();
  for(const value of new Set([...Array.from(el<HTMLSelectElement>(source).options).map(o=>o.value).filter(Boolean),...values]))selected.set(value,check(fieldset,value,values.includes(value)));
  parent.append(fieldset);return ()=>[...selected].filter(([,input])=>input.checked).map(([value])=>value);
}
export function attachAdminInquiryEditor(card:HTMLElement,row:Row,reload:()=>Promise<void>){
  if(!row.user_id)return;
  const actions=node('div','','button-row'),edit=node('button','내용 수정','secondary'),host=node('div');edit.type='button';actions.append(edit);
  const review=Array.isArray(row.request_reviews)?row.request_reviews[0]:row.request_reviews;
  const args=(payload:Record<string,any>,message:string,note:string,reopen:boolean)=>({p_id:row.id,p_payload:payload,p_message:message,p_note:note,p_expected_revision:row.revision,p_reopen:reopen,p_expected_actor:requireUser().id});
  if(row.status==='rejected'){
    const reopen=node('button','승인 대기로 돌리기','secondary');reopen.type='button';reopen.onclick=()=>void action(reopen,'admin-status',async()=>{await rpc('admin_edit_request',args(row.payload,row.message,review?.note??'',true));await reload();el('admin-status').textContent='승인 대기로 변경했습니다.';});actions.append(reopen);
  }
  edit.onclick=()=>{
    if(host.children.length){host.hidden=!host.hidden;return;}
    const form=node('form','','portal-form moderation-editor'),fields=node('div','','portal-grid'),collectors:Array<(payload:Record<string,any>)=>void>=[],mutable=row.status!=='approved';
    if(mutable&&row.kind!=='promotion'){
      for(const [key,title]of [['name','음식점 이름'],['address','주소'],['phone','전화번호'],['latitude','위도'],['longitude','경도']]){
        const field=textField(fields,title,row.payload[key]) as HTMLInputElement;field.maxLength=key==='name'?200:1000;
        if(['latitude','longitude'].includes(key)){field.type='number';field.step='any';field.min=key==='latitude'?'-85.05112878':'-180';field.max=key==='latitude'?'85.05112878':'180';}
        if(row.kind==='registration'&&['name','address'].includes(key))field.required=true;
        collectors.push(payload=>{if(field.value.trim()||key in row.payload)payload[key]=field.value.trim();});
      }
      form.append(fields);
      if('active'in row.payload){const active=check(form,'추천에 표시',row.payload.active!==false);collectors.push(payload=>payload.active=active.checked);}
      const hours=check(form,'영업시간 다시 지정',false),times=node('div','','portal-grid'),open=textField(times,'매일 영업 시작','') as HTMLInputElement,close=textField(times,'매일 영업 종료','') as HTMLInputElement;open.type=close.type='time';times.hidden=true;
      hours.onchange=()=>{times.hidden=!hours.checked;open.required=close.required=hours.checked;};form.append(times);
      if(row.payload.hours_display)form.append(node('p','현재 영업시간: '+row.payload.hours_display,'helper'));
      collectors.push(payload=>{if(hours.checked){if(!open.value||!close.value)throw Error('영업 시작과 종료 시각을 입력해 주세요.');const end=close.value===open.value?'익일'+close.value:close.value;payload.hours_text=[...'월화수목금토일'].map(day=>day+'='+open.value+'~'+end).join(' | ');payload.hours_display='매일 '+open.value+' ~ '+(close.value<=open.value?'익일 ':'')+close.value;}});
      if(row.kind==='registration'){
        const categories=choice(form,'음식 종류','category',Array.isArray(row.payload.categories)?row.payload.categories:[]);const menuBox=node('div'),menuRows:Array<{row:HTMLElement;read:()=>any}>=[];
        const addMenu=(original:any={name:'',price:null,forms:['미분류']})=>{
          const block=node('div','','portal-grid moderation-editor'),name=textField(block,'메뉴명',original.name) as HTMLInputElement,price=amount(block,'가격 (원)',original.price),variable=check(block,'변동가격',!!original.variable_price),forms=choice(block,'음식 형태','form',Array.isArray(original.forms)?original.forms:[]),remove=node('button','메뉴 삭제','secondary');name.required=true;name.maxLength=300;price.disabled=variable.checked;variable.onchange=()=>price.disabled=variable.checked;remove.type='button';remove.onclick=()=>block.remove();block.append(remove);menuBox.append(block);
          menuRows.push({row:block,read:()=>{const n=price.value===''?null:Number(price.value),selected=forms();if(!name.value.trim()||!selected.length)throw Error('메뉴명과 음식 형태를 확인해 주세요.');if(n!==null&&(!Number.isInteger(n)||n<0))throw Error('메뉴 가격을 확인해 주세요.');return {...original,name:name.value.trim(),price:variable.checked?null:n,variable_price:variable.checked,forms:selected};}});
        };
        for(const menu of Array.isArray(row.payload.menus)?row.payload.menus:[])addMenu(menu);
        const add=node('button','메뉴 추가','secondary');add.type='button';add.onclick=()=>addMenu();form.append(menuBox,add);
        collectors.push(payload=>{payload.categories=categories();payload.menus=menuRows.filter(item=>menuBox.contains(item.row)).map(item=>item.read());if(!payload.categories.length||!payload.menus.length)throw Error('음식 종류와 메뉴를 한 개 이상 입력해 주세요.');payload.forms=[...new Set(payload.menus.flatMap((m:any)=>m.forms))];});
      }else if(row.payload.menu_patch){
        const patch=row.payload.menu_patch,price=amount(form,'신청한 메뉴 가격 (원)',patch.price),variable=check(form,'메뉴 변동가격',!!patch.variable_price);price.disabled=variable.checked;variable.onchange=()=>price.disabled=variable.checked;
        collectors.push(payload=>{const n=price.value===''?null:Number(price.value);if(n!==null&&(!Number.isInteger(n)||n<0))throw Error('메뉴 가격을 확인해 주세요.');payload.menu_patch={...patch,price:variable.checked?null:n,variable_price:variable.checked};});
      }
    }else if(mutable){
      const title=textField(form,'홍보 제목',row.payload.title) as HTMLInputElement,body=textField(form,'홍보 내용',row.payload.content,'textarea'),end=textField(form,'홍보 종료일','') as HTMLInputElement;title.maxLength=120;body.maxLength=5000;title.required=body.required=end.required=true;end.type='date';
      const originalDate=row.payload.ends_at?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.payload.ends_at)):'';end.value=originalDate;
      collectors.push(payload=>{payload.title=title.value.trim();payload.content=body.value.trim();if(end.value!==originalDate)payload.ends_at=end.value+'T23:59:59+09:00';});
    }else form.append(node('p','승인된 음식점 정보를 바꾸려면 정보 수정 신청을 이용해 주세요. 여기서는 문의 내용과 처리 사유를 수정할 수 있어요.','helper'));
    const content=textField(form,'문의 내용',row.message,'textarea');content.maxLength=3000;
    const note=row.status!=='pending'?textField(form,'처리 사유',review?.note??'','textarea'):null;if(note)note.maxLength=3000;
    const controls=node('div','','button-row'),save=node('button','수정 저장'),cancel=node('button','닫기','secondary');cancel.type='button';cancel.onclick=()=>host.hidden=true;controls.append(save,cancel);form.append(controls);
    form.onsubmit=event=>{event.preventDefault();void action(save,'admin-status',async()=>{const payload=structuredClone(row.payload);for(const collect of collectors)collect(payload);await rpc('admin_edit_request',args(payload,content.value,note?.value??'',false));await reload();el('admin-status').textContent='문의 내용을 수정했습니다.';});};
    host.append(form);host.hidden=false;
  };
  card.append(actions,host);
}
