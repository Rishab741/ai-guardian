"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { landingPath, useSession } from "@/components/AuthGate";

/** Each role lands on its own workspace. */
export default function Home() {
  const { me } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (me) router.replace(landingPath(me));
  }, [me, router]);
  return null;
}
