import java.nio.file.*;
import java.nio.charset.*;
import java.lang.reflect.*;
import java.util.*;

/** One-time migration tool: preserve the Java parser's exact menu/price/form rules. */
public final class CloudExport {
    static Object get(Object object,String name) throws Exception {
        Field f=object.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(object);
    }
    public static void main(String[] args) throws Exception {
        var records=RandomFoodPicker.readCsv(Path.of(args[0]),Charset.forName("MS949"));
        var headers=records.get(0);
        Field h=FoodPickerWeb.class.getDeclaredField("headers");h.setAccessible(true);h.set(null,headers);
        Method describe=FoodPickerWeb.class.getDeclaredMethod("describe",List.class);describe.setAccessible(true);
        List<Object> restaurants=new ArrayList<>(),menus=new ArrayList<>();
        for(var row:records.subList(1,records.size())) {
            Map<String,String> raw=new LinkedHashMap<>();for(int i=0;i<headers.size();i++)raw.put(headers.get(i),row.get(i));
            if("폐업".equals(raw.getOrDefault("최종대조판정","").trim()))continue;
            Object info=describe.invoke(null,row);
            Map<String,Object> r=new LinkedHashMap<>();String id=raw.get("음식점아이디");
            r.put("id",id);r.put("name",raw.get("음식점명"));r.put("address",raw.getOrDefault("주소",""));
            r.put("detail_address",raw.getOrDefault("상세주소",""));r.put("phone",raw.getOrDefault("전화번호",""));
            r.put("representative_menu",raw.getOrDefault("대표메뉴명",""));
            for(String[] p:new String[][]{{"latitude","위도"},{"longitude","경도"}}) {
                Double value=null;try{double d=Double.parseDouble(raw.get(p[1]));if(Double.isFinite(d)&&Math.abs(d)<=(p[0].equals("latitude")?90:180))value=d;}catch(Exception ignored){}
                r.put(p[0],value);
            }
            r.put("categories",get(info,"categories"));r.put("forms",get(info,"forms"));
            r.put("hours_text",raw.getOrDefault("영업 시간대",""));r.put("hours_display",raw.getOrDefault("운영시간정보",""));
            r.put("source_fields",raw);restaurants.add(r);
            for(Object menu:(List<?>)get(info,"menus")) {
                Map<String,Object> m=new LinkedHashMap<>();Object index=get(menu,"index");
                m.put("id",UUID.nameUUIDFromBytes((id+"\u0000"+index).getBytes(StandardCharsets.UTF_8)).toString());
                m.put("restaurant_id",id);m.put("source_index",index);m.put("name",get(menu,"name"));
                m.put("price",get(menu,"price"));m.put("variable_price",!get(menu,"priceLabel").equals(""));
                m.put("forms",get(menu,"forms"));menus.add(m);
            }
        }
        Field page=FoodPickerWeb.class.getDeclaredField("PAGE");page.setAccessible(true);
        Field location=FoodPickerWeb.class.getDeclaredField("LOCATION_TEST_PAGE");location.setAccessible(true);
        Files.writeString(Path.of(args[1]),GeminiFoodRecommender.Json.write(Map.of("restaurants",restaurants,"menus",menus,"html",page.get(null),"location",location.get(null))),StandardCharsets.UTF_8);
    }
}
