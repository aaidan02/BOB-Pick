export function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){
  const value=document.createElement(tag);value.textContent=text;if(className)value.className=className;return value;
}
export const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
export function input(id:string){return el<HTMLInputElement>(id).value.trim();}
export function message(id:string,value:string){el(id).textContent=value;}
export function friendly(error:unknown){
  const text=error instanceof Error?error.message:String((error as {message?:string})?.message??error);
  if(/Invalid login credentials/i.test(text))return '이메일과 비밀번호를 확인해 주세요.';
  if(/Email not confirmed/i.test(text))return '메일의 가입 확인 링크를 먼저 눌러 주세요.';
  if(/already registered/i.test(text))return '이미 가입한 이메일입니다.';
  if(/rate limit|too many/i.test(text))return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  if(/row.level|permission denied|JWT/i.test(text))return '이 작업의 권한이 없습니다. 로그인 상태를 확인해 주세요.';
  if(/violates check constraint|invalid input syntax/i.test(text))return '입력한 내용과 가격·날짜 형식을 확인해 주세요.';
  if(/fetch|network|timeout|timed out|connection/i.test(text))return '연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.';
  // Application validation messages are Korean. Keep internal JS/DB details out of the UI.
  if(/[가-힣]/.test(text)&&!/[{}<>]|\b(?:TypeError|Error|SELECT|INSERT|constraint|Symbol)\b/i.test(text))return text;
  return '처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
}
export async function action(button:HTMLButtonElement,statusId:string,work:()=>Promise<void>){
  button.disabled=true;message(statusId,'처리 중입니다.');
  try{await work();}catch(error){message(statusId,friendly(error));}finally{button.disabled=false;}
}
export function price(menu:{price:number|null;variable_price:boolean}){return menu.variable_price?'변동가격':menu.price==null?'가격 표시 없음':menu.price.toLocaleString('ko-KR')+'원';}
export function date(value:string){return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}
