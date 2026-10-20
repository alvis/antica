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
import { citation, claim, hit, image, topic } from './knowledge.spec.fixtures';
import { KnowledgeResultCard } from './KnowledgeResultCard';
import { RemoteImageReference } from './RemoteImageReference';
import { TopicBrowse } from './TopicBrowse';

it('should show a museum example with its language fallback and open it explicitly', async () => {
  const open = jest.fn();
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <KnowledgeResultCard hit={hit} onOpen={open} />
    </LocaleProvider>,
  );

  await waitFor(() =>
    expect(screen.getByTestId(`knowledge-result-${hit.id}`)).toBeTruthy(),
  );
  expect(screen.getByText('Museum example')).toBeTruthy();
  expect(screen.getByText(/Showing original.*zh-Hant/)).toBeTruthy();
  expect(screen.getByText('The surface is dark.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'View' }));
  expect(open).toHaveBeenCalledTimes(1);
});

it('should expose category selection and original-language fallback as text and semantics', async () => {
  const select = jest.fn();
  const originalTopic = { ...topic, fallback: true, language: 'zh-Hant' };
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <TopicBrowse
        topics={[originalTopic]}
        selected={[topic.id]}
        onSelect={select}
        category
      />
    </LocaleProvider>,
  );

  const control = await screen.findByTestId(`knowledge-category-${topic.id}`);
  expect(control).toHaveProp('accessibilityState', { selected: true });
  expect(screen.getByText(/Showing original.*zh-Hant/)).toBeTruthy();
  await fireEvent.press(control);
  expect(select).toHaveBeenCalledWith(originalTopic);
});

it('should show claim scope, uncertainty and numbered citation before opening its panel', async () => {
  const openCitation = jest.fn();
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <CitedClaim
        claim={claim}
        citations={[citation]}
        original={false}
        onCitation={openCitation}
      />
    </LocaleProvider>,
  );

  await waitFor(() =>
    expect(
      screen.getByTestId(`knowledge-claim-${claim.claimKey}`),
    ).toBeTruthy(),
  );
  expect(screen.getByText('The huanghuali surface is dark.')).toBeTruthy();
  expect(screen.getByText(/A later finish may affect appearance/)).toBeTruthy();
  expect(screen.getByText(/Qing/)).toBeTruthy();
  await fireEvent.press(
    screen.getByTestId(`knowledge-citation-${claim.claimKey}-${citation.id}`),
  );
  expect(openCitation).toHaveBeenCalledWith(citation, expect.anything());
});

it('should keep the captured quote and exact field path in the citation panel', async () => {
  const close = jest.fn();
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <CitationPanel citation={citation} onClose={close} restoreFocus={null} />
    </LocaleProvider>,
  );

  await waitFor(() =>
    expect(
      screen.getByTestId(`knowledge-citation-panel-${citation.id}`),
    ).toBeTruthy(),
  );
  expect(screen.getByText('Museum object record')).toBeTruthy();
  expect(screen.getByText(citation.quote)).toBeTruthy();
  expect(screen.getByText(/\/description/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  expect(close).toHaveBeenCalledTimes(1);
});

it('should reserve the image area without downloading before it nears the viewport', async () => {
  const fetchImage = jest.spyOn(globalThis, 'fetch');
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <RemoteImageReference image={image} caption="Museum chair" />
    </LocaleProvider>,
  );

  await waitFor(() =>
    expect(screen.getByTestId(`knowledge-image-${image.id}`)).toBeTruthy(),
  );
  expect(
    screen.getByTestId(`knowledge-image-loading-${image.id}`),
  ).toBeTruthy();
  expect(screen.getByText('Museum chair')).toBeTruthy();
  expect(screen.getByText('Rights not recorded')).toBeTruthy();
  expect(fetchImage).not.toHaveBeenCalled();
});

it('should offer retry and source access when a remote image fails', async () => {
  const fetchImage = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response('', { status: 404 }));
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <RemoteImageReference image={image} caption="Museum chair" nearViewport />
    </LocaleProvider>,
  );

  await waitFor(() =>
    expect(
      screen.getByTestId(`knowledge-image-error-${image.id}`),
    ).toBeTruthy(),
  );
  expect(screen.getByText('Museum chair')).toBeTruthy();
  expect(screen.getByTestId(`knowledge-image-source-${image.id}`)).toBeTruthy();
  await fireEvent.press(
    screen.getByTestId(`knowledge-image-retry-${image.id}`),
  );
  await waitFor(() => expect(fetchImage.mock.calls.length).toBeGreaterThan(1));
});

it('should display a reviewed claim without an original-language fallback', async () => {
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <CitedClaim
        claim={claim}
        citations={[]}
        original={false}
        onCitation={jest.fn()}
      />
    </LocaleProvider>,
  );

  expect(screen.getByText('The huanghuali surface is dark.')).toBeTruthy();
  expect(screen.queryByText(/Showing original/)).toBeNull();
  expect(
    screen.queryByTestId(`knowledge-citation-${claim.claimKey}-${citation.id}`),
  ).toBeNull();
});

it('should label unsupported draft claims and their original-language fallback', async () => {
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <CitedClaim
        claim={{
          ...claim,
          supportState: 'needs_source',
          citationIds: [],
          variants: [],
          review: { state: 'pending' },
          scope: {},
          qualifiers: {},
          uncertainty: undefined,
        }}
        citations={[]}
        original={false}
        onCitation={jest.fn()}
      />
    </LocaleProvider>,
  );

  expect(screen.getByText(claim.originalText)).toBeTruthy();
  expect(screen.getByText(/Showing original.*zh-Hant/)).toBeTruthy();
  expect(screen.getByText(/Source needed.*Pending review/)).toBeTruthy();
});

it('should show a printed page locator and keep the captured quote when no source URL exists', async () => {
  const pageCitation = knowledgeCitationV2Schema.parse({
    ...citation,
    locator: {
      kind: 'page',
      id: citation.locator.id,
      sourceId: citation.source.id,
      sourceVersionId: citation.source.versionId,
      pageId: citation.locator.id,
      pageIndex: 12,
      printedPageLabel: 'xiii',
      excerpt: 'Printed page excerpt',
    },
    source: { ...citation.source, canonicalUrl: undefined },
  });
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <CitationPanel
        citation={pageCitation}
        onClose={jest.fn()}
        restoreFocus={null}
      />
    </LocaleProvider>,
  );

  expect(screen.getByText(/xiii/)).toBeTruthy();
  expect(screen.getByText(pageCitation.quote)).toBeTruthy();
  expect(
    screen.queryByTestId(`knowledge-source-open-${pageCitation.id}`),
  ).toBeNull();
});

it('should report a failed source-page action while preserving citation evidence', async () => {
  const open = jest
    .spyOn(Linking, 'openURL')
    .mockRejectedValueOnce(new Error('Offline'));
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <CitationPanel
        citation={citation}
        onClose={jest.fn()}
        restoreFocus={null}
      />
    </LocaleProvider>,
  );

  await fireEvent.press(
    screen.getByTestId(`knowledge-source-open-${citation.id}`),
  );
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.getByText(citation.quote)).toBeTruthy();
  expect(open).toHaveBeenCalledWith(citation.source.canonicalUrl);
  open.mockRestore();
});

it('should display a contained in-memory image after a successful near-viewport read', async () => {
  const fetchImage = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response('PNG!', {
      headers: { 'content-type': 'image/png' },
    }),
  );
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <RemoteImageReference image={image} caption="Museum chair" nearViewport />
    </LocaleProvider>,
  );

  await waitFor(() =>
    expect(
      screen.getByLabelText(/Museum chair.*Cleveland Museum of Art/),
    ).toBeTruthy(),
  );
  expect(fetchImage).toHaveBeenCalledWith(
    image.imageUrl,
    expect.objectContaining({ cache: 'no-store', credentials: 'omit' }),
  );
  expect(
    screen.getByLabelText(/Museum chair.*Cleveland Museum of Art/),
  ).toHaveProp(
    'source',
    expect.objectContaining({ uri: 'data:image/png;base64,UE5HIQ==' }),
  );
});
