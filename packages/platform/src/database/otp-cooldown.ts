import { sql } from 'drizzle-orm';
import type { Database } from './connection.js';

export interface OtpCooldownParams {
  readonly db: Database;
  readonly phoneNumber: string;
}

/** claims one OTP send per normalized phone number each sixty seconds */
export async function claimOtpSend({
  db,
  phoneNumber,
}: OtpCooldownParams): Promise<boolean> {
  const result = await db.execute(sql`
    insert into otp_send_cooldown (phone_number, last_sent_at)
    values (${phoneNumber}, now())
    on conflict (phone_number) do update
      set last_sent_at = excluded.last_sent_at
      where otp_send_cooldown.last_sent_at <= now() - interval '60 seconds'
    returning phone_number
  `);
  return result.length === 1;
}
