import type { JobEvent } from '@antica/contracts';

export interface JobDispatchPort {
  publish(name: string, event: JobEvent): Promise<void>;
}
export interface CallbackVerificationPort {
  verify(
    provider: string,
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<{
    readonly providerEventId: string;
    readonly providerJobId: string;
    readonly payload: unknown;
  }>;
}
