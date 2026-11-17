import java.nio.charset.*;
import java.nio.file.*;
import java.time.*;
import java.util.*;
public final class CloudHoursProbe {
  public static void main(String[] args) throws Exception {
    var records=RandomFoodPicker.readCsv(Path.of(args[0]),Charset.forName("MS949"));
    int id=records.get(0).indexOf("음식점아이디"),hours=records.get(0).indexOf("영업 시간대");
    Set<String> seen=new HashSet<>();List<Object> result=new ArrayList<>();
    for(var row:records.subList(1,records.size())){
      if(!seen.add(row.get(hours)))continue;
      var schedule=BusinessHours.parse(row.get(hours));
      for(String day:List.of("2026-11-09","2026-11-10","2026-11-11","2026-11-12","2026-11-13","2026-11-14","2026-11-15","2026-03-02","2026-02-17","2026-09-25","2036-01-01")){
        for(String time:List.of("00:00","01:00","12:00","15:30","22:00")){
          Map<String,Object> item=new LinkedHashMap<>();item.put("id",row.get(id));item.put("day",day);item.put("time",time);item.put("expected",schedule.openAt(LocalDate.parse(day),LocalTime.parse(time)));result.add(item);
        }
      }
    }
    System.out.print(GeminiFoodRecommender.Json.write(result));
  }
}
