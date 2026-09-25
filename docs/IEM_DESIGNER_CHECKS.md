# IEM designer workflow fixes

## Problems corrected

- Driver name, gain, sensitivity and other form edits could revert when adding an acoustic element or otherwise redrawing driver cards. Inputs now update the model immediately and invalidate stale simulation results.
- Saved projects omitted output-load, environment, display, reverse-search and CAD settings. Projects now save these settings, show save/load feedback, and restore defaults for older files. New projects reset simulation settings and discard old results.
- Drivers without measured FR ignored sensitivity in the WASM path. The request now supplies a flat sensitivity baseline, matching the JavaScript fallback.
- The JavaScript fallback ignored uploaded response phase when summing drivers. Imported phase now contributes to the sum. The fallback status identifies its approximate acoustic model.
- Applying zero-damper reverse candidates could leave additional dampers behind. Legacy low-pass filters included in the candidate score could disappear on application. Applied designs now preserve the scored filter chain and remove all dampers when the candidate requires zero damping.
- Reverse results referred to driver array positions and could modify a replacement driver or apply results after the target/design changed. Results now carry driver identity and a context signature; obsolete results require a fresh search.
- Invalid tube dimensions, impedances, response filters, load settings and reverse-search constraints could reach the engine and be silently clamped. They now produce actionable input errors.
- Invalid imports could erase existing response data. Imports now validate numeric data before replacing it, deduplicate frequencies, preserve existing data on failure, and report errors. A user FR upload also clears database-specific reference compensation and uses its own phase.
- A delayed engine-version lookup could overwrite newer circuit diagnostics. It now checks the calculation revision before updating status.
- Local-library corruption and database exceptions could leave the library unusable without explanation. These errors are displayed while existing stored data is retained.
- A failed WASM initialization permanently cached a rejected promise. Subsequent calculations can retry initialization.

## Verification

```sh
node --disable-warning=ExperimentalWarning --test tests/*.test.mjs
```

`tests/designer-workflows.test.mjs` exercises the workflow regressions, including the shipped WASM binary. Existing circuit, frontend and payment regression tests also run with this command.

Browser checks use local database fixtures and the actual WASM engine. Verified workflows include editing and redrawing driver cards, wiring and calculating, save/new/load, rejecting invalid dimensions, rejecting stale reverse results, applying fresh candidates, loading the database library, and passing reference validation for a fixture with matching measurement geometry.

These checks do not verify live Supabase data or deploy the changes.
