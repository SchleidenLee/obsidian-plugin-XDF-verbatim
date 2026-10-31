import esbuild from "esbuild";
import process from "process";
import { copyFileSync, mkdirSync } from "node:fs";
import builtins from "builtin-modules";

const banner = `/*
XDF Verbatim — built with esbuild
*/
`;

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtins],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "dist/main.js",
  minify: prod,
  platform: "node",
});

// manifest/styles 复制进 dist，保证三件套齐全
mkdirSync("dist", { recursive: true });
copyFileSync("manifest.json", "dist/manifest.json");
copyFileSync("styles.css", "dist/styles.css");

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
