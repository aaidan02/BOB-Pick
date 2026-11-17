let owner:string|null=null;
let filter:Record<string,unknown>={};
let loading=false,failed=false;
export function activePreferenceFilter(){return structuredClone(filter);}
export function preferencesLoading(){return loading;}
export function preferencesFailed(){return failed;}
export function markPreferencesLoading(value:boolean){loading=value;window.dispatchEvent(new Event('food-preferences-loading'));}
export function failPreferences(userId:string){setActivePreferences(userId);failed=true;window.dispatchEvent(new Event('food-preferences-changed'));}
export function setActivePreferences(userId:string|null,next:Record<string,unknown>={}){
  const changed=owner!==userId||JSON.stringify(filter)!==JSON.stringify(next);
  owner=userId;filter=next;failed=false;
  for(const id of ['manual-taste-row','chat-taste-row']){const row=document.getElementById(id);if(row)row.hidden=!userId;}
  if(changed)window.dispatchEvent(new Event('food-preferences-changed'));
}
