# Curved STEP regression fixtures

Generated locally with the pinned Gmsh 4.15.2 Open CASCADE kernel on 16 October 2026: sphere (radius 10 mm), torus (major radius 15 mm, minor radius 5 mm), cone (radius 10 mm, height 20 mm), and NURBS conversions of a sphere and cylinder (radius 10 mm, height 20 mm). These are synthetic geometry, not the user's failing 44 KB file.

The test imports and exports each through the actual browser Open CASCADE kernel and checks positive volume, finite tessellation and round-trip volume. The torus also exercises native preview, streaming upload and native tetrahedral meshing. NURBS mass integration is compared across round trips rather than assuming analytic primitive volume after conversion.
