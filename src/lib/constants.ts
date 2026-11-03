/** Shared (server + client) constants. No "use client" here: server components import these too. */
export const BRANCH_COOKIE = "bf_branch";
export const STUDIO_TZ = "Asia/Qatar";
export const CURRENCY = "QAR";
/** All money is stored in minor units (dirham = 1/100 riyal). */
export const MINOR_PER_MAJOR = 100;
