/**
 * enforces an Expo runtime assumption in the browser story environment
 * @param condition value expected to be truthy
 * @param format optional message with percent-s placeholders
 * @param substitutions values inserted into the message placeholders
 * @throws {Error} when the condition is falsy
 */
export default function invariant(
  condition: unknown,
  format?: string,
  ...substitutions: unknown[]
): asserts condition {
  if (condition) {
    return;
  }

  let substitutionIndex = 0;
  const message = (format ?? 'Invariant violation').replace(/%s/g, () =>
    String(substitutions[substitutionIndex++]),
  );
  const error = new Error(message) as Error & { framesToPop: number };
  error.name = 'Invariant Violation';
  error.framesToPop = 1;
  throw error;
}
