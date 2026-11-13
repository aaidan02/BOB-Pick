import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';
export default defineConfig({testDir:'tests',testMatch:'cloud-browser.spec.ts',workers:1,timeout:60000,use:{baseURL:'http://127.0.0.1:5173',timezoneId:'Asia/Seoul',launchOptions:{executablePath:process.env.CHROMIUM_PATH||(existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']}},webServer:[
  {command:'node --import tsx tests/cloud-fixture-server.ts',url:'http://127.0.0.1:54329/health',timeout:60000},
  {command:'npm run dev -- --host 127.0.0.1',url:'http://127.0.0.1:5173',env:{VITE_SUPABASE_URL:'http://127.0.0.1:54329',VITE_SUPABASE_PUBLISHABLE_KEY:'unit-test-publishable-key'},timeout:30000}
]});
