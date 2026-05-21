import { measure } from 'measure-fn';
import { config } from './config';
import { getMetaNumber, setMeta } from './database';

export interface TreasuryStrategyDecision {
    attempted: boolean;
    enabled: boolean;
    liquidSol: number;
    liquidTargetSol: number;
    liquidFloorSol: number;
    rebalanceMinSol: number;
    idleAsset: string;
    action: 'disabled' | 'hold' | 'park' | 'unwind';
    amountSol: number;
    reason: string;
    at: number;
}

export function evaluateTreasuryStrategy(now = Date.now()): TreasuryStrategyDecision {
    const strategy = config.treasuryStrategy;
    const liquidSol = getMetaNumber('treasuryBalanceSol', 0);

    if (!strategy.enabled) {
        return {
            attempted: false,
            enabled: false,
            liquidSol,
            liquidTargetSol: strategy.liquidTargetSol,
            liquidFloorSol: strategy.liquidFloorSol,
            rebalanceMinSol: strategy.rebalanceMinSol,
            idleAsset: strategy.idleAsset,
            action: 'disabled',
            amountSol: 0,
            reason: 'treasury-strategy-disabled',
            at: now,
        };
    }

    if (liquidSol < strategy.liquidFloorSol) {
        return {
            attempted: true,
            enabled: true,
            liquidSol,
            liquidTargetSol: strategy.liquidTargetSol,
            liquidFloorSol: strategy.liquidFloorSol,
            rebalanceMinSol: strategy.rebalanceMinSol,
            idleAsset: strategy.idleAsset,
            action: 'unwind',
            amountSol: Math.max(0, strategy.liquidTargetSol - liquidSol),
            reason: 'liquid-below-floor',
            at: now,
        };
    }

    const surplusSol = liquidSol - strategy.liquidTargetSol;
    if (surplusSol >= strategy.rebalanceMinSol) {
        return {
            attempted: true,
            enabled: true,
            liquidSol,
            liquidTargetSol: strategy.liquidTargetSol,
            liquidFloorSol: strategy.liquidFloorSol,
            rebalanceMinSol: strategy.rebalanceMinSol,
            idleAsset: strategy.idleAsset,
            action: 'park',
            amountSol: surplusSol,
            reason: 'liquid-above-target',
            at: now,
        };
    }

    return {
        attempted: true,
        enabled: true,
        liquidSol,
        liquidTargetSol: strategy.liquidTargetSol,
        liquidFloorSol: strategy.liquidFloorSol,
        rebalanceMinSol: strategy.rebalanceMinSol,
        idleAsset: strategy.idleAsset,
        action: 'hold',
        amountSol: 0,
        reason: 'within-target-band',
        at: now,
    };
}

export async function runTreasuryStrategyPass(now = Date.now()) {
    return await measure('Run treasury strategy pass', async () => {
        const decision = evaluateTreasuryStrategy(now);

        setMeta('treasuryStrategyLastRunAt', decision.at);
        setMeta('treasuryStrategyLastAction', decision.action);
        setMeta('treasuryStrategyLastAmountSol', decision.amountSol);
        setMeta('treasuryStrategyLastReason', decision.reason);
        setMeta('treasuryStrategyIdleAsset', decision.idleAsset);

        return decision;
    });
}
