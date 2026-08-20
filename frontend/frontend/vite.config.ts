import { renameSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin, type ResolvedConfig } from "vite";
import react from "@vitejs/plugin-react";

const publicDir = resolve(import.meta.dirname, "../public");
const serverPort = process.env.PORT ?? "18080";
const renameAdminEntry = (): Plugin => {
  let shouldWrite = true;
  return {
    name: "rename-admin-entry",
    configResolved(config: ResolvedConfig): void {
      shouldWrite = config.build.write;
    },
    closeBundle(): void {
      if (!shouldWrite) return;
      renameSync(resolve(publicDir, "index.html"), resolve(publicDir, "admin.html"));
    }
  };
};

export default defineConfig({
  root: import.meta.dirname,
  base: "/",
  plugins: [
    react(),
    renameAdminEntry()
  ],
  build: {
    outDir: "../public",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  },
  server: {
    proxy: {
      "/api": `http://127.0.0.1:${serverPort}`,
      "/health": `http://127.0.0.1:${serverPort}`
    }
  }
});
