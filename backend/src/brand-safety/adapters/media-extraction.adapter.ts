import { Injectable } from '@nestjs/common';

export interface MediaExtractionInput {
  mediaAssetUrl: string;
}

export interface MediaExtractionResult {
  onScreenText: string | null;
  audioTranscript: string | null;
}

// A separate adapter from ContentSafetyAdapter (ADR-0021): extraction is a
// transcription concern, safety judgment is a reasoning concern. Keeping
// them apart means a future OCR/ASR provider swap never touches judgment
// code and vice versa (section 4 of the E4 architecture doc).
export interface MediaExtractionAdapter {
  extract(input: MediaExtractionInput): Promise<MediaExtractionResult>;
}

export const MEDIA_EXTRACTION_ADAPTER = 'MEDIA_EXTRACTION_ADAPTER';

// No real OCR/ASR provider is wired up yet. This stub always reports
// extraction as unavailable so extract-content-channels.processor degrades
// honestly (extraction_status = 'failed', fewer channels checked) rather
// than fabricating on-screen text or an audio transcript it never actually
// read. Swapping in a real provider is a change to this class and its DI
// binding only (NFR-29).
@Injectable()
export class StubMediaExtractionAdapter implements MediaExtractionAdapter {
  async extract(_input: MediaExtractionInput): Promise<MediaExtractionResult> {
    throw new Error('No media extraction provider is configured yet.');
  }
}
