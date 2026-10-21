import { useLocale } from '../../../providers/LocaleProvider';

import { claimText } from '../api/knowledge';

import { useKnowledgeEntry } from './useKnowledgeEntry';

import type { KnowledgeContentEnvelopeV2 } from '@antica/contracts';

import type { LocaleState } from '../../../providers/LocaleProvider';

type KnowledgeImage = KnowledgeContentEnvelopeV2['images'][number];
type KnowledgeClaim = KnowledgeContentEnvelopeV2['claims'][number];

/** a claim a card quotes, with its footnote number */
export interface QuotedClaim {
  /** the claim in the interface language, else its original */
  readonly text: string;
  /** the claim's position among the entry's claims, counted from one */
  readonly number: number;
}

/** what a card needs from an entry beyond its related-card summary */
export interface KnowledgePreview {
  /** the entry's photo the device can show, once the revision is read */
  readonly image?: KnowledgeImage;
  /** museum and licence line for that image */
  readonly credit?: string;
  /** how many claims the entry makes, each with its source */
  readonly claimCount?: number;
  /** the claim the card quotes: what to look for on the object, once the revision is read */
  readonly quote?: QuotedClaim;
}

/** message keys naming the corpus providers; an unknown provider shows its own id */
const providerNameKeys = {
  aic: 'knowledgeProviderAic',
  cleveland: 'knowledgeProviderCleveland',
  met: 'knowledgeProviderMet',
  wikidata: 'knowledgeProviderWikidata',
} as const;

// the image decoders on both platforms read these; museums also publish TIFF masters
const decodable = /\.(?:jpe?g|png|webp)(?:[?#]|$)/iu;
// museums name their renditions: a strip card fits the screen-sized one, a full-width card needs
// the print-sized one (Cleveland's web rendition is 900 px, the Met's web-large 600 px)
const screenRendition = /[_-](?:web|screen|thumb)(?![a-z-])/iu;
const largeRendition = /[_-](?:print|large)/iu;
const renditionRanks = {
  card: [screenRendition, largeRendition],
  wide: [largeRendition, screenRendition],
} as const;
// an alternate view, such as Cleveland's 1957.40_alt0; the main view comes first
const alternateView = /_alt\d+/iu;
// the rendition markers a file name carries, so renditions of one view share a key
const renditionSuffix = /[_-](?:web|screen|thumb|print|large|full|original)$/iu;

/** the width a card gives its photo */
export type CardPhotoSize = keyof typeof renditionRanks;

/**
 * reads the pinned revision of an entry for its photo, credit, claim count and quoted claim
 * @param entryId entry identity
 * @param revision the revision the related card pinned
 * @param claimKey the claim the related card excerpted, quoted when the entry describes no features
 * @param size the width the card gives its photo
 * @returns the preview, filled in once the revision is read
 */
export function useKnowledgePreview(
  entryId: string,
  revision: number,
  claimKey?: string,
  size: CardPhotoSize = 'card',
): KnowledgePreview {
  const { locale, t } = useLocale();
  const { detail } = useKnowledgeEntry(entryId, 'revision', revision);
  const content = detail.data?.content;
  const image = content && pickCardImage(content.images, size);
  const claims = content?.claims ?? [];
  const quoted = pickQuotedClaim(claims, claimKey);

  return {
    image,
    credit: image && creditLine(image, t),
    claimCount: content?.claims.length,
    quote: quoted && {
      text: claimText(quoted, locale, false).text,
      number: claims.indexOf(quoted) + 1,
    },
  };
}

/**
 * picks the claim a card quotes: a cited physical feature first, since it tells the collector what
 * to look for on their object; else the claim the related card excerpted; else the first cited one
 * @param claims the entry's claims in footnote order
 * @param claimKey the claim the related card excerpted, if any
 * @returns the claim, or undefined when none is cited
 */
export function pickQuotedClaim(
  claims: readonly KnowledgeClaim[],
  claimKey?: string,
): KnowledgeClaim | undefined {
  const cited = claims.filter((claim) => claim.supportState === 'cited');

  return (
    cited.find((claim) => claim.section === 'features') ??
    cited.find((claim) => claim.claimKey === claimKey) ??
    cited.at(0)
  );
}

/**
 * names the view an image shows, the same for every rendition of it, so cards can avoid repeating
 * a photo: 1957.40_web and 1957.40_print are one view, 1957.40_alt0_web another
 * @param image an entry image
 * @returns the view's key
 */
export function photoKey(image: KnowledgeImage): string {
  const name = image.imageUrl.split(/[?#]/u)[0]?.split('/').at(-1) ?? '';

  return name
    .replace(/\.[^.]+$/u, '')
    .replace(renditionSuffix, '')
    .toLowerCase();
}

/**
 * picks the image a card shows: a rendition the device decodes, sized for the card, the main view
 * before alternates, and none of the views another card already shows
 * @param images the entry's images
 * @param size the width the card gives its photo
 * @param avoid views other cards already show
 * @returns the chosen image, or nothing when none can be shown
 */
export function pickCardImage(
  images: readonly KnowledgeImage[],
  size: CardPhotoSize = 'card',
  avoid: ReadonlySet<string> = new Set(),
): KnowledgeImage | undefined {
  const shown = images.filter(
    (image) =>
      image.status !== 'removed' &&
      decodable.test(image.imageUrl) &&
      !avoid.has(photoKey(image)),
  );
  const ranks = renditionRanks[size];
  const rank = (image: KnowledgeImage): number => {
    const index = ranks.findIndex((pattern) => pattern.test(image.imageUrl));

    return (
      (alternateView.test(image.imageUrl) ? ranks.length + 1 : 0) +
      (index < 0 ? ranks.length : index)
    );
  };

  return [...shown].sort((left, right) => rank(left) - rank(right))[0];
}

/**
 * picks one image per card for a row of cards, so no two cards show the same view
 * @param imageLists each card's images, undefined while its entry loads
 * @returns each card's image, in card order
 */
export function distinctCardImages(
  imageLists: ReadonlyArray<readonly KnowledgeImage[] | undefined>,
): Array<KnowledgeImage | undefined> {
  const used = new Set<string>();

  return imageLists.map((images) => {
    const image = images && pickCardImage(images, 'card', used);
    if (image) {
      used.add(photoKey(image));
    }

    return image;
  });
}

/**
 * names a corpus provider in the interface language
 * @param provider the provider's id, such as met
 * @param t translator
 * @returns the museum's name, else the id itself
 */
export function providerName(provider: string, t: LocaleState['t']): string {
  return provider in providerNameKeys
    ? t(providerNameKeys[provider as keyof typeof providerNameKeys])
    : provider;
}

/**
 * names who holds the image and under what terms, such as 圖：克里夫蘭藝術博物館 · 開放館藏
 * @param image the shown image
 * @param t translator
 * @returns the credit line
 */
function creditLine(image: KnowledgeImage, t: LocaleState['t']): string {
  const rights = image.observedRights;
  const provider = providerName(image.provider, t);

  return t('knowledgePhotoCredit', {
    holder: rights?.holder ?? rights?.attribution ?? provider,
    rights: rights?.name ?? t('knowledgeOpenCollection'),
  });
}
