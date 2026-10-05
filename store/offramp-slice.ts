import { createAsyncThunk, createSlice, nanoid, type PayloadAction } from "@reduxjs/toolkit";
import { DEFAULT_CHAIN, getChain, isSupportedChainId } from "@/lib/chains";
import { api, ERROR_COPY, toApiError, type ApiErrorCode, type QuoteOffer } from "@/lib/api";
import { parseUnits } from "@/lib/money";

export interface DraftRecipient {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  /** False when the name came from a development placeholder, not the bank. */
  nameVerified: boolean;
}

export interface FlowError {
  code: ApiErrorCode;
  message: string;
}

/**
 * Client-side draft only. Intent status, activity and receipts are server
 * state fetched through the API client, never stored here.
 */
export interface OfframpState {
  /** False until the session draft has been read on the client. */
  hydrated: boolean;
  /** Lets reviewers walk the flow without a wallet; never signs anything. */
  preview: boolean;
  /** Network the user pays from; the escrow is deployed per chain. */
  chainId: number;
  amount: string;
  recipient: DraftRecipient | null;
  /** Idempotency key for creating the intent; rotates whenever the details change. */
  draftKey: string;
  intentId: string | null;
  offer: QuoteOffer | null;
  quoteStatus: "idle" | "loading" | "error";
  quoteError: FlowError | null;
  /** Intents whose payment-successful modal has been dismissed. */
  receiptsSeen: string[];
}

export type PersistedOfframp = Pick<
  OfframpState,
  "preview" | "chainId" | "amount" | "draftKey" | "intentId" | "offer" | "receiptsSeen"
>;

const initialState: OfframpState = {
  hydrated: false,
  preview: false,
  chainId: DEFAULT_CHAIN.id,
  amount: "",
  recipient: null,
  draftKey: "",
  intentId: null,
  offer: null,
  quoteStatus: "idle",
  quoteError: null,
  receiptsSeen: [],
};

/** Creates the intent on first use (idempotently), then requests a fresh quote for it. */
export const requestQuote = createAsyncThunk<
  { intentId: string; offer: QuoteOffer },
  { walletAddress: string | null },
  { state: { offramp: OfframpState }; rejectValue: FlowError }
>("offramp/requestQuote", async ({ walletAddress }, { getState, rejectWithValue }) => {
  const { offramp } = getState();
  const chain = getChain(offramp.chainId);
  const units = parseUnits(offramp.amount, chain.usdc.erc20Decimals);
  if (!offramp.recipient || units === null) {
    return rejectWithValue({ code: "validation", message: ERROR_COPY.validation });
  }

  try {
    let intentId = offramp.intentId;
    if (!intentId) {
      const created = await api.createIntent(
        {
          inputAsset: "USDC",
          inputAmount: units.toString(),
          chainId: chain.id,
          fiatCurrency: "NGN",
          recipient: { bankCode: offramp.recipient.bankCode, accountNumber: offramp.recipient.accountNumber },
          walletAddress,
        },
        { idempotencyKey: offramp.draftKey },
      );
      intentId = created.intentId;
    }
    return { intentId, offer: await api.requestQuote(intentId) };
  } catch (error) {
    const apiError = toApiError(error);
    return rejectWithValue({ code: apiError.code, message: apiError.message });
  }
});

const offrampSlice = createSlice({
  name: "offramp",
  initialState,
  reducers: {
    hydrate(state, action: PayloadAction<Partial<PersistedOfframp> | null>) {
      if (action.payload) Object.assign(state, action.payload);
      if (!isSupportedChainId(state.chainId)) state.chainId = DEFAULT_CHAIN.id;
      state.hydrated = true;
    },
    setPreview(state, action: PayloadAction<boolean>) {
      state.preview = action.payload;
    },
    setChainId: {
      reducer(state, action: PayloadAction<number, string, { draftKey: string }>) {
        if (state.chainId === action.payload) return;
        state.chainId = action.payload;
        state.draftKey = action.meta.draftKey;
        state.intentId = null;
        state.offer = null;
      },
      prepare: (chainId: number) => ({ payload: chainId, meta: { draftKey: nanoid() } }),
    },
    setAmount: {
      reducer(state, action: PayloadAction<string, string, { draftKey: string }>) {
        state.amount = action.payload;
        state.draftKey = action.meta.draftKey;
        state.intentId = null;
        state.offer = null;
      },
      prepare: (amount: string) => ({ payload: amount, meta: { draftKey: nanoid() } }),
    },
    setRecipient: {
      reducer(state, action: PayloadAction<DraftRecipient | null, string, { draftKey: string }>) {
        state.recipient = action.payload;
        state.draftKey = action.meta.draftKey;
        state.intentId = null;
        state.offer = null;
      },
      prepare: (recipient: DraftRecipient | null) => ({ payload: recipient, meta: { draftKey: nanoid() } }),
    },
    clearQuoteError(state) {
      state.quoteError = null;
      state.quoteStatus = "idle";
    },
    markReceiptSeen(state, action: PayloadAction<string>) {
      if (!state.receiptsSeen.includes(action.payload)) state.receiptsSeen.push(action.payload);
    },
    /** Called once the user lands on tracking, so a back-navigation can't re-authorize the same quote. */
    resetDraft(state) {
      state.amount = "";
      state.recipient = null;
      state.intentId = null;
      state.offer = null;
      state.quoteStatus = "idle";
      state.quoteError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(requestQuote.pending, (state) => {
        state.quoteStatus = "loading";
        state.quoteError = null;
      })
      .addCase(requestQuote.fulfilled, (state, action) => {
        state.quoteStatus = "idle";
        state.intentId = action.payload.intentId;
        state.offer = action.payload.offer;
      })
      .addCase(requestQuote.rejected, (state, action) => {
        state.quoteStatus = "error";
        state.quoteError = action.payload ?? { code: "network", message: ERROR_COPY.network };
      });
  },
});

export const {
  hydrate,
  setPreview,
  setChainId,
  setAmount,
  setRecipient,
  clearQuoteError,
  markReceiptSeen,
  resetDraft,
} = offrampSlice.actions;

export default offrampSlice.reducer;
