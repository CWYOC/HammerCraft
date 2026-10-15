// Rebuild checked-in, same-origin CAD assets: npm ci && npm run build.
import { build } from "esbuild";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const here = new URL("./", import.meta.url);
const out = new URL("../../docs/engineering/vendor/", here);
await mkdir(out, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL("entry.mjs", here))],
  outfile: fileURLToPath(new URL("replicad.mjs", out)),
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  legalComments: "inline",
});
await build({
  entryPoints: [fileURLToPath(new URL("constraint-entry.mjs", here))],
  outfile: fileURLToPath(new URL("planegcs-wrapper.mjs", out)),
  bundle: true, minify: true, format: "esm", platform: "browser", target: "es2022", legalComments: "inline",
});
for (const [from, to] of [
  ["replicad-opencascadejs/dist/replicad_single.js", "replicad_single.mjs"],
  ["replicad-opencascadejs/dist/replicad_single.wasm", "replicad_single.wasm"],
  ["replicad-opencascadejs/LICENSE", "LICENSE-opencascade.txt"],
  ["replicad/LICENSE", "LICENSE-replicad.txt"],
  ["flatbush/LICENSE", "LICENSE-flatbush.txt"],
  ["flatqueue/LICENSE", "LICENSE-flatqueue.txt"],
  ["opentype.js/LICENSE", "LICENSE-opentype.txt"],
  ["tiny-inflate/LICENSE", "LICENSE-tiny-inflate.txt"],
  ["string.prototype.codepointat/LICENSE-MIT.txt", "LICENSE-codepointat.txt"],
  ["@salusoft89/planegcs/dist/planegcs_dist/planegcs.js", "planegcs.mjs"],
  ["@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm", "planegcs.wasm"],
  ["@salusoft89/planegcs/LICENSE", "LICENSE-planegcs.txt"],
])
  await copyFile(new URL(`node_modules/${from}`, here), new URL(to, out));
const manifest = {
  replicad: "1.1.0",
  opencascadeBuild: "replicad-opencascadejs@1.1.0",
  planegcs: "@salusoft89/planegcs@1.3.0",
  sha256: {},
};
for (const name of [
  "replicad.mjs",
  "replicad_single.mjs",
  "replicad_single.wasm",
  "planegcs-wrapper.mjs", "planegcs.mjs", "planegcs.wasm",
])
  manifest.sha256[name] = createHash("sha256")
    .update(await readFile(new URL(name, out)))
    .digest("hex");
await writeFile(
  new URL("manifest.json", out),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log("Vendored pinned CAD runtime and license notices.");
