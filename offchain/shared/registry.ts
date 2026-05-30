import { getSkinBookRead, fromUsdc, BOOKING_STATUS, type BookingStatus } from "./chain.js";

export interface EnrichedBusiness {
  businessId: number;
  owner: string;
  name: string;
  active: boolean;
  depositUsd: number;
  cancellationWindowSecs: number;
  gracePeriodSecs: number;
  bookingsHonored: number;
  noShows: number;
  reliability: number; // 0..1 (honored / total), neutral 1.0 when no history
  score: number; // reliability-weighted ranking; higher is better
}

export interface EnrichedBooking {
  bookingId: number;
  businessId: number;
  customer: string;
  slotTime: number; // unix seconds
  status: BookingStatus;
  depositUsd: number; // current redeemable value (principal + yield)
  claimedAt: number;
}

/** Reliability-weighted score used for ranking businesses. No-shows lift the
 *  score (more enforced accountability); a poor honored-ratio sinks it. */
export function scoreBusiness(a: { reliability: number; bookingsHonored: number; noShows: number }): number {
  const total = a.bookingsHonored + a.noShows;
  const volume = Math.log10(10 + total);
  return a.reliability * volume;
}

/** Read all active businesses from the registry. */
export async function enrichActiveBusinesses(): Promise<EnrichedBusiness[]> {
  const sb = getSkinBookRead();
  if (!sb) throw new Error("SKINBOOK_ADDR not set");

  const ids: bigint[] = await sb.listActiveBusinesses();
  const out: EnrichedBusiness[] = [];

  for (const idB of ids) {
    const id = Number(idB);
    const b = await sb.businesses(id);
    const honored = Number(b.bookingsHonored);
    const noShows = Number(b.noShows);
    const total = honored + noShows;
    const reliability = total > 0 ? honored / total : 1;

    out.push({
      businessId: id,
      owner: b.owner,
      name: b.name,
      active: b.active,
      depositUsd: fromUsdc(b.depositAmount),
      cancellationWindowSecs: Number(b.cancellationWindow),
      gracePeriodSecs: Number(b.gracePeriod),
      bookingsHonored: honored,
      noShows,
      reliability,
      score: scoreBusiness({ reliability, bookingsHonored: honored, noShows }),
    });
  }

  return out.sort((x, y) => y.score - x.score);
}

/** Read recent bookings (newest first) from the registry. */
export async function recentBookings(limit = 20): Promise<EnrichedBooking[]> {
  const sb = getSkinBookRead();
  if (!sb) throw new Error("SKINBOOK_ADDR not set");

  const count = Number(await sb.bookingCount());
  const out: EnrichedBooking[] = [];
  for (let id = count; id >= 1 && out.length < limit; id--) {
    const bk = await sb.bookings(id);
    out.push({
      bookingId: id,
      businessId: Number(bk.businessId),
      customer: bk.customer,
      slotTime: Number(bk.slotTime),
      status: BOOKING_STATUS[Number(bk.status)] ?? "None",
      depositUsd: fromUsdc(await sb.bookingValue(id)),
      claimedAt: Number(bk.claimedAt),
    });
  }
  return out;
}
