import { defineConfig } from "@redenv/core";
import { studioPlugin } from "./packages/studio/src";

export default defineConfig({
  environment: "development",
  name: "redenv",
  plugins: [studioPlugin],
});
