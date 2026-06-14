import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(appRoot, "..", "..");
const source = resolve(workspaceRoot, "packages", "sigly", "dist");
const target = resolve(appRoot, "public", "sigly");

await mkdir(resolve(appRoot, "public"), { recursive: true });
await rm(target, { force: true, recursive: true });
await cp(source, target, { recursive: true });
