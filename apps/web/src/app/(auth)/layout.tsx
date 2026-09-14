export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-bold tracking-tight">MeManager</h1>
        <p className="text-sm text-muted">家族で共有する、暮らしの管理</p>
      </header>
      {children}
    </main>
  );
}
