// Text STEP only. The kernel performs the actual geometry validation in a worker.
export const MAX_STEP_BYTES = 1024 * 1024;
export const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
export function validateSTEPText(value) {
  if (
    typeof value !== "string" ||
    value.length > MAX_STEP_BYTES ||
    new TextEncoder().encode(value).length > MAX_STEP_BYTES
  )
    throw Error(
      "STEP files must be text files no larger than 1 MiB in this release.",
    );
  if (
    !/^\uFEFF?\s*ISO-10303-21\s*;/i.test(value) ||
    !/END-ISO-10303-21\s*;\s*$/i.test(value) ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
  )
    throw Error(
      "Choose a complete text STEP (.step or .stp) file. Binary, compressed and truncated files are not supported.",
    );
  return value;
}
