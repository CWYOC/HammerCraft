# CAD runtime notices

These files are generated with `npm ci && npm run build` in `tools/engineering-cad`.
The package lock pins the complete dependency graph and registry integrity hashes;
`manifest.json` records SHA-256 hashes of the generated browser assets.

- [replicad 1.1.0 source](https://github.com/sgenoud/replicad/tree/e4b05f67dc4e2393a876ce8c5064a9c93db05bf1/packages/replicad): MIT, see `LICENSE-replicad.txt`.
- [replicad-opencascadejs 1.1.0 source and build configuration](https://github.com/sgenoud/replicad/tree/e4b05f67dc4e2393a876ce8c5064a9c93db05bf1/packages/replicad-opencascadejs): LGPL 2.1, see `LICENSE-opencascade.txt`.
- [OpenCascade.js source and build tools](https://github.com/taucad/opencascade.js/tree/ebd263f1) used by that upstream custom build.
- [Open CASCADE Technology source](https://github.com/Open-Cascade-SAS/OCCT) and its upstream copyright/license notices.
- Bundled JavaScript dependencies carry their accompanying `LICENSE-*.txt` notices.

The unmodified single-threaded OpenCascade.js loader and WASM are separate files,
loaded from this origin in a dedicated worker. They can be replaced with a compatible
custom build without rebuilding the application. No multithreaded build or external
runtime CDN is used. The kernel WASM is about 22 MB before HTTP compression.


## Sketch constraint runtime

- [PlaneGCS wrapper 1.3.0 and corresponding C++ source/build scripts](https://github.com/Salusoft89/planegcs/tree/9d26baef0b240fe0eef4186d4e5e5e66ec3620b7): published as `@salusoft89/planegcs`, LGPL-2.0-or-later as declared upstream; see `LICENSE-planegcs.txt`. The source repository includes the extracted FreeCAD solver and its copyright notices, Eigen dependencies and the Emscripten build configuration.
- The pinned package's loader and approximately 475 KiB WASM are copied unchanged to `planegcs.mjs` and `planegcs.wasm`. `planegcs-wrapper.mjs` bundles the package's JavaScript wrapper and enum definitions without code changes; `constraint-entry.mjs` is the application build entry point.
- The wrapper/loader/WASM are separate replaceable files, with integrity hashes in the manifest. No external runtime CDN or new server service is required. Application adapters are `constraints-data.mjs` and `constraints-solver.mjs`; they do not modify the upstream solver.
- Rebuild/relink these assets using the same pinned `npm ci && npm run build` command above. To change the underlying solver build, use the corresponding upstream source/build scripts linked above and replace the compatible loader/WASM pair. Keep copyright/license notices with redistributed builds.
