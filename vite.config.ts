import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [
    {
      name: "font-licenses",
      generateBundle() {
        for (const family of ["bricolage-grotesque", "inter"]) {
          const license = new URL(
            `./node_modules/@fontsource-variable/${family}/LICENSE`,
            import.meta.url,
          );
          this.emitFile({
            type: "asset",
            fileName: `assets/${family}-LICENSE.txt`,
            source: readFileSync(license, "utf8"),
          });
        }
      },
    },
  ],
  root: "frontend",
  base: "/ui/",
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4175",
      "/builds": "http://127.0.0.1:4175",
      "/preview": "http://127.0.0.1:4175",
    },
  },
});
