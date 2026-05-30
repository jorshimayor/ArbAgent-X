// Human-readable ABI for the slice of ProofStake the off-chain stack uses.
export const PROOFSTAKE_ABI = [
  "function agentCount() view returns (uint256)",
  "function challengeCount() view returns (uint256)",
  "function usdc() view returns (address)",
  "function vault() view returns (address)",
  "function verifier() view returns (address)",
  "function minChallengerBond() view returns (uint256)",
  "function agents(uint256) view returns (address operator, string endpoint, uint256 shares, uint64 jobsServed, uint64 jobsSuccessful, uint64 timesSlashed, bool active, uint64 deactivatedAt)",
  "function getReputation(uint256 agentId) view returns (uint64 jobsServed, uint64 jobsSuccessful, uint64 timesSlashed, bool active)",
  "function bondValue(uint256 agentId) view returns (uint256)",
  "function listActive() view returns (uint256[])",
  "function challenges(uint256) view returns (uint256 agentId, address challenger, bytes32 requestId, string evidenceURI, uint256 challengerBond, bool resolved, bool upheld)",
  "function minBond() view returns (uint256)",
  "function register(string endpoint, uint256 bondAmount) returns (uint256)",
  "function topUp(uint256 agentId, uint256 amount)",
  "function deactivate(uint256 agentId)",
  "function withdraw(uint256 agentId)",
  "function challenge(uint256 agentId, bytes32 requestId, string evidenceURI, uint256 challengerBond) returns (uint256)",
  "function resolve(uint256 challengeId, bool upheld)",
  "function recordJob(uint256 agentId, bytes32 requestId, bool success)",
  "event AgentRegistered(uint256 indexed agentId, address indexed operator, string endpoint, uint256 bond, uint256 shares)",
  "event ChallengeOpened(uint256 indexed challengeId, uint256 indexed agentId, address indexed challenger, bytes32 requestId, string evidenceURI, uint256 bond)",
  "event ChallengeResolved(uint256 indexed challengeId, uint256 indexed agentId, bool upheld, uint256 payout, uint256 fee)",
  "event JobRecorded(uint256 indexed agentId, bytes32 indexed requestId, bool success)",
];

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];
