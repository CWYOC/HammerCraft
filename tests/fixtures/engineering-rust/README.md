# Independent migration references

`legacy-units.mjs` preserves the pre-migration JavaScript parser solely for parity tests; the application does not import it.

`scalar-fem.json` records a 60 × 20 × 10 mm Gmsh 4.15.2 box mesh (365 nodes / 1,073 tetrahedra), plus four scikit-fem 12.0.2 / SciPy 1.18.1 thermal references produced before the Rust implementation: linear fixed-end conduction, fixed/convection, uniform generation and all-Robin cooling. Requests and complete reference fields are included. These are synthetic verification cases, not experimental material data.

The same mesh supports an independent electrical check: conductivity 100 S/m and end voltages 0 and 2 V give R = L/(σA) = 3 Ω, I = 2/3 A, P = 4/3 W and V(x) = 2x/0.06. No Rust-computed expected field is stored.
