@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where javac >nul 2>nul
if errorlevel 1 (
  echo JDK 17 or later is required. Install a JDK and add its bin folder to PATH.
  goto failed
)
if not exist build mkdir build
javac -encoding UTF-8 --release 17 -d build RandomFoodPicker.java BusinessHours.java GeminiFoodRecommender.java FoodPickerWeb.java FoodPickerServer.java
if errorlevel 1 goto failed
java -cp build FoodPickerWeb %*
if errorlevel 1 goto failed
exit /b 0
:failed
pause
exit /b 1
