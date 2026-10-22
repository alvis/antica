import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import { renderMobile, savedLanguage } from '../../../../mobile.spec.fixtures';

import { AnalysisThreadBlock } from './AnalysisThreadBlock';

jest.mock('../../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

it('should offer no empty suggestions link when analysis returns no proposals', async () => {
  const open = jest.fn();
  await renderMobile(
    <AnalysisThreadBlock
      phase="finished"
      photoUris={[]}
      photoCount={0}
      videoCount={0}
      suggestionCount={0}
      onOpenSuggestions={open}
    />,
    {},
  );

  expect(screen.getByText('Analysis done, with 0 suggestions.')).toBeVisible();
  expect(screen.queryByTestId('analysis-open-suggestions')).toBeNull();
  expect(open).not.toHaveBeenCalled();
});

it('should use the same total for completion and the working suggestions link', async () => {
  const open = jest.fn();
  await renderMobile(
    <AnalysisThreadBlock
      phase="finished"
      photoUris={[]}
      photoCount={0}
      videoCount={0}
      suggestionCount={6}
      onOpenSuggestions={open}
    />,
    {},
  );

  expect(screen.getByText('Analysis done, with 6 suggestions.')).toBeVisible();
  const link = screen.getByRole('link', { name: 'Review 6 suggestions' });
  await fireEvent.press(link);
  expect(open).toHaveBeenCalledTimes(1);
});

it.each(['queued', 'running'] as const)(
  'should show truthful %s progress',
  async (phase) => {
    await renderMobile(
      <AnalysisThreadBlock
        phase={phase}
        photoUris={[]}
        photoCount={6}
        videoCount={0}
        suggestionCount={0}
        onOpenSuggestions={jest.fn()}
      />,
      {},
      savedLanguage('zh-Hant'),
    );

    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({
      text: phase === 'queued' ? '排隊中' : '分析中',
    });
    if (phase === 'queued') {
      expect(
        screen.queryAllByTestId(/analysis-step-.*-(done|now)/),
      ).toHaveLength(0);
      expect(screen.getAllByTestId(/analysis-step-.*-todo/)).toHaveLength(3);
    } else {
      expect(screen.getByTestId('analysis-step-0-done')).toBeVisible();
      expect(screen.getByTestId('analysis-step-1-now')).toBeVisible();
      expect(screen.getByTestId('analysis-step-2-todo')).toBeVisible();
    }
  },
);
