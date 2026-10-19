import type { Database } from './connection.js';

/** collector phone number and database for the OTP send cooldown */
export interface OtpCooldownParams {
  readonly db: Database;
  readonly phoneNumber: string;
}

/**
 * claims one OTP send per normalized phone number each sixty seconds
 * @param root0
 * @param root0.db
 * @param root0.phoneNumber
 */
export async function claimOtpSend({
  db,
  phoneNumber,
}: OtpCooldownParams): Promise<boolean> {
  const result = await db.$queryRaw<ReadonlyArray<{ phoneNumber: string }>>`
    insert into otp_send_cooldown (phone_number, last_sent_at)
    values (${phoneNumber}, now())
    on conflict (phone_number) do update
      set last_sent_at = excluded.last_sent_at
      where otp_send_cooldown.last_sent_at <= now() - interval '60 seconds'
    returning phone_number as "phoneNumber"
  `;

  return result.length === 1;
}
