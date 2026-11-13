$ErrorActionPreference = 'Stop'
$bobRoot = (Get-Location).Path
$bobCsv = Join-Path $bobRoot '관내 음식점 텍스트 데이터셋_둔산동_재검토_2.csv'
$bobJava = Join-Path $bobRoot 'RandomFoodPicker.java'
$bobEncoding = [System.Text.Encoding]::GetEncoding(949)
$bobRows = @([System.IO.File]::ReadAllText($bobCsv, $bobEncoding) | ConvertFrom-Csv)
if ($bobRows.Count -eq 0 -or $bobRows[0].PSObject.Properties.Name -notcontains '최종대조판정') {
    throw '최종대조판정 열이 있는 음식점 CSV를 확인해 주세요.'
}
$bobKept = @($bobRows | Where-Object { ([string]$_.'최종대조판정').Trim() -ne '폐업' })
$bobSource = [System.IO.File]::ReadAllText($bobJava, [System.Text.Encoding]::UTF8)
if (-not $bobSource.Contains('BOB_PICK_EXCLUDE_CONFIRMED_CLOSED')) {
    if ([regex]::Matches($bobSource, '\breturn records;').Count -ne 1) {
        throw 'RandomFoodPicker.java의 readCsv 메서드를 확인해 주세요. 파일은 변경하지 않았습니다.'
    }
    $bobFilter = @'
// BOB_PICK_EXCLUDE_CONFIRMED_CLOSED
        int statusColumn = records.isEmpty()
                ? -1 : records.get(0).indexOf("최종대조판정");
        if (statusColumn >= 0) {
            for (int i = records.size() - 1; i >= 1; i--) {
                List<String> values = records.get(i);
                if (values.size() > statusColumn
                        && "폐업".equals(values.get(statusColumn).trim())) {
                    records.remove(i);
                }
            }
        }
        return records;
'@
    $bobSource = $bobSource.Replace('return records;', $bobFilter)
}
$bobSource = $bobSource.Replace('가격·업종·영업 상태 조건 없음', '폐업 확정 제외 / 미확정·미확인 유지')
if ($bobKept.Count -gt 0) {
    $bobCsvLines = @($bobKept | ConvertTo-Csv -NoTypeInformation)
} else {
    $bobCsvLines = @(@($bobRows[0] | ConvertTo-Csv -NoTypeInformation)[0])
}
$bobCsvText = [string]::Join("`r`n", [string[]]$bobCsvLines) + "`r`n"
$bobUtf8 = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($bobCsv + '.tmp', $bobCsvText, $bobEncoding)
[System.IO.File]::WriteAllText($bobJava + '.tmp', $bobSource, $bobUtf8)
Move-Item -LiteralPath ($bobCsv + '.tmp') -Destination $bobCsv -Force
Move-Item -LiteralPath ($bobJava + '.tmp') -Destination $bobJava -Force
Write-Host ("폐업 확정 {0}곳 삭제 / 남은 음식점 {1}곳" -f ($bobRows.Count - $bobKept.Count), $bobKept.Count)
Write-Host '미확정·미확인과 나머지 열의 값은 유지했습니다. Java를 다시 컴파일하고 실행해 주세요.'
