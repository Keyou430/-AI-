import type { ImageAssetLocationInfo } from './imageAssetLocation';
import type { ParsedVideoData } from './videoParser';
import type { IndustryProfile } from './trendingTypes';

export const IMAGE_RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'] as const;
export type ImageRatio = typeof IMAGE_RATIOS[number];
export type ContentKind = 'video' | 'image-text' | 'unknown';
export interface ImageReference {
  id: string;
  name: string;
  kind: 'style' | 'scene';
  width: number;
  height: number;
}
export interface ImageStyleCard {
  palette: string;
  layout: string;
  typography: string;
  elements: string;
  mood: string;
}
export interface ImageFactEvidence { documentId: string; quote: string; claim: string; }
export interface ImagePageVersion {
  id: string;
  pageId: string;
  assetId: string;
  createdAt: string;
  text: string;
  visual: string;
  referenceIds: string[];
  renderedKey: string;
  ratio: ImageRatio;
  style: string;
  styleCard?: ImageStyleCard;
  reviewed: boolean;
}
export interface ImageTextPage {
  id: string;
  text: string;
  visual: string;
  referenceIds: string[];
  assetId?: string;
  renderedKey?: string;
  error?: string;
  currentVersionId?: string;
  reviewedVersionId?: string;
}
export interface ImageTextRemixContext {
  industryProfile?: IndustryProfile;
  companyBusinessProfile: string;
  keywords: Array<{ text: string; category: 'brand' | 'jargon' | 'forbidden' }>;
}
export interface ImageTextDraft {
  id: string;
  createdAt: string;
  source: ParsedVideoData;
  remixContext?: ImageTextRemixContext;
  typeOrigin: 'automatic' | 'manual';
  title: string;
  body: string;
  tags: string[];
  style: string;
  styleCard?: ImageStyleCard;
  evidence?: ImageFactEvidence[];
  versions?: ImagePageVersion[];
  ratio: ImageRatio;
  ratioOrigin: string;
  references: ImageReference[];
  archivedReferences?: ImageReference[];
  pages: ImageTextPage[];
  notices: string[];
  confirmed: boolean;
}
export interface ImageTextPlanInput {
  draft: ImageTextDraft;
  instruction?: string;
  taskId: string;
}
export interface ImageTextResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  canceled?: boolean;
  errorCode?: string;
}
export interface ImageTextAPI {
  getImageAssetLocation(): Promise<ImageTextResult<ImageAssetLocationInfo>>;
  chooseImageAssetLocation(): Promise<ImageTextResult<ImageAssetLocationInfo>>;
  followDataImageAssetLocation(): Promise<ImageTextResult<ImageAssetLocationInfo>>;
  planImageText(input: ImageTextPlanInput): Promise<ImageTextResult<ImageTextDraft>>;
  generateImageText(input: { draft: ImageTextDraft; pageId: string; taskId: string; usePreviousImage?: boolean }): Promise<ImageTextResult<{ assetId: string; renderedKey: string; draft?: ImageTextDraft; persistenceError?: string }>>;
  cancelImageText(taskId: string): Promise<ImageTextResult<never>>;
  selectImageTextReferences(kind: 'style' | 'scene', draft: ImageTextDraft): Promise<ImageTextResult<ImageReference[]>>;
  readImageTextAsset(id: string): Promise<ImageTextResult<string>>;
  listImageTextHistory(): Promise<ImageTextResult<ImageTextDraft[]>>;
  saveImageTextHistory(draft: ImageTextDraft): Promise<ImageTextResult<ImageTextDraft>>;
  getImageTextDeletionInfo(id: string): Promise<ImageTextResult<{ count: number; bytes: number }>>;
  deleteImageTextHistory(id: string): Promise<ImageTextResult<never>>;
  exportImageText(draft: ImageTextDraft, forbiddenWords?: string[]): Promise<ImageTextResult<string>>;
}
