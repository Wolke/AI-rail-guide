import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/web/testSetup.ts"],
    include: ["src/web/**/*.test.{ts,tsx}"]
  }
});
