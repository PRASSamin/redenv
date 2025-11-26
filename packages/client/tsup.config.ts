import { defineConfig } from "tsup";

export default defineConfig({
  tsconfig: "./tsconfig.json",
  entry: {
    index: "src/index.ts",
    utils: "src/utils/index.ts",
  },
  format: ["esm", "cjs"],
  outDir: "dist",
  bundle: true,
  dts: true,
  splitting: true,
  sourcemap: false,
  treeshake: true,
  clean: true,
  target: "esnext",
  skipNodeModulesBundle: true,
  onSuccess: async () => {
    console.log("Build completed successfully!");
  },
});
