import esbuild from "esbuild";
esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "fs", "os", "path", "child_process", "events", "readline"],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: "inline",
  treeShaking: true,
  outfile: "main.js",
}).catch(() => process.exit(1));
