import { useEffect, useState } from 'react';

interface RemoteKnowledgeImageState {
  uri: string | null;
  failed: boolean;
  retry: () => void;
  markFailed: () => void;
}
const timeoutMs = 15_000;
const maximumImageBytes = 16_777_216;
/**
 * keeps downloaded image bytes in component memory and aborts offscreen reads
 * @param imageUrl validated remote image URL
 * @param nearViewport whether the gallery permits a fetch
 * @returns transient source and retry controls
 */
export function useRemoteKnowledgeImage(
  imageUrl: string,
  nearViewport: boolean,
): RemoteKnowledgeImageState {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!nearViewport) {
      return undefined;
    }
    const controller = new AbortController();
    const lifecycle = { active: true };
    setFailed(false);
    setUri(null);
    const timer = setTimeout(() => {
      setFailed(true);
      controller.abort();
    }, timeoutMs);
    void (async () => {
      try {
        const data = await fetchKnowledgeImage(imageUrl, controller.signal);
        if (lifecycle.active && !controller.signal.aborted) {
          setUri(data);
        }
      } catch {
        if (lifecycle.active) {
          setFailed(true);
        }
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => {
      lifecycle.active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [attempt, imageUrl, nearViewport]);

  return {
    uri,
    failed,
    retry: () => {
      setFailed(false);
      setAttempt((value) => value + 1);
    },
    markFailed: () => setFailed(true),
  };
}
/**
 * bypasses the HTTP cache and supplies data rather than a remote native source
 * @param imageUrl remote URL
 * @param signal cancellation of the transient read
 * @returns memory-only image data URL
 * @throws {Error} when the response is unavailable, invalid or too large
 */
async function fetchKnowledgeImage(
  imageUrl: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(imageUrl, {
    signal,
    cache: 'no-store',
    credentials: 'omit',
    headers: { 'Cache-Control': 'no-store' },
  });
  if (!response.ok) {
    throw new Error('Image unavailable');
  }
  const mime = response.headers.get('content-type')?.split(';')[0] ?? '';
  if (!mime.startsWith('image/')) {
    throw new Error('Invalid image type');
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maximumImageBytes) {
    throw new Error('Image too large');
  }
  let binary = '';
  for (const byte of new Uint8Array(buffer)) {
    binary += String.fromCharCode(byte);
  }

  return `data:${mime};base64,${btoa(binary)}`;
}
