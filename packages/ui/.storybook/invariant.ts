/**
 * Enforces an Expo runtime assumption in the browser story environment.
 * @param condition Value expected to be truthy.
 * @param format Optional message with percent-s placeholders.
 * @param substitutions Values inserted into the message placeholders.
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
