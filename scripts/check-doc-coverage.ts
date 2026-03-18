#!/usr/bin/env bun

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT_DIR = process.cwd();
const PACKAGES_DIR = join(ROOT_DIR, "packages");
const SKIP_DIRS = new Set(["__tests__", "dist", "node_modules"]);

type PackageStats = {
  total: number;
  documented: number;
};

function walkSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walkSourceFiles(fullPath, acc);
      continue;
    }

    if (
      (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx")) &&
      !fullPath.endsWith(".d.ts")
    ) {
      acc.push(fullPath);
    }
  }

  return acc;
}

function getModifiers(node: ts.Node): readonly ts.ModifierLike[] {
  return ts.getModifiers?.(node) ?? node.modifiers ?? [];
}

function isExported(node: ts.Node): boolean {
  const modifiers = getModifiers(node);

  return modifiers.some(
    (modifier) =>
      modifier.kind === ts.SyntaxKind.ExportKeyword ||
      modifier.kind === ts.SyntaxKind.DefaultKeyword,
  );
}

function hasDocComment(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const jsDocs = ts.getJSDocCommentsAndTags(node);

  for (const doc of jsDocs) {
    if (!ts.isJSDoc(doc)) continue;

    const { comment, tags } = doc;
    if (typeof comment === "string" && comment.trim().length > 0) return true;
    if (Array.isArray(comment) && comment.length > 0) return true;
    if (tags !== undefined && tags.length > 0) return true;
  }

  const commentRanges =
    ts.getLeadingCommentRanges(sourceFile.getFullText(), node.pos) ?? [];

  return commentRanges.some((range) =>
    sourceFile.getFullText().slice(range.pos, range.end).startsWith("/**"),
  );
}

function getNodeName(
  node: ts.Node | undefined,
  sourceFile: ts.SourceFile,
): string {
  if (node === undefined) return "default";

  try {
    return node.getText(sourceFile);
  } catch {
    return "default";
  }
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) return "100.0";
  return ((numerator / denominator) * 100).toFixed(1);
}

function printSummary(
  byPackage: ReadonlyArray<[string, PackageStats]>,
  total: number,
  documented: number,
): void {
  console.log(
    `Exported API doc coverage: ${documented}/${total} (${formatPercent(documented, total)}%)`,
  );

  for (const [pkg, stats] of byPackage) {
    console.log(
      `  ${pkg.padEnd(12)} ${String(stats.documented).padStart(3)}/${String(stats.total).padEnd(3)} ${formatPercent(stats.documented, stats.total).padStart(5)}%`,
    );
  }
}

const sourceFiles = walkSourceFiles(PACKAGES_DIR);
const program = ts.createProgram(sourceFiles, {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  skipLibCheck: true,
  allowJs: false,
});

const byPackage = new Map<string, PackageStats>();
const undocumented: string[] = [];
let total = 0;
let documented = 0;

for (const sourceFile of program.getSourceFiles()) {
  const relativePath = relative(ROOT_DIR, sourceFile.fileName);

  if (
    (!sourceFile.fileName.includes("/packages/") &&
      !sourceFile.fileName.startsWith("packages/")) ||
    sourceFile.fileName.includes("/node_modules/") ||
    relativePath.includes("/src/__tests__/")
  ) {
    continue;
  }

  const match = relativePath.match(/^packages\/([^/]+)\//);
  const packageName = match?.[1] ?? "(unknown)";
  if (!byPackage.has(packageName)) {
    byPackage.set(packageName, { total: 0, documented: 0 });
  }

  const stats = byPackage.get(packageName);
  if (stats === undefined) {
    throw new Error(`Missing package stats bucket for ${packageName}`);
  }

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        total += 1;
        stats.total += 1;

        if (hasDocComment(statement, sourceFile)) {
          documented += 1;
          stats.documented += 1;
          continue;
        }

        const line =
          sourceFile.getLineAndCharacterOfPosition(
            declaration.getStart(sourceFile),
          ).line + 1;

        undocumented.push(
          `${relativePath}:${line} variable ${getNodeName(declaration.name, sourceFile)}`,
        );
      }

      continue;
    }

    const isCountableExport =
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      isExported(statement);

    if (!isCountableExport) continue;

    total += 1;
    stats.total += 1;

    if (hasDocComment(statement, sourceFile)) {
      documented += 1;
      stats.documented += 1;
      continue;
    }

    const line =
      sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile))
        .line + 1;

    undocumented.push(
      `${relativePath}:${line} ${ts.SyntaxKind[statement.kind]} ${getNodeName(statement.name, sourceFile)}`,
    );
  }
}

const sortedPackages = [...byPackage.entries()].sort(([a], [b]) =>
  a.localeCompare(b),
);

printSummary(sortedPackages, total, documented);

if (undocumented.length > 0) {
  console.error("\nUndocumented exported declarations:");
  for (const line of undocumented) {
    console.error(`  - ${line}`);
  }
  process.exitCode = 1;
}
