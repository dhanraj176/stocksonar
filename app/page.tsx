import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-3xl font-semibold">StockSonar</h1>
      <p className="max-w-md">
        Record why you own each stock. StockSonar tracks the evidence for and against that reason,
        with every claim linked to its source. Research, not advice.
      </p>
      <div className="flex gap-4">
        <Link href="/signup" className="rounded-md bg-foreground px-4 py-2 font-medium text-background">
          Create an account
        </Link>
        <Link href="/login" className="rounded-md border border-black/15 px-4 py-2 dark:border-white/20">
          Log in
        </Link>
      </div>
    </main>
  );
}
