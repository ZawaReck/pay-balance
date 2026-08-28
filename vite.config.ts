import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "PayBalance",
        short_name: "PayBalance",
        description: "二人の支払いバランスを整えるアプリ",
        theme_color: "#f9fffb",
        background_color: "#f9fffb",
        display: "standalone",
        lang: "ja",
      },
    }),
  ],
});
