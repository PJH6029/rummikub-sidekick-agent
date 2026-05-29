import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDotEnv } from "./env.js";

describe("env loader", () => {
  it("loads .env values without overriding existing process environment", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rummikub-env-"));
    const envPath = path.join(dir, ".env");
    fs.writeFileSync(envPath, [
      "# comment",
      "OPENAI_API_KEY=sk-test",
      "RUMMIKUB_MODEL='gpt-5.4'",
      "RUMMIKUB_REASONING_EFFORT=low",
      "EXISTING=value-from-file",
    ].join("\n"));

    const target: NodeJS.ProcessEnv = {
      EXISTING: "keep-existing",
    };
    loadDotEnv(envPath, target);

    expect(target.OPENAI_API_KEY).toBe("sk-test");
    expect(target.RUMMIKUB_MODEL).toBe("gpt-5.4");
    expect(target.RUMMIKUB_REASONING_EFFORT).toBe("low");
    expect(target.EXISTING).toBe("keep-existing");
  });
});
