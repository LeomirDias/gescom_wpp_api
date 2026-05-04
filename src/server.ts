import { app } from "./app";
import { env } from "./config/env";
import { startSendTextMessageWorker } from "./modules/mensagens/mensagem-texto/worker";
import { startSendDocumentMessageWorker } from "./modules/mensagens/mensagem-documento/worker-documento";
import type { QueueSubscription } from "./shared/queue/queue-connection.interface";
import {
  initializeAuditStore,
  shutdownAuditStore,
} from "./shared/audit/redis-audit-store";
import {
  initializeQueueConnection,
  shutdownQueueConnection,
} from "./shared/queue/queue-factory";

initializeQueueConnection();
initializeAuditStore();

const workerSubscriptions: QueueSubscription[] = [];

const bootstrapWorkers = async (): Promise<void> => {
  workerSubscriptions.push(await startSendTextMessageWorker());
  workerSubscriptions.push(await startSendDocumentMessageWorker());
};

void bootstrapWorkers().catch((error: unknown) => {
  console.error({
    event: "worker_bootstrap_error",
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});

const server = app.listen(env.PORT, () => {
  console.info(`Servidor rodando na porta ${env.PORT}`);
});

const gracefulShutdown = async (signal: NodeJS.Signals): Promise<void> => {
  console.info({ event: "shutdown_signal_received", signal });

  while (workerSubscriptions.length > 0) {
    const subscription = workerSubscriptions.pop();
    if (!subscription) {
      continue;
    }

    try {
      subscription.unsubscribe();
    } catch (error: unknown) {
      console.error({
        event: "worker_unsubscribe_error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await shutdownQueueConnection();
  await shutdownAuditStore();

  server.close((error?: Error) => {
    if (error) {
      console.error({ event: "http_server_close_error", error: error.message });
      process.exit(1);
    }

    process.exit(0);
  });
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void gracefulShutdown(signal);
  });
}
