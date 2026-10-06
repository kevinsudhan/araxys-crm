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
        rollupOptions: {
            output: {
                /*
                  The libraries in files of their own (6 Oct). They change only when a
                  library is upgraded, so a release of the app's own code — several a
                  day — leaves them in the browser's cache and only the app's code is
                  fetched again. The heavy ones a few pages use (jsPDF, the sheet
                  writer, the map) stay split off with those pages.
                */
                manualChunks: function (id) {
                    if (!id.includes("node_modules"))
                        return undefined;
                    if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id))
                        return "vendor-react";
                    if (/[\\/]node_modules[\\/](react-router|react-router-dom|@remix-run)[\\/]/.test(id))
                        return "vendor-router";
                    if (/[\\/]node_modules[\\/](@supabase|iceberg-js)[\\/]/.test(id))
                        return "vendor-supabase";
                    // The icons in one file (7 Oct): left alone they came as ~120 files of
                    // a few hundred bytes, twenty to sixty fetched for each page opened.
                    if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id))
                        return "vendor-icons";
                    return undefined;
                },
            },
        },
    },
});
