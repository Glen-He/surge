export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { seedDefaultUser } = await import("./lib/seed");
    await seedDefaultUser();
    const { purgeExpiredDeletions } = await import("./lib/account-deletion");
    await purgeExpiredDeletions();
  }
}
