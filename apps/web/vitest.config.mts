import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * テストからも `@/` で書けるようにする。
 * これが無いと、値の import だけが解決できずに落ちる
 * （型の import は実行時に消えるので、気づかないまま通ってしまう）。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
