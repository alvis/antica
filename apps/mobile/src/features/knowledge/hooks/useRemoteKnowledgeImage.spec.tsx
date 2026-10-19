import { afterEach, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useRemoteKnowledgeImage } from './useRemoteKnowledgeImage';

const imageUrl = 'https://museum.example/image.png';
const timeoutMs = 15_000;
const maximumImageBytes = 16_777_216;

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('should fetch only near the viewport and expose transient image data', async () => {
  const fetchImage = jest.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response('PNG!', {
        headers: { 'content-type': 'image/png; charset=binary' },
      }),
  );
  const { result, rerender } = await renderHook(
    (nearViewport: boolean) => useRemoteKnowledgeImage(imageUrl, nearViewport),
    { initialProps: false },
  );

  expect(fetchImage).not.toHaveBeenCalled();
  await rerender(true);
  await waitFor(() =>
    expect(result.current.uri).toBe('data:image/png;base64,UE5HIQ=='),
  );
  expect(result.current.failed).toBe(false);
  expect(fetchImage).toHaveBeenCalledWith(
    imageUrl,
    expect.objectContaining({
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'Cache-Control': 'no-store' },
    }),
  );

  await act(() => result.current.markFailed());
  expect(result.current.failed).toBe(true);
  await act(() => result.current.retry());
  await waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(2));
  expect(result.current.failed).toBe(false);
  expect(result.current.uri).toBe('data:image/png;base64,UE5HIQ==');
});

it.each([
  ['unavailable', () => new Response('', { status: 404 })],
  ['missing media type', () => new Response(new ArrayBuffer(0))],
  [
    'non-image media type',
    () => new Response('html', { headers: { 'content-type': 'text/html' } }),
  ],
  [
    'oversized image',
    () =>
      new Response(new ArrayBuffer(maximumImageBytes + 1), {
        headers: { 'content-type': 'image/png' },
      }),
  ],
])(
  'should reject an %s response and allow a later retry',
  async (_reason, response) => {
    const fetchImage = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(
        new Response('PNG!', { headers: { 'content-type': 'image/png' } }),
      );
    const { result } = await renderHook(() =>
      useRemoteKnowledgeImage(imageUrl, true),
    );

    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.uri).toBeNull();
    await act(() => result.current.retry());
    await waitFor(() =>
      expect(result.current.uri).toBe('data:image/png;base64,UE5HIQ=='),
    );
    expect(result.current.failed).toBe(false);
    expect(fetchImage).toHaveBeenCalledTimes(2);
  },
);

it('should abort a timed-out request and ignore a response arriving afterwards', async () => {
  jest.useFakeTimers();
  let resolveResponse!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  const fetchImage = jest.spyOn(globalThis, 'fetch').mockReturnValue(pending);
  const { result } = await renderHook(() =>
    useRemoteKnowledgeImage(imageUrl, true),
  );
  const signal = fetchImage.mock.calls[0][1]?.signal;

  await act(() => {
    jest.advanceTimersByTime(timeoutMs - 1);
  });
  expect(result.current.failed).toBe(false);
  expect(signal?.aborted).toBe(false);
  await act(() => {
    jest.advanceTimersByTime(1);
  });
  expect(result.current.failed).toBe(true);
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    resolveResponse(
      new Response('PNG!', { headers: { 'content-type': 'image/png' } }),
    );
    await pending;
  });
  expect(result.current.uri).toBeNull();
});

it.each(['resolve', 'reject'] as const)(
  'should cancel an offscreen request before it can %s into current state',
  async (outcome) => {
    jest.useFakeTimers();
    let resolveResponse!: (response: Response) => void;
    let rejectResponse!: (error: Error) => void;
    const pending = new Promise<Response>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    const fetchImage = jest.spyOn(globalThis, 'fetch').mockReturnValue(pending);
    const { result, rerender } = await renderHook(
      (nearViewport: boolean) =>
        useRemoteKnowledgeImage(imageUrl, nearViewport),
      { initialProps: true },
    );
    const signal = fetchImage.mock.calls[0][1]?.signal;

    await rerender(false);
    expect(signal?.aborted).toBe(true);
    await act(() => {
      jest.advanceTimersByTime(timeoutMs);
    });
    expect(result.current.failed).toBe(false);
    await act(async () => {
      if (outcome === 'resolve') {
        resolveResponse(
          new Response('PNG!', { headers: { 'content-type': 'image/png' } }),
        );
      } else {
        rejectResponse(new Error('Canceled image request'));
      }
      await pending.catch(() => undefined);
    });
    expect(result.current.uri).toBeNull();
    expect(result.current.failed).toBe(false);
  },
);
