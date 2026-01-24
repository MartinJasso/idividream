export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
        Welcome to Idividream
      </h1>
      <p className="text-lg text-slate-300">
        Your Next.js + TypeScript + Tailwind starter is ready to build.
      </p>
      <div className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200">
        Run <span className="font-semibold text-white">npm run dev</span> to
        start.
      </div>
    </main>
  );
}
