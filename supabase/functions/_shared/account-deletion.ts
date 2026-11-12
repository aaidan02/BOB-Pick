export class AccountDeletionError extends Error{constructor(message:string,public status=400){super(message);}}
export interface AccountDeletionDependencies {
  status:()=>Promise<{allowed:boolean;reason?:string}>;
  verifyPassword:(password:string)=>Promise<{userId:string;token:string}|null>;
  signOutAll:(token:string)=>Promise<void>;
  deleteUser:(id:string)=>Promise<void>;
}
export async function deleteOwnAccount(body:Record<string,unknown>,actorId:string,deps:AccountDeletionDependencies){
  if(body.confirm!==true||body.expectedUserId!==actorId||typeof body.password!=='string'||body.password.length<1||body.password.length>128)throw new AccountDeletionError('탈퇴 확인과 현재 비밀번호를 확인해 주세요.');
  const status=await deps.status();if(!status.allowed)throw new AccountDeletionError(status.reason??'이 계정은 탈퇴할 수 없습니다.',403);
  const verified=await deps.verifyPassword(body.password);
  if(!verified||verified.userId!==actorId)throw new AccountDeletionError('현재 비밀번호를 확인해 주세요.',403);
  await deps.signOutAll(verified.token);
  await deps.deleteUser(actorId);
  return {deleted:true};
}
