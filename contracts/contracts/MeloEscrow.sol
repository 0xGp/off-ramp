// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MeloEscrow
/// @notice Holds a user's USDC per cash-out intent until the fiat payout is attested.
///         Success releases to the payee fixed at deposit; failure or timeout refunds the depositor.
/// @dev Only the ERC-20 interface of the token is used. On Arc, USDC is also the native gas
///      token (18 decimals natively, 6 via ERC-20); this contract never accepts native value.
contract MeloEscrow is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Escrowed,
        Released,
        Refunded
    }

    enum RefundReason {
        PayoutFailed,
        Timeout
    }

    uint8 public constant OUTCOME_PAYOUT_SUCCEEDED = 1;
    uint8 public constant OUTCOME_PAYOUT_FAILED = 2;

    uint64 public constant MIN_REFUND_DELAY = 30 minutes;
    uint64 public constant MAX_REFUND_DELAY = 24 hours;

    /// @notice Signed by the MELO quote signer after a quote is locked.
    struct DepositTerms {
        bytes32 intentId;
        address depositor;
        address token;
        uint256 amount;
        address payee;
        bytes32 recipientCommitment;
        uint64 quoteExpiry;
        uint64 refundAfter;
    }

    /// @notice Signed by attestors once the payout provider reports a final outcome.
    struct Attestation {
        bytes32 intentId;
        uint8 outcome;
        bytes32 evidenceHash;
        uint64 expiry;
    }

    struct Escrow {
        address depositor;
        uint64 refundAfter;
        Status status;
        address token;
        address payee;
        uint256 amount;
    }

    bytes32 public constant DEPOSIT_TERMS_TYPEHASH = keccak256(
        "DepositTerms(bytes32 intentId,address depositor,address token,uint256 amount,address payee,bytes32 recipientCommitment,uint64 quoteExpiry,uint64 refundAfter)"
    );

    bytes32 public constant ATTESTATION_TYPEHASH =
        keccak256("Attestation(bytes32 intentId,uint8 outcome,bytes32 evidenceHash,uint64 expiry)");

    mapping(bytes32 intentId => Escrow) private _escrows;

    /// @notice Per-deposit cap per token. Zero means the token is not accepted.
    mapping(address token => uint256 maxAmount) public tokenMaxAmount;

    /// @notice Sum of amounts currently escrowed per token; anything above it is surplus.
    mapping(address token => uint256 total) public totalEscrowed;

    address public quoteSigner;

    mapping(address account => bool enabled) public isAttestor;
    uint256 public attestorCount;
    uint256 public threshold;

    event Deposited(
        bytes32 indexed intentId,
        address indexed depositor,
        address indexed token,
        uint256 amount,
        address payee,
        bytes32 recipientCommitment,
        uint64 refundAfter
    );
    event Released(bytes32 indexed intentId, address indexed payee, uint256 amount, bytes32 evidenceHash);
    event Refunded(
        bytes32 indexed intentId, address indexed depositor, uint256 amount, RefundReason reason, bytes32 evidenceHash
    );

    event QuoteSignerUpdated(address indexed previous, address indexed current);
    event AttestorUpdated(address indexed attestor, bool enabled);
    event ThresholdUpdated(uint256 previous, uint256 current);
    event TokenConfigured(address indexed token, uint256 maxAmount);
    event SurplusSwept(address indexed token, address indexed to, uint256 amount);

    error ZeroAddress();
    error NotDepositor();
    error QuoteExpired();
    error TokenNotAccepted();
    error InvalidAmount();
    error InvalidRefundWindow();
    error IntentAlreadyExists();
    error InvalidQuoteSignature();
    error BalanceMismatch();
    error NotEscrowed();
    error AttestationExpired();
    error InvalidOutcome();
    error InsufficientSignatures();
    error InvalidAttestorSignature();
    error RefundNotYetAvailable();
    error InvalidThreshold();
    error AttestorUnchanged();
    error RenounceDisabled();

    constructor(address initialOwner, address initialQuoteSigner, address[] memory attestors, uint256 initialThreshold)
        EIP712("MeloEscrow", "1")
        Ownable(initialOwner)
    {
        _setQuoteSigner(initialQuoteSigner);
        for (uint256 i = 0; i < attestors.length; i++) {
            _setAttestor(attestors[i], true);
        }
        _setThreshold(initialThreshold);
    }

    // ---------------------------------------------------------------------
    // User flow
    // ---------------------------------------------------------------------

    /// @notice Locks `terms.amount` of `terms.token` for `terms.intentId`.
    /// @dev Caller must have approved this contract for at least `terms.amount`.
    function deposit(DepositTerms calldata terms, bytes calldata quoteSignature) external nonReentrant whenNotPaused {
        if (msg.sender != terms.depositor) revert NotDepositor();
        if (block.timestamp > terms.quoteExpiry) revert QuoteExpired();
        if (terms.payee == address(0)) revert ZeroAddress();

        uint256 cap = tokenMaxAmount[terms.token];
        if (cap == 0) revert TokenNotAccepted();
        if (terms.amount == 0 || terms.amount > cap) revert InvalidAmount();

        if (
            terms.refundAfter < block.timestamp + MIN_REFUND_DELAY
                || terms.refundAfter > block.timestamp + MAX_REFUND_DELAY
        ) revert InvalidRefundWindow();

        Escrow storage e = _escrows[terms.intentId];
        if (e.status != Status.None) revert IntentAlreadyExists();

        address signer = ECDSA.recover(hashDepositTerms(terms), quoteSignature);
        if (signer != quoteSigner) revert InvalidQuoteSignature();

        e.depositor = terms.depositor;
        e.refundAfter = terms.refundAfter;
        e.status = Status.Escrowed;
        e.token = terms.token;
        e.payee = terms.payee;
        e.amount = terms.amount;
        totalEscrowed[terms.token] += terms.amount;

        IERC20 token = IERC20(terms.token);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), terms.amount);
        if (token.balanceOf(address(this)) - balanceBefore != terms.amount) revert BalanceMismatch();

        emit Deposited(
            terms.intentId,
            terms.depositor,
            terms.token,
            terms.amount,
            terms.payee,
            terms.recipientCommitment,
            terms.refundAfter
        );
    }

    /// @notice Finalizes an intent from attestor signatures. Anyone may submit.
    /// @dev Signatures must come from distinct attestors, ordered by ascending signer address.
    ///      Still callable after `refundAfter` while the intent is escrowed: the first of
    ///      `settle` and `refund` to land wins.
    function settle(Attestation calldata attestation, bytes[] calldata signatures) external nonReentrant whenNotPaused {
        Escrow storage e = _escrows[attestation.intentId];
        if (e.status != Status.Escrowed) revert NotEscrowed();
        if (block.timestamp > attestation.expiry) revert AttestationExpired();
        if (attestation.outcome != OUTCOME_PAYOUT_SUCCEEDED && attestation.outcome != OUTCOME_PAYOUT_FAILED) {
            revert InvalidOutcome();
        }
        _verifyAttestors(hashAttestation(attestation), signatures);

        uint256 amount = e.amount;
        totalEscrowed[e.token] -= amount;

        if (attestation.outcome == OUTCOME_PAYOUT_SUCCEEDED) {
            e.status = Status.Released;
            IERC20(e.token).safeTransfer(e.payee, amount);
            emit Released(attestation.intentId, e.payee, amount, attestation.evidenceHash);
        } else {
            e.status = Status.Refunded;
            IERC20(e.token).safeTransfer(e.depositor, amount);
            emit Refunded(attestation.intentId, e.depositor, amount, RefundReason.PayoutFailed, attestation.evidenceHash);
        }
    }

    /// @notice Returns escrowed funds to the depositor once `refundAfter` has passed.
    ///         Permissionless and not blocked by pause.
    function refund(bytes32 intentId) external nonReentrant {
        Escrow storage e = _escrows[intentId];
        if (e.status != Status.Escrowed) revert NotEscrowed();
        if (block.timestamp < e.refundAfter) revert RefundNotYetAvailable();

        uint256 amount = e.amount;
        totalEscrowed[e.token] -= amount;
        e.status = Status.Refunded;

        IERC20(e.token).safeTransfer(e.depositor, amount);
        emit Refunded(intentId, e.depositor, amount, RefundReason.Timeout, bytes32(0));
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getEscrow(bytes32 intentId) external view returns (Escrow memory) {
        return _escrows[intentId];
    }

    function hashDepositTerms(DepositTerms calldata terms) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    DEPOSIT_TERMS_TYPEHASH,
                    terms.intentId,
                    terms.depositor,
                    terms.token,
                    terms.amount,
                    terms.payee,
                    terms.recipientCommitment,
                    terms.quoteExpiry,
                    terms.refundAfter
                )
            )
        );
    }

    function hashAttestation(Attestation calldata attestation) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ATTESTATION_TYPEHASH,
                    attestation.intentId,
                    attestation.outcome,
                    attestation.evidenceHash,
                    attestation.expiry
                )
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------------
    // Admin (owner = multisig outside local testing)
    // ---------------------------------------------------------------------

    function setQuoteSigner(address newSigner) external onlyOwner {
        _setQuoteSigner(newSigner);
    }

    function setAttestor(address attestor, bool enabled) external onlyOwner {
        _setAttestor(attestor, enabled);
        if (threshold > attestorCount) revert InvalidThreshold();
    }

    function setThreshold(uint256 newThreshold) external onlyOwner {
        _setThreshold(newThreshold);
    }

    /// @notice Sets the per-deposit cap for `token`; zero stops new deposits in it.
    ///         Existing escrows are unaffected.
    function configureToken(address token, uint256 maxAmount) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        tokenMaxAmount[token] = maxAmount;
        emit TokenConfigured(token, maxAmount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Recovers tokens sent here directly (not via `deposit`). Never touches escrowed funds.
    function sweepSurplus(address token, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 surplus = IERC20(token).balanceOf(address(this)) - totalEscrowed[token];
        if (surplus == 0) revert InvalidAmount();
        IERC20(token).safeTransfer(to, surplus);
        emit SurplusSwept(token, to, surplus);
    }

    /// @dev Losing the owner would freeze attestor rotation; ownership moves only via Ownable2Step.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _verifyAttestors(bytes32 digest, bytes[] calldata signatures) private view {
        if (signatures.length < threshold) revert InsufficientSignatures();
        address previous = address(0);
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ECDSA.recover(digest, signatures[i]);
            if (!isAttestor[signer] || signer <= previous) revert InvalidAttestorSignature();
            previous = signer;
        }
    }

    function _setQuoteSigner(address newSigner) private {
        if (newSigner == address(0)) revert ZeroAddress();
        emit QuoteSignerUpdated(quoteSigner, newSigner);
        quoteSigner = newSigner;
    }

    function _setAttestor(address attestor, bool enabled) private {
        if (attestor == address(0)) revert ZeroAddress();
        if (isAttestor[attestor] == enabled) revert AttestorUnchanged();
        isAttestor[attestor] = enabled;
        if (enabled) {
            attestorCount += 1;
        } else {
            attestorCount -= 1;
        }
        emit AttestorUpdated(attestor, enabled);
    }

    function _setThreshold(uint256 newThreshold) private {
        if (newThreshold == 0 || newThreshold > attestorCount) revert InvalidThreshold();
        emit ThresholdUpdated(threshold, newThreshold);
        threshold = newThreshold;
    }
}
