import {
  disconnectPrismaClient,
  getPrismaClient,
  PrismaCustomerProjectionRepository,
} from '../src';
import {
  CustomerProjectionRepairCommandError,
  runCustomerProjectionRepairCommand,
} from '../src/consumer-crm/customer-projection-repair-command';

async function main(): Promise<void> {
  try {
    const repository = new PrismaCustomerProjectionRepository(getPrismaClient());
    const result = await runCustomerProjectionRepairCommand(repository, process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code =
      error instanceof CustomerProjectionRepairCommandError
        ? error.code
        : 'customer_projection_repair_failed';
    process.stderr.write(`${JSON.stringify({ outcome: 'failed', code })}\n`);
    process.exitCode = 1;
  } finally {
    await disconnectPrismaClient();
  }
}

void main();
