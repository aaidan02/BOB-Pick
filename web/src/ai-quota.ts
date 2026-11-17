import {user} from './auth';
import {rpc} from './supabase';
import {message} from './ui';

type Quota={day:string;limit:number|null;used:number;remaining:number|null;unlimited:boolean;reset_at:string};
let version=0,resetAt=0;
export async function refreshAiQuota(){
  const mine=++version,who=user?.id;
  if(!who){resetAt=0;message('ai-quota','로그인 후 AI 추천을 이용할 수 있어요.');return;}
  if(!resetAt)message('ai-quota','오늘 사용 횟수를 확인하고 있어요.');
  try{
    const quota=await rpc<Quota>('ai_quota_status');
    if(mine!==version||user?.id!==who)return;
    resetAt=Date.parse(quota.reset_at);
    message('ai-quota',quota.unlimited?'관리자 · AI 추천 무제한':`오늘 남은 AI 추천 ${quota.remaining}/${quota.limit}회`);
  }catch{
    if(mine===version&&user?.id===who)message('ai-quota','AI 추천 횟수를 확인하지 못했어요.');
  }
}
export function initAiQuota(){
  window.addEventListener('identity-changed',()=>{resetAt=0;void refreshAiQuota();});
  window.addEventListener('ai-usage-changed',()=>void refreshAiQuota());
  window.addEventListener('focus',()=>void refreshAiQuota());
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refreshAiQuota();});
  setInterval(()=>{if(user&&resetAt&&Date.now()>=resetAt)void refreshAiQuota();},30000);
  void refreshAiQuota();
}
