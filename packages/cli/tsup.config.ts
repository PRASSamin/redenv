import { defineConfig, type Options } from "tsup";

export default defineConfig((options?: Partial<Options>) => ({
  tsconfig: "./tsconfig.json",
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  dts: false,
  bundle: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  target: "esnext",
  skipNodeModulesBundle: true,
  onSuccess: 'echo "CLI build completed successfully!"',
  ...options,
}));
