import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/gauntlet/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 58031,
    proxy: {
      "/gauntlet/api": "http://127.0.0.1:8080",
    },
  },
});
