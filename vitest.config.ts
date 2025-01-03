import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
   test: {
      include: ["vitest/tests/**/*"],
      server: {
         deps: {
            external: ["typescript"],
         },
      },
   },
   resolve: {
      alias: {
         "@testutils": path.resolve(__dirname, "./vitest/utils"),
         "@src": path.resolve(__dirname, "./src"),
      },
   },
});
