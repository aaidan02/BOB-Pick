export interface FoodPreferences {
  liked_categories:string[];avoided_categories:string[];liked_forms:string[];avoided_menus:string[];
  min_price:number|null;max_price:number|null;avoid_visited_days:number;
}
export const emptyPreferences=():FoodPreferences=>({liked_categories:[],avoided_categories:[],liked_forms:[],avoided_menus:[],min_price:null,max_price:null,avoid_visited_days:7});
export function applyPreferenceFilter(filter:Record<string,unknown>,preferences:Record<string,unknown>={}){
  const result={...filter};
  for(const key of ['excludedCategories','excludedForms','excludedTerms','excludedRestaurantIds']){
    result[key]=[...new Set([...(Array.isArray(result[key])?result[key] as string[]:[]),...(Array.isArray(preferences[key])?preferences[key] as string[]:[])])];
  }
  for(const key of ['preferredCategories','preferredForms'])if(Array.isArray(preferences[key]))result[key]=preferences[key];
  if(result.min==null&&result.max==null){
    if(typeof preferences.min==='number')result.min=preferences.min;
    if(typeof preferences.max==='number')result.max=preferences.max;
  }
  return result;
}
