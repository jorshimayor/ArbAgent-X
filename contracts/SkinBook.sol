// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SkinBook
/// @notice No-show booking deposits with skin in the game. A customer books a
///         slot at a business and posts a refundable USDC deposit. The deposit is
///         held as shares of a Moonwell (ERC4626) USDC vault, so it *earns yield
///         while it waits* — something a card hold can never do. Show up (or
///         cancel in time) and the deposit is refunded with its yield; no-show
///         and the deposit is slashed to the business.
/// @dev The yield-bearing-deposit core is shared with the original ProofStake
///      design, but the trust model is fairer: most bookings self-resolve via the
///      customer cancelling or the business confirming attendance. Only a
///      *contested* no-show touches the trusted arbiter (`verifier`), via a
///      bounded dispute window — not every transaction.
contract SkinBook is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Config ---

    IERC20 public immutable usdc;
    IERC4626 public immutable vault; // Moonwell ERC4626 USDC vault
    address public verifier; // trusted arbiter for disputed no-shows only
    address public treasury; // collects protocol fee on slashed deposits
    uint16 public protocolFeeBps; // fee on slashed deposit, in basis points
    uint256 public minDeposit; // floor for a business's required deposit
    uint256 public disputeWindow; // time a customer has to contest a no-show claim

    uint16 public constant MAX_FEE_BPS = 2_000; // 20% ceiling

    // --- Data ---

    struct Business {
        address owner;
        string name;
        uint256 depositAmount; // USDC each booking must deposit
        uint64 cancellationWindow; // free-cancel cutoff: secs before the slot
        uint64 gracePeriod; // secs after the slot before a no-show can be claimed
        uint64 bookingsHonored; // attended or cancelled-in-time
        uint64 noShows; // upheld no-shows
        bool active;
    }

    enum Status {
        None,
        Booked, // deposit locked in the vault, awaiting outcome
        Refunded, // returned to the customer (attended or cancelled) — terminal
        NoShowClaimed, // business filed a no-show; dispute window running
        Disputed, // customer contested; awaiting the arbiter
        Slashed // deposit paid to the business — terminal
    }

    struct Booking {
        uint256 businessId;
        address customer;
        uint64 slotTime; // appointment timestamp
        uint256 shares; // Moonwell vault shares backing this deposit
        uint64 claimedAt; // when a no-show was filed (dispute-window anchor)
        Status status;
    }

    uint256 public businessCount;
    uint256 public bookingCount;
    mapping(uint256 => Business) public businesses;
    mapping(uint256 => Booking) public bookings;

    // --- Events ---

    event BusinessRegistered(uint256 indexed businessId, address indexed owner, string name, uint256 depositAmount);
    event BusinessUpdated(uint256 indexed businessId, uint256 depositAmount, uint64 cancellationWindow, uint64 gracePeriod);
    event BusinessDeactivated(uint256 indexed businessId);
    event Booked(uint256 indexed bookingId, uint256 indexed businessId, address indexed customer, uint64 slotTime, uint256 deposit, uint256 shares);
    event Cancelled(uint256 indexed bookingId, uint256 indexed businessId, address indexed customer, uint256 refund);
    event AttendanceConfirmed(uint256 indexed bookingId, uint256 indexed businessId, address indexed customer, uint256 refund);
    event NoShowClaimed(uint256 indexed bookingId, uint256 indexed businessId, uint64 at);
    event NoShowSettled(uint256 indexed bookingId, uint256 indexed businessId, uint256 toBusiness, uint256 fee);
    event Disputed(uint256 indexed bookingId, uint256 indexed businessId, address indexed customer);
    event DisputeResolved(uint256 indexed bookingId, uint256 indexed businessId, bool customerPresent, uint256 payout, uint256 fee);
    event VerifierUpdated(address verifier);
    event TreasuryUpdated(address treasury);
    event ProtocolFeeUpdated(uint16 bps);
    event DisputeWindowUpdated(uint256 secondsWindow);

    // --- Errors ---

    error NotVerifier();
    error NotBusinessOwner();
    error NotCustomer();
    error BusinessNotActive();
    error DepositTooSmall();
    error BadSlotTime();
    error BadStatus();
    error CancelWindowPassed();
    error TooEarlyToClaim();
    error DisputeWindowOpen();
    error DisputeWindowClosed();
    error FeeTooHigh();
    error ZeroAddress();

    modifier onlyVerifier() {
        if (msg.sender != verifier) revert NotVerifier();
        _;
    }

    constructor(
        IERC20 usdc_,
        IERC4626 vault_,
        address verifier_,
        address treasury_,
        uint16 protocolFeeBps_,
        uint256 minDeposit_,
        uint256 disputeWindow_
    ) Ownable(msg.sender) {
        if (address(usdc_) == address(0) || address(vault_) == address(0)) revert ZeroAddress();
        if (verifier_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (protocolFeeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        if (vault_.asset() != address(usdc_)) revert ZeroAddress();

        usdc = usdc_;
        vault = vault_;
        verifier = verifier_;
        treasury = treasury_;
        protocolFeeBps = protocolFeeBps_;
        minDeposit = minDeposit_;
        disputeWindow = disputeWindow_;
    }

    // --- Admin ---

    function setVerifier(address verifier_) external onlyOwner {
        if (verifier_ == address(0)) revert ZeroAddress();
        verifier = verifier_;
        emit VerifierUpdated(verifier_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setProtocolFeeBps(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh();
        protocolFeeBps = bps;
        emit ProtocolFeeUpdated(bps);
    }

    function setDisputeWindow(uint256 secondsWindow) external onlyOwner {
        disputeWindow = secondsWindow;
        emit DisputeWindowUpdated(secondsWindow);
    }

    // --- Business registry ---

    /// @notice List a business and its booking policy.
    /// @param depositAmount USDC each booking must deposit (>= minDeposit).
    /// @param cancellationWindow free-cancel cutoff, in seconds before the slot.
    /// @param gracePeriod seconds after the slot before a no-show can be claimed.
    function registerBusiness(
        string calldata name,
        uint256 depositAmount,
        uint64 cancellationWindow,
        uint64 gracePeriod
    ) external returns (uint256 businessId) {
        if (depositAmount < minDeposit) revert DepositTooSmall();

        businessId = ++businessCount;
        businesses[businessId] = Business({
            owner: msg.sender,
            name: name,
            depositAmount: depositAmount,
            cancellationWindow: cancellationWindow,
            gracePeriod: gracePeriod,
            bookingsHonored: 0,
            noShows: 0,
            active: true
        });

        emit BusinessRegistered(businessId, msg.sender, name, depositAmount);
    }

    /// @notice Update a business's booking policy.
    function updateBusiness(
        uint256 businessId,
        uint256 depositAmount,
        uint64 cancellationWindow,
        uint64 gracePeriod
    ) external {
        Business storage b = businesses[businessId];
        if (b.owner != msg.sender) revert NotBusinessOwner();
        if (depositAmount < minDeposit) revert DepositTooSmall();
        b.depositAmount = depositAmount;
        b.cancellationWindow = cancellationWindow;
        b.gracePeriod = gracePeriod;
        emit BusinessUpdated(businessId, depositAmount, cancellationWindow, gracePeriod);
    }

    /// @notice Stop accepting new bookings. Existing bookings still resolve.
    function deactivateBusiness(uint256 businessId) external {
        Business storage b = businesses[businessId];
        if (b.owner != msg.sender) revert NotBusinessOwner();
        b.active = false;
        emit BusinessDeactivated(businessId);
    }

    // --- Booking lifecycle ---

    /// @notice Book a slot and deposit the business's required USDC into the
    ///         Moonwell vault. The deposit earns yield until the booking resolves.
    /// @dev Caller must have approved this contract for the deposit amount.
    function book(uint256 businessId, uint64 slotTime) external nonReentrant returns (uint256 bookingId) {
        Business storage b = businesses[businessId];
        if (!b.active) revert BusinessNotActive();
        if (slotTime <= block.timestamp) revert BadSlotTime();

        uint256 deposit = b.depositAmount;
        uint256 shares = _depositToVault(deposit);

        bookingId = ++bookingCount;
        bookings[bookingId] = Booking({
            businessId: businessId,
            customer: msg.sender,
            slotTime: slotTime,
            shares: shares,
            claimedAt: 0,
            status: Status.Booked
        });

        emit Booked(bookingId, businessId, msg.sender, slotTime, deposit, shares);
    }

    /// @notice Customer cancels in time and is fully refunded (deposit + yield).
    ///         Allowed only before `slotTime - cancellationWindow`.
    function cancel(uint256 bookingId) external nonReentrant {
        Booking storage bk = bookings[bookingId];
        if (bk.customer != msg.sender) revert NotCustomer();
        if (bk.status != Status.Booked) revert BadStatus();

        Business storage b = businesses[bk.businessId];
        if (block.timestamp > bk.slotTime - b.cancellationWindow) revert CancelWindowPassed();

        bk.status = Status.Refunded;
        b.bookingsHonored += 1;
        uint256 refund = _redeemTo(bk.shares, bk.customer);

        emit Cancelled(bookingId, bk.businessId, bk.customer, refund);
    }

    /// @notice Business confirms the customer showed up; deposit (+ yield) is
    ///         refunded to the customer. The business gains nothing by confirming,
    ///         so it has no incentive to lie here — its only temptation is to file
    ///         a false no-show instead, which the customer can dispute.
    function confirmAttendance(uint256 bookingId) external nonReentrant {
        Booking storage bk = bookings[bookingId];
        Business storage b = businesses[bk.businessId];
        if (b.owner != msg.sender) revert NotBusinessOwner();
        if (bk.status != Status.Booked) revert BadStatus();

        bk.status = Status.Refunded;
        b.bookingsHonored += 1;
        uint256 refund = _redeemTo(bk.shares, bk.customer);

        emit AttendanceConfirmed(bookingId, bk.businessId, bk.customer, refund);
    }

    /// @notice Business files a no-show after the slot + grace period. This opens
    ///         a dispute window; the deposit stays in the vault until it settles.
    function claimNoShow(uint256 bookingId) external {
        Booking storage bk = bookings[bookingId];
        Business storage b = businesses[bk.businessId];
        if (b.owner != msg.sender) revert NotBusinessOwner();
        if (bk.status != Status.Booked) revert BadStatus();
        if (block.timestamp < uint256(bk.slotTime) + b.gracePeriod) revert TooEarlyToClaim();

        bk.status = Status.NoShowClaimed;
        bk.claimedAt = uint64(block.timestamp);

        emit NoShowClaimed(bookingId, bk.businessId, bk.claimedAt);
    }

    /// @notice Finalize an uncontested no-show after the dispute window: the
    ///         deposit is slashed to the business (minus the protocol fee).
    ///         Callable by anyone (the business, or a keeper).
    function settleNoShow(uint256 bookingId) external nonReentrant {
        Booking storage bk = bookings[bookingId];
        if (bk.status != Status.NoShowClaimed) revert BadStatus();
        if (block.timestamp < uint256(bk.claimedAt) + disputeWindow) revert DisputeWindowOpen();

        Business storage b = businesses[bk.businessId];
        bk.status = Status.Slashed;
        b.noShows += 1;

        (uint256 toBusiness, uint256 fee) = _slashTo(bk.shares, b.owner);
        emit NoShowSettled(bookingId, bk.businessId, toBusiness, fee);
    }

    /// @notice Customer contests a no-show claim within the dispute window.
    function dispute(uint256 bookingId) external {
        Booking storage bk = bookings[bookingId];
        if (bk.customer != msg.sender) revert NotCustomer();
        if (bk.status != Status.NoShowClaimed) revert BadStatus();
        if (block.timestamp >= uint256(bk.claimedAt) + disputeWindow) revert DisputeWindowClosed();

        bk.status = Status.Disputed;
        emit Disputed(bookingId, bk.businessId, bk.customer);
    }

    /// @notice Arbiter resolves a disputed no-show.
    ///         `customerPresent = true`  -> refund the deposit (+ yield) to the customer.
    ///         `customerPresent = false` -> slash the deposit to the business.
    function resolveDispute(uint256 bookingId, bool customerPresent) external onlyVerifier nonReentrant {
        Booking storage bk = bookings[bookingId];
        if (bk.status != Status.Disputed) revert BadStatus();
        Business storage b = businesses[bk.businessId];

        if (customerPresent) {
            bk.status = Status.Refunded;
            b.bookingsHonored += 1;
            uint256 refund = _redeemTo(bk.shares, bk.customer);
            emit DisputeResolved(bookingId, bk.businessId, true, refund, 0);
        } else {
            bk.status = Status.Slashed;
            b.noShows += 1;
            (uint256 toBusiness, uint256 fee) = _slashTo(bk.shares, b.owner);
            emit DisputeResolved(bookingId, bk.businessId, false, toBusiness, fee);
        }
    }

    // --- Views ---

    /// @notice Current redeemable USDC value of a booking's deposit (principal + yield).
    function bookingValue(uint256 bookingId) public view returns (uint256) {
        return vault.convertToAssets(bookings[bookingId].shares);
    }

    /// @notice Reliability tuple used for discovery/ranking.
    function getReliability(uint256 businessId)
        external
        view
        returns (uint64 bookingsHonored, uint64 noShows, bool active)
    {
        Business storage b = businesses[businessId];
        return (b.bookingsHonored, b.noShows, b.active);
    }

    /// @notice IDs of all currently active businesses.
    function listActiveBusinesses() external view returns (uint256[] memory ids) {
        uint256 n;
        for (uint256 i = 1; i <= businessCount; i++) {
            if (businesses[i].active) n++;
        }
        ids = new uint256[](n);
        uint256 k;
        for (uint256 i = 1; i <= businessCount; i++) {
            if (businesses[i].active) ids[k++] = i;
        }
    }

    // --- Internal ---

    function _depositToVault(uint256 amount) internal returns (uint256 shares) {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        usdc.forceApprove(address(vault), amount);
        shares = vault.deposit(amount, address(this));
    }

    /// @dev Redeem all shares straight to `to`. Yield rides along with principal.
    function _redeemTo(uint256 shares, address to) internal returns (uint256 assets) {
        assets = shares > 0 ? vault.redeem(shares, to, address(this)) : 0;
    }

    /// @dev Redeem shares to this contract, skim the protocol fee to treasury,
    ///      pay the remainder to `to`. Returns (paid, fee).
    function _slashTo(uint256 shares, address to) internal returns (uint256 toRecipient, uint256 fee) {
        uint256 assets = shares > 0 ? vault.redeem(shares, address(this), address(this)) : 0;
        fee = (assets * protocolFeeBps) / 10_000;
        toRecipient = assets - fee;
        if (fee > 0) usdc.safeTransfer(treasury, fee);
        if (toRecipient > 0) usdc.safeTransfer(to, toRecipient);
    }
}
