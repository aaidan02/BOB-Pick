import {node} from './ui';
import {emptyPreferences,type FoodPreferences} from '../../supabase/functions/_shared/preferences';
const words=['백반','국밥','해장국','찌개','전골','구이','냉면','칼국수','짜장면','짬뽕','마라','탕수육','초밥','돈카츠','돈까스','라멘','우동','소바','파스타','피자','버거','스테이크','브런치','떡볶이','김밥','쌀국수','커리','커피','베이커리','디저트'];
const options=(id:string)=>[...document.querySelectorAll<HTMLOptionElement>('#'+id+' option')].map(o=>o.value).filter(Boolean);
export function preferenceMarkup(prefix:string){return `
  <section class="taste-section"><h3>음식 취향</h3><p class="helper">좋아요는 우선하고, 피할래요는 추천 후보에서 제외해요.</p><div id="${prefix}-categories" class="taste-categories"></div></section>
  <section class="taste-section"><h3>좋아하는 음식 형태</h3><div id="${prefix}-forms" class="taste-chips" role="group" aria-label="좋아하는 음식 형태"></div></section>
  <section class="taste-section"><h3>피하고 싶은 세부 메뉴</h3><p class="helper">메뉴 이름에 선택한 단어가 포함되면 제외해요.</p><div id="${prefix}-menus" class="taste-chips" role="group" aria-label="피하고 싶은 세부 메뉴"></div><div class="taste-word-entry"><label class="grow"><span class="sr-only">제외할 메뉴 직접 입력</span><input id="${prefix}-word" maxlength="60" placeholder="예: 곱창"></label><button type="button" id="${prefix}-word-add" class="secondary">추가</button></div><p id="${prefix}-word-status" class="helper" role="status"></p></section>
  <section class="taste-section"><h3>자주 고르는 예산 <span class="helper">선택</span></h3><div class="portal-grid"><label>최소 가격 (원)<input id="${prefix}-min" type="number" min="0" max="2147483647" step="1000" placeholder="제한 없음"></label><label>최대 가격 (원)<input id="${prefix}-max" type="number" min="0" max="2147483647" step="1000" placeholder="제한 없음"></label></div></section>
  <section class="taste-section"><h3>최근 방문한 가게 다시 추천하지 않기</h3><p class="helper">‘다녀왔어요’로 표시한 기록에만 적용해요.</p><div id="${prefix}-days" class="taste-chips" role="group" aria-label="최근 방문 제외 기간"></div></section>`;}
function chip(text:string,value:string,pressed:boolean){const button=node('button',text,'taste-chip');button.type='button';button.dataset.value=value;button.setAttribute('aria-pressed',String(pressed));return button;}
export function renderPreferenceForm(prefix:string,value:FoodPreferences=emptyPreferences()){
  const categories=document.getElementById(prefix+'-categories')!;categories.replaceChildren();
  for(const category of options('category')){
    const row=node('div','','taste-row'),label=node('strong',category),buttons=node('div','','taste-actions');
    const like=chip('♡ 좋아요',category,value.liked_categories.includes(category)),avoid=chip('⊗ 피할래요',category,value.avoided_categories.includes(category));
    like.dataset.choice='like';avoid.dataset.choice='avoid';
    for(const [button,other]of [[like,avoid],[avoid,like]])button.onclick=()=>{const active=button.getAttribute('aria-pressed')==='true';button.setAttribute('aria-pressed',String(!active));other.setAttribute('aria-pressed','false');};
    buttons.append(like,avoid);row.append(label,buttons);categories.append(row);
  }
  const forms=document.getElementById(prefix+'-forms')!;forms.replaceChildren();
  for(const form of options('form')){const button=chip(form,form,value.liked_forms.includes(form));button.onclick=()=>button.setAttribute('aria-pressed',String(button.getAttribute('aria-pressed')!=='true'));forms.append(button);}
  const menus=document.getElementById(prefix+'-menus')!;menus.replaceChildren();
  const addWord=(word:string,pressed:boolean)=>{const button=chip(word,word,pressed);button.onclick=()=>button.setAttribute('aria-pressed',String(button.getAttribute('aria-pressed')!=='true'));menus.append(button);};
  for(const word of [...new Set([...words,...value.avoided_menus])])addWord(word,value.avoided_menus.includes(word));
  const entry=document.getElementById(prefix+'-word') as HTMLInputElement;
  document.getElementById(prefix+'-word-add')!.onclick=()=>{
    const word=entry.value.trim(),status=document.getElementById(prefix+'-word-status')!;
    if(!word||word.length>60){status.textContent='메뉴 이름을 1~60자로 입력해 주세요.';return;}
    const existing=[...menus.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.dataset.value===word);
    if(existing)existing.setAttribute('aria-pressed','true');else addWord(word,true);
    entry.value='';status.textContent='';
  };
  entry.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();document.getElementById(prefix+'-word-add')!.click();}};
  for(const [name,amount]of [['min',value.min_price],['max',value.max_price]] as const)(document.getElementById(prefix+'-'+name) as HTMLInputElement).value=amount==null?'':String(amount);
  const days=document.getElementById(prefix+'-days')!;days.replaceChildren();
  for(const day of [0,7,14,30]){const button=chip(day?day+'일':'사용 안 함',String(day),day===value.avoid_visited_days);button.onclick=()=>{for(const sibling of days.querySelectorAll('button'))sibling.setAttribute('aria-pressed',String(sibling===button));};days.append(button);}
}
export function readPreferenceForm(prefix:string):FoodPreferences{
  const selected=(suffix:string,choice?:string)=>[...document.querySelectorAll<HTMLButtonElement>(`#${prefix}-${suffix} button[aria-pressed=true]${choice?`[data-choice=${choice}]`:''}`)].map(button=>button.dataset.value!);
  const number=(suffix:string)=>{const text=(document.getElementById(prefix+'-'+suffix) as HTMLInputElement).value.trim();if(!text)return null;const amount=Number(text);if(!Number.isInteger(amount)||amount<0||amount>2147483647)throw Error('예산을 0 이상의 정수로 입력해 주세요.');return amount;};
  const min=number('min'),max=number('max');if(min!=null&&max!=null&&min>max)throw Error('최소 가격이 최대 가격보다 큽니다.');
  const prefs={liked_categories:selected('categories','like'),avoided_categories:selected('categories','avoid'),liked_forms:selected('forms'),avoided_menus:selected('menus'),min_price:min,max_price:max,avoid_visited_days:Number(selected('days')[0]??7)};
  if(prefs.avoided_menus.length>30)throw Error('제외 메뉴는 30개까지 선택할 수 있어요.');return prefs;
}
