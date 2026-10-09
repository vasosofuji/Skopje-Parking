import { createApp } from "./bootstrap";
async function main() {
  const app = await createApp();
  await app.listen({
    port: Number(process.env.PORT ?? 3001),
    host: process.env.HOST ?? "127.0.0.1",
  });
  console.log(
    `ParkSkopje API listening at http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? "3001"}`,
  );
  const close = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
