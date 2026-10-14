export { renderCanonicalImage } from './pixels.js';
export { validateIndexSpace } from './index-space.js';
export type { IndexCompatibility } from './index-space.js';
export {
  createLocalImageRetrieval,
  developmentImageIndex,
  getImageMatchIdentity,
} from './image.js';
export type {
  ImageSearchEntry,
  LocalImageRetrievalParams,
  SearchImage,
} from './image.js';
export { createLocalTextRetrieval, developmentTextIndex } from './text.js';
export type { LocalTextRetrievalParams, TextSearchEntry } from './text.js';
export { createExaWebResearch, isPublicSourceUrl } from './web.js';
export type { ExaWebResearchParams } from './web.js';

export { createVoyageImageEmbedding } from './voyage.js';
export type {
  VoyageImageEmbedding,
  VoyageImageEmbeddingParams,
} from './voyage.js';
export {
  createQdrantImageRetrieval,
  createQdrantImageWriter,
} from './qdrant.js';
export type {
  QdrantImageDocument,
  QdrantImageRetrievalParams,
  QdrantImageWriter,
} from './qdrant.js';

export { createLlamaTextRetrieval } from './llama.js';
export type { LlamaRetrievedChunk, LlamaTextRetrievalParams } from './llama.js';

export { createConfiguredImageRetrieval } from './config.js';
export type {
  CloudImageRetrievalConfig,
  ConfiguredImageRetrieval,
  ConfiguredImageRetrievalParams,
  LocalImageRetrievalConfig,
} from './config.js';

export { createLlamaTextIndexWriter } from './llama-writer.js';
export type { LlamaTextIndexWriterParams } from './llama-writer.js';

export { createCloudImageComparison } from './comparison.js';
export type { CloudImageComparisonParams } from './comparison.js';
