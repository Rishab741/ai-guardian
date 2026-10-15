import { defineConfig } from "@playwright/test";

// Runs against an already-running stack (gateway :8000, console :3000),
// e.g. after start-demo.ps1. Override with E2E_BASE_URL.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", screenshot: "only-on-failure" },
  reporter: [["list"]],
});
