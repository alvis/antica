export const assetId = '00000000-0000-4000-8000-000000000053';
export const detail = {
  source: {
    kind: 'book_pdf',
    metadata: {
      title: 'Historical catalog',
      authorStatus: 'unknown',
      contributors: [],
      editionStatement: null,
    },
  },
  version: { status: 'ready', originalAssetIds: [assetId] },
  pages: { items: [], nextCursor: null },
  referenceImages: [],
  knowledgeDraftIds: [],
  reads: [
    {
      assetOrDerivativeId: assetId,
      url: 'https://storage.example/expired.pdf',
    },
  ],
};

export const populatedDetail = {
  ...detail,
  source: {
    kind: 'book_pages',
    metadata: {
      title: 'Historical catalog',
      authorStatus: 'named',
      contributors: [{ nameAsPrinted: 'Jane Collector' }],
      editionStatement: 'Second edition',
    },
  },
  version: { status: 'partial', originalAssetIds: [] },
  pages: {
    items: [
      {
        id: 'page-one',
        pageIndex: 0,
        printedPageLabel: 'xii',
        view: { derivativeId: 'view-one' },
        quality: 'usable',
        presentation: {
          rotationQuarterTurns: 1,
          crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
        },
        rawText: 'Printed catalog prose',
      },
      {
        id: 'page-two',
        pageIndex: 1,
        printedPageLabel: null,
        view: { derivativeId: 'view-two' },
        quality: 'needs_review',
        presentation: { rotationQuarterTurns: 0, crop: null },
        rawText: '',
      },
      {
        id: 'page-three',
        pageIndex: 2,
        printedPageLabel: null,
        view: { derivativeId: 'unavailable-view' },
        quality: 'unusable',
        presentation: null,
        rawText: '',
      },
    ],
    nextCursor: 'page-next',
  },
  referenceImages: [
    {
      id: 'reference-one',
      storedDerivativeId: 'reference-view-one',
      originalCaption: { textAsPrinted: 'Printed vase caption' },
      generatedDescriptionZhHant: '花瓶圖例',
    },
    {
      id: 'reference-two',
      storedDerivativeId: 'reference-view-two',
      originalCaption: null,
      generatedDescriptionZhHant: null,
    },
  ],
  knowledgeDraftIds: ['00000000-0000-4000-8000-000000000061'],
  reads: [
    { assetOrDerivativeId: 'view-one', url: 'https://storage.example/one.jpg' },
    { assetOrDerivativeId: 'view-two', url: 'https://storage.example/two.jpg' },
    {
      assetOrDerivativeId: 'reference-view-one',
      url: 'https://storage.example/reference-one.jpg',
    },
    {
      assetOrDerivativeId: 'reference-view-two',
      url: 'https://storage.example/reference-two.jpg',
    },
  ],
};
