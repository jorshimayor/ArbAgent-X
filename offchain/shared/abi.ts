// Human-readable ABI for the slice of SkinBook the off-chain stack uses.
export const SKINBOOK_ABI = [
  // config / views
  "function businessCount() view returns (uint256)",
  "function bookingCount() view returns (uint256)",
  "function usdc() view returns (address)",
  "function vault() view returns (address)",
  "function verifier() view returns (address)",
  "function treasury() view returns (address)",
  "function protocolFeeBps() view returns (uint16)",
  "function minDeposit() view returns (uint256)",
  "function disputeWindow() view returns (uint256)",
  "function businesses(uint256) view returns (address owner, string name, uint256 depositAmount, uint64 cancellationWindow, uint64 gracePeriod, uint64 bookingsHonored, uint64 noShows, bool active)",
  "function bookings(uint256) view returns (uint256 businessId, address customer, uint64 slotTime, uint256 shares, uint64 claimedAt, uint8 status)",
  "function bookingValue(uint256 bookingId) view returns (uint256)",
  "function getReliability(uint256 businessId) view returns (uint64 bookingsHonored, uint64 noShows, bool active)",
  "function listActiveBusinesses() view returns (uint256[])",
  // business writes
  "function registerBusiness(string name, uint256 depositAmount, uint64 cancellationWindow, uint64 gracePeriod) returns (uint256)",
  "function updateBusiness(uint256 businessId, uint256 depositAmount, uint64 cancellationWindow, uint64 gracePeriod)",
  "function deactivateBusiness(uint256 businessId)",
  // booking lifecycle
  "function book(uint256 businessId, uint64 slotTime) returns (uint256)",
  "function cancel(uint256 bookingId)",
  "function confirmAttendance(uint256 bookingId)",
  "function claimNoShow(uint256 bookingId)",
  "function settleNoShow(uint256 bookingId)",
  "function dispute(uint256 bookingId)",
  "function resolveDispute(uint256 bookingId, bool customerPresent)",
  // events
  "event BusinessRegistered(uint256 indexed businessId, address indexed owner, string name, uint256 depositAmount)",
  "event Booked(uint256 indexed bookingId, uint256 indexed businessId, address indexed customer, uint64 slotTime, uint256 deposit, uint256 shares)",
  "event Cancelled(uint256 indexed bookingId, uint256 indexed businessId, address indexed customer, uint256 refund)",
  "event AttendanceConfirmed(uint256 indexed bookingId, uint256 indexed businessId, address indexed customer, uint256 refund)",
  "event NoShowClaimed(uint256 indexed bookingId, uint256 indexed businessId, uint64 at)",
  "event NoShowSettled(uint256 indexed bookingId, uint256 indexed businessId, uint256 toBusiness, uint256 fee)",
  "event Disputed(uint256 indexed bookingId, uint256 indexed businessId, address indexed customer)",
  "event DisputeResolved(uint256 indexed bookingId, uint256 indexed businessId, bool customerPresent, uint256 payout, uint256 fee)",
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];
