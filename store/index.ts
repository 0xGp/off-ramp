import { configureStore } from "@reduxjs/toolkit";
import offrampReducer from "./offramp-slice";

export function makeStore() {
  return configureStore({
    reducer: {
      offramp: offrampReducer,
    },
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
