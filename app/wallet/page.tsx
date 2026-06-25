"use client";

import { useEffect, useState } from "react";

type Purchase = {
  shopify_order_id: string;
  minutes_purchased: number;
  created_at: string;
};

type Transaction = {
  type: string;
  minutes: number;
  source: string;
  notes: string;
  created_at: string;
};

export default function WalletPage() {
  const [loading, setLoading] = useState(true);

const [wallet, setWallet] = useState<{
  email: string;
  secondsBalance: number;
  displayBalance: string;
  purchases: Purchase[];
  transactions: Transaction[];
} | null>(null);

useEffect(() => {
  async function loadWallet() {
    try {
      //
      // Ask our server who is logged in
      //
      const meRes = await fetch("/api/customer/me");
      const me = await meRes.json();

      if (!me.authenticated) {
        window.location.href = "/";
        return;
      }

      //
      // Load that customer's wallet
      //
      const walletRes = await fetch("/api/wallet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: me.email,
        }),
      });

      const walletData = await walletRes.json();

      setWallet(walletData);
    } catch (error) {
      console.error("[Wallet Load Error]", error);
    } finally {
      setLoading(false);
    }
  }

  loadWallet();
}, []);

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        Loading Chef-it wallet...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white px-5 py-8">
      <div className="max-w-5xl mx-auto">
        <p className="uppercase tracking-[0.3em] text-zinc-500 text-sm">
          Chef-it Wallet
        </p>

        <h1 className="mt-4 text-4xl sm:text-5xl font-bold">
          Welcome back
        </h1>

        <p className="mt-3 text-zinc-400">{wallet?.email}</p>

        <section className="mt-8 rounded-3xl border border-zinc-800 bg-zinc-950 p-8">
          <p className="text-zinc-400">Available Time</p>
          <p className="mt-3 text-6xl font-bold">
            {wallet?.displayBalance || "0:00"}
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-4">
            <a
              href="/avatar"
              className="rounded-full bg-white text-black px-6 py-4 text-center font-semibold"
            >
              Start Chef George
            </a>

            <a
              href="/"
              className="rounded-full bg-zinc-800 text-white px-6 py-4 text-center font-semibold"
            >
              Buy More Minutes
            </a>
          </div>
        </section>

        <section className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-2xl font-bold">Recent Purchases</h2>

            <div className="mt-5 space-y-3">
              {wallet?.purchases?.length ? (
                wallet.purchases.map((purchase) => (
                  <div
                    key={purchase.shopify_order_id}
                    className="rounded-2xl bg-zinc-900 p-4"
                  >
                    <p className="font-semibold">
                      {purchase.minutes_purchased} Minute Chef Session
                    </p>
                    <p className="text-sm text-zinc-500">
                      Order #{purchase.shopify_order_id}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {new Date(purchase.created_at).toLocaleString()}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-zinc-500">No purchases yet.</p>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-2xl font-bold">Wallet Activity</h2>

            <div className="mt-5 space-y-3">
              {wallet?.transactions?.length ? (
                wallet.transactions.map((transaction, index) => (
                  <div key={index} className="rounded-2xl bg-zinc-900 p-4">
                    <p className="font-semibold capitalize">
                      {transaction.type}: {transaction.minutes} min
                    </p>
                    <p className="text-sm text-zinc-500">
                      {transaction.source}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {transaction.notes}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {new Date(transaction.created_at).toLocaleString()}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-zinc-500">No wallet activity yet.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}