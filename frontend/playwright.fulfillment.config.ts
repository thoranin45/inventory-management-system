import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";
export default defineConfig({testDir:"./e2e",testMatch:"fulfillment-recovery.spec.ts",workers:1,fullyParallel:false,retries:0,reporter:"list",outputDir:path.join(os.tmpdir(),`r5-safe3-browser-${process.pid}-${Date.now()}`),use:{baseURL:"http://127.0.0.1:5087",channel:"msedge",headless:true,trace:"off",screenshot:"off",video:"off"},webServer:{command:"node node_modules/vite/bin/vite.js --config fulfillment-harness/vite.config.ts",url:"http://127.0.0.1:5087",reuseExistingServer:false,timeout:30000}});
