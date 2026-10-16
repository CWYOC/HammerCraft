// Text STEP only. The kernel performs the actual geometry validation in a worker.
// Decimal GB, matching the displayed upload limit. Large sources stream to disk.
export const MAX_STEP_BYTES = 1_500_000_000;
export const MAX_INLINE_STEP_BYTES = 1024 * 1024;
export function validateSTEPFileSize(size) {
  if(!Number.isSafeInteger(size)||size<=0||size>MAX_STEP_BYTES)throw Error('STEP uploads must be no larger than 1.5 GB (1,500,000,000 bytes).');
  return size;
}
export function validateSTEPAsset(value) {
  if(!value||typeof value.sha256!=='string'||!/^([a-f0-9]{64})$/.test(value.sha256))throw Error('Invalid STEP asset identity.');
  return {sha256:value.sha256,bytes:validateSTEPFileSize(value.bytes)};
}
export const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
export function validateSTEPText(value) {
  if (
    typeof value !== "string" ||
    value.length > MAX_INLINE_STEP_BYTES ||
    new TextEncoder().encode(value).length > MAX_INLINE_STEP_BYTES
  )
    throw Error(
      "Embedded STEP text must be at most 1 MiB. Use Import STEP for files up to 1.5 GB; larger sources are stored by the local compute service.",
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
