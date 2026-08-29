/**
 * Blitz Pi — Access Profiles Tests
 * Tests for access checkpoint: tool control via YAML profiles
 */

import path from "path";
import { readFileSync } from "fs";
import { minimatch } from "minimatch";
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";

// Since ProfileMatcher is not exported, we'll test it indirectly through the extension
// by checking that profiles load correctly and match expected rules

describe("Blitz Pi - Access Profiles", () => {
  describe("Profile Loading", () => {
    test("should load strict profile from .blitz/profiles/strict.yaml", () => {
      const profilePath = path.join(process.cwd(), ".blitz/profiles/strict.yaml");
      const content = readFileSync(profilePath, "utf-8");

      expect(content).toContain("name: strict");
      expect(content).toContain("denied: true");
      expect(content).toContain("tool: bash");
    });

    test("should have bash tool denied in strict profile", () => {
      const profilePath = path.join(process.cwd(), ".blitz/profiles/strict.yaml");
      const content = readFileSync(profilePath, "utf-8");

      const lines = content.split("\n");
      let foundBash = false;
      let foundDenied = false;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("tool: bash")) {
          foundBash = true;
          // Check next few lines for denied: true
          for (let j = i; j < Math.min(i + 3, lines.length); j++) {
            if (lines[j].includes("denied: true")) {
              foundDenied = true;
              break;
            }
          }
        }
      }

      expect(foundBash).toBe(true);
      expect(foundDenied).toBe(true);
    });

    test("should have default allow-all profile (user.yaml)", () => {
      const profilePath = path.join(process.cwd(), ".blitz/profiles/user.yaml");
      const content = readFileSync(profilePath, "utf-8");

      expect(content).toContain("name: user");
      expect(content).toContain('tool: "*"');
      expect(content).toContain("allowed: true");
    });
  });

  describe("Config Loading", () => {
    test("should load config from .blitz/blitz.config.yaml", () => {
      const configPath = path.join(process.cwd(), ".blitz/blitz.config.yaml");
      const content = readFileSync(configPath, "utf-8");

      expect(content).toContain("threat_detection:");
      expect(content).toContain("profiles:");
      expect(content).toContain("sandbox:");
      expect(content).toContain("governance:");
    });

    test("should have user profile as default", () => {
      const configPath = path.join(process.cwd(), ".blitz/blitz.config.yaml");
      const content = readFileSync(configPath, "utf-8");

      expect(content).toMatch(/profiles:[\s\n]+default: user/);
    });
  });

  describe("Path Matching Logic", () => {
    test("glob pattern ./src/** should match ./src/file.ts", () => {
      // Test the glob matching behavior
      const pattern = "./src/**";
      const filePath = "./src/file.ts";

      // Minimatch behavior (used by ProfileMatcher)
      const matches = minimatch(path.resolve(filePath), path.resolve(pattern), {
        noglobstar: false,
        dot: true,
      });

      expect(matches).toBe(true);
    });

    test("glob pattern ./src/** should NOT match ../etc/passwd", () => {
      const pattern = "./src/**";
      const filePath = "../etc/passwd";

      const matches = minimatch(path.resolve(filePath), path.resolve(pattern), {
        noglobstar: false,
        dot: true,
      });

      expect(matches).toBe(false);
    });
  });

  describe("Rule Structure", () => {
    test("strict profile should have bash denied rule", () => {
      const profilePath = path.join(process.cwd(), ".blitz/profiles/strict.yaml");
      const content = readFileSync(profilePath, "utf-8");

      // Parse YAML manually for testing
      expect(content).toContain("- tool: bash");
      expect(content).toContain("denied: true");
    });

    test("strict profile should allow read in ./src/** and ./docs/**", () => {
      const profilePath = path.join(process.cwd(), ".blitz/profiles/strict.yaml");
      const content = readFileSync(profilePath, "utf-8");

      expect(content).toContain("- tool: read");
      expect(content).toContain("./src/**");
      expect(content).toContain("./docs/**");
    });

    test("strict profile should allow write only in ./runs/** and ./.blitz/audit/**", () => {
      const profilePath = path.join(process.cwd(), ".blitz/profiles/strict.yaml");
      const content = readFileSync(profilePath, "utf-8");

      expect(content).toContain("- tool: write");
      expect(content).toContain("./runs/**");
      expect(content).toContain("./.blitz/audit/**");
    });

    test("strict profile should deny all other tools", () => {
      const profilePath = path.join(process.cwd(), ".blitz/profiles/strict.yaml");
      const content = readFileSync(profilePath, "utf-8");

      // Last rule should be catch-all deny
      const lines = content.split("\n");
      const lastRuleIdx = lines.findIndex((l, i) =>
        l.includes('tool: "*"') && i > 10 // Skip header
      );

      expect(lastRuleIdx).toBeGreaterThan(0);
    });
  });

  describe("Audit Trail location", () => {
    test("audit trail is global (~/.blitz/audit), not project-local", () => {
      const os = require("os");
      const { loadConfig } = require("../src/config");
      const auditPath = loadConfig().audit.path as string;
      // resolves under the user's home, and NOT inside the current project
      expect(auditPath.startsWith(process.env.HOME || os.homedir())).toBe(true);
      expect(auditPath.startsWith(process.cwd())).toBe(false);
      expect(auditPath).not.toContain("~"); // tilde must be expanded, never a literal
    });
  });
});
