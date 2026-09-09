# Hammer Craft IEM Designer v0.14

Adds reverse-design support for driver measurements around real SPL levels (for example ~80 dB SPL).

## Reverse graph changes
- Absolute SPL is the default reverse-match mode.
- Relative / normalised matching is still available and uses the selected normalisation frequency.
- Default absolute reverse viewport is 60–100 dB SPL.
- Mouse wheel over the reverse graph pans the visible Y range without modifying target data.
- Shift + mouse wheel pans by 10 dB per step.
- Explicit View Min / View Max controls are available.
- +10 dB / -10 dB viewport buttons are available.
- Auto Fit derives a sensible display range from imported TXT/CSV/FRD data.
- Reset View restores 60–100 dB in absolute mode or -30–20 dB in relative mode.
- Imported target data automatically switches reverse mode to Absolute SPL and auto-fits the graph.

## Rust reverse optimiser
`ReverseDesignRequest` now includes `absolute_match`.
- `absolute_match: true` compares candidate output directly against target SPL values.
- `absolute_match: false` compares normalised response shapes at `normalization_frequency_hz`.

Graph panning is display-only and never changes values sent to Rust.
