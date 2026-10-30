import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/code-reviewer/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 58031,
    proxy: {
      "/code-reviewer/api": "http://127.0.0.1:58041",
    },
  },
});
