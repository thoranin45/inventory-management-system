import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fixturePlugin } from "./fixture-server";
const here=path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({root:here,plugins:[react(),fixturePlugin()],resolve:{alias:{"@":path.resolve(here,"../src")}},server:{host:"127.0.0.1",port:5087,strictPort:true,allowedHosts:["127.0.0.1"],fs:{allow:[path.resolve(here,"..")]}}});
