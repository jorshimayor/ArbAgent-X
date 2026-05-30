// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ProofStake
/// @notice x402 with skin in the game. A registry of x402-paid agents, each
///         backed by a yield-bearing USDC bond held as shares of a Moonwell
///         (ERC4626) vault. Bad outputs are challengeable; an upheld challenge
///         slashes the agent's bond to the challenger.
/// @dev v1 collapses AgentRegistry + BondVault + Slasher into one contract and
///      uses a single trusted verifier — called out openly in the PRD. The bond
///      is deposited straight into a Moonwell ERC4626 vault, so principal earns
///      yield while idle and slashing redeems shares atomically for liquid USDC.
contract ProofStake is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Config ---

    IERC20 public immutable usdc;
    IERC4626 public immutable vault; // Moonwell ERC4626 USDC vault
    address public verifier; // trusted resolver (v1)
    address public treasury; // collects protocol fee on slashes
    uint16 public protocolFeeBps; // fee on slashed amount, in basis points
    uint256 public minBond; // minimum bond to register
    uint256 public minChallengerBond; // minimum stake to open a challenge

    uint256 public constant WITHDRAW_COOLDOWN = 7 days;
    uint16 public constant MAX_FEE_BPS = 2_000; // 20% ceiling

    // --- Data ---

    struct Agent {
        address operator;
        string endpoint;
        uint256 shares; // Moonwell vault shares backing this agent's bond
        uint64 jobsServed;
        uint64 jobsSuccessful;
        uint64 timesSlashed;
        bool active;
        uint64 deactivatedAt; // cooldown anchor; 0 while active
    }

    struct Challenge {
        uint256 agentId;
        address challenger;
        bytes32 requestId;
        string evidenceURI;
        uint256 challengerBond;
        bool resolved;
        bool upheld;
    }

    uint256 public agentCount;
    uint256 public challengeCount;
    mapping(uint256 => Agent) public agents;
    mapping(uint256 => Challenge) public challenges;

    // --- Events ---

    event AgentRegistered(uint256 indexed agentId, address indexed operator, string endpoint, uint256 bond, uint256 shares);
    event BondToppedUp(uint256 indexed agentId, uint256 amount, uint256 shares);
    event JobRecorded(uint256 indexed agentId, bytes32 indexed requestId, bool success);
    event AgentDeactivated(uint256 indexed agentId, uint64 at);
    event BondWithdrawn(uint256 indexed agentId, address indexed operator, uint256 assets);
    event ChallengeOpened(uint256 indexed challengeId, uint256 indexed agentId, address indexed challenger, bytes32 requestId, string evidenceURI, uint256 bond);
    event ChallengeResolved(uint256 indexed challengeId, uint256 indexed agentId, bool upheld, uint256 payout, uint256 fee);
    event VerifierUpdated(address verifier);
    event TreasuryUpdated(address treasury);
    event ProtocolFeeUpdated(uint16 bps);

    // --- Errors ---

    error NotVerifier();
    error NotOperator();
    error AgentNotActive();
    error AgentInactive();
    error BondTooSmall();
    error ChallengerBondTooSmall();
    error AlreadyResolved();
    error CooldownActive();
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
        uint256 minBond_,
        uint256 minChallengerBond_
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
        minBond = minBond_;
        minChallengerBond = minChallengerBond_;
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

    // --- Registry + BondVault ---

    /// @notice Register an agent and bond `bondAmount` USDC into the Moonwell vault.
    /// @dev Caller must have approved this contract for `bondAmount` USDC.
    function register(string calldata endpoint, uint256 bondAmount) external nonReentrant returns (uint256 agentId) {
        if (bondAmount < minBond) revert BondTooSmall();

        uint256 shares = _depositToVault(bondAmount);

        agentId = ++agentCount;
        agents[agentId] = Agent({
            operator: msg.sender,
            endpoint: endpoint,
            shares: shares,
            jobsServed: 0,
            jobsSuccessful: 0,
            timesSlashed: 0,
            active: true,
            deactivatedAt: 0
        });

        emit AgentRegistered(agentId, msg.sender, endpoint, bondAmount, shares);
    }

    /// @notice Add more USDC to an active agent's bond.
    function topUp(uint256 agentId, uint256 amount) external nonReentrant {
        Agent storage a = agents[agentId];
        if (a.operator != msg.sender) revert NotOperator();
        if (!a.active) revert AgentNotActive();

        uint256 shares = _depositToVault(amount);
        a.shares += shares;

        emit BondToppedUp(agentId, amount, shares);
    }

    /// @notice Deactivate an agent, removing it from discovery and starting the
    ///         withdraw cooldown. Bond keeps earning yield during cooldown.
    function deactivate(uint256 agentId) external {
        Agent storage a = agents[agentId];
        if (a.operator != msg.sender) revert NotOperator();
        if (!a.active) revert AgentNotActive();

        a.active = false;
        a.deactivatedAt = uint64(block.timestamp);

        emit AgentDeactivated(agentId, a.deactivatedAt);
    }

    /// @notice Redeem the bond (principal + accrued yield) after the cooldown.
    function withdraw(uint256 agentId) external nonReentrant {
        Agent storage a = agents[agentId];
        if (a.operator != msg.sender) revert NotOperator();
        if (a.active) revert AgentInactive(); // must deactivate first
        if (block.timestamp < a.deactivatedAt + WITHDRAW_COOLDOWN) revert CooldownActive();

        uint256 shares = a.shares;
        a.shares = 0;
        uint256 assets = vault.redeem(shares, a.operator, address(this));

        emit BondWithdrawn(agentId, a.operator, assets);
    }

    // --- Reputation ---

    /// @notice Record a served job's outcome. Verifier-attested in v1; off-chain
    ///         x402 receipts feed this.
    function recordJob(uint256 agentId, bytes32 requestId, bool success) external onlyVerifier {
        Agent storage a = agents[agentId];
        if (a.operator == address(0)) revert AgentNotActive();
        a.jobsServed += 1;
        if (success) a.jobsSuccessful += 1;
        emit JobRecorded(agentId, requestId, success);
    }

    // --- Slasher ---

    /// @notice Open a challenge against an agent's output. Caller stakes a
    ///         challenger bond, refunded (plus the slash) if upheld, forfeited
    ///         to the agent's operator if rejected.
    /// @dev Caller must have approved this contract for `challengerBond` USDC.
    function challenge(
        uint256 agentId,
        bytes32 requestId,
        string calldata evidenceURI,
        uint256 challengerBond
    ) external nonReentrant returns (uint256 challengeId) {
        Agent storage a = agents[agentId];
        if (!a.active) revert AgentNotActive();
        if (challengerBond < minChallengerBond) revert ChallengerBondTooSmall();

        usdc.safeTransferFrom(msg.sender, address(this), challengerBond);

        challengeId = ++challengeCount;
        challenges[challengeId] = Challenge({
            agentId: agentId,
            challenger: msg.sender,
            requestId: requestId,
            evidenceURI: evidenceURI,
            challengerBond: challengerBond,
            resolved: false,
            upheld: false
        });

        emit ChallengeOpened(challengeId, agentId, msg.sender, requestId, evidenceURI, challengerBond);
    }

    /// @notice Resolve a challenge. Only the trusted verifier (v1).
    ///         `upheld = true`  -> bad output confirmed: slash 100% of the
    ///                             agent's bond, pay challenger (bond back +
    ///                             slashed principal minus protocol fee).
    ///         `upheld = false` -> challenge rejected: challenger bond awarded
    ///                             to the agent's operator.
    function resolve(uint256 challengeId, bool upheld) external onlyVerifier nonReentrant {
        Challenge storage c = challenges[challengeId];
        if (c.resolved) revert AlreadyResolved();
        c.resolved = true;
        c.upheld = upheld;

        Agent storage a = agents[c.agentId];

        if (upheld) {
            // Redeem the full bond to liquid USDC.
            uint256 shares = a.shares;
            a.shares = 0;
            a.active = false;
            a.timesSlashed += 1;
            if (a.deactivatedAt == 0) a.deactivatedAt = uint64(block.timestamp);

            uint256 slashed = shares > 0 ? vault.redeem(shares, address(this), address(this)) : 0;
            uint256 fee = (slashed * protocolFeeBps) / 10_000;
            uint256 toChallenger = slashed - fee + c.challengerBond;

            if (fee > 0) usdc.safeTransfer(treasury, fee);
            usdc.safeTransfer(c.challenger, toChallenger);

            emit ChallengeResolved(challengeId, c.agentId, true, toChallenger, fee);
        } else {
            // Reward the honest agent: challenger bond goes to its operator,
            // and the rejected challenge counts as a clean served job.
            a.jobsServed += 1;
            a.jobsSuccessful += 1;
            usdc.safeTransfer(a.operator, c.challengerBond);

            emit ChallengeResolved(challengeId, c.agentId, false, c.challengerBond, 0);
        }
    }

    // --- Views ---

    /// @notice Reputation tuple used for discovery and routing.
    function getReputation(uint256 agentId)
        external
        view
        returns (uint64 jobsServed, uint64 jobsSuccessful, uint64 timesSlashed, bool active)
    {
        Agent storage a = agents[agentId];
        return (a.jobsServed, a.jobsSuccessful, a.timesSlashed, a.active);
    }

    /// @notice Current redeemable USDC value of an agent's bond (principal + yield).
    function bondValue(uint256 agentId) public view returns (uint256) {
        return vault.convertToAssets(agents[agentId].shares);
    }

    /// @notice IDs of all currently active agents.
    function listActive() external view returns (uint256[] memory ids) {
        uint256 n;
        for (uint256 i = 1; i <= agentCount; i++) {
            if (agents[i].active) n++;
        }
        ids = new uint256[](n);
        uint256 k;
        for (uint256 i = 1; i <= agentCount; i++) {
            if (agents[i].active) ids[k++] = i;
        }
    }

    // --- Internal ---

    function _depositToVault(uint256 amount) internal returns (uint256 shares) {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        usdc.forceApprove(address(vault), amount);
        shares = vault.deposit(amount, address(this));
    }
}
