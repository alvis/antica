import { getItemAsync, setItemAsync } from 'expo-secure-store';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import type { FC, PropsWithChildren } from 'react';

export type Locale = 'en' | 'zh-Hant';

const messages = {
  welcome: [
    'A private place for every piece of evidence',
    '讓每一項判斷，都能回到看得見的證據',
  ],
  privateCollection: [
    'Your private collection and research',
    '您的私人藏品與研究',
  ],
  whatsappLogin: ['Sign in with WhatsApp', '使用 WhatsApp 登入'],
  authorizedPhone: ['Authorized phone number', '已核准的電話號碼'],
  continue: ['Continue', '繼續'],
  sentTo: ['Code sent to', '驗證碼已傳送至'],
  code: ['Six-digit code', '六位數驗證碼'],
  verify: ['Verify code', '驗證驗證碼'],
  verifying: ['Verifying…', '驗證中…'],
  resend: ['Resend code', '重發驗證碼'],
  expired: [
    'This code has expired. Request a new code.',
    '驗證碼已過期。請索取新驗證碼。',
  ],
  collection: ['Collection', '藏品'],
  tasks: ['Tasks', '待辦'],
  knowledge: ['Knowledge', '知識庫'],
  research: ['Research', '研究'],
  settings: ['Settings', '設定'],
  addItem: ['Add item', '新增藏品'],
  noItems: [
    'Your collection is empty. Add an item to begin.',
    '藏品庫目前沒有資料。新增藏品即可開始。',
  ],
  capture: ['Capture', '拍攝'],
  import: ['Import file', '匯入檔案'],
  addText: ['Add text', '加入文字'],
  single: ['Single item', '單件'],
  set: ['Set', '整套'],
  photo: ['Photo', '照片'],
  video: ['Video', '影片'],
  audio: ['Voice note', '語音筆記'],
  importAudio: ['Import audio', '匯入音訊'],
  component: ['Component label', '部件標籤'],
  name: ['Name', '名稱'],
  type: ['Object type', '器類'],
  typeTag: ['Object type tag', '器類標籤'],
  description: ['Description', '描述'],
  originalWords: ['Original words', '原話'],
  originalTranscript: ['Original transcript', '原始轉寫'],
  confirmOriginalWords: [
    'Confirm the original words before saving.',
    '儲存前請確認原話。',
  ],
  confirmWords: ['Confirm original words', '確認原話'],
  confirmedWords: ['Original words confirmed', '原話已確認'],
  selectProposal: ['Select proposal', '選取建議'],
  selectedProposal: ['Proposal selected', '已選取建議'],
  preparedDescription: ['Prepared description', '整理後描述'],
  adoptDescription: ['Adopt description', '採用描述'],
  height: ['Height', '高度'],
  unit: ['Unit', '單位'],
  location: ['Location', '位置'],
  locationDetail: ['Detailed location', '詳細位置'],
  receipt: ['Purchase receipt', '購買憑證'],
  save: ['Save', '儲存'],
  saved: ['Saved', '已保存'],
  notAnalyzed: ['Not analyzed', '尚未分析'],
  analyze: ['Analyze', '分析'],
  analyzeAgain: ['Analyze again', '再次分析'],
  newEvidence: ['New evidence not analyzed', '新證據尚未分析'],
  processing: ['Processing', '處理中'],
  partial: ['Partially complete', '部分完成'],
  photoClues: ['Photo clues', '照片線索'],
  collectorObservations: ['Collector observations', '收藏家觀察'],
  sourceClaims: ['Source claims', '來源說法'],
  hypothesesPendingResearch: ['Hypotheses pending research', '待研究假說'],
  checks: ['Checks', '實查'],
  present: ['Present', '有'],
  absent: ['Absent', '沒有'],
  unable: ['Unable to determine', '無法判定'],
  reason: ['Reason', '原因'],
  addEvidence: ['Add evidence', '補充證據'],
  evidence: ['Evidence', '證據'],
  observation: ['Observation', '觀察'],
  citation: ['Citation', '引文'],
  observed: ['Observed', '直接觀察'],
  reported: ['Reported', '轉述'],
  tentative: ['Tentative', '暫定'],
  undetermined: ['Undetermined', '未判定'],
  supports: ['Supports', '支持'],
  contradicts: ['Contradicts', '相矛盾'],
  context: ['Context', '背景資訊'],
  proposal: ['Proposed changes', '建議修改'],
  previous: ['Previous', '目前內容'],
  proposed: ['Proposed', '建議內容'],
  applySelected: ['Apply selected changes', '套用所選變更'],
  conflict: [
    'The item changed. Review the latest revision before applying.',
    '藏品已有變更。請檢視最新版本後再套用。',
  ],
  imageSearch: ['Find similar images', '搜尋相似圖片'],
  references: ['Collected references', '已收錄參考圖'],
  myCollection: ['My collection', '我的藏品'],
  fullImage: ['Full image', '全圖'],
  selectRegion: ['Select region', '選取區域'],
  search: ['Search', '搜尋'],
  compare: ['Compare', '比較'],
  similarity: ['Similarities', '相似處'],
  differences: ['Differences', '差異'],
  viewSource: ['View source', '查看來源'],
  addReference: ['Add reference', '加入參考'],
  sourceNeedsReview: ['Source needs review', '來源待核對'],
  sources: ['Sources', '來源'],
  importBook: ['Import book or page', '匯入書籍或書頁'],
  bookTitle: ['Book title', '書名'],
  author: ['Author', '作者'],
  unknownAuthor: ['Unknown author', '作者不詳'],
  edition: ['Edition', '版本'],
  printedPage: ['Printed page', '印刷頁碼'],
  pageOrder: ['Page order', '書頁順序'],
  knowledgeDraft: ['Knowledge draft', '知識草稿'],
  history: ['History', '歷史背景'],
  scope: ['Scope', '適用範圍'],
  methods: ['Inspection methods', '檢查方法'],
  examples: ['Reference examples', '參考例圖'],
  newResearch: ['New research', '新增研究'],
  question: ['Research question', '研究問題'],
  curatedOnly: ['Collected sources only', '僅查已收錄來源'],
  curatedWeb: ['Collected sources and public web', '已收錄來源與公開網路'],
  startResearch: ['Start research', '開始研究'],
  citations: ['Citations', '引用'],
  saveNote: ['Save note', '儲存筆記'],
  language: ['Language', '語言'],
  session: ['Session', '登入狀態'],
  signOut: ['Sign out', '登出'],
  loading: ['Loading…', '載入中…'],
  retry: ['Retry', '重試'],
  empty: ['Nothing here yet.', '目前沒有資料。'],
  all: ['All', '全部'],
  more: ['More', '更多'],
  previousPage: ['Previous page', '上一頁'],
  filters: ['Filters', '篩選'],
  material: ['Material', '材質'],
  period: ['Period', '年代'],
  tags: ['Tags', '標籤'],
  collectorJudgment: ['Collector judgment', '收藏家判斷'],
  pendingChecks: ['Pending checks', '待完成實查'],
  sort: ['Sort', '排序'],
  recent: ['Recently updated', '最近更新'],
  itemCode: ['Item code', '藏品編號'],
  clearFilters: ['Clear filters', '清除篩選'],
  unnamed: ['Unnamed item', '未命名藏品'],
  unknown: ['Unknown', '未知'],
  edit: ['Edit', '編輯'],
  results: ['Results', '結果'],
  analysisFailed: [
    'Analysis could not finish. Review this item and choose Analyze again when ready.',
    '分析未能完成。請檢視此藏品，準備好後再選擇「再次分析」。',
  ],
  reviewItem: ['Review item', '檢視藏品'],
  version: ['Input version', '輸入版本'],
  jobResumes: [
    'This job continues if you close the app. Return here for its saved result.',
    '關閉 App 後工作仍會繼續。您可返回查看已保存的結果。',
  ],
  summary: ['Summary', '摘要'],
  uncertainties: ['Uncertainties', '待釐清事項'],
  supplied: ['Evidence supplied', '已補充證據'],
  dismiss: ['Dismiss action', '略過待辦'],
  reasonRequired: [
    'Add a description or reason first.',
    '請先輸入描述或原因。',
  ],
  view: ['View', '查看'],
  rank: ['Match rank', '相似排序'],
  rotate: ['Rotate preview', '旋轉預覽'],
  publisher: ['Publisher', '出版社'],
  originalImage: ['Original image', '原始圖片'],
  openOriginalPdf: ['Open original PDF', '開啟原始 PDF'],
  preparedPreview: ['Crop and rotation preview', '裁切及旋轉預覽'],
  transcribe: ['Transcribe voice note', '語音轉寫'],
  prepareDescription: ['Prepare description', '整理描述'],
  chooseItemForSearch: [
    'Open an item and choose one of its photos to search.',
    '開啟藏品並選擇相片開始搜尋。',
  ],
  researchDescription: [
    'Ask a question and choose which sources may be searched.',
    '提出問題並選擇可檢索的來源範圍。',
  ],
  originalLanguage: [
    'Your question is kept in its original language.',
    '您的問題會保留原始語言。',
  ],
  namedAuthors: ['Prefer named authors', '優先列出具名作者'],
  notChecked: ['Not checked', '尚未實查'],
  methodUpdated: [
    'A newer method is available. This check retains its original method.',
    '已有新版方法。本次實查仍保留原方法。',
  ],
  startCheck: ['Start check', '開始實查'],
  viewMethod: ['View method', '查看方法'],
  error: ['Something went wrong.', '發生錯誤。'],
  offline: ['Connect to the internet and retry.', '請連線後重試。'],
  uploadFailed: [
    'This file did not upload. Retry this file.',
    '這個檔案尚未上傳。請重試此檔案。',
  ],
  photoRequired: [
    'Add and upload at least one object photo.',
    '請新增並上傳至少一張藏品照片。',
  ],
  startRecording: ['Start recording', '開始錄音'],
  stopRecording: ['Stop recording', '停止錄音'],
  adopted: ['Description adopted', '已採用描述'],
  permissionDenied: [
    'Permission was denied. You can import a file instead.',
    '未取得權限。您仍可匯入檔案。',
  ],
  queued: ['Queued', '排隊中'],
  running: ['Running', '進行中'],
  waiting: ['Waiting', '等待中'],
  succeeded: ['Succeeded', '已完成'],
  completed: ['Completed', '已完成'],
  failed: ['Failed', '失敗'],
  cancelled: ['Canceled', '已取消'],
  ready: ['Ready', '已就緒'],
  registered: ['Registered', '已登記'],
  usable: ['Usable', '可使用'],
  unusable: ['Unusable', '不可使用'],
  pending: ['Pending', '待處理'],
  accepted: ['Accepted', '已採納'],
  skipped: ['Skipped', '已略過'],
  dismissed: ['Dismissed', '已略過'],
  inProgress: ['In progress', '進行中'],
  recorded: ['Recorded', '已記錄'],
  draft: ['Draft', '草稿'],
  uploaded: ['Uploaded', '已上傳'],
  uploading: ['Uploading', '上傳中'],
  local: ['On device', '僅在裝置上'],
  awaitingUpload: ['Awaiting upload', '等待上傳'],
  linkOnly: ['Link only', '僅有連結'],
  frameTimeSeconds: ['Frame time (seconds)', '畫格時間（秒）'],
  frameTimeInvalid: [
    'Enter a time within the video duration.',
    '請輸入影片長度內的時間。',
  ],
  prepareFrame: ['Prepare video frame', '擷取影片畫格'],
  actualFrameTime: ['Actual frame time', '實際畫格時間'],
  preparedFrame: ['Prepared video frame', '已擷取的影片畫格'],
  useFrame: ['Use frame as evidence', '將畫格用作證據'],
  notApplicable: ['Not applicable', '不適用'],
} as const;

export type MessageKey = keyof typeof messages;

const proposalFieldKeys = {
  name: 'name',
  description: 'description',
  materialIds: 'material',
  period: 'period',
  tags: 'tags',
  collectorJudgment: 'collectorJudgment',
} as const satisfies Record<string, MessageKey>;

export function localizeProposalField(
  field: keyof typeof proposalFieldKeys,
  t: (key: MessageKey) => string,
): string {
  return t(proposalFieldKeys[field]);
}

const statusKeys = {
  queued: 'queued',
  running: 'running',
  waiting: 'waiting',
  succeeded: 'succeeded',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  ready: 'ready',
  registered: 'registered',
  usable: 'usable',
  unusable: 'unusable',
  pending: 'pending',
  accepted: 'accepted',
  skipped: 'skipped',
  dismissed: 'dismissed',
  in_progress: 'inProgress',
  recorded: 'recorded',
  not_started: 'notChecked',
  draft: 'draft',
  saved: 'saved',
  uploaded: 'uploaded',
  uploading: 'uploading',
  local: 'local',
  awaiting_upload: 'awaitingUpload',
  processing: 'processing',
  partial: 'partial',
  needs_review: 'sourceNeedsReview',
  link_only: 'linkOnly',
  not_applicable: 'notApplicable',
} as const satisfies Record<string, MessageKey>;

export function localizeStatus(
  value: string,
  t: (key: MessageKey) => string,
): string {
  const key = (statusKeys as Partial<Record<string, MessageKey>>)[value];
  return key ? t(key) : value.replaceAll('_', ' ');
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => Promise<void>;
  t: (key: MessageKey) => string;
}

const localeContext = createContext<LocaleContextValue | null>(null);

export const LocaleProvider: FC<PropsWithChildren> = ({ children }) => {
  const [locale, setCurrentLocale] = useState<Locale>('en');

  useEffect(() => {
    let active = true;
    void getItemAsync('antica.locale').then((saved) => {
      if (active && saved === 'zh-Hant') {
        setCurrentLocale(saved);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale: async (next: Locale): Promise<void> => {
        await setItemAsync('antica.locale', next);
        setCurrentLocale(next);
      },
      t: (key: MessageKey): string => messages[key][locale === 'en' ? 0 : 1],
    }),
    [locale],
  );

  return (
    <localeContext.Provider value={value}>{children}</localeContext.Provider>
  );
};

/** */
export function useLocale(): LocaleContextValue {
  const value = useContext(localeContext);
  if (value === null) {
    throw new Error('LocaleProvider is missing.');
  }

  return value;
}
