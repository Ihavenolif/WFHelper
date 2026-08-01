// Shared push/PR range so the commit and comment gates cover the same commits.

export function resolveRange(env = process.env) {
  const baseRef = env.BASE_REF?.trim();
  if (baseRef) {
    return { base: `origin/${baseRef}`, head: "HEAD", symmetric: true, fallbackToHead: false };
  }

  const before = env.BEFORE_SHA?.trim();
  if (before && !/^0+$/.test(before)) {
    return { base: before, head: "HEAD", symmetric: false, fallbackToHead: false };
  }

  const defaultBranch = env.DEFAULT_BRANCH?.trim();
  if (defaultBranch) {
    return {
      base: `origin/${defaultBranch}`,
      head: "HEAD",
      symmetric: true,
      fallbackToHead: true,
    };
  }

  return { base: null, head: "HEAD", symmetric: false, fallbackToHead: true };
}
