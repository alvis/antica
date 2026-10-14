export {
  calculateAnalysisFreshness,
  isAnalysisRelevantRecordField,
} from './record.js';
export { validateEvidenceAnchor } from './evidence/anchor.js';
export { mapEvidencePoint, mapEvidenceRegion } from './evidence/geometry.js';
export {
  isResolvedCheckResult,
  normalizeComponentScope,
} from './inspection.js';
export { MAX_ROTATION_QUARTER_TURNS } from './source.js';

export type {
  EntityId,
  Instant,
  RecordVersions,
  Revision,
  VersionedEntity,
} from './shared.js';
export type { AnalysisFreshness } from './record.js';
export type {
  CanonicalView,
  EvidenceAnchor,
  EvidenceInput,
  EvidenceScope,
  FrameLocator,
  Matrix3,
  Point,
  Region,
} from './evidence/anchor.js';
export type { Observation, ObservationInput } from './observation.js';
export type {
  CheckCreate,
  CheckDetail,
  CheckPatch,
  CheckResult,
  RecordCheck,
} from './inspection.js';
export type {
  ApplicabilityContext,
  CitedText,
  InspectionMethod,
  InspectionMethodVersion,
  KnowledgeContent,
  KnowledgeDetail,
  KnowledgeEntry,
  KnowledgeKind,
  KnowledgeSummary,
  MethodDefinition,
} from './knowledge.js';
export type {
  ReferenceImage,
  Source,
  SourceAvailability,
  SourceCitation,
  SourceContributor,
  SourceLocator,
  SourceMetadata,
  SourcePage,
  SourceRegion,
  SourceVersion,
} from './source.js';
export type {
  EditDraft,
  EditDraftSnapshot,
  Transcript,
  TranscriptionSnapshot,
} from './workflow.js';
