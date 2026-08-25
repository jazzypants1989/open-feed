// A rule the example has just proven. Call it AFTER the assertion: a failed assertion exits the
// script before the line is printed, and tools/spec.js assembles the spec from these lines only.
export const rule = (section, text) =>
  console.log(text.trim().split('\n').map((l, i) => `¶ ${i ? '+' : `§${section}`} ${l}`).join('\n'));
