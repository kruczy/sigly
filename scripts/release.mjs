import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const planPath = ".release/plan.json";
const dependencyFields = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "devDependencies",
];

function windowsPnpmCommand(args) {
  const unsafe = /[\s"&|<>()^%!]/;
  for (const arg of args) {
    if (unsafe.test(arg)) {
      throw new Error(`Unsafe character in pnpm argument: ${arg}`);
    }
  }
  return `pnpm.cmd ${args.join(" ")}`;
}

function run(command, args, options = {}) {
  const useCommandPrompt = process.platform === "win32" && command === "pnpm";
  const executable = useCommandPrompt ? (process.env.ComSpec ?? "cmd.exe") : command;
  const executableArgs = useCommandPrompt ? ["/d", "/s", "/c", windowsPnpmCommand(args)] : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
  });

  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${output ? `:\n${output}` : ""}`);
  }

  return result;
}

function git(args, options) {
  return run("git", args, options);
}

function gitOutput(args) {
  return git(args).stdout.trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function writeJson(path, value) {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function discoverPackages() {
  const packageRoot = join(root, "packages");
  const packages = readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = `packages/${entry.name}`;
      const manifest = readJson(`${path}/package.json`);
      return { manifest, name: manifest.name, path, version: manifest.version };
    })
    .filter((pkg) => pkg.manifest.private !== true);

  const names = new Set(packages.map((pkg) => pkg.name));
  for (const pkg of packages) {
    pkg.internalDependencies = new Set(
      dependencyFields.flatMap((field) =>
        Object.keys(pkg.manifest[field] ?? {}).filter((name) => names.has(name)),
      ),
    );
  }

  return packages;
}

export function bumpVersion(version, releaseType = "patch") {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Cannot ${releaseType}-bump unsupported version ${version}`);
  }

  let [, major, minor, patch] = match.map(Number);
  if (releaseType === "major") [major, minor, patch] = [major + 1, 0, 0];
  else if (releaseType === "minor") [minor, patch] = [minor + 1, 0];
  else if (releaseType === "patch") patch += 1;
  else throw new Error(`Unknown release type: ${releaseType}`);

  return `${major}.${minor}.${patch}`;
}

export function sortPackages(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const visiting = new Set();
  const visited = new Set();
  const sorted = [];

  function visit(pkg) {
    if (visited.has(pkg.name)) return;
    if (visiting.has(pkg.name)) {
      throw new Error(`Internal package dependency cycle involving ${pkg.name}`);
    }

    visiting.add(pkg.name);
    for (const dependency of [...pkg.internalDependencies].toSorted((a, b) => a.localeCompare(b))) {
      const dependencyPackage = byName.get(dependency);
      if (dependencyPackage) visit(dependencyPackage);
    }
    visiting.delete(pkg.name);
    visited.add(pkg.name);
    sorted.push(pkg);
  }

  for (const pkg of [...packages].toSorted((a, b) => a.name.localeCompare(b.name))) {
    visit(pkg);
  }
  return sorted;
}

function isAncestor(revision) {
  return (
    git(["merge-base", "--is-ancestor", revision, "HEAD"], {
      allowFailure: true,
    }).status === 0
  );
}

function tagCommit(tag) {
  const result = git(["rev-parse", `${tag}^{commit}`], { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

function latestPackageTag(pkg) {
  const prefix = `${pkg.name}@`;
  const tags = gitOutput(["tag", "--list", `${prefix}*`, "--sort=-version:refname"]).split(/\r?\n/);

  return (
    tags.find(
      (tag) =>
        tag.startsWith(prefix) &&
        /^\d+\.\d+\.\d+$/.test(tag.slice(prefix.length)) &&
        isAncestor(tag),
    ) ?? null
  );
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function legacyReleaseCommit(pkg) {
  if (pkg.version === "0.0.0") return null;
  const version = escapeRegex(pkg.version);
  const name = escapeRegex(pkg.name);
  const result = git(
    [
      "log",
      "-n",
      "1",
      "--format=%H",
      "--extended-regexp",
      `--grep=^(v${version}|${name}@${version})$`,
    ],
    { allowFailure: true },
  );
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

function baselineFor(pkg) {
  return latestPackageTag(pkg) ?? legacyReleaseCommit(pkg);
}

function changedFiles(pkg, baseline) {
  if (!baseline) {
    return gitOutput(["ls-files", pkg.path]).split(/\r?\n/).filter(Boolean);
  }
  return gitOutput(["diff", "--name-only", `${baseline}..HEAD`, "--", pkg.path])
    .split(/\r?\n/)
    .filter(Boolean);
}

function assertClean() {
  const status = gitOutput(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status) {
    throw new Error(
      "The working tree must be clean. Commit or stash changes before preparing or publishing a release.",
    );
  }
}

function readPlan() {
  return existsSync(join(root, planPath)) ? readJson(planPath) : null;
}

function validatePlan(plan) {
  if (plan?.schema !== 1 || !plan.sourceHead || !Array.isArray(plan.packages)) {
    throw new Error(`${planPath} is not a valid release plan`);
  }
  const names = new Set();
  for (const pkg of plan.packages) {
    if (
      !pkg?.name ||
      !pkg.path ||
      !pkg.from ||
      !pkg.to ||
      pkg.tag !== `${pkg.name}@${pkg.to}` ||
      names.has(pkg.name)
    ) {
      throw new Error(`${planPath} contains an invalid package release`);
    }
    names.add(pkg.name);
  }
}

function workingTreePaths() {
  const status = git(["status", "--porcelain=v1", "--untracked-files=all"]).stdout.trimEnd();
  return status
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").at(-1).replaceAll("\\", "/"));
}

function planIsComplete(plan) {
  return plan.packages.every((pkg) => tagCommit(pkg.tag));
}

function assertPlanVersions(plan, packages) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  for (const release of plan.packages) {
    const pkg = byName.get(release.name);
    if (!pkg) throw new Error(`Release package ${release.name} no longer exists`);
    if (pkg.version !== release.to) {
      throw new Error(
        `${release.name} is ${pkg.version}, but the release plan expects ${release.to}`,
      );
    }
  }
}

function activePlanHandled(plan, packages) {
  if (!plan) return false;
  validatePlan(plan);
  if (planIsComplete(plan)) return false;
  assertPlanVersions(plan, packages);
  if (!isAncestor(plan.sourceHead)) {
    throw new Error(`Release source ${plan.sourceHead} is not an ancestor of HEAD`);
  }

  const allowed = new Set([planPath, ...plan.packages.map((pkg) => `${pkg.path}/package.json`)]);
  const committed = gitOutput(["diff", "--name-only", `${plan.sourceHead}..HEAD`])
    .split(/\r?\n/)
    .filter(Boolean);
  const unexpected = [...committed, ...workingTreePaths()].filter((path) => !allowed.has(path));
  if (unexpected.length) {
    throw new Error(
      `A release is already prepared, but it has later changes: ${[...new Set(unexpected)].join(", ")}. Publish or revert that plan first.`,
    );
  }

  console.log("Release already prepared:");
  printPlan(plan);
  console.log("\nCommit the release files, then run pnpm release:publish.");
  return true;
}

function printPlan(plan) {
  for (const pkg of plan.packages) {
    console.log(`  ${pkg.name}: ${pkg.from} -> ${pkg.to}`);
  }
}

function parsePrepareArgs(args) {
  let releaseType = "patch";
  let dryRun = false;
  for (const arg of args) {
    if (["patch", "minor", "major"].includes(arg)) releaseType = arg;
    else if (["--patch", "--minor", "--major"].includes(arg)) {
      releaseType = arg.slice(2);
    } else if (arg === "--dry-run") dryRun = true;
    else throw new Error(`Unknown prepare option: ${arg}`);
  }
  return { dryRun, releaseType };
}

function prepare(args) {
  const options = parsePrepareArgs(args);
  const packages = discoverPackages();
  const existingPlan = readPlan();
  if (activePlanHandled(existingPlan, packages)) return;
  assertClean();

  const selected = packages
    .map((pkg) => {
      pkg.baseline = baselineFor(pkg);
      pkg.changedFiles = changedFiles(pkg, pkg.baseline);
      return pkg;
    })
    .filter((pkg) => pkg.changedFiles.length > 0 || !pkg.baseline);

  if (!selected.length) {
    console.log("No public packages have changed since their latest release tags.");
    return;
  }

  const plan = {
    schema: 1,
    sourceHead: gitOutput(["rev-parse", "HEAD"]),
    releaseType: options.releaseType,
    packages: sortPackages(selected).map((pkg) => ({
      name: pkg.name,
      path: pkg.path,
      from: pkg.version,
      to: bumpVersion(pkg.version, options.releaseType),
      baseline: pkg.baseline,
      tag: `${pkg.name}@${bumpVersion(pkg.version, options.releaseType)}`,
      changedFiles: pkg.changedFiles,
    })),
  };

  console.log(options.dryRun ? "Release preview:" : "Prepared release:");
  printPlan(plan);
  if (options.dryRun) return;

  for (const release of plan.packages) {
    const manifestPath = `${release.path}/package.json`;
    const manifest = readJson(manifestPath);
    manifest.version = release.to;
    writeJson(manifestPath, manifest);
  }
  writeJson(planPath, plan);
  console.log(
    `\nReview and commit the package manifests and ${planPath}; publish later with pnpm release:publish.`,
  );
}

function parsePublishArgs(args) {
  const forwarded = [];
  let dryRun = false;
  const optionsWithValues = new Set(["--access", "--otp", "--tag"]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run" || arg === "--provenance") {
      forwarded.push(arg);
      if (arg === "--dry-run") dryRun = true;
    } else if ([...optionsWithValues].some((option) => arg.startsWith(`${option}=`))) {
      forwarded.push(arg);
    } else if (optionsWithValues.has(arg)) {
      const value = args[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      forwarded.push(arg, value);
      index += 1;
    } else {
      throw new Error(`Unknown publish option: ${arg}`);
    }
  }
  return { dryRun, forwarded };
}

function registryHasVersion(name, version) {
  const result = run("pnpm", ["view", `${name}@${version}`, "version", "--json"], {
    allowFailure: true,
  });
  if (result.status === 0) return true;

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (/E404|404 Not Found/i.test(output)) return false;
  throw new Error(`Could not check ${name}@${version} in npm:\n${output.trim()}`);
}

function ensureTag(tag) {
  const head = gitOutput(["rev-parse", "HEAD"]);
  const existing = tagCommit(tag);
  if (existing && existing !== head) {
    throw new Error(`${tag} already points to ${existing}, not ${head}`);
  }
  if (!existing) git(["tag", tag, head]);
}

function pushTag(tag) {
  ensureTag(tag);
  console.log(`Pushing ${tag} to origin`);
  git(["push", "origin", `refs/tags/${tag}:refs/tags/${tag}`], {
    inherit: true,
  });
}

function publish(args) {
  const options = parsePublishArgs(args);
  assertClean();
  const plan = readPlan();
  if (!plan) throw new Error(`No ${planPath} exists; run pnpm release:prepare first`);
  validatePlan(plan);
  const packages = discoverPackages();
  assertPlanVersions(plan, packages);
  if (!isAncestor(plan.sourceHead)) {
    throw new Error(`Release source ${plan.sourceHead} is not an ancestor of HEAD`);
  }
  if (git(["ls-files", "--error-unmatch", planPath], { allowFailure: true }).status !== 0) {
    throw new Error(`${planPath} must be committed before publishing`);
  }

  const releases = sortPackages(
    plan.packages.map((release) => {
      const pkg = packages.find((candidate) => candidate.name === release.name);
      if (pkg.path !== release.path) {
        throw new Error(
          `${release.name} is at ${pkg.path}, but the release plan says ${release.path}`,
        );
      }
      pkg.release = release;
      return pkg;
    }),
  ).map((pkg) => pkg.release);

  const pending = [];
  for (const pkg of releases) {
    if (registryHasVersion(pkg.name, pkg.to)) {
      console.log(`Already published, skipping ${pkg.name}@${pkg.to}`);
      if (!options.dryRun) pushTag(pkg.tag);
    } else {
      pending.push(pkg);
    }
  }

  if (!pending.length) {
    console.log(
      options.dryRun
        ? "All versions in the release plan are already published."
        : "All versions are published and their tags are on origin.",
    );
    return;
  }

  for (const pkg of pending) {
    console.log(`\nBuilding ${pkg.name}@${pkg.to}`);
    run("pnpm", ["run", "build"], {
      cwd: join(root, pkg.path),
      inherit: true,
    });
  }

  for (const pkg of pending) {
    console.log(`\n${options.dryRun ? "Packing" : "Publishing"} ${pkg.name}@${pkg.to}`);
    const publishArgs = ["publish", "--access", "public", ...options.forwarded];
    run("pnpm", publishArgs, { cwd: join(root, pkg.path), inherit: true });
    if (!options.dryRun) pushTag(pkg.tag);
  }

  if (options.dryRun) {
    console.log("\nDry run complete; nothing was published, tagged, or pushed.");
  } else {
    console.log("\nPublished in dependency order and pushed every package tag to origin.");
  }
}

function usage() {
  console.log(`Usage:
  pnpm release:prepare [patch|minor|major] [--dry-run]
  pnpm release:publish [--dry-run] [--tag <tag>] [--otp <code>] [--provenance]`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "prepare") prepare(args);
  else if (command === "publish") publish(args);
  else {
    usage();
    if (command) process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Release failed: ${error.message}`);
    process.exitCode = 1;
  });
}
