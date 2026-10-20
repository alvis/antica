import { z } from 'zod';

/** ordered observation groups shared by guide consumers */
export const corpusGuideGroupSchema = z.enum([
  'form',
  'material_body',
  'surface',
  'decoration_technique',
  'base_marks',
  'wear_age',
  'repairs_alterations',
  'documentation',
]);
/** observation prompts within a check */
export const corpusGuideFieldSchema = z.enum([
  'what',
  'why',
  'howToSee',
  'typical',
  'warningSigns',
]);
