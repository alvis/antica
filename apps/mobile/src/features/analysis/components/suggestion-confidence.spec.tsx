import { expect, it, jest } from '@jest/globals';
import { screen } from '@testing-library/react-native';

import { renderMobile, savedLanguage } from '../../../mobile.spec.fixtures';

import { SuggestionConfidence } from './SuggestionConfidence';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

it.each([
  { confidence: 'high', label: '信心高' },
  { confidence: 'medium', label: '信心中' },
  { confidence: 'low', label: '信心低' },
] as const)(
  'should show the reported $confidence confidence in Traditional Chinese',
  async ({ confidence, label }) => {
    await renderMobile(
      <SuggestionConfidence confidence={confidence} />,
      {},
      savedLanguage('zh-Hant'),
    );

    expect(screen.getByText(label)).toBeVisible();
  },
);

it('should leave confidence absent when the proposal does not supply it', async () => {
  await renderMobile(<SuggestionConfidence />, {});

  expect(screen.queryByText(/confidence/i)).toBeNull();
});
