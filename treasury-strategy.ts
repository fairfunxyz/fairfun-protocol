import { configure, measure, measureSync } from 'measure-fn';
import { config } from './lib/config';
import { runTreasuryStrategyPass } from './lib/treasury-strategy';

configure({
    timestamps: true,
    maxResultLength: 160,
});

let interval: ReturnType<typeof setInterval> | null = null;

async function runPass() {
    const result = await runTreasuryStrategyPass();
    measureSync('Treasury strategy pass complete', () => result);
}

await measure.assert('Start FairFun treasury strategy worker', async () => {
    await runPass();
    interval = setInterval(() => {
        void runPass().catch((error) => {
            console.error('[TreasuryStrategy] Pass failed:', error);
        });
    }, config.treasuryStrategy.intervalMs);
    measureSync('Treasury strategy worker ready', () => ({
        enabled: config.treasuryStrategy.enabled,
        intervalMs: config.treasuryStrategy.intervalMs,
        liquidTargetSol: config.treasuryStrategy.liquidTargetSol,
        liquidFloorSol: config.treasuryStrategy.liquidFloorSol,
        rebalanceMinSol: config.treasuryStrategy.rebalanceMinSol,
        idleAsset: config.treasuryStrategy.idleAsset,
    }));
});

const shutdown = (signal: string) => {
    measureSync(`Stop treasury strategy worker (${signal})`, () => {
        if (interval) clearInterval(interval);
        interval = null;
        return 'stopped';
    });
    process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
