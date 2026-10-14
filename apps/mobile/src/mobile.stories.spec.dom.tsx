import { composeStories } from '@storybook/react-native-web-vite';
import { userEvent, waitFor, within } from '@storybook/testing-library';

import { describe, expect, it, vi } from 'vitest';

import { expect as expectDom } from 'storybook/test';

import { useAuth } from './auth';
import * as analysisStories from './features/analysis/AnalysisContainer.stories';
import * as captureStories from './features/capture/CaptureContainer.stories';
import * as recordStories from './features/collection/RecordContainer.stories';
import {
  MobileStoryShell,
  storyRecord,
  storyRunId,
} from './mobile.stories.fixtures';
import { findStoryElement, findStoryText } from './mobile.stories.helpers';
import { withCanvas } from './mobile.stories.spec.dom.helpers';

import type { ReactElement } from 'react';

const analysis = composeStories(analysisStories);
const capture = composeStories(captureStories);
const record = composeStories(recordStories);
const successStatus = 200;
const missingFixtureStatus = 501;
const pendingObservationDelay = 25;

/**
 * exposes session state and sign-out through the real story auth provider
 * @returns a minimal rendered consumer of the public auth context
 */
function StorySessionConsumer(): ReactElement {
  const { authenticated, signOut } = useAuth();

  return (
    <>
      <output>{authenticated ? 'Signed in' : 'Signed out'}</output>
      <button onClick={() => void signOut()}>Sign out</button>
    </>
  );
}

describe('Mobile container story interactions', () => {
  it('should create a capture draft through the rendered single-item action', async () => {
    await withCanvas(<capture.ChooseCaptureMethod />, async (canvas) => {
      const play = capture.ChooseCaptureMethod.play;
      if (!play) {
        throw new Error('Capture story must expose its user interaction.');
      }

      await play({ canvasElement: canvas });

      expect(canvas.textContent).toContain('2 / 6');
      expect(canvas.textContent).toContain('POST /v1/records');
    });
  });

  it('should save an edited record through its rendered form', async () => {
    await withCanvas(<record.SavedRecord />, async (canvas) => {
      const play = record.SavedRecord.play;
      if (!play) {
        throw new Error('Record story must expose its user interaction.');
      }

      await play({ canvasElement: canvas });
      await findStoryText(canvas, 'Blue-and-white bowl, edited');

      expect(canvas.querySelector('input[aria-label="Name"]')).toBeNull();
      expect(canvas.textContent).toContain('Blue-and-white bowl, edited');
    });
  });

  it('should apply the selected analysis proposal through rendered controls', async () => {
    await withCanvas(<analysis.CompletedWithProposals />, async (canvas) => {
      const play = analysis.CompletedWithProposals.play;
      if (!play) {
        throw new Error('Analysis story must expose its user interaction.');
      }

      await play({ canvasElement: canvas });

      await findStoryText(canvas, 'Apply selected changes (0)');

      expect(canvas.textContent).toContain('POST /v1/analyses/');
      expect(
        canvas.querySelectorAll('[role="checkbox"][aria-checked="true"]'),
      ).toHaveLength(0);
    });
  });
});

describe('Mobile story localized errors', () => {
  it('should show a draft creation error in Traditional Chinese', async () => {
    await withCanvas(
      <capture.DraftFailureInTraditionalChinese />,
      async (canvas) => {
        const play = capture.DraftFailureInTraditionalChinese.play;
        if (!play) {
          throw new Error('Failure story must expose its user interaction.');
        }

        await play({ canvasElement: canvas });

        expect(canvas.textContent).toContain('目前無法建立藏品草稿。');
        expect(canvas.textContent).toContain('1 / 6');
      },
    );
  });
});

describe('Mobile story persistent service failures', () => {
  it.each([
    {
      name: 'record',
      element: <record.OfflineInTraditionalChinese />,
      text: '請連線後重試。',
      endpoint: `GET /v1/records/${storyRecord.id}`,
    },
    {
      name: 'analysis',
      element: <analysis.FailedInTraditionalChinese />,
      text: '分析服務暫時無法使用。',
      endpoint: `GET /v1/analyses/${storyRunId}`,
    },
  ])(
    'should display the $name service failure in Traditional Chinese',
    async ({ element, text, endpoint }) => {
      await withCanvas(element, async (canvas) => {
        const scoped = within(canvas);
        const expectPrivateFailure = async (): Promise<void> => {
          await waitFor(async () => {
            await expectDom(scoped.getByRole('alert')).toHaveTextContent(/\S/);
            await expectDom(scoped.getByRole('alert')).toBeVisible();
            expect(scoped.queryByRole('progressbar')).toBeNull();
            await expectDom(
              scoped.getByRole('button', { name: '重試' }),
            ).toBeVisible();
            expect(scoped.queryByRole('button', { name: 'Retry' })).toBeNull();
            expect(canvas.textContent).not.toContain(text);
          });
        };
        await expectPrivateFailure();
        const activity = scoped.getByLabelText('Story network activity');
        const countOwningRequests = (): number =>
          activity.textContent
            .replace('Network activity: ', '')
            .split(' · ')
            .filter((key) => key === endpoint).length;
        const requestsBefore = countOwningRequests();

        await userEvent.click(scoped.getByRole('button', { name: '重試' }));
        await waitFor(() => {
          expect(countOwningRequests(), activity.textContent).toBe(
            requestsBefore + 1,
          );
        });
        await expectPrivateFailure();
      });
    },
  );
});

describe('Mobile story pending requests', () => {
  it.each([
    { name: 'record', element: <record.Loading /> },
    { name: 'analysis', element: <analysis.Loading /> },
  ])(
    'should retain the $name loading indicator during a delayed response',
    async ({ element }) => {
      await withCanvas(element, async (canvas) => {
        await findStoryText(canvas, 'Loading');
        await new Promise((resolve) =>
          setTimeout(resolve, pendingObservationDelay),
        );

        expect(canvas.querySelector('[role="progressbar"]')).not.toBeNull();
      });
    },
  );

  it('should keep draft creation pending during its delayed response', async () => {
    await withCanvas(<capture.CreatingDraft />, async (canvas) => {
      const play = capture.CreatingDraft.play;
      if (!play) {
        throw new Error('Pending story must expose its user interaction.');
      }

      await play({ canvasElement: canvas });

      await new Promise((resolve) =>
        setTimeout(resolve, pendingObservationDelay),
      );

      expect(canvas.textContent).toContain('1 / 6');
      expect(
        canvas
          .querySelector('[role="button"][aria-label="Single item"]')
          ?.getAttribute('aria-disabled'),
      ).toBe('true');
    });
  });
});

describe('rc:MobileStoryShell', () => {
  it('should route request bodies to fixture factories and expose missing endpoint failures', async () => {
    await withCanvas(
      <MobileStoryShell
        responses={{
          'POST /v1/echo': async (request) => ({
            received: await request.json(),
          }),
        }}>
        <div>Fixture consumer</div>
      </MobileStoryShell>,
      async (canvas) => {
        const response = await fetch(
          new Request('https://antica.test/v1/echo', {
            method: 'POST',
            body: JSON.stringify({ name: 'Edited bowl' }),
            headers: { 'Content-Type': 'application/json' },
          }),
        );
        const missing = await fetch('https://antica.test/v1/missing');
        const session = await fetch('https://antica.test/api/auth/get-session');
        await findStoryText(canvas, 'POST /v1/echo');
        await findStoryText(canvas, 'GET /v1/missing');

        expect(await response.json()).toEqual({
          received: { name: 'Edited bowl' },
        });
        expect(response.status).toBe(successStatus);
        expect(missing.status).toBe(missingFixtureStatus);
        expect(await missing.json()).toEqual({
          error: {
            code: 'STORY_FIXTURE_MISSING',
            message: 'No Storybook fixture is registered for GET /v1/missing.',
          },
        });
        expect(await session.json()).toEqual({ session: null, user: null });
        expect(canvas.textContent).not.toContain('/api/auth/');
      },
    );
  });
});

describe('Story transport lifecycle', () => {
  it('should resolve configured responses after a story network delay', async () => {
    await withCanvas(
      <MobileStoryShell
        responses={{ 'GET /v1/delayed': { ready: true } }}
        delayMs={10}>
        <div>Delayed consumer</div>
      </MobileStoryShell>,
      async (canvas) => {
        const response = await fetch('https://antica.test/v1/delayed');
        await findStoryText(canvas, 'GET /v1/delayed');

        expect(await response.json()).toEqual({ ready: true });
      },
    );
  });

  it('should preserve a transport replacement installed while the story is mounted', async () => {
    const original = globalThis.fetch;
    const replacement: typeof fetch = async (...args) => original(...args);
    vi.stubGlobal('fetch', original);

    await withCanvas(
      <MobileStoryShell responses={{}}>
        <div>Transport owner</div>
      </MobileStoryShell>,
      async () => {
        expect(globalThis.fetch).not.toBe(original);
        vi.stubGlobal('fetch', replacement);
      },
    );

    expect(globalThis.fetch).toBe(replacement);
  });
});

describe('Story authenticated session', () => {
  it('should initialize an authenticated story and clear the session on sign-out', async () => {
    await withCanvas(
      <MobileStoryShell responses={{}}>
        <StorySessionConsumer />
      </MobileStoryShell>,
      async (canvas) => {
        await findStoryText(canvas, 'Signed in');
        const signOut = await findStoryElement(canvas, 'button');

        signOut.click();
        await findStoryText(canvas, 'Signed out');

        expect(canvas.textContent).not.toContain('Signed in');
      },
    );
  });
});
