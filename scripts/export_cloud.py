"""Export the original CSV without rewriting it. Run before publishing new catalog data."""
import json, pathlib, re, shutil, subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1]
DATA=ROOT/'관내 음식점 텍스트 데이터셋_둔산동_재검토_2.csv'
def run():
    compiler=[shutil.which('javac')] if shutil.which('javac') else ['java','com.sun.tools.javac.Main']
    (ROOT/'build').mkdir(exist_ok=True)
    subprocess.run(compiler+['-encoding','UTF-8','-d','build','RandomFoodPicker.java','BusinessHours.java','GeminiFoodRecommender.java','FoodPickerWeb.java','scripts/CloudExport.java'],cwd=ROOT,check=True)
    subprocess.run(['java','-cp','build','CloudExport',str(DATA),'build/cloud-export.json'],cwd=ROOT,check=True)
    data=json.loads((ROOT/'build/cloud-export.json').read_text())
    seed=['-- Generated from the CSV by scripts/export_cloud.py. Existing records are preserved.\nbegin;']
    definitions={
      'restaurants':'id text,name text,address text,detail_address text,phone text,representative_menu text,latitude float8,longitude float8,categories text[],forms text[],hours_text text,hours_display text,source_fields jsonb',
      'menus':'id uuid,restaurant_id text,source_index integer,name text,price integer,variable_price boolean,forms text[]'}
    for table in definitions:
      cols=','.join(data[table][0].keys())
      for offset in range(0,len(data[table]),50):
        payload=json.dumps(data[table][offset:offset+50],ensure_ascii=False,separators=(',',':')).replace("'","''")
        seed.append(f"insert into public.{table}({cols}) select {cols} from jsonb_to_recordset('{payload}'::jsonb) as x({definitions[table]}) on conflict(id) do nothing;")
    sets=json.loads((ROOT/'korean_holidays.json').read_text())['sets']; holidays={}
    for kind,days in sets.items():
      for day in days: holidays.setdefault(day,[]).append(kind)
    values=','.join("('%s',array[%s])"%(d,','.join("'%s'"%k for k in ks)) for d,ks in sorted(holidays.items()))
    seed.append('insert into public.holidays(day,kinds) values '+values+' on conflict(day) do nothing;')
    seed.append('commit;')
    (ROOT/'supabase/seed.sql').write_text('\n'.join(seed)+'\n',encoding='utf-8')
    print(f"Exported {len(data['restaurants'])} restaurants and {len(data['menus'])} menus; CSV unchanged.")
    return data
if __name__=='__main__': run()
