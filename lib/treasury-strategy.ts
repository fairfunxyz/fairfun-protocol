import { measure } from 'measure-fn';
import { config } from './config';
import { getMetaNumber, setMeta } from './database';
import { getClaimerPressureSnapshot } from './auto-claims';

export interface TreasuryStrategyDecision {
    attempted: boolean;
    enabled: boolean;
    liquidSol: number;
    liquidTargetSol: number;
    liquidFloorSol: number;
    eligibleClaimableSol: number;
    eligibleHolderCount: number;
    coverageRatio: number;
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
    const pressure = getClaimerPressureSnapshot();
    const dynamicLiquidTargetSol = Math.max(
        strategy.liquidTargetSol,
        Math.min(Math.max(pressure.eligibleClaimableSol, strategy.liquidFloorSol), strategy.liquidTargetSol * 3),
    );

    if (!strategy.enabled) {
        return {
            attempted: false,
            enabled: false,
            liquidSol,
            liquidTargetSol: dynamicLiquidTargetSol,
            liquidFloorSol: strategy.liquidFloorSol,
            eligibleClaimableSol: pressure.eligibleClaimableSol,
            eligibleHolderCount: pressure.eligibleHolderCount,
            coverageRatio: pressure.coverageRatio,
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
            liquidTargetSol: dynamicLiquidTargetSol,
            liquidFloorSol: strategy.liquidFloorSol,
            eligibleClaimableSol: pressure.eligibleClaimableSol,
            eligibleHolderCount: pressure.eligibleHolderCount,
            coverageRatio: pressure.coverageRatio,
            rebalanceMinSol: strategy.rebalanceMinSol,
            idleAsset: strategy.idleAsset,
            action: 'unwind',
            amountSol: Math.max(0, dynamicLiquidTargetSol - liquidSol),
            reason: 'liquid-below-floor',
            at: now,
        };
    }

    const surplusSol = liquidSol - dynamicLiquidTargetSol;
    if (surplusSol >= strategy.rebalanceMinSol) {
        return {
            attempted: true,
            enabled: true,
            liquidSol,
            liquidTargetSol: dynamicLiquidTargetSol,
            liquidFloorSol: strategy.liquidFloorSol,
            eligibleClaimableSol: pressure.eligibleClaimableSol,
            eligibleHolderCount: pressure.eligibleHolderCount,
            coverageRatio: pressure.coverageRatio,
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
        liquidTargetSol: dynamicLiquidTargetSol,
        liquidFloorSol: strategy.liquidFloorSol,
        eligibleClaimableSol: pressure.eligibleClaimableSol,
        eligibleHolderCount: pressure.eligibleHolderCount,
        coverageRatio: pressure.coverageRatio,
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
        setMeta('treasuryStrategyLastEligibleClaimableSol', decision.eligibleClaimableSol);
        setMeta('treasuryStrategyLastEligibleHolderCount', decision.eligibleHolderCount);
        setMeta('treasuryStrategyLastCoverageRatio', decision.coverageRatio);
        setMeta('treasuryStrategyLastLiquidTargetSol', decision.liquidTargetSol);

        return decision;
    });
}
