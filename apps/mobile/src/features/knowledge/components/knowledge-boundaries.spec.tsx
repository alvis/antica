import { expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { Linking } from 'react-native';

import { knowledgeCitationV2Schema } from '@antica/contracts';

import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';

import { CitationPanel } from './CitationPanel';
import { CitedClaim } from './CitedClaim';
import { citation, claim, hit, image } from './knowledge.spec.fixtures';
import { KnowledgeResultCard } from './KnowledgeResultCard';
import { RemoteImageReference } from './RemoteImageReference';

it('should distinguish rejected and pending drafts without presenting them as museum examples', async () => {
  for (const [reviewState, expected] of [
    ['rejected', 'Rejected'],
    ['pending', 'Pending review'],
  ] as const) {
    const view = await render(
      <LocaleProvider preferences={savedPreferences('en')}>
        <KnowledgeResultCard
          hit={{
            ...hit,
            kind: 'concept',
            status: 'draft',
            reviewState,
            fallback: false,
            excerpt: null,
          }}
          onOpen={jest.fn()}
        />
      </LocaleProvider>,
    );
    try {
      expect(screen.getByText(new RegExp(`Drafts.*${expected}`))).toBeTruthy();
      expect(screen.queryByText('Museum example')).toBeNull();
      expect(screen.queryByText(/Showing original/)).toBeNull();
    } finally {
      await view.unmount();
    }
  }
});

it('should show rejected claim review without a review timestamp', async () => {
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <CitedClaim
        claim={{ ...claim, review: { state: 'rejected' } }}
        citations={[]}
        original
        onCitation={jest.fn()}
      />
    </LocaleProvider>,
  );

  expect(screen.getByText(claim.originalText)).toBeTruthy();
  expect(screen.getByText(/Cited.*Rejected/)).toBeTruthy();
  expect(screen.queryByText(/Reviewed at/)).toBeNull();
});

it('should show a web section and an unlabelled printed page as exact citation locations', async () => {
  const web = knowledgeCitationV2Schema.parse({
    ...citation,
    locator: {
      kind: 'web',
      id: citation.locator.id,
      sourceId: citation.source.id,
      sourceVersionId: citation.source.versionId,
      url: 'https://museum.example/catalogue',
      retrievedAt: '2026-10-13T00:00:00.000Z',
      section: 'Catalogue note',
      excerpt: 'A catalogue note.',
    },
  });
  const webView = await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <CitationPanel citation={web} onClose={jest.fn()} restoreFocus={null} />
    </LocaleProvider>,
  );
  expect(screen.getByText(/Catalogue note/)).toBeTruthy();
  await webView.unmount();

  const page = knowledgeCitationV2Schema.parse({
    ...citation,
    locator: {
      kind: 'page',
      id: citation.locator.id,
      sourceId: citation.source.id,
      sourceVersionId: citation.source.versionId,
      pageId: citation.locator.id,
      pageIndex: 12,
      printedPageLabel: null,
      excerpt: 'Page excerpt',
    },
  });
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <CitationPanel citation={page} onClose={jest.fn()} restoreFocus={null} />
    </LocaleProvider>,
  );
  expect(screen.getByText(/Page 13/)).toBeTruthy();
});

it('should preserve the image caption and source action when a response has no image type', async () => {
  const fetchImage = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response('not an image', {
      headers: { 'content-type': 'text/plain' },
    }),
  );
  const open = jest
    .spyOn(Linking, 'openURL')
    .mockRejectedValueOnce(new Error('Offline'));
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <RemoteImageReference
        image={{
          ...image,
          width: undefined,
          height: undefined,
          observedRights: {
            observedAt: '2026-10-13T00:00:00.000Z',
            evidenceUrl: 'https://museum.example/rights',
            statement: 'Public domain',
          },
        }}
        caption="Museum chair"
        nearViewport
      />
    </LocaleProvider>,
  );

  await waitFor(() =>
    expect(
      screen.getByTestId(`knowledge-image-error-${image.id}`),
    ).toBeTruthy(),
  );
  expect(screen.getByText('Museum chair')).toBeTruthy();
  expect(screen.getByText(/Public domain/)).toBeTruthy();
  await fireEvent.press(
    screen.getByTestId(`knowledge-image-source-${image.id}`),
  );
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(open).toHaveBeenCalledWith(image.sourcePageUrl);
  fetchImage.mockRestore();
  open.mockRestore();
});

it('should replace a decoded image with a recoverable error when native decoding fails', async () => {
  const fetchImage = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      new Response('PNG!', { headers: { 'content-type': 'image/png' } }),
    );
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <RemoteImageReference image={image} caption="Museum chair" nearViewport />
    </LocaleProvider>,
  );

  const decoded = await screen.findByLabelText(
    /Museum chair.*Cleveland Museum of Art/,
  );
  await fireEvent(decoded, 'error');
  await waitFor(() =>
    expect(
      screen.getByTestId(`knowledge-image-error-${image.id}`),
    ).toBeTruthy(),
  );
  expect(screen.getByTestId(`knowledge-image-retry-${image.id}`)).toBeTruthy();
  fetchImage.mockRestore();
});
