/** Project-name validation for the confined project factory. */

/** Characters a Windows directory segment must never carry, plus C0/C1 controls. */
const INVALID_SEGMENT = /[/\\<>*?:"|\u0000-\u001f\u007f-\u009f]/

/** Device names Windows reserves in every spelling. */
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Edge dots and spaces Windows silently strips from a directory segment. */
const STRIPPED_EDGE = /^[.\s]|[.\s]$/

/**
 * Whether `name` is one safe directory segment under the project base.
 * @param name - user-supplied project name.
 * @returns whether the name can become exactly one directory segment.
 */
export function isValidProjectName(name: string): boolean {
  if (name.length < 1 || name.length > 64) return false
  if (name === '.' || name === '..') return false
  if (STRIPPED_EDGE.test(name)) return false
  if (INVALID_SEGMENT.test(name)) return false
  if (RESERVED_DEVICE.test(name)) return false
  return true
}
