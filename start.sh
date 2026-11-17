#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
mkdir -p build
javac -encoding UTF-8 --release 17 -d build RandomFoodPicker.java BusinessHours.java GeminiFoodRecommender.java FoodPickerWeb.java FoodPickerServer.java
exec java -cp build FoodPickerWeb "$@"
