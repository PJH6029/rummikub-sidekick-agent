import fs from "node:fs";
import path from "node:path";

loadDotEnv();

export function loadDotEnv(
  filePath = path.resolve(process.cwd(), ".env"),
  target: NodeJS.ProcessEnv = process.env,
): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const entry = parseDotEnvLine(line);
    if (!entry || target[entry.key] !== undefined) {
      continue;
    }
    target[entry.key] = entry.value;
  }
}

function parseDotEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
  if (!match) {
    return null;
  }

  return {
    key: match[1] ?? "",
    value: stripQuotes((match[2] ?? "").trim()),
  };
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
