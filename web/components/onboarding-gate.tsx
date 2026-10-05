"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BACKEND_URL, useMe } from "@/lib/api/account";
import { useWallet } from "@/lib/use-wallet";

/** Pages a signed-in user can see before finishing account setup. */
const OPEN_PATHS = ["/account/setup", "/landing"];

/** Right after sign-in, account setup comes first: until it's complete, every other page redirects to it. */
export function OnboardingGate() {
  const router = useRouter();
  const pathname = usePathname();
  const { signedIn } = useWallet();
  const me = useMe();
  const incomplete = !!BACKEND_URL && signedIn && me.data !== undefined && !me.data.onboarding.complete;
  const open = OPEN_PATHS.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (incomplete && !open) router.replace(`/account/setup?next=${encodeURIComponent(pathname)}`);
  }, [incomplete, open, pathname, router]);

  return null;
}
