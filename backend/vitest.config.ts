import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    setupFiles: ["vitest.setup.ts"],
    exclude: [...configDefaults.exclude],
    testTimeout: 5000,
    reporters: "verbose",
  },
})
