import { measure } from 'measure-fn';
import { config } from './config';
import { getMetaNumber, recordTreasuryStrategyEvent, setMeta } from './database';
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
    parkedSolEquivalent: number;
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
    const parkedSolEquivalent = getMetaNumber('treasuryStrategyParkedSolEquivalent', 0);
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
            parkedSolEquivalent,
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
            parkedSolEquivalent,
            rebalanceMinSol: strategy.rebalanceMinSol,
            idleAsset: strategy.idleAsset,
            action: 'unwind',
            amountSol: Math.min(Math.max(0, dynamicLiquidTargetSol - liquidSol), parkedSolEquivalent),
            reason: parkedSolEquivalent > 0 ? 'liquid-below-floor' : 'liquid-below-floor-no-parked-balance',
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
            parkedSolEquivalent,
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
        parkedSolEquivalent,
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
        const strategyEnabled = config.treasuryStrategy.enabled ? 1 : 0;

        setMeta('treasuryStrategyEnabled', strategyEnabled);
        setMeta('treasuryStrategyLastRunAt', decision.at);
        setMeta('treasuryStrategyLastAction', decision.action);
        setMeta('treasuryStrategyLastAmountSol', decision.amountSol);
        setMeta('treasuryStrategyLastReason', decision.reason);
        setMeta('treasuryStrategyIdleAsset', decision.idleAsset);
        setMeta('treasuryStrategyLastEligibleClaimableSol', decision.eligibleClaimableSol);
        setMeta('treasuryStrategyLastEligibleHolderCount', decision.eligibleHolderCount);
        setMeta('treasuryStrategyLastCoverageRatio', decision.coverageRatio);
        setMeta('treasuryStrategyLastLiquidTargetSol', decision.liquidTargetSol);

        if (decision.action === 'park') {
            recordTreasuryStrategyEvent({
                action: decision.action,
                status: 'planned',
                idleAsset: decision.idleAsset,
                amountSol: decision.amountSol,
                parkedSolEquivalent: decision.parkedSolEquivalent,
                liquidSol: decision.liquidSol,
                liquidTargetSol: decision.liquidTargetSol,
                eligibleClaimableSol: decision.eligibleClaimableSol,
                eligibleHolderCount: decision.eligibleHolderCount,
                coverageRatio: decision.coverageRatio,
                reason: decision.reason,
                timestamp: decision.at,
            });
        } else if (decision.action === 'unwind') {
            recordTreasuryStrategyEvent({
                action: decision.action,
                status: decision.amountSol > 0 ? 'planned' : 'skipped',
                idleAsset: decision.idleAsset,
                amountSol: decision.amountSol,
                parkedSolEquivalent: decision.parkedSolEquivalent,
                liquidSol: decision.liquidSol,
                liquidTargetSol: decision.liquidTargetSol,
                eligibleClaimableSol: decision.eligibleClaimableSol,
                eligibleHolderCount: decision.eligibleHolderCount,
                coverageRatio: decision.coverageRatio,
                reason: decision.reason,
                timestamp: decision.at,
            });
        }

        return decision;
    });
}
