export class AccountDeletionError extends Error{constructor(message:string,public status=400){super(message);}}
export interface AccountDeletionDependencies {
  status:()=>Promise<{allowed:boolean;reason?:string}>;
  verifyPassword:(password:string)=>Promise<{userId:string;token:string;sessionId:string;session:{access_token:string;refresh_token:string}}|null>;
  revokeSessions:(token:string,scope:'global'|'others')=>Promise<void>;
  withdraw:(id:string)=>Promise<{restoreUntil:string}>;
  restore:(id:string,sessionId:string)=>Promise<unknown>;
}
export async function deleteOwnAccount(body:Record<string,unknown>,actorId:string,deps:AccountDeletionDependencies){
  const action=body.action??'withdraw';
  if(action==='withdraw'&&body.retentionDays!==7)throw new AccountDeletionError('탈퇴 안내가 변경되었습니다. 새로고침한 뒤 다시 시도해 주세요.');
  if(!['withdraw','restore'].includes(String(action))||body.confirm!==true||body.expectedUserId!==actorId||typeof body.password!=='string'||body.password.length<1||body.password.length>128)throw new AccountDeletionError('본인 확인과 현재 비밀번호를 확인해 주세요.');
  if(action==='withdraw'){const status=await deps.status();if(!status.allowed)throw new AccountDeletionError(status.reason??'이 계정은 탈퇴할 수 없습니다.',403);}
  const verified=await deps.verifyPassword(body.password);
  if(!verified||verified.userId!==actorId)throw new AccountDeletionError('현재 비밀번호를 확인해 주세요.',403);
  if(action==='restore'){
    await deps.revokeSessions(verified.token,'others');
    await deps.restore(actorId,verified.sessionId);
    return {restored:true,session:verified.session};
  }
  // Block existing JWTs in the database before revoking refresh sessions.
  const withdrawal=await deps.withdraw(actorId);let sessionsRevoked=true;
  try{await deps.revokeSessions(verified.token,'global');}catch{sessionsRevoked=false;}
  return {withdrawn:true,restoreUntil:withdrawal.restoreUntil,sessionsRevoked};
}
