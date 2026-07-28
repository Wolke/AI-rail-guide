import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const root = new URL("../dist-web/", import.meta.url).pathname;
const secretPatterns = [/sk-[A-Za-z0-9_-]{20,}/, /Bearer\s+[A-Za-z0-9._-]{24,}/, /OPENAI_API_KEY\s*=\s*[^\s"']+/];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

for (const file of await walk(root)) {
  if (![".js", ".css", ".html", ".json", ".svg", ".webmanifest"].includes(extname(file))) continue;
  const content = await readFile(file, "utf8");
  if (secretPatterns.some((pattern) => pattern.test(content))) throw new Error(`Potential secret found in web artifact: ${file}`);
}
process.stdout.write("Web artifact secret scan passed.\n");
