import { describe, expect, it } from 'vitest';

import { runRelevanceCommand } from './relevance.js';

describe('fn:runRelevanceCommand', () => {
  it(
    'should install and save the real corpus and measure all unchanged questions',
    { timeout: 300_000 },
    async () => {
      const reports: string[] = [];
      const errors: string[] = [];
      const status = await runRelevanceCommand({
        stdout: (text) => {
          reports.push(text);
        },
        stderr: (text) => {
          errors.push(text);
        },
      });
      expect(errors).toEqual([]);
      expect(status).toBe(0);
      expect(reports).toHaveLength(1);
      expect(JSON.parse(reports[0]!)).toMatchObject({
        provisional: true,
        installed: 56,
        saved: 56,
        overall: {
          questions: 20,
          supportedQuestions: 20,
          noSupportQuestions: 0,
        },
      });
    },
  );
});
