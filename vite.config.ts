import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 belongs to the production copy in ../araxys-crm; both run at once.
    port: 5174,
  },
  build: {
    target: "es2020",
  },
});
