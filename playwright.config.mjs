import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',
  timeout:60000,
  expect:{timeout:12000},
  retries:0,
  workers:1,
  reporter:'list',
  use:{
    baseURL:process.env.IMAGE_BASE_URL||'http://127.0.0.1:18082',
    headless:true,
    trace:'retain-on-failure'
  },
  projects:[
    {name:'chromium',use:{browserName:'chromium'}},
    {name:'firefox',use:{browserName:'firefox'}},
    {name:'webkit',use:{browserName:'webkit'}}
  ]
});
